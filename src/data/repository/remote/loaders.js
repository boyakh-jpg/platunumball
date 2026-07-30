import { ADMIN_AUDIT_COLUMNS } from "../../repositoryColumns.js";
import { ADMIN_DISCIPLINARY_COLUMNS } from "../../repositoryColumns.js";
import { AFFILIATION_COLUMNS } from "../../repositoryColumns.js";
import { APPOINTMENT_COLUMNS } from "../../repositoryColumns.js";
import { APPROVED_COURT_COLUMNS } from "../../repositoryColumns.js";
import { COURT_COLUMNS } from "../../repositoryColumns.js";
import { COURT_REQUEST_COLUMNS } from "../../repositoryColumns.js";
import { COURT_REVIEW_COLUMNS } from "../../repositoryColumns.js";
import { DEFAULT_RATING } from "../../../lib/constants.js";
import { DEFAULT_SETTINGS } from "../../repositoryDefaults.js";
import { DEFAULT_TOURNAMENT_MMR_GAP } from "../../../lib/constants.js";
import { DISCORD_DELIVERY_COLUMNS } from "../../repositoryColumns.js";
import { FAVORITE_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_AGREEMENT_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_APPROVAL_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_DISPUTE_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_PLAYER_COLUMNS } from "../../repositoryColumns.js";
import { MATCH_RESULT_COLUMNS } from "../../repositoryColumns.js";
import { NOTIFICATION_COLUMNS } from "../../repositoryColumns.js";
import { PLAYER_STAT_COLUMNS } from "../../repositoryColumns.js";
import { PRIVATE_PROFILE_COLUMNS } from "../../repositoryColumns.js";
import { PROFILE_SETTINGS_COLUMNS } from "../../repositoryColumns.js";
import { PUBLIC_PROFILE_COLUMNS } from "../../repositoryColumns.js";
import { RECRUITING_APPLICATION_COLUMNS } from "../../repositoryColumns.js";
import { RECRUITING_POST_COLUMNS } from "../../repositoryColumns.js";
import { REFEREE_EXAM_ATTEMPT_COLUMNS } from "../../repositoryColumns.js";
import { REFEREE_REQUEST_COLUMNS } from "../../repositoryColumns.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { REMOTE_CLIENT_MATCH_LIMIT } from "../../../lib/constants.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../lib/constants.js";
import { REMOTE_CLIENT_TOURNAMENT_LIMIT } from "../../../lib/constants.js";
import { REPORT_COLUMNS } from "../../repositoryColumns.js";
import { SEASON_COLUMNS } from "../../repositoryColumns.js";
import { STAT_ENTRY_WINDOW_MINUTES } from "../../../lib/constants.js";
import { TEAM_COLUMNS } from "../../repositoryColumns.js";
import { TEAM_INVITATION_COLUMNS } from "../../repositoryColumns.js";
import { TEAM_MEMBER_COLUMNS } from "../../repositoryColumns.js";
import { TEST_PROFILE_AGE_GROUP } from "../../../lib/constants.js";
import { TEST_PROFILE_AGE_GROUP_SEASON } from "../../../lib/constants.js";
import { TEST_PROFILE_BIRTH_YEAR } from "../../../lib/constants.js";
import { TEST_PROFILE_SETUP_AT } from "../../../lib/constants.js";
import { TOURNAMENT_COLUMNS } from "../../repositoryColumns.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../../lib/tournamentGovernance.js";
import { TOURNAMENT_TEAM_COLUMNS } from "../../repositoryColumns.js";
import { applyIdScope } from "../../remoteQuery.js";
import { applyUpdatedBefore } from "../../remoteQuery.js";
import { collectMatchPageScope } from "../../remoteScopeUtils.js";
import { collectRecruitingPageScope } from "../../remoteScopeUtils.js";
import { collectTournamentPageScope } from "../../remoteScopeUtils.js";
import { composeFilters } from "../../remoteQuery.js";
import { createProfileShell } from "../../profileMappers.js";
import { fetchAllRows } from "../../remoteQuery.js";
import { fetchFilteredRows } from "../../remoteQuery.js";
import { fetchOptionalFilteredRows } from "../../remoteQuery.js";
import { fetchOptionalRows } from "../../remoteQuery.js";
import { fetchRowsByIds } from "../../remoteQuery.js";
import { firstBy } from "../../rowUtils.js";
import { fromRemoteAffiliation } from "../../affiliationMappers.js";
import { fromRemoteApprovedCourt } from "../../remotePayloadMappers.js";
import { fromRemoteCourtMetric } from "../../remotePayloadMappers.js";
import { fromRemoteCourtRequest } from "../../remotePayloadMappers.js";
import { fromRemoteCourtReview } from "../../remotePayloadMappers.js";
import { fromRemoteMatch } from "../../matchMappers.js";
import { fromRemoteNotification } from "../../remotePayloadMappers.js";
import { fromRemotePayloadRow } from "../../remotePayloadMappers.js";
import { fromRemoteProfile } from "../../profileMappers.js";
import { fromRemoteReport } from "../../remotePayloadMappers.js";
import { fromRemoteTeam } from "../../teamMappers.js";
import { fromRemoteTeamInvitation } from "../../teamMappers.js";
import { fromRemoteTournament } from "../../tournamentMappers.js";
import { getClientLimit } from "../../remoteQuery.js";
import { getClientPrivateProfileFilter } from "../../remoteScopeUtils.js";
import { getCourtId } from "../../../lib/courts.js";
import { getDbScheduleParts } from "../../scheduleUtils.js";
import { getDiscordConnectionUserId } from "../../../lib/discord.js";
import { getMatchRowReaderIds } from "../../remoteScopeUtils.js";
import { getMaxUpdatedAt } from "../../rowUtils.js";
import { getProfileRegionSnapshot } from "../../profileMappers.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRemoteAppSettings } from "../../profileMappers.js";
import { getUserHashtag } from "../../../lib/handles.js";
import { groupBy } from "../../rowUtils.js";
import { isPublicTeamRecruitingRoom } from "../../../lib/recruiting.js";
import { isSupabaseConfigured } from "../../../lib/supabase.js";
import { makeCurrentUserFromProfiles } from "../../remoteScopeUtils.js";
import { mergePublicProfilesIntoProfiles } from "../../remoteScopeUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { normalizeRatings } from "../../profileMappers.js";
import { normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode } from "../../../lib/constants.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { normalizeState } from "../../stateNormalizer.js";
import { nullableText } from "../../rowUtils.js";
import { projectMatchDbFields } from "../../../../shared/lib/matchPersistence.js";
import { projectPlayerStatRows } from "../../../../shared/lib/matchPersistence.js";
import { projectProfileSettings } from "../../settingsMappers.js";
import { replaceRemoteRecruitingApplications } from "../../remoteWriteUtils.js";
import { softDeleteRemoteTeams } from "../../remoteWriteUtils.js";
import { supabase } from "../../../lib/supabase.js";
import { toApprovedCourtRow } from "../../remoteRowSerializers.js";
import { toCourtRequestRow } from "../../remoteRowSerializers.js";
import { toDateTime } from "../../rowUtils.js";
import { toNotificationRow } from "../../remoteRowSerializers.js";
import { toPayloadRow } from "../../remoteRowSerializers.js";
import { toReportRow } from "../../remoteRowSerializers.js";
import { uniqueRowsById } from "../../remoteQuery.js";
import { uniqueScopeIds } from "../../remoteQuery.js";
import { upsertOptionalRemoteRows } from "../../remoteWriteUtils.js";
import { upsertRemoteRows } from "../../remoteWriteUtils.js";

export async function fetchCourtRows(client = supabase, ids = []) {
  const scopedIds = uniqueScopeIds(ids);
  const approvedFilter = (query) => {
    const activeQuery = query.or("status.is.null,status.eq.active");
    return scopedIds.length ? applyIdScope(activeQuery, "id", scopedIds) : activeQuery;
  };
  return fetchOptionalFilteredRows("approved_courts", COURT_COLUMNS, "id", client, approvedFilter);
}

export async function fetchCurrentUserReports(currentUserId = "", client = supabase) {
  if (!currentUserId) return [];
  const [byReporter, byTarget, byReportedUser] = await Promise.all([
    fetchOptionalFilteredRows("reports", REPORT_COLUMNS, "created_at", client, (query) => query.eq("user_id", currentUserId)),
    fetchOptionalFilteredRows("reports", REPORT_COLUMNS, "created_at", client, (query) => query.eq("target_id", currentUserId)),
    fetchOptionalFilteredRows("reports", REPORT_COLUMNS, "created_at", client, (query) => query.filter("reported_user_ids", "cs", JSON.stringify([currentUserId]))),
  ]);
  return uniqueRowsById([...byReporter, ...byTarget, ...byReportedUser])
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
}

export async function loadNormalizedMatchDetailFromClient(client = supabase, authUserId = "", authEmail = "", options = {}) {
  const matchId = String(options.matchId ?? options.id ?? "").trim();
  if (!matchId) {
    const error = new Error("match_id_required");
    error.statusCode = 400;
    throw error;
  }

  const authUserIdText = String(authUserId || "");
  const privateProfileFilter = getClientPrivateProfileFilter(authUserIdText);
  const [privateProfiles, matches] = await Promise.all([
    authUserIdText && privateProfileFilter
      ? fetchOptionalFilteredRows("profiles", PRIVATE_PROFILE_COLUMNS, "id", client, privateProfileFilter)
      : [],
    fetchFilteredRows("matches", MATCH_COLUMNS, null, client, (query) => query.eq("id", matchId), 1),
  ]);
  const match = matches[0] ?? null;
  const privateProfileById = new Map((privateProfiles ?? []).map((profile) => [profile.id, profile]));
  const profiles = [...(privateProfiles ?? [])];
  const { currentProfile, shellUser, currentUserId } = makeCurrentUserFromProfiles(profiles, authUserIdText, authEmail);

  if (!match) {
    const users = currentProfile ? [fromRemoteProfile(currentProfile)] : [];
    return {
      state: normalizeState({
        currentUserId,
        users: shellUser ? [...users, shellUser] : users,
        teams: [],
        matches: [],
        settings: DEFAULT_SETTINGS,
      }, { includeDemo: false }),
      updatedAt: 0,
    };
  }

  const matchFilter = (query) => query.eq("match_id", match.id);
  const matchTeamIds = uniqueScopeIds([match.team_a_id, match.team_b_id]);
  const ownTeamMemberships = currentUserId && matchTeamIds.length
    ? await fetchOptionalFilteredRows("team_members", TEAM_MEMBER_COLUMNS, null, client, (query) => query
      .eq("user_id", currentUserId)
      .in("team_id", matchTeamIds))
    : [];
  const [
    matchPlayers,
    matchResults,
    playerStats,
    agreements,
    approvals,
    disputes,
  ] = await Promise.all([
    fetchFilteredRows("match_players", MATCH_PLAYER_COLUMNS, null, client, matchFilter),
    fetchFilteredRows("match_results", MATCH_RESULT_COLUMNS, null, client, matchFilter),
    fetchFilteredRows("player_match_stats", PLAYER_STAT_COLUMNS, null, client, matchFilter),
    fetchFilteredRows("match_agreements", MATCH_AGREEMENT_COLUMNS, null, client, matchFilter),
    fetchFilteredRows("match_approvals", MATCH_APPROVAL_COLUMNS, null, client, matchFilter),
    fetchOptionalFilteredRows("match_disputes", MATCH_DISPUTE_COLUMNS, null, client, matchFilter),
  ]);

  const canReadMatch = options.isAdmin === true ||
    (match.visibility ?? match.rules?.visibility ?? "public") !== "private" ||
    ownTeamMemberships.length > 0 ||
    getMatchRowReaderIds(match, matchPlayers, matchResults, playerStats, agreements, approvals, disputes).includes(currentUserId);
  if (!canReadMatch) {
    const users = currentProfile ? [fromRemoteProfile(currentProfile)] : [];
    return {
      state: normalizeState({
        currentUserId,
        users: shellUser ? [...users, shellUser] : users,
        teams: [],
        matches: [],
        settings: DEFAULT_SETTINGS,
      }, { includeDemo: false }),
      updatedAt: 0,
    };
  }

  const scoped = collectMatchPageScope([match], matchPlayers, matchResults, playerStats, agreements, approvals, disputes, privateProfiles.map((profile) => profile.id));
  const [teams, teamMembers, courts, publicProfiles] = await Promise.all([
    fetchRowsByIds("teams", TEAM_COLUMNS, "id", scoped.teamIds, "id", client, true),
    fetchRowsByIds("team_members", TEAM_MEMBER_COLUMNS, "team_id", scoped.teamIds, null, client, true),
    fetchCourtRows(client, scoped.courtIds),
    fetchRowsByIds("public_profiles", PUBLIC_PROFILE_COLUMNS, "id", [...scoped.profileIds], "id", client, true),
  ]);
  mergePublicProfilesIntoProfiles(profiles, publicProfiles, privateProfileById);
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
  const state = normalizeState({
    currentUserId,
    users: shellUser ? [...profiles.map(fromRemoteProfile), shellUser] : profiles.map(fromRemoteProfile),
    teams: teams.filter((team) => !team.deleted_at).map((team) => fromRemoteTeam(team, teamMembersByTeam.get(team.id))),
    matches: [fromRemoteMatch(match, context)],
    settings: DEFAULT_SETTINGS,
  }, { includeDemo: false });

  return {
    state: {
      ...state,
      recruitingPosts: [],
      tournaments: [],
      affiliations: [],
      seasons: [],
      reports: [],
      notifications: [],
      discordNotificationDeliveries: [],
    },
    updatedAt: Math.max(
      getMaxUpdatedAt(profiles),
      getMaxUpdatedAt(teams),
      getMaxUpdatedAt([match]),
      getMaxUpdatedAt(matchResults),
      getMaxUpdatedAt(playerStats),
    ),
  };
}

export async function loadNormalizedDirectoryStateFromClient(client = supabase, authUserId = "", authEmail = "", options = {}) {
  const authUserIdText = String(authUserId || "");
  const privateProfileFilter = getClientPrivateProfileFilter(authUserIdText);
  const privateProfileColumns = `${PRIVATE_PROFILE_COLUMNS},app_settings`;
  const [
    privateProfiles,
    publicProfiles,
    teams,
    affiliations,
  ] = await Promise.all([
    authUserIdText && privateProfileFilter
      ? fetchOptionalFilteredRows("profiles", privateProfileColumns, "id", client, privateProfileFilter)
      : [],
    fetchOptionalRows("public_profiles", PUBLIC_PROFILE_COLUMNS, "id", client),
    fetchAllRows("teams", TEAM_COLUMNS, "id", client),
    fetchAllRows("affiliations", AFFILIATION_COLUMNS, "id", client),
  ]);
  const activeTeamIds = (teams ?? []).filter((team) => !team.deleted_at).map((team) => team.id);
  const teamMembers = await fetchRowsByIds("team_members", TEAM_MEMBER_COLUMNS, "team_id", activeTeamIds, null, client);
  const privateProfileById = new Map((privateProfiles ?? []).map((profile) => [profile.id, profile]));
  const profiles = mergePublicProfilesIntoProfiles([...(privateProfiles ?? [])], publicProfiles, privateProfileById);
  const { currentProfile, shellUser, currentUserId } = makeCurrentUserFromProfiles(profiles, authUserIdText, authEmail);
  const isAdminStateLoad = options.isAdmin === true;
  const currentUserFilter = (column = "user_id") => (query) => query.eq(column, currentUserId);
  const [
    favorites,
    teamInvitations,
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
    currentUserId ? fetchFilteredRows("favorites", FAVORITE_COLUMNS, null, client, currentUserFilter("user_id")) : [],
    currentUserId ? fetchOptionalFilteredRows("team_invitations", TEAM_INVITATION_COLUMNS, "created_at", client, (query) => query.or(`from_user_id.eq.${currentUserId},target_user_id.eq.${currentUserId}`)) : [],
    currentUserId ? (isAdminStateLoad ? fetchOptionalRows("reports", REPORT_COLUMNS, "created_at", client) : fetchCurrentUserReports(currentUserId, client)) : [],
    currentUserId
      ? isAdminStateLoad
        ? fetchOptionalRows("court_requests", COURT_REQUEST_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("court_requests", COURT_REQUEST_COLUMNS, "created_at", client, currentUserFilter("requested_by"))
      : [],
    fetchOptionalFilteredRows("approved_courts", APPROVED_COURT_COLUMNS, "created_at", client, (query) => query.or("status.is.null,status.eq.active")),
    fetchOptionalFilteredRows("court_reviews", COURT_REVIEW_COLUMNS, "created_at", client, (query) => query.or("status.is.null,status.eq.active")),
    currentUserId
      ? isAdminStateLoad
        ? fetchOptionalRows("referee_requests", REFEREE_REQUEST_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("referee_requests", REFEREE_REQUEST_COLUMNS, "created_at", client, currentUserFilter("requested_by"))
      : [],
    currentUserId
      ? isAdminStateLoad
        ? fetchOptionalRows("referee_exam_attempts", REFEREE_EXAM_ATTEMPT_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("referee_exam_attempts", REFEREE_EXAM_ATTEMPT_COLUMNS, "created_at", client, currentUserFilter("user_id"))
      : [],
    currentUserId
      ? isAdminStateLoad
        ? fetchOptionalRows("admin_appointments", APPOINTMENT_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("admin_appointments", APPOINTMENT_COLUMNS, "created_at", client, currentUserFilter("user_id"))
      : [],
    currentUserId
      ? isAdminStateLoad
        ? fetchOptionalRows("referee_appointments", APPOINTMENT_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("referee_appointments", APPOINTMENT_COLUMNS, "created_at", client, currentUserFilter("user_id"))
      : [],
    isAdminStateLoad ? fetchOptionalRows("admin_audit_log", ADMIN_AUDIT_COLUMNS, "created_at", client) : [],
    currentUserId
      ? isAdminStateLoad
        ? fetchOptionalRows("admin_disciplinary_actions", ADMIN_DISCIPLINARY_COLUMNS, "created_at", client)
        : fetchOptionalFilteredRows("admin_disciplinary_actions", ADMIN_DISCIPLINARY_COLUMNS, "created_at", client, currentUserFilter("user_id"))
      : [],
  ]);
  const teamMembersByTeam = groupBy(teamMembers, "team_id");
  const remoteUsers = profiles.map(fromRemoteProfile);
  const favoriteRows = favorites.filter((favorite) => favorite.user_id === currentUserId);
  const remoteAppSettings = getRemoteAppSettings(currentProfile);
  const state = normalizeState({
    currentUserId,
    users: shellUser ? [...remoteUsers, shellUser] : remoteUsers,
    teams: teams.filter((team) => !team.deleted_at).map((team) => fromRemoteTeam(team, teamMembersByTeam.get(team.id))),
    teamInvitations: teamInvitations.map(fromRemoteTeamInvitation),
    affiliations: affiliations
      .filter((affiliation) => affiliation.type !== "club")
      .map(fromRemoteAffiliation),
    reports: reports.map(fromRemoteReport),
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
    state: {
      ...state,
      matches: [],
      recruitingPosts: [],
      tournaments: [],
      notifications: [],
      discordNotificationDeliveries: [],
    },
    updatedAt: Math.max(
      getMaxUpdatedAt(profiles),
      getMaxUpdatedAt(teams),
      getMaxUpdatedAt(teamMembers),
      getMaxUpdatedAt(approvedCourts),
      getMaxUpdatedAt(courtRequests),
      getMaxUpdatedAt(courtReviews),
      getMaxUpdatedAt(reports),
    ),
  };
}
