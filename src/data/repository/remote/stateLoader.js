import { ADMIN_AUDIT_COLUMNS, ADMIN_DISCIPLINARY_COLUMNS, AFFILIATION_COLUMNS, APPOINTMENT_COLUMNS, APPROVED_COURT_COLUMNS, COURT_COLUMNS, COURT_REQUEST_COLUMNS, COURT_REVIEW_COLUMNS, DISCORD_DELIVERY_COLUMNS, FAVORITE_COLUMNS, MATCH_AGREEMENT_COLUMNS, MATCH_APPROVAL_COLUMNS, MATCH_COLUMNS, MATCH_DISPUTE_COLUMNS, MATCH_PLAYER_COLUMNS, MATCH_RESULT_COLUMNS, NOTIFICATION_COLUMNS, PLAYER_STAT_COLUMNS, PRIVATE_PROFILE_COLUMNS, PROFILE_SETTINGS_COLUMNS, PUBLIC_PROFILE_COLUMNS, RECRUITING_APPLICATION_COLUMNS, RECRUITING_POST_COLUMNS, REFEREE_EXAM_ATTEMPT_COLUMNS, REFEREE_REQUEST_COLUMNS, REPORT_COLUMNS, SEASON_COLUMNS, TEAM_COLUMNS, TEAM_INVITATION_COLUMNS, TEAM_MEMBER_COLUMNS, TOURNAMENT_COLUMNS, TOURNAMENT_TEAM_COLUMNS } from "../../repositoryColumns.js";
import { DEFAULT_RATING, DEFAULT_TOURNAMENT_MMR_GAP, REFEREE_TRUST_MIN, REMOTE_CLIENT_MATCH_LIMIT, REMOTE_CLIENT_RECRUITING_LIMIT, REMOTE_CLIENT_TOURNAMENT_LIMIT, STAT_ENTRY_WINDOW_MINUTES, TEST_PROFILE_AGE_GROUP, TEST_PROFILE_AGE_GROUP_SEASON, TEST_PROFILE_BIRTH_YEAR, TEST_PROFILE_SETUP_AT, normalizeDisputeWindowMinutes, normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode } from "../../../lib/constants.js";
import { DEFAULT_SETTINGS } from "../../repositoryDefaults.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../../lib/tournamentGovernance.js";
import { applyIdScope, applyUpdatedBefore, composeFilters, fetchAllRows, fetchFilteredRows, fetchOptionalFilteredRows, fetchOptionalRows, fetchRowsByIds, getClientLimit, uniqueRowsById, uniqueScopeIds } from "../../remoteQuery.js";
import { collectMatchPageScope, collectRecruitingPageScope, collectTournamentPageScope, getClientPrivateProfileFilter, getMatchRowReaderIds, makeCurrentUserFromProfiles, mergePublicProfilesIntoProfiles } from "../../remoteScopeUtils.js";
import { createProfileShell, fromRemoteProfile, getProfileRegionSnapshot, getRemoteAppSettings, normalizeRatings } from "../../profileMappers.js";
import { firstBy, getMaxUpdatedAt, groupBy, nullableText, toDateTime } from "../../rowUtils.js";
import { fromRemoteAffiliation } from "../../affiliationMappers.js";
import { fromRemoteApprovedCourt, fromRemoteCourtMetric, fromRemoteCourtRequest, fromRemoteCourtReview, fromRemoteNotification, fromRemotePayloadRow, fromRemoteReport } from "../../remotePayloadMappers.js";
import { fromRemoteMatch } from "../../matchMappers.js";
import { fromRemoteTeam, fromRemoteTeamInvitation } from "../../teamMappers.js";
import { fromRemoteTournament } from "../../tournamentMappers.js";
import { getCourtId } from "../../../lib/courts.js";
import { getDbScheduleParts } from "../../scheduleUtils.js";
import { getDiscordConnectionUserId } from "../../../lib/discord.js";
import { getRecruitingBenchCapacity, getRecruitingRoomOwnerId, getRecruitingSideCapacity, isPublicTeamRecruitingRoom, normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { getUserHashtag } from "../../../lib/handles.js";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase.js";
import { normalizeState } from "../../stateNormalizer.js";
import { projectMatchDbFields, projectPlayerStatRows } from "../../../../shared/lib/matchPersistence.js";
import { projectProfileSettings } from "../../settingsMappers.js";
import { replaceRemoteRecruitingApplications, softDeleteRemoteTeams, upsertOptionalRemoteRows, upsertRemoteRows } from "../../remoteWriteUtils.js";
import { toApprovedCourtRow, toCourtRequestRow, toNotificationRow, toPayloadRow, toReportRow } from "../../remoteRowSerializers.js";
import { fetchCourtRows, fetchCurrentUserReports } from "./loaders.js";
import { fetchScopedDirectoryReferences, mergeScopedProfiles } from "./stateScope.js";

export async function loadNormalizedRemoteStateFromClient(client = supabase, authUserId = "", authEmail = "", options = {}) {
  const clientState = options.clientState === true;
  const scope = String(options.scope || "full");
  const profileScope = scope === "profile";
  const includeMatches = scope === "full" || scope === "matches";
  const includeRecruiting = scope === "full" || scope === "recruiting";
  const includeTournaments = scope === "full" || scope === "tournaments";
  const includeAppMeta = scope === "full";
  const includeUserScoped = scope === "full";
  const includeProfileTeams = includeUserScoped || profileScope;
  const includeProfileSettings = includeUserScoped || profileScope;
  const matchPageScope = scope === "matches";
  const recruitingPageScope = scope === "recruiting";
  const tournamentPageScope = scope === "tournaments";
  const recruitingListOnly = options.recruitingListOnly === true;
  const relatedDirectoryScope = scope === "full" && options.directoryScope === "related";
  const authUserIdText = String(authUserId || "");
  const matchScopeIds = uniqueScopeIds(options.matchIds ?? options.matchId);
  const recruitingScopeIds = uniqueScopeIds(options.recruitingPostIds ?? options.recruitingPostId ?? options.postId);
  const tournamentScopeIds = uniqueScopeIds(options.tournamentIds ?? options.tournamentId);
  const matchListOnly = options.matchListOnly === true && !matchScopeIds.length;
  const tournamentMatchFilter = tournamentPageScope && tournamentScopeIds.length
    ? (query) => applyIdScope(query, "tournament_id", tournamentScopeIds)
    : null;
  const matchFilter = composeFilters(
    matchScopeIds.length ? (query) => applyIdScope(query, "id", matchScopeIds) : null,
    tournamentMatchFilter,
    !matchScopeIds.length && !tournamentMatchFilter
      ? (query) => applyUpdatedBefore(query, "updated_at", options.matchUpdatedBefore ?? options.matchCursor)
      : null,
  );
  const recruitingFilter = composeFilters(
    recruitingScopeIds.length ? (query) => applyIdScope(query, "id", recruitingScopeIds) : null,
    !recruitingScopeIds.length ? (query) => applyUpdatedBefore(query, "updated_at", options.recruitingUpdatedBefore ?? options.recruitingCursor) : null,
  );
  const tournamentFilter = composeFilters(
    tournamentScopeIds.length ? (query) => applyIdScope(query, "id", tournamentScopeIds) : null,
    !tournamentScopeIds.length ? (query) => applyUpdatedBefore(query, "updated_at", options.tournamentUpdatedBefore ?? options.tournamentCursor) : null,
  );
  const privateProfileFilter = (clientState || tournamentPageScope) && authUserIdText
    ? (query) => query.eq("auth_user_id", authUserIdText)
    : null;
  const matchLimit = matchScopeIds.length ? null : clientState ? getClientLimit(options.matchLimit, REMOTE_CLIENT_MATCH_LIMIT) : null;
  const recruitingLimit = recruitingScopeIds.length ? null : clientState ? getClientLimit(options.recruitingLimit, REMOTE_CLIENT_RECRUITING_LIMIT) : null;
  const tournamentLimit = tournamentScopeIds.length ? null : clientState ? getClientLimit(options.tournamentLimit, REMOTE_CLIENT_TOURNAMENT_LIMIT) : null;
  let publicProfiles = [];
  let teams = [];
  let teamMembers = [];
  let courts = [];
  const [
    privateProfiles,
    matches,
    recruitingPosts,
    tournaments,
    seasons,
    affiliations,
  ] = await Promise.all([
    privateProfileFilter
      ? fetchOptionalFilteredRows("profiles", PRIVATE_PROFILE_COLUMNS, "id", client, privateProfileFilter)
      : fetchOptionalRows("profiles", PRIVATE_PROFILE_COLUMNS, "id", client),
    includeMatches || tournamentPageScope ? fetchFilteredRows("matches", MATCH_COLUMNS, "updated_at", client, matchFilter, matchLimit, !matchLimit) : [],
    includeRecruiting ? fetchFilteredRows("recruiting_posts", RECRUITING_POST_COLUMNS, "updated_at", client, recruitingFilter, recruitingLimit, !recruitingLimit) : [],
    includeTournaments ? fetchFilteredRows("tournaments", TOURNAMENT_COLUMNS, "updated_at", client, tournamentFilter, tournamentLimit, !tournamentLimit) : [],
    includeAppMeta ? fetchAllRows("seasons", SEASON_COLUMNS, "id", client) : [],
    includeAppMeta ? fetchAllRows("affiliations", AFFILIATION_COLUMNS, "id", client) : [],
  ]);

  if (!profileScope && !matchPageScope && !recruitingPageScope && !tournamentPageScope && !relatedDirectoryScope) {
    [publicProfiles, teams, teamMembers, courts] = await Promise.all([
      fetchOptionalRows("public_profiles", PUBLIC_PROFILE_COLUMNS, "id", client),
      fetchAllRows("teams", TEAM_COLUMNS, "id", client),
      fetchAllRows("team_members", TEAM_MEMBER_COLUMNS, null, client),
      fetchCourtRows(client),
    ]);
  }

  const privateProfileById = new Map((privateProfiles ?? []).map((profile) => [profile.id, profile]));
  const profiles = (publicProfiles ?? []).map((profile) => ({ ...profile, ...(privateProfileById.get(profile.id) ?? {}) }));
  for (const privateProfile of privateProfiles ?? []) {
    if (!profiles.some((profile) => profile.id === privateProfile.id)) profiles.push(privateProfile);
  }

  const currentProfile = authUserIdText
    ? profiles.find((profile) => String(profile.auth_user_id ?? "") === authUserIdText)
    : null;
  const shellUser = authUserIdText && !currentProfile ? createProfileShell(authUserIdText, authEmail) : null;
  const currentUserId = currentProfile?.id ?? shellUser?.id ?? profiles[0]?.id ?? "";
  const isAdminStateLoad = options.isAdmin === true;
  const [favorites, notifications, discordNotificationDeliveries, profileSettingsRows, teamInvitations] = await Promise.all([
    includeUserScoped && currentUserId
      ? fetchFilteredRows("favorites", FAVORITE_COLUMNS, null, client, (query) => query.eq("user_id", currentUserId))
      : [],
    includeUserScoped && currentUserId
      ? fetchOptionalFilteredRows("notifications", NOTIFICATION_COLUMNS, "created_at", client, (query) => query
        .or(`user_id.eq.${currentUserId},target_user_id.eq.${currentUserId}`))
      : [],
    includeUserScoped && currentUserId
      ? fetchOptionalFilteredRows("discord_notification_deliveries", DISCORD_DELIVERY_COLUMNS, "queued_at", client, (query) => query.eq("target_user_id", currentUserId))
      : [],
    includeProfileSettings && currentUserId
      ? fetchOptionalFilteredRows("profiles", PROFILE_SETTINGS_COLUMNS, null, client, (query) => query.eq("id", currentUserId))
      : [],
    includeProfileTeams && currentUserId
      ? fetchOptionalFilteredRows("team_invitations", TEAM_INVITATION_COLUMNS, "created_at", client, (query) => query
        .or(`from_user_id.eq.${currentUserId},target_user_id.eq.${currentUserId}`))
      : [],
  ]);

  if (profileScope && currentUserId) {
    const currentUserTeamMemberships = await fetchOptionalFilteredRows("team_members", TEAM_MEMBER_COLUMNS, null, client, (query) => query.eq("user_id", currentUserId));
    const teamIds = uniqueScopeIds([
      ...currentUserTeamMemberships.map((member) => member.team_id),
      ...teamInvitations.map((invitation) => invitation.team_id),
    ]);
    const teamMemberRows = await fetchRowsByIds("team_members", TEAM_MEMBER_COLUMNS, "team_id", teamIds, null, client, true);
    const memberProfileIds = uniqueScopeIds(teamMemberRows.map((member) => member.user_id));
    [teams, teamMembers, publicProfiles] = await Promise.all([
      fetchRowsByIds("teams", TEAM_COLUMNS, "id", teamIds, "id", client, true),
      Promise.resolve(teamMemberRows),
      fetchRowsByIds("public_profiles", PUBLIC_PROFILE_COLUMNS, "id", memberProfileIds, "id", client, true),
    ]);
    mergeScopedProfiles(profiles, publicProfiles, privateProfileById);
  }

  const [
    reports,
    courtRequests,
    approvedCourts,
    courtReviews,
    refereeRequests,
    refereeExamAttempts,
    adminAppointments,
    refereeAppointments,
    adminAuditLog,
    adminDisciplinaryActions,
  ] = await Promise.all([
    !includeUserScoped || !currentUserId
      ? []
      : isAdminStateLoad
        ? fetchOptionalRows("reports", REPORT_COLUMNS, "created_at", client)
        : fetchCurrentUserReports(currentUserId, client),
    !includeUserScoped || !currentUserId
      ? []
      : isAdminStateLoad
        ? fetchOptionalRows("court_requests", COURT_REQUEST_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("court_requests", COURT_REQUEST_COLUMNS, "created_at", client, (query) => query.eq("requested_by", currentUserId)),
    !includeUserScoped
      ? []
      : isAdminStateLoad
      ? fetchOptionalRows("approved_courts", APPROVED_COURT_COLUMNS, "created_at", client)
      : fetchOptionalFilteredRows("approved_courts", APPROVED_COURT_COLUMNS, "created_at", client, (query) => query.or("status.is.null,status.eq.active")),
    !includeUserScoped
      ? []
      : isAdminStateLoad
      ? fetchOptionalRows("court_reviews", COURT_REVIEW_COLUMNS, "created_at", client)
      : fetchOptionalFilteredRows("court_reviews", COURT_REVIEW_COLUMNS, "created_at", client, (query) => query.or("status.is.null,status.eq.active")),
    !includeUserScoped || !currentUserId
      ? []
      : isAdminStateLoad
        ? fetchOptionalRows("referee_requests", REFEREE_REQUEST_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("referee_requests", REFEREE_REQUEST_COLUMNS, "created_at", client, (query) => query.eq("requested_by", currentUserId)),
    !includeUserScoped || !currentUserId
      ? []
      : isAdminStateLoad
        ? fetchOptionalRows("referee_exam_attempts", REFEREE_EXAM_ATTEMPT_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("referee_exam_attempts", REFEREE_EXAM_ATTEMPT_COLUMNS, "created_at", client, (query) => query.eq("user_id", currentUserId)),
    !includeUserScoped || !currentUserId
      ? []
      : isAdminStateLoad
        ? fetchOptionalRows("admin_appointments", APPOINTMENT_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("admin_appointments", APPOINTMENT_COLUMNS, "created_at", client, (query) => query.eq("user_id", currentUserId)),
    includeUserScoped ? fetchOptionalRows("referee_appointments", APPOINTMENT_COLUMNS, "created_at", client) : [],
    includeUserScoped && isAdminStateLoad ? fetchOptionalRows("admin_audit_log", ADMIN_AUDIT_COLUMNS, "created_at", client) : [],
    !includeUserScoped || !currentUserId
      ? []
      : isAdminStateLoad
        ? fetchOptionalRows("admin_disciplinary_actions", ADMIN_DISCIPLINARY_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("admin_disciplinary_actions", ADMIN_DISCIPLINARY_COLUMNS, "created_at", client, (query) => query.eq("user_id", currentUserId)),
  ]);
  const loadedMatchIds = matches.map((match) => match.id).filter(Boolean);
  const loadedRecruitingPostIds = recruitingPosts.map((post) => post.id).filter(Boolean);
  const loadedTournamentIds = tournaments.map((tournament) => tournament.id).filter(Boolean);
  const shouldFilterMatchChildren = Boolean(matchScopeIds.length || tournamentMatchFilter || clientState || matchLimit);
  const shouldFilterRecruitingChildren = Boolean(recruitingScopeIds.length || clientState || recruitingLimit);
  const shouldFilterTournamentChildren = Boolean(tournamentScopeIds.length || clientState || tournamentLimit);
  const matchChildFilter = shouldFilterMatchChildren ? (query) => applyIdScope(query, "match_id", loadedMatchIds) : null;
  const recruitingChildFilter = shouldFilterRecruitingChildren ? (query) => applyIdScope(query, "post_id", loadedRecruitingPostIds) : null;
  const tournamentChildFilter = shouldFilterTournamentChildren ? (query) => applyIdScope(query, "tournament_id", loadedTournamentIds) : null;
  const [
    matchPlayers,
    matchResults,
    playerStats,
    agreements,
    approvals,
    disputes,
    recruitingApplications,
    tournamentTeams,
  ] = await Promise.all([
    shouldFilterMatchChildren && !loadedMatchIds.length ? [] : fetchFilteredRows("match_players", MATCH_PLAYER_COLUMNS, null, client, matchChildFilter),
    matchListOnly || (shouldFilterMatchChildren && !loadedMatchIds.length) ? [] : fetchFilteredRows("match_results", MATCH_RESULT_COLUMNS, null, client, matchChildFilter),
    matchListOnly || (shouldFilterMatchChildren && !loadedMatchIds.length) ? [] : fetchFilteredRows("player_match_stats", PLAYER_STAT_COLUMNS, null, client, matchChildFilter),
    matchListOnly || (shouldFilterMatchChildren && !loadedMatchIds.length) ? [] : fetchFilteredRows("match_agreements", MATCH_AGREEMENT_COLUMNS, null, client, matchChildFilter),
    matchListOnly || (shouldFilterMatchChildren && !loadedMatchIds.length) ? [] : fetchFilteredRows("match_approvals", MATCH_APPROVAL_COLUMNS, null, client, matchChildFilter),
    matchListOnly || (shouldFilterMatchChildren && !loadedMatchIds.length) ? [] : fetchOptionalFilteredRows("match_disputes", MATCH_DISPUTE_COLUMNS, null, client, matchChildFilter),
    shouldFilterRecruitingChildren && !loadedRecruitingPostIds.length ? [] : fetchFilteredRows("recruiting_applications", RECRUITING_APPLICATION_COLUMNS, null, client, recruitingChildFilter),
    shouldFilterTournamentChildren && !loadedTournamentIds.length ? [] : fetchFilteredRows("tournament_teams", TOURNAMENT_TEAM_COLUMNS, null, client, tournamentChildFilter),
  ]);

  if (matchPageScope) {
    const scopedProfileIds = [...privateProfiles.map((profile) => profile.id), ...uniqueScopeIds(options.profileIds)];
    const scoped = collectMatchPageScope(matches, matchPlayers, matchResults, playerStats, agreements, approvals, disputes, scopedProfileIds);
    const teamIds = uniqueScopeIds([...scoped.teamIds, ...uniqueScopeIds(options.teamIds)]);
    const teamMemberTeamIds = matchListOnly ? [] : teamIds;
    ({ teams, teamMembers, courts, publicProfiles } = await fetchScopedDirectoryReferences(client, {
      teamIds,
      teamMemberTeamIds,
      courtIds: scoped.courtIds,
      profileIds: scoped.profileIds,
    }));
    mergeScopedProfiles(profiles, publicProfiles, privateProfileById);
  }
  if (recruitingPageScope) {
    const scopedProfileIds = [...privateProfiles.map((profile) => profile.id), ...uniqueScopeIds(options.profileIds)];
    const scoped = collectRecruitingPageScope(recruitingPosts, recruitingApplications, scopedProfileIds);
    const currentUserTeamMemberships = options.includeCurrentUserTeams && currentUserId
      ? await fetchFilteredRows("team_members", TEAM_MEMBER_COLUMNS, null, client, (query) => query.eq("user_id", currentUserId))
      : [];
    const teamIds = uniqueScopeIds([...scoped.teamIds, ...uniqueScopeIds(options.teamIds), ...currentUserTeamMemberships.map((member) => member.team_id)]);
    const teamMemberTeamIds = recruitingListOnly ? [] : teamIds;
    ({ teams, teamMembers, courts, publicProfiles } = await fetchScopedDirectoryReferences(client, {
      teamIds,
      teamMemberTeamIds,
      courtIds: scoped.courtIds,
      profileIds: scoped.profileIds,
    }));
    mergeScopedProfiles(profiles, publicProfiles, privateProfileById);
  }
  if (tournamentPageScope) {
    const scopedProfileIds = [...privateProfiles.map((profile) => profile.id), ...uniqueScopeIds(options.profileIds)];
    const tournamentScope = collectTournamentPageScope(tournaments, tournamentTeams, scopedProfileIds);
    const matchScope = collectMatchPageScope(matches, matchPlayers, matchResults, playerStats, agreements, approvals, disputes, tournamentScope.profileIds);
    const teamIds = uniqueScopeIds([...tournamentScope.teamIds, ...matchScope.teamIds, ...uniqueScopeIds(options.teamIds)]);
    const courtIds = uniqueScopeIds([...tournamentScope.courtIds, ...matchScope.courtIds]);
    const profileIds = uniqueScopeIds([...tournamentScope.profileIds, ...matchScope.profileIds]);
    ({ teams, teamMembers, courts, publicProfiles } = await fetchScopedDirectoryReferences(client, {
      teamIds,
      courtIds,
      profileIds,
    }));
    mergeScopedProfiles(profiles, publicProfiles, privateProfileById);
  }
  if (relatedDirectoryScope) {
    const scopedProfileIds = [
      ...privateProfiles.map((profile) => profile.id),
      ...favorites.filter((favorite) => favorite.target_type === "player").map((favorite) => favorite.target_id),
      ...favorites.filter((favorite) => favorite.target_type === "referee").map((favorite) => favorite.target_id),
    ];
    const scopedTeamIds = favorites.filter((favorite) => favorite.target_type === "team").map((favorite) => favorite.target_id);
    const matchScope = collectMatchPageScope(matches, matchPlayers, matchResults, playerStats, agreements, approvals, disputes, scopedProfileIds);
    const recruitingScope = collectRecruitingPageScope(recruitingPosts, recruitingApplications);
    const tournamentScope = collectTournamentPageScope(tournaments, tournamentTeams);
    const teamIds = uniqueScopeIds([...matchScope.teamIds, ...recruitingScope.teamIds, ...tournamentScope.teamIds, ...scopedTeamIds]);
    const courtIds = uniqueScopeIds([...matchScope.courtIds, ...recruitingScope.courtIds, ...tournamentScope.courtIds]);
    const profileIds = uniqueScopeIds([...matchScope.profileIds, ...recruitingScope.profileIds, ...tournamentScope.profileIds]);
    ({ teams, teamMembers, courts, publicProfiles } = await fetchScopedDirectoryReferences(client, {
      teamIds,
      courtIds,
      profileIds,
    }));
    mergeScopedProfiles(profiles, publicProfiles, privateProfileById);
  }
  const teamMembersByTeam = groupBy(teamMembers, "team_id");
  const teamById = firstBy(teams, "id");
  const courtById = firstBy(courts, "id");
  const context = {
    teamById,
    courtById,
    playersByMatch: groupBy(matchPlayers, "match_id"),
    resultsByMatch: firstBy(matchResults, "match_id"),
    statsByMatch: groupBy(playerStats, "match_id"),
    agreementsByMatch: groupBy(agreements, "match_id"),
    approvalsByMatch: groupBy(approvals, "match_id"),
    disputesByMatch: groupBy(disputes, "match_id"),
  };
  const deletedTeamIds = teams.filter((team) => team.deleted_at).map((team) => team.id);
  const remoteTeams = teams
    .filter((team) => !team.deleted_at)
    .map((team) => fromRemoteTeam(team, teamMembersByTeam.get(team.id)));
  const remoteMatches = matches.map((match) => fromRemoteMatch(match, context)).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  const favoriteRows = favorites.filter((favorite) => favorite.user_id === currentUserId);
  const applicationsByPost = groupBy(recruitingApplications, "post_id");
  const tournamentTeamsByTournament = groupBy(tournamentTeams, "tournament_id");
  const remoteAppSettings = getRemoteAppSettings(profileSettingsRows[0]);

  const remoteUsers = profiles.map(fromRemoteProfile);
  const normalizedState = normalizeState({
    currentUserId,
    deletedTeamIds,
    users: shellUser ? [...remoteUsers, shellUser] : remoteUsers,
    teams: remoteTeams,
    teamInvitations: teamInvitations.map(fromRemoteTeamInvitation),
    matches: remoteMatches,
    affiliations: affiliations
      .filter((affiliation) => affiliation.type !== "club")
      .map(fromRemoteAffiliation),
    seasons: seasons.map((season) => ({
      id: season.id,
      name: season.name,
      subtitle: season.subtitle,
      startsAt: season.starts_at,
      endsAt: season.ends_at,
      active: Boolean(season.active),
      regions: season.regions ?? [],
      promotionLine: season.promotion_line ?? 0,
      rules: season.rules ?? [],
    })),
    notifications: notifications
      .filter((notification) => (
        (!notification.user_id || notification.user_id === currentUserId) &&
        (!notification.target_user_id || notification.target_user_id === currentUserId)
      ))
      .map(fromRemoteNotification),
    reports: reports.map(fromRemoteReport),
    discordNotificationDeliveries: discordNotificationDeliveries.map(fromRemotePayloadRow),
    recruitingPosts: recruitingPosts.map((post) => {
      const rawScheduledAt = toDateTime(post.scheduled_date, post.scheduled_time, post.scheduled_at);
      const roomState = normalizeRecruitingRoomState(post.room_state ?? {});
      const legacyInstant = !roomState.timingType && rawScheduledAt === "즉시";
      const timingType = roomState.timingType === "instant" || legacyInstant ? "instant" : "scheduled";
      const scheduledAt = timingType === "instant" ? "즉시" : rawScheduledAt;
      return {
        id: post.id,
        type: post.type,
        title: post.title,
        visibility: post.visibility ?? "public",
        region: post.region,
        courtId: post.court_id ?? null,
        court: post.court_name ?? courtById[post.court_id]?.name ?? "미정",
        mode: post.mode,
        scheduledDate: post.scheduled_date,
        scheduledTime: post.scheduled_time ? String(post.scheduled_time).slice(0, 5) : "",
        scheduledAt,
        timingType,
        ranked: post.ranked,
        official: Boolean(post.official),
        preRegistered: post.pre_registered !== false,
        ratingScale: Number(post.rating_scale ?? 1),
        ageRestriction: post.age_restriction ?? "any",
        allowedAgeGroups: post.allowed_age_groups ?? [],
        rules: post.rules ?? {},
        stakes: post.stakes ?? "",
        courtReserved: Boolean(post.court_reserved),
        courtFee: post.court_fee ?? "",
        spots: post.spots,
        teamId: post.team_id,
        targetTeamId: post.target_team_id,
        refereeWanted: Boolean(roomState.refereeWanted || post.referee_id),
        refereeId: post.referee_id ?? "",
        refereeTrustMin: post.referee_trust_min ?? REFEREE_TRUST_MIN,
        statEntryMinutes: post.stat_entry_minutes ?? STAT_ENTRY_WINDOW_MINUTES,
        disputeMinutes: normalizeDisputeWindowMinutes(post.dispute_minutes),
        roomState,
        mmrLimitMode: normalizeRecruitingMmrLimitMode(roomState.mmrLimitMode),
        teamOnly: roomState.teamOnly === true || isPublicTeamRecruitingRoom({ visibility: post.visibility, hostJoinMode: post.host_join_mode }),
        hostJoinMode: post.host_join_mode,
        hostSide: post.host_side,
        hostReady: post.host_ready,
        sideCapacity: post.side_capacity,
        benchCapacity: getRecruitingBenchCapacity(post),
        playerIds: post.player_ids ?? [],
        position: post.position,
        playerId: post.player_id,
        memo: post.memo,
        status: post.status,
        confirmedAt: post.confirmed_at,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        applicants: (applicationsByPost.get(post.id) ?? []).map((application) => ({
          kind: application.kind,
          joinMode: application.kind,
          teamId: application.team_id,
          playerId: application.player_id,
          side: application.side,
          status: application.status,
          reserve: application.reserve,
          position: application.position,
          playerIds: application.player_ids ?? [],
          sourceTeamId: application.source_team_id ?? null,
          sourceEntryId: application.source_entry_id ?? null,
          createdAt: application.created_at,
          updatedAt: application.updated_at,
        })),
      };
    }),
    tournaments: tournaments.map((tournament) => fromRemoteTournament(tournament, {
      tournamentTeamsByTournament,
      courtById: context.courtById,
    })),
    settings: projectProfileSettings(remoteAppSettings, favoriteRows, {
      overrides: {
        courtMetrics: approvedCourts.map(fromRemoteCourtMetric),
        approvedCourts: approvedCourts.map(fromRemoteApprovedCourt),
        courtRequests: courtRequests.map(fromRemoteCourtRequest),
        courtReviews: courtReviews.map(fromRemoteCourtReview),
        refereeRequests: refereeRequests.map(fromRemotePayloadRow),
        refereeExamAttempts: refereeExamAttempts.map(fromRemotePayloadRow),
        adminAppointments: adminAppointments.map(fromRemotePayloadRow),
        refereeAppointments: refereeAppointments.map(fromRemotePayloadRow),
        adminAuditLog: adminAuditLog.map(fromRemotePayloadRow),
        adminDisciplinaryActions: adminDisciplinaryActions.map(fromRemotePayloadRow),
      },
    }),
  }, { includeDemo: false });
  return {
    state: normalizedState,
    updatedAt: Math.max(
      getMaxUpdatedAt(profiles),
      getMaxUpdatedAt(teams),
      getMaxUpdatedAt(matches),
      getMaxUpdatedAt(recruitingPosts),
      getMaxUpdatedAt(tournaments),
      getMaxUpdatedAt(teamInvitations),
      getMaxUpdatedAt(courtRequests),
      getMaxUpdatedAt(approvedCourts),
      getMaxUpdatedAt(courtReviews),
      getMaxUpdatedAt(reports),
      getMaxUpdatedAt(notifications),
    ),
  };
}
