import { ADMIN_AUDIT_COLUMNS } from "../../repositoryColumns.js";
import { ADMIN_DISCIPLINARY_COLUMNS } from "../../repositoryColumns.js";
import { AFFILIATION_COLUMNS } from "../../repositoryColumns.js";
import { APPOINTMENT_COLUMNS } from "../../repositoryColumns.js";
import { APPROVED_COURT_COLUMNS } from "../../repositoryColumns.js";
import { COURT_COLUMNS } from "../../repositoryColumns.js";
import { COURT_METRIC_COLUMNS } from "../../repositoryColumns.js";
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

export function toSeedMatchRow(match = {}, currentUserId = "") {
  const schedule = getDbScheduleParts(match);
  return {
    id: match.id,
    title: match.title,
    mode: match.mode,
    court_id: getCourtId(match),
    court_name: match.court,
    ...projectMatchDbFields(match, { schedule }),
    team_a_id: match.teamA?.teamId || null,
    team_b_id: match.teamB?.teamId || null,
    memo: match.memo,
    stakes: match.stakes,
    objection_window: match.objectionWindow,
    created_by: match.teamA?.players?.[0] ?? currentUserId,
    created_at: match.createdAt,
    agreed_at: match.agreedAt,
    started_at: match.startedAt ?? null,
    ended_at: match.endedAt ?? null,
    confirmed_at: match.confirmedAt,
    cancelled_at: match.cancelledAt,
    voided_at: match.voidedAt,
    void_reason: match.voidReason ?? null,
    voided_by: match.voidedBy ?? null,
    void_snapshot: match.voidSnapshot ?? {},
    void_review: match.voidReview ?? {},
    updated_at: new Date().toISOString(),
  };
}

export function toSeedPlayerStatRows(match = {}) {
  return projectPlayerStatRows(match);
}

export async function saveNormalizedRemoteState(state, options = {}) {
  const client = options.client ?? supabase;
  const currentUserId = state.currentUserId ?? "";
  const deletedTeamIds = state.deletedTeamIds ?? [];
  const profileRows = state.users.map((user) => {
    const hashtag = getUserHashtag(user);
    const isTestProfile = Boolean(user.testLoginId);
    const setupAt = user.updatedAt ?? user.createdAt ?? TEST_PROFILE_SETUP_AT;
    const region = getProfileRegionSnapshot(user.regionSido, user.regionDistrict, user.region);
    return {
      id: user.id,
      name: user.name,
      handle: hashtag,
      hashtag,
      birth_year: user.birthYear ?? (isTestProfile ? TEST_PROFILE_BIRTH_YEAR : null),
      age_group: user.ageGroup ?? (isTestProfile ? TEST_PROFILE_AGE_GROUP : null),
      age_group_checked_season: user.ageGroupCheckedSeason ?? (isTestProfile ? TEST_PROFILE_AGE_GROUP_SEASON : null),
      region_sido: user.regionSido ?? null,
      region_district: user.regionDistrict ?? null,
      onboarding_complete: Boolean(user.onboardingComplete || isTestProfile),
      profile_version: user.profileVersion ?? 0,
      handle_locked_at: user.handleLockedAt ?? (isTestProfile ? setupAt : null),
      birth_year_locked_at: user.birthYearLockedAt ?? (isTestProfile ? setupAt : null),
      name_updated_at: user.nameUpdatedAt ?? null,
      region,
      position: user.position,
      avatar_color: user.avatarColor,
      trust_score: user.trustScore ?? 80,
      ratings: normalizeRatings(user.ratings),
      school: user.school,
      company: user.company,
      club: user.club,
      streak: user.streak ?? 0,
      test_login_id: user.testLoginId,
      auth_user_id: user.authUserId ?? null,
      discord_connection: user.discordConnection ?? null,
      discord_user_id: getDiscordConnectionUserId(user.discordConnection) || null,
      updated_at: new Date().toISOString(),
    };
  });
  const teamRows = state.teams.map((team) => ({
    id: team.id,
    name: team.name,
    region: team.region,
    home_court: team.homeCourt,
    mmr: team.mmr ?? DEFAULT_RATING,
    roster_mmr: team.rosterMmr ?? team.mmr ?? DEFAULT_RATING,
    performance_adjustment: team.performanceAdjustment ?? 0,
    wins: team.wins ?? 0,
    losses: team.losses ?? 0,
    accent: team.accent,
    updated_at: new Date().toISOString(),
  }));
  const teamMemberRows = state.teams.flatMap((team) =>
    team.members.map((member) => ({
      team_id: team.id,
      user_id: member.userId,
      role: member.role ?? "regular",
    })),
  );
  const matchRows = state.matches.map((match) => toSeedMatchRow(match, currentUserId));
  const matchPlayerRows = state.matches.flatMap((match) => [
    ...(match.teamA?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: match.teamA.teamId,
      user_id: userId,
      side: "teamA",
      slot_order: index,
    })),
    ...(match.teamB?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: match.teamB.teamId,
      user_id: userId,
      side: "teamB",
      slot_order: index,
    })),
  ]);
  const resultRows = state.matches
    .filter((match) => match.result)
    .map((match) => ({
      match_id: match.id,
      submitted_by: match.result.submittedBy ?? match.refereeId ?? match.teamA?.players?.[0] ?? currentUserId,
      score_a: Number(match.result.scoreA ?? 0),
      score_b: Number(match.result.scoreB ?? 0),
      score_revision_a: Number(match.result.scoreRevisionA ?? 0),
      score_revision_b: Number(match.result.scoreRevisionB ?? 0),
      score_submissions: match.result.scoreSubmissions ?? {},
      stat_submissions: match.result.statSubmissions ?? {},
      submitted_at: match.result.submittedAt,
    }));
  const statRows = state.matches.flatMap(toSeedPlayerStatRows);
  const agreementRows = state.matches.flatMap((match) => [
    ...(match.agreements?.teamA ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamA" })),
    ...(match.agreements?.teamB ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamB" })),
  ]);
  const approvalRows = state.matches.flatMap((match) => [
    ...(match.approvals?.teamA ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamA" })),
    ...(match.approvals?.teamB ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamB" })),
  ]);
  const favoriteRows = [
    ...(state.settings?.favoritePlayerIds ?? []).map((targetId) => ({ user_id: currentUserId, target_type: "player", target_id: targetId })),
    ...(state.settings?.favoriteTeamIds ?? []).map((targetId) => ({ user_id: currentUserId, target_type: "team", target_id: targetId })),
    ...(state.settings?.favoriteCourtIds ?? []).map((targetId) => ({ user_id: currentUserId, target_type: "court", target_id: targetId })),
    ...(state.settings?.favoriteRefereeIds ?? []).map((targetId) => ({ user_id: currentUserId, target_type: "referee", target_id: targetId })),
  ];
  const recruitingRows = (state.recruitingPosts ?? []).map((post) => {
    const schedule = getDbScheduleParts(post);
    return {
      id: post.id,
      type: post.type,
      title: post.title,
      visibility: post.visibility ?? "public",
      player_id: post.playerId,
      team_id: nullableText(post.teamId),
      region: post.region,
      court_id: nullableText(getCourtId(post)),
      court_name: post.court,
      mode: post.mode,
      scheduled_date: schedule.scheduledDate,
      scheduled_time: schedule.scheduledTime,
      scheduled_at: schedule.scheduledAt,
      ranked: post.ranked !== false,
      official: Boolean(post.official),
      pre_registered: post.preRegistered !== false,
      rating_scale: Number(post.ratingScale ?? 1),
      age_restriction: post.ageRestriction ?? null,
      allowed_age_groups: post.allowedAgeGroups ?? [],
      rules: post.rules ?? {},
      stakes: post.stakes ?? "",
      court_reserved: Boolean(post.courtReserved),
      court_fee: nullableText(post.courtFee),
      spots: post.spots ?? 1,
      target_team_id: nullableText(post.targetTeamId),
      referee_id: post.refereeId || null,
      referee_trust_min: Number(post.refereeTrustMin ?? REFEREE_TRUST_MIN),
      stat_entry_minutes: Number(post.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
      dispute_minutes: normalizeDisputeWindowMinutes(post.disputeMinutes),
      room_state: {
        ...normalizeRecruitingRoomState(post.roomState ?? {}),
        ownerId: getRecruitingRoomOwnerId(post),
        timingType: schedule.timingType,
        refereeWanted: Boolean(post.refereeWanted ?? post.roomState?.refereeWanted ?? post.refereeId),
      },
      host_join_mode: post.hostJoinMode ?? (post.teamId ? "team" : "player"),
      host_side: post.hostSide ?? "teamA",
      host_ready: Boolean(post.hostReady),
      side_capacity: getRecruitingSideCapacity(post),
      bench_capacity: getRecruitingBenchCapacity(post),
      player_ids: post.playerIds ?? [],
      position: post.position,
      memo: post.memo,
      status: post.status ?? "open",
      confirmed_at: post.confirmedAt ?? null,
      created_at: post.createdAt,
      updated_at: new Date().toISOString(),
    };
  });
  const applicationRows = (state.recruitingPosts ?? []).flatMap((post) =>
    (post.applicants ?? []).map((application) => ({
      post_id: post.id,
      player_id: application.playerId,
      team_id: nullableText(application.teamId),
      kind: application.kind ?? "player",
      side: application.side ?? "teamB",
      status: application.status ?? "waiting",
      reserve: Boolean(application.reserve),
      position: application.position ?? null,
      player_ids: application.playerIds ?? [],
      source_team_id: nullableText(application.sourceTeamId),
      source_entry_id: nullableText(application.sourceEntryId),
      created_at: application.createdAt,
      updated_at: application.updatedAt ?? application.createdAt,
    })),
  ).filter((application) => application.player_id);
  const recruitingPostIds = (state.recruitingPosts ?? []).map((post) => post.id).filter(Boolean);
  const tournamentRows = (state.tournaments ?? []).map((tournament) => ({
    id: tournament.id,
    title: tournament.title,
    format: tournament.format ?? "league",
    visibility: tournament.visibility ?? "private",
    status: tournament.status ?? "draft",
    region: tournament.region,
    court_id: nullableText(getCourtId(tournament)),
    court_name: tournament.court,
    mode: tournament.mode,
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    start_date: tournament.startDate || null,
    end_date: tournament.endDate || null,
    schedule_policy: tournament.schedulePolicy ?? "weekly",
    schedule_note: tournament.scheduleNote,
    mmr_limit_mode: tournament.mmrLimitMode ?? "warn",
    max_mmr_gap: Number(tournament.maxMmrGap ?? DEFAULT_TOURNAMENT_MMR_GAP),
    mmr_policy: tournament.mmrPolicy ?? "gap_adjusted",
    rules: tournament.rules ?? {},
    memo: tournament.memo,
    created_by: tournament.createdBy ?? currentUserId,
    created_at: tournament.createdAt,
    started_at: tournament.startedAt ?? null,
    match_ids: tournament.matchIds ?? [],
    team_statuses: tournament.teamStatuses ?? {},
    team_approvals: tournament.teamApprovals ?? {},
    referee_ids: tournament.refereeIds ?? [],
    referee_statuses: tournament.refereeStatuses ?? {},
    referee_approvals: tournament.refereeApprovals ?? {},
    sanction_status: tournament.sanctionStatus ?? TOURNAMENT_SANCTION_STATUS.pending,
    sanction_reviewed_by: nullableText(tournament.sanctionReviewedBy),
    sanction_reviewed_at: tournament.sanctionReviewedAt ?? null,
    sanction_review_note: nullableText(tournament.sanctionReviewNote),
    bracket: tournament.bracket ?? {},
    updated_at: new Date().toISOString(),
  }));
  const tournamentTeamRows = (state.tournaments ?? []).flatMap((tournament) =>
    (tournament.teamIds ?? []).map((teamId, index) => ({
      tournament_id: tournament.id,
      team_id: teamId,
      seed_order: index + 1,
      status: tournament.teamStatuses?.[teamId] ?? "invited",
      approved_by: tournament.teamApprovals?.[teamId]?.by ?? null,
      approved_at: tournament.teamApprovals?.[teamId]?.approvedAt ?? null,
    })),
  );
  const notificationRows = (state.notifications ?? []).map((notification) => toNotificationRow(notification, currentUserId)).filter((row) => row.id);
  const reportRows = (state.reports ?? []).map(toReportRow).filter((row) => row.id && row.type && row.target_id);
  const courtRequestRows = (state.settings?.courtRequests ?? []).map(toCourtRequestRow).filter((row) => row.id && row.name && row.address_text);
  const approvedCourtRows = (state.settings?.approvedCourts ?? []).map(toApprovedCourtRow).filter((row) => row.id && row.name && row.address_text);
  const refereeRequestRows = (state.settings?.refereeRequests ?? []).map((request) => ({
    ...toPayloadRow(request),
    requested_by: request.requestedBy ?? null,
    qualification: request.qualification ?? null,
    trust_score: request.trustScore ?? null,
  })).filter((row) => row.id);
  const refereeExamAttemptRows = (state.settings?.refereeExamAttempts ?? []).map((attempt) => ({
    ...toPayloadRow(attempt),
    user_id: attempt.userId ?? null,
    exam_version: attempt.examVersion ?? null,
    started_at: attempt.startedAt ?? null,
    finished_at: attempt.finishedAt ?? null,
    available_after: attempt.availableAfter ?? null,
  })).filter((row) => row.id);
  const adminAppointmentRows = (state.settings?.adminAppointments ?? [])
    .filter((appointment) => appointment.source !== "server_context")
    .map((appointment) => ({
      ...toPayloadRow(appointment),
      user_id: appointment.userId ?? null,
      role: appointment.role ?? "admin",
      grade: appointment.grade ?? null,
      appointed_by: appointment.appointedBy ?? null,
      starts_at: appointment.startsAt ?? null,
      ends_at: appointment.endsAt ?? null,
    })).filter((row) => row.id);
  const refereeAppointmentRows = (state.settings?.refereeAppointments ?? []).map((appointment) => ({
    ...toPayloadRow(appointment),
    user_id: appointment.userId ?? null,
    role: appointment.role ?? "referee",
    grade: appointment.grade ?? null,
    appointed_by: appointment.appointedBy ?? null,
    starts_at: appointment.startsAt ?? null,
    ends_at: appointment.endsAt ?? null,
  })).filter((row) => row.id);
  const adminAuditRows = (state.settings?.adminAuditLog ?? []).map((log) => ({
    id: log.id,
    type: log.type ?? null,
    status: log.status ?? null,
    report_id: log.reportId ?? null,
    request_id: log.requestId ?? null,
    appointment_id: log.appointmentId ?? null,
    target_user_id: log.targetUserId ?? null,
    created_by: log.createdBy ?? null,
    payload: log,
    created_at: log.createdAt ?? new Date().toISOString(),
  })).filter((row) => row.id);
  const disciplinaryRows = (state.settings?.adminDisciplinaryActions ?? []).map((action) => ({
    ...toPayloadRow(action),
    user_id: action.userId ?? null,
    type: action.type ?? null,
    action_type: action.actionType ?? null,
    source_report_id: action.sourceReportId ?? null,
    created_by: action.createdBy ?? null,
    starts_at: action.startsAt ?? null,
    ends_at: action.endsAt ?? null,
  })).filter((row) => row.id);
  const discordDeliveryRows = (state.discordNotificationDeliveries ?? []).map((delivery) => ({
    ...toPayloadRow(delivery),
    notification_id: delivery.notificationId ?? null,
    target_user_id: delivery.targetUserId ?? null,
    discord_user_id: delivery.discordUserId ?? null,
    event: delivery.event ?? null,
    queued_at: delivery.queuedAt ?? null,
    send_at: delivery.sendAt ?? delivery.queuedAt ?? null,
    sent_at: delivery.sentAt ?? null,
    failed_at: delivery.failedAt ?? null,
    last_error: delivery.lastError ?? null,
  })).filter((row) => row.id);

  await softDeleteRemoteTeams(deletedTeamIds, client);
  await upsertRemoteRows("profiles", profileRows, "id", client);
  await upsertRemoteRows("teams", teamRows, "id", client);
  await upsertRemoteRows("team_members", teamMemberRows, "team_id,user_id", client);
  await upsertRemoteRows("matches", matchRows, "id", client);
  await upsertRemoteRows("match_players", matchPlayerRows, "match_id,user_id", client);
  await upsertRemoteRows("match_results", resultRows, "match_id", client);
  await upsertRemoteRows("player_match_stats", statRows, "match_id,user_id", client);
  await upsertRemoteRows("match_agreements", agreementRows, "match_id,user_id", client);
  await upsertRemoteRows("match_approvals", approvalRows, "match_id,user_id", client);

  if (currentUserId) await client.from("favorites").delete().eq("user_id", currentUserId);
  await upsertRemoteRows("favorites", favoriteRows, "user_id,target_type,target_id", client);
  await upsertRemoteRows("recruiting_posts", recruitingRows, "id", client);
  await replaceRemoteRecruitingApplications(recruitingPostIds, applicationRows, client);
  await upsertRemoteRows("tournaments", tournamentRows, "id", client);
  await upsertRemoteRows("tournament_teams", tournamentTeamRows, "tournament_id,team_id", client);
  await upsertOptionalRemoteRows("notifications", notificationRows, "id", client);
  await upsertOptionalRemoteRows("reports", reportRows, "id", client);
  await upsertOptionalRemoteRows("court_requests", courtRequestRows, "id", client);
  await upsertOptionalRemoteRows("approved_courts", approvedCourtRows, "id", client);
  await upsertOptionalRemoteRows("referee_requests", refereeRequestRows, "id", client);
  await upsertOptionalRemoteRows("referee_exam_attempts", refereeExamAttemptRows, "id", client);
  await upsertOptionalRemoteRows("admin_appointments", adminAppointmentRows, "id", client);
  await upsertOptionalRemoteRows("referee_appointments", refereeAppointmentRows, "id", client);
  await upsertOptionalRemoteRows("admin_audit_log", adminAuditRows, "id", client);
  await upsertOptionalRemoteRows("admin_disciplinary_actions", disciplinaryRows, "id", client);
  await upsertOptionalRemoteRows("discord_notification_deliveries", discordDeliveryRows, "id", client);
}
