import {
  COURT_REQUEST_TRUST_MIN,
  DAY_MS,
  DEFAULT_BENCH_CAPACITY,
  DEFAULT_RATING,
  DEFAULT_TOURNAMENT_MMR_GAP,
  DISPUTE_WINDOW_MINUTES,
  FALSE_COURT_REPORT_TRUST_PENALTY,
  FAVORITE_LIMIT,
  MAX_TEAM_MEMBERS,
  MAX_TEAM_MEMBERSHIPS,
  MAX_TEAM_NAME_LENGTH,
  MATCH_SIDES,
  MODE_SIZES,
  PLAYER_POSITIONS,
  PUBLIC_ROOM_SCHEDULE_MAX_DAYS,
  RECORD_TYPES,
  REFEREE_ABSENCE_TRUST_PENALTY,
  REFEREE_EXAM_COOLDOWN_MS,
  REFEREE_TRUST_MIN,
  REPORT_MATCH_WINDOW_MS,
  REMOTE_CLIENT_ACTIVE_MATCH_LIMIT,
  REMOTE_CLIENT_HOME_LOCAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_INITIAL_MATCH_LIMIT,
  REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
  REMOTE_CLIENT_RECRUITING_LIMIT,
  REMOTE_CLIENT_TOURNAMENT_LIMIT,
  ROOM_SCHEDULE_MAX_DAYS,
  SCHEDULE_MAX_DAYS,
  SIDE_LABEL_TEXT,
  SOLO_RECORD_ANONYMOUS_POSITION,
  STAT_ENTRY_WINDOW_MINUTES,
  TEST_PROFILE_AGE_GROUP,
  TEST_PROFILE_AGE_GROUP_SEASON,
  TEST_PROFILE_BIRTH_YEAR,
  TEST_PROFILE_SETUP_AT,
  getHostTrustRequirement,
  isSameRegion,
  isSupportedMatchMode,
  isSupportedSoloRecordMode,
  normalizeDisputeWindowMinutes,
  normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode,
} from "../lib/constants.js";
import {
  courtIdByName,
  findCourtDuplicate,
  getCourtCanonicalName,
  getCourtDuplicateMessage,
  getCourtFacilityBaseName,
  getCourtHoopCount,
  getCourtId,
  getCourtLocationMatches,
  getCourtReservationValue,
  getCourtStandardName,
  getOptionalCourtCoordinate,
  getRegisteredCourts,
  makeRandomCourtHashtag,
  normalizeCourtAccessType,
  normalizeCourtHashtag,
  normalizeCourtKind,
  normalizeCourtLayout,
  normalizeCourtFacilityName,
  normalizeCourtNamePart,
  normalizeCourtOptionalBoolean,
  normalizeCourtPublicAccess,
  normalizeCourtReviewRating,
  normalizeCourtSourceUrl,
  normalizeCourtSigungu,
  normalizeCourtSurfaceType,
  normalizeCourtType,
} from "../lib/courts.js";
import {
  canOperatorSubmitMissingPostgameResult,
  canRequestVoidMatchRestore,
  clearMatchPlayerDecision,
  fillMatchDecision,
  getAgreementStatus,
  getApprovalStatus,
  getMatchPlayerIds,
  getMatchRecordPlayerIds,
  getMatchCancelCopy,
  getMatchResultEntryPermission,
  getMatchScoreEditableSides,
  getMatchHostPlayerId as getMatchHostPlayerIdFromMatch,
  getMatchAttendance,
  getMatchRosterSideName,
  getMatchRoomPhase,
  getMatchPlayerPlacement,
  getMatchPlayerTeamId,
  getMatchReservePlayerIds,
  getMatchSubstitutionAccess,
  getMatchSidePlayerIds,
  getMatchSideLeaderId,
  getMatchSideRecordPlayerIds,
  getMatchStartDate,
  getTournamentScheduleEditPolicy,
  getMatchTrustFeedbackLimit,
  getMatchTrustFeedbackParticipantIds,
  getMergedResultScore,
  getRecorderHandoffPatch,
  getReportableMatchTimeMs,
  getReportableMatchUserIds,
  getVoidMatchRestoreTargetUserId,
  getPublicRoomTimingStatus,
  getMatchRecordWindow,
  getRecordCreationWindowStatus,
  getMatchScheduledDate,
  getMissingMatchAttendance,
  applyOperatorAttendance,
  getPlayerSideName,
  getStatRecorderSides,
  getResultPointAudit,
  getStatSubmissionStatus,
  getSubmittedStatPatch,
  getTeamCaptainId,
  isMatchTrustFeedbackOpen,
  isMatchLateAttendancePlayer,
  isEligibleReferee,
  isMatchPartyTeamParty,
  isMatchReferee,
  isMatchSideTeamParty,
  isMatchStatRecorder,
  isMatchRecordMatch,
  isAutoDecisionDue,
  isPersonalRecordMatch,
  makeAnonymousMatchPlayer,
  getSeoulTimeInputValue,
  normalizeDisputeRequest,
  normalizeStatRecorders,
  normalizePlayerStats,
  updateMatchPartiesForPlayer,
  withEffectiveMatchStatRecorders,
} from "../lib/matchUtils.js";
import { getDefaultMatchRules, getMatchRulesPayload } from "../lib/matchRules.js";
import {
  getMatchCreationPolicyPayload,
  getPickupTeamAssignmentRatingScale,
} from "../lib/matchCreationPolicies.js";
import { VOID_MATCH_RESTORE_REPORT_REASON } from "../lib/reportReasons.js";
import {
  applyMatchRating,
  averageTeamMmr,
  calculateTeamDelta,
  getAveragePlayerMmr,
  getFinalizationRatingContext,
  getMatchSideTeamGroups,
  teamRegularRatio,
} from "../lib/rating.js";
import {
  cleanRecruitingRoomStatRecorders,
  currentUserCanRefereeRecruitingRoom,
  inferRecruitingInvitationTeamId,
  inferSidePartyTeamIdForUser,
  getExplicitInvitationTeamPlayerIds,
  getRecruitingApplicantKey,
  getRecruitingApplicantKind,
  getRecruitingBenchCapacity,
  getRecruitingBestSide,
  getRecruitingEntryLeaderId,
  getRecruitingEntryPlayerIds,
  getRecruitingFit,
  getPendingReserveInvitationCount,
  getLobbyEntryTeamId,
  getLobbyPrimaryTeamId,
  getLobbySidePlayerTeamIds,
  getLobbyTeamEntry,
  getRecruitingLobby,
  getRecruitingRatingScale,
  getRecruitingHostEditReady,
  getRecruitingRoomParticipantIds,
  getRecruitingRoomStatRecorders,
  getRecruitingRoomOwnerId,
  getRecruitingSideCapacity,
  getRecruitingSlotEditStatus,
  getRecruitingTargetMmr,
  getTeamEventEligibility,
  getValidRecruitingRecorder,
  getSelectableTeamPlayerIds,
  getSelectedTeamPlayerIds,
  hasRecruitingApplicant,
  hasRecruitingTeamMemberOnOtherSide,
  isRecruitingReserveLimitExceeded,
  isPublicTeamRecruitingRoom,
  isRecruitingPartyEntry,
  isRecruitingRoomMember,
  isRecruitingRoomOwner,
  isRecruitingRoomParticipant,
  isRecruitingTeamSideLocked,
  isRecruitingEntryMember,
  isIndividualOnlyRecruitingRoom,
  isPickupRecruitingRoom,
  isTeamOnlyRecruitingRoom,
  isMutableRecruitingRoom,
  normalizeRecruitingMmrRangeMode,
  normalizeRecruitingApplicants,
  normalizeRecruitingPost,
  normalizeRecruitingRoomState,
  removeAcceptedRecruitingInvitations,
  expirePendingPlayerInvitationsWhenFull,
  updateManyPinnedReservePlayers,
  updatePinnedReservePlayers,
} from "../lib/recruiting.js";
import {
  buildPickupTeamAssignment,
  getPickupCompatibilityPlacements,
  getPickupParticipantCapacity,
  getPickupRerollState,
  getRecruitingRuleAcknowledgement,
  getRoomCancellationPolicy,
  getRoomEditAvailability,
  getRoomScheduleProposalProgress,
  isRoomScheduleChangePending,
} from "../lib/roomFlow.js";
import {
  ADMIN_GRADE_META,
  ADMIN_REVIEW_ACTIONS,
  REFEREE_GRADE_META,
  canManageAppointmentRole,
  getActiveUserDiscipline,
  getActivePublicRoomDiscipline,
  getAdminAuthorityLevel,
  getAppointmentTermDays,
  getReportTargetUserId,
  getSuspensionTier,
  hasAdminAccess,
  isAppointmentActive,
} from "../lib/admin.js";
import { clearState, readState, writeState } from "../lib/storage.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";
import { findDiscordConnectionOwner, getDiscordConnectionUserId, syncDiscordNotificationDeliveries } from "../lib/discord.js";
import { getUserHashtag, sameHashtag, toHashtag } from "../lib/handles.js";
import { getBlockedUserIds, isNotificationDue, isNotificationFromBlockedUser } from "../lib/notifications.js";
import { canChangeProfileName } from "../lib/profileSetup.js";
import {
  TOURNAMENT_COMMUNITY_RATING_SCALE,
  TOURNAMENT_SANCTION_STATUS,
  getAcceptedTournamentRefereeIds,
  getRequiredTournamentRefereeCount,
  getTournamentRefereePoolValidation,
  getTournamentRefereeStatus,
  isTournamentGovernanceEnabled,
  isTournamentRefereeNeutral,
  doTournamentMatchSchedulesOverlap,
} from "../lib/tournamentGovernance.js";
import {
  getScheduledStartMs,
} from "./matchLifecycleUtils.js";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "./repositoryDefaults.js";
import {
  ensureTeamPartyLeader,
  fromRemoteTeam,
  fromRemoteTeamInvitation,
  getSelectedReservePlayerIds,
  getTeamMemberIds,
  getTeamPlayers,
  normalizeTeamInviteRole,
} from "./teamMappers.js";
import {
  buildLeaguePairings,
  buildTournamentPairings,
  fromRemoteTournament,
  getTournamentTeamStatuses,
  normalizeTournament,
} from "./tournamentMappers.js";
import {
  fromRemoteApprovedCourt,
  fromRemoteCourtMetric,
  fromRemoteCourtRequest,
  fromRemoteCourtReview,
  fromRemoteNotification,
  fromRemotePayloadRow,
  fromRemoteReport,
} from "./remotePayloadMappers.js";
import {
  toApprovedCourtRow,
  toCourtRequestRow,
  toNotificationRow,
  toPayloadRow,
  toReportRow,
} from "./remoteRowSerializers.js";
import {
  fromRemoteMatch,
  getSoloRecordRosterError,
  getSoloRecordSideSize,
  makeSoloRecordAnonymousSide,
  makeSoloRecordStats,
  normalizeMatch,
  normalizeSoloRecordMode,
  parseSoloRecordRosterText,
  toSoloRecordNumber,
} from "./matchMappers.js";
import {
  collectMatchPageScope,
  collectRecruitingPageScope,
  collectTournamentPageScope,
  getClientPrivateProfileFilter,
  getMatchRowReaderIds,
  makeCurrentUserFromProfiles,
  mergePublicProfilesIntoProfiles,
} from "./remoteScopeUtils.js";
import {
  createProfileShell,
  fromRemoteProfile,
  getProfileRegionSnapshot,
  getRemoteAppSettings,
  getUserIdentityHashtag,
  normalizeRatings,
} from "./profileMappers.js";
import { fromRemoteAffiliation } from "./affiliationMappers.js";
import {
  ADMIN_AUDIT_COLUMNS,
  ADMIN_DISCIPLINARY_COLUMNS,
  AFFILIATION_COLUMNS,
  APPOINTMENT_COLUMNS,
  APPROVED_COURT_COLUMNS,
  COURT_COLUMNS,
  COURT_METRIC_COLUMNS,
  COURT_REQUEST_COLUMNS,
  COURT_REVIEW_COLUMNS,
  DISCORD_DELIVERY_COLUMNS,
  FAVORITE_COLUMNS,
  MATCH_AGREEMENT_COLUMNS,
  MATCH_APPROVAL_COLUMNS,
  MATCH_COLUMNS,
  MATCH_DISPUTE_COLUMNS,
  MATCH_PLAYER_COLUMNS,
  MATCH_RESULT_COLUMNS,
  NOTIFICATION_COLUMNS,
  PLAYER_STAT_COLUMNS,
  PRIVATE_PROFILE_COLUMNS,
  PROFILE_SETTINGS_COLUMNS,
  PUBLIC_PROFILE_COLUMNS,
  RECRUITING_APPLICATION_COLUMNS,
  RECRUITING_POST_COLUMNS,
  REFEREE_EXAM_ATTEMPT_COLUMNS,
  REFEREE_REQUEST_COLUMNS,
  REPORT_COLUMNS,
  SEASON_COLUMNS,
  TEAM_COLUMNS,
  TEAM_INVITATION_COLUMNS,
  TEAM_MEMBER_COLUMNS,
  TOURNAMENT_COLUMNS,
  TOURNAMENT_TEAM_COLUMNS,
} from "./repositoryColumns.js";
import {
  applyIdScope,
  applyUpdatedBefore,
  composeFilters,
  fetchAllRows,
  fetchFilteredRows,
  fetchOptionalFilteredRows,
  fetchOptionalRows,
  fetchRowsByIds,
  getClientLimit,
  uniqueRowsById,
  uniqueScopeIds,
} from "./remoteQuery.js";
import {
  clone,
  firstBy,
  getMaxUpdatedAt,
  groupBy,
  makeId,
  makeUuid,
  nullableText,
  toDateTime,
  toggleId,
  uniquePlayerIds,
} from "./rowUtils.js";
import {
  replaceRemoteRecruitingApplications,
  softDeleteRemoteTeams,
  upsertOptionalRemoteRows,
  upsertRemoteRows,
} from "./remoteWriteUtils.js";
import {
  createEmptyState,
  mergeDemoDefaultsById,
  normalizeTeam,
  normalizeUser,
} from "./stateMappers.js";
import { normalizeSettings as normalizeSettingsCore } from "./settingsMappers.js";
import {
  getDbScheduleParts,
  getNextQueueSchedule,
  getScheduleText,
  isScheduleDateInAllowedWindow,
  normalizeRecruitingSchedules,
} from "./scheduleUtils.js";
import { adjustUserTrust, clampTrustScore, getFoulTrustPenalty } from "./trustUtils.js";
import { getUnsafeUserTextReason } from "../lib/inputSecurity.js";
import { isPracticeEntity } from "../lib/practiceMode.js";
export { DEFAULT_SETTINGS } from "./repositoryDefaults.js";
export { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "./profileMappers.js";
export { fromRemoteTeamInvitation } from "./teamMappers.js";
export {
  FAVORITE_LIMIT,
  REMOTE_CLIENT_ACTIVE_MATCH_LIMIT,
  REMOTE_CLIENT_HOME_LOCAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_INITIAL_MATCH_LIMIT,
  REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../lib/constants.js";

let demoInitialState = null;
export function setDemoInitialState(state = null) {
  demoInitialState = state && typeof state === "object" ? state : null;
}
export function hasDemoInitialState() {
  return Boolean(demoInitialState);
}
function getDemoInitialState() {
  return demoInitialState ?? EMPTY_STATE;
}

function getHostTrustBlockNotification(state, draft = {}) {
  const ranked = draft.ranked !== false;
  const visibility = draft.visibility === "public" ? "public" : "private";
  const requiredTrust = getHostTrustRequirement({ ranked, visibility, official: Boolean(draft.official) });
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (!requiredTrust || trustScore >= requiredTrust) return null;
  return {
    id: makeId("n"),
    title: "방장 신뢰도 부족",
    body: `${visibility === "public" ? "공개 정규전" : "정규전"} 방장은 신뢰도 ${requiredTrust}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
    tone: "orange",
  };
}

function getDisciplineBlockedState(state, actionLabel = "이 작업") {
  const discipline = getActiveUserDiscipline(state.settings, state.currentUserId);
  if (!discipline) return null;
  const until = discipline.endsAt ? new Date(discipline.endsAt).toLocaleString("ko-KR") : "제한 해제 전";
  return {
    ...state,
    notifications: [
      {
        id: makeId("n"),
        title: "이용 제한 중",
        body: `${actionLabel}은 ${until}까지 제한됩니다. 사유: ${discipline.reason || "관리자 제재"}`,
        tone: "orange",
      },
      ...state.notifications,
    ],
  };
}

function getInvalidScheduleNotification(maxDays = SCHEDULE_MAX_DAYS) {
  return {
    id: makeId("n"),
    title: "일정 설정 불가",
    body: maxDays <= ROOM_SCHEDULE_MAX_DAYS
      ? "비공개 경기방 날짜는 오늘부터 1개월 안에서만 만들 수 있습니다."
      : "경기 날짜는 오늘부터 1년 안에서만 만들 수 있습니다.",
    tone: "orange",
  };
}

function getInvalidPublicScheduleNotification(detail = "공개 예약방은 5일 이내, 경기 4시간 이후 시간만 만들 수 있습니다.") {
  return {
    id: makeId("n"),
    title: "공개방 일정 불가",
    body: detail,
    tone: "orange",
  };
}

function normalizeSettings(settings = {}, options = {}) {
  const includeDemo = options.includeDemo !== false;
  const demoState = includeDemo ? getDemoInitialState() : EMPTY_STATE;
  const fallbackSettings = includeDemo ? demoState.settings ?? {} : {};
  return normalizeSettingsCore(settings, { fallbackSettings });
}

function getPublicRoomDisciplineBlockedState(state, post, actionLabel = "공개방 참가") {
  if ((post?.visibility ?? "public") !== "public") return null;
  const discipline = getActivePublicRoomDiscipline(state.settings, state.currentUserId);
  if (!discipline) return null;
  const until = discipline.endsAt ? new Date(discipline.endsAt).toLocaleString("ko-KR") : "제한 해제 전";
  return {
    ...state,
    notifications: [{
      id: makeId("n"),
      title: "공개방 참가 제한 중",
      body: `${actionLabel}은 ${until}까지 제한됩니다. 사유: ${discipline.reason || "관리자 제재"}`,
      tone: "orange",
    }, ...state.notifications],
  };
}

export function normalizeState(state, options = {}) {
  const includeDemo = options.includeDemo !== false;
  const preserveAuthoritativeMatches = options.preserveAuthoritativeMatches ?? !includeDemo;
  const demoState = includeDemo ? getDemoInitialState() : EMPTY_STATE;
  const baseState = includeDemo ? clone(demoState) : clone(EMPTY_STATE);
  const notifications = state?.notifications?.length ? state.notifications : includeDemo ? demoState.notifications : [];
  const deletedTeamIds = new Set(state?.deletedTeamIds ?? []);
  const recruitingPosts = normalizeRecruitingSchedules(
    includeDemo ? mergeDemoDefaultsById(state?.recruitingPosts, demoState.recruitingPosts ?? []) : state?.recruitingPosts ?? [],
  );
  const currentUserId = state?.currentUserId ?? baseState.currentUserId ?? "";
  const settings = normalizeSettings(state?.settings ?? (includeDemo ? demoState.settings : DEFAULT_SETTINGS), { includeDemo });
  const blockedUserIds = getBlockedUserIds(settings);
  const blockedUserIdSet = new Set(blockedUserIds);
  const isBlockedIncomingInvitation = (invitation = {}) => (
    invitation.targetUserId === currentUserId && blockedUserIdSet.has(invitation.fromUserId)
  );
  const visibleRecruitingPosts = recruitingPosts.map(normalizeRecruitingPost).map((post) => {
    const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
    const invitations = roomState.invitations.filter((invitation) => !isBlockedIncomingInvitation(invitation));
    return invitations.length === roomState.invitations.length
      ? post
      : { ...post, roomState: { ...roomState, invitations } };
  });

  return {
    ...baseState,
    ...state,
    deletedTeamIds: Array.from(deletedTeamIds),
    users: (includeDemo ? mergeDemoDefaultsById(state?.users, demoState.users) : state?.users ?? []).map(normalizeUser),
    teams: (includeDemo ? mergeDemoDefaultsById(state?.teams, demoState.teams) : state?.teams ?? [])
      .filter((team) => team && typeof team === "object" && !deletedTeamIds.has(team.id))
      .map(normalizeTeam),
    teamInvitations: (state?.teamInvitations ?? (includeDemo ? demoState.teamInvitations ?? [] : []))
      .filter((invitation) => !isBlockedIncomingInvitation(invitation)),
    affiliations: (includeDemo ? mergeDemoDefaultsById(state?.affiliations, demoState.affiliations) : state?.affiliations ?? []).filter((affiliation) => affiliation.type !== "club"),
    seasons: includeDemo ? mergeDemoDefaultsById(state?.seasons, demoState.seasons ?? []) : state?.seasons ?? [],
    matches: (includeDemo ? mergeDemoDefaultsById(state?.matches, demoState.matches) : state?.matches ?? [])
      .map((match) => normalizeMatch(match, { preserveAuthoritativeLifecycle: preserveAuthoritativeMatches })),
    tournaments: (includeDemo ? mergeDemoDefaultsById(state?.tournaments, demoState.tournaments ?? []) : state?.tournaments ?? []).map(normalizeTournament),
    notifications: notifications
      .map((notification) => ({ readAt: null, ...notification }))
      .filter((notification) => !(
        notification.targetUserId === currentUserId && isNotificationFromBlockedUser(notification, blockedUserIds)
      )),
    discordNotificationDeliveries: state?.discordNotificationDeliveries ?? (includeDemo ? demoState.discordNotificationDeliveries ?? [] : []),
    discordNotificationSeenKeys: state?.discordNotificationSeenKeys ?? (includeDemo ? demoState.discordNotificationSeenKeys ?? [] : []),
    discordNotificationSeenUsers: state?.discordNotificationSeenUsers ?? (includeDemo ? demoState.discordNotificationSeenUsers ?? [] : []),
    settings,
    reports: state?.reports ?? (includeDemo ? demoState.reports ?? [] : []),
    recruitingPosts: visibleRecruitingPosts,
  };
}

export function loadState(options = {}) {
  const includeDemo = options.includeDemo !== false;
  const fallback = includeDemo ? clone(getDemoInitialState()) : createEmptyState(options);
  const rawState = includeDemo ? readState(fallback) : fallback;
  return runAutomaticStateMaintenance(normalizeState(rawState, { includeDemo }));
}

export function saveState(state) {
  writeState(state);
}

export function syncNotificationDeliveries(state) {
  return syncDiscordNotificationDeliveries(state);
}

async function fetchCourtRows(client = supabase, ids = []) {
  const scopedIds = uniqueScopeIds(ids);
  const approvedFilter = (query) => {
    const activeQuery = query.or("status.is.null,status.eq.active");
    return scopedIds.length ? applyIdScope(activeQuery, "id", scopedIds) : activeQuery;
  };
  const [legacyRows, approvedRows] = await Promise.all([
    scopedIds.length
      ? fetchRowsByIds("courts", COURT_COLUMNS, "id", scopedIds, "id", client, true)
      : fetchOptionalRows("courts", COURT_COLUMNS, "id", client),
    fetchOptionalFilteredRows("approved_courts", COURT_COLUMNS, "id", client, approvedFilter),
  ]);
  return uniqueRowsById([...legacyRows, ...approvedRows]);
}

async function fetchCurrentUserReports(currentUserId = "", client = supabase) {
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
    legacyCourtMetrics,
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
    fetchOptionalRows("courts", COURT_METRIC_COLUMNS, "id", client),
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
    settings: {
      ...DEFAULT_SETTINGS,
      ...remoteAppSettings,
      favoritePlayerIds: favoriteRows.filter((favorite) => favorite.target_type === "player").map((favorite) => favorite.target_id),
      favoriteTeamIds: favoriteRows.filter((favorite) => favorite.target_type === "team").map((favorite) => favorite.target_id),
      favoriteCourtIds: favoriteRows.filter((favorite) => favorite.target_type === "court").map((favorite) => favorite.target_id),
      favoriteRefereeIds: favoriteRows.filter((favorite) => favorite.target_type === "referee").map((favorite) => favorite.target_id),
      courtMetrics: legacyCourtMetrics.map(fromRemoteCourtMetric),
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
      getMaxUpdatedAt(legacyCourtMetrics),
      getMaxUpdatedAt(approvedCourts),
      getMaxUpdatedAt(courtRequests),
      getMaxUpdatedAt(courtReviews),
      getMaxUpdatedAt(reports),
    ),
  };
}

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
    publicProfiles.forEach((profile) => {
      const mergedProfile = { ...profile, ...(privateProfileById.get(profile.id) ?? {}) };
      const existingIndex = profiles.findIndex((item) => item.id === mergedProfile.id);
      if (existingIndex >= 0) profiles[existingIndex] = { ...profiles[existingIndex], ...mergedProfile };
      else profiles.push(mergedProfile);
    });
  }

  const [
    reports,
    courtRequests,
    legacyCourtMetrics,
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
    !includeUserScoped ? [] : fetchOptionalRows("courts", COURT_METRIC_COLUMNS, "id", client),
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
    [teams, teamMembers, courts] = await Promise.all([
      fetchRowsByIds("teams", TEAM_COLUMNS, "id", teamIds, "id", client),
      fetchRowsByIds("team_members", TEAM_MEMBER_COLUMNS, "team_id", teamMemberTeamIds, null, client),
      fetchCourtRows(client, scoped.courtIds),
    ]);
    publicProfiles = await fetchRowsByIds(
      "public_profiles",
      PUBLIC_PROFILE_COLUMNS,
      "id",
      [...scoped.profileIds, ...(matchListOnly ? [] : teamMembers.map((member) => member.user_id))],
      "id",
      client,
      true,
    );
    publicProfiles.forEach((profile) => {
      const mergedProfile = { ...profile, ...(privateProfileById.get(profile.id) ?? {}) };
      const existingIndex = profiles.findIndex((item) => item.id === mergedProfile.id);
      if (existingIndex >= 0) profiles[existingIndex] = { ...profiles[existingIndex], ...mergedProfile };
      else profiles.push(mergedProfile);
    });
  }
  if (recruitingPageScope) {
    const scopedProfileIds = [...privateProfiles.map((profile) => profile.id), ...uniqueScopeIds(options.profileIds)];
    const scoped = collectRecruitingPageScope(recruitingPosts, recruitingApplications, scopedProfileIds);
    const currentUserTeamMemberships = options.includeCurrentUserTeams && currentUserId
      ? await fetchFilteredRows("team_members", TEAM_MEMBER_COLUMNS, null, client, (query) => query.eq("user_id", currentUserId))
      : [];
    const teamIds = uniqueScopeIds([...scoped.teamIds, ...uniqueScopeIds(options.teamIds), ...currentUserTeamMemberships.map((member) => member.team_id)]);
    const teamMemberTeamIds = recruitingListOnly ? [] : teamIds;
    [teams, teamMembers, courts] = await Promise.all([
      fetchRowsByIds("teams", TEAM_COLUMNS, "id", teamIds, "id", client),
      fetchRowsByIds("team_members", TEAM_MEMBER_COLUMNS, "team_id", teamMemberTeamIds, null, client),
      fetchCourtRows(client, scoped.courtIds),
    ]);
    publicProfiles = await fetchRowsByIds(
      "public_profiles",
      PUBLIC_PROFILE_COLUMNS,
      "id",
      [...scoped.profileIds, ...(recruitingListOnly ? [] : teamMembers.map((member) => member.user_id))],
      "id",
      client,
      true,
    );
    publicProfiles.forEach((profile) => {
      const mergedProfile = { ...profile, ...(privateProfileById.get(profile.id) ?? {}) };
      const existingIndex = profiles.findIndex((item) => item.id === mergedProfile.id);
      if (existingIndex >= 0) profiles[existingIndex] = { ...profiles[existingIndex], ...mergedProfile };
      else profiles.push(mergedProfile);
    });
  }
  if (tournamentPageScope) {
    const scopedProfileIds = [...privateProfiles.map((profile) => profile.id), ...uniqueScopeIds(options.profileIds)];
    const tournamentScope = collectTournamentPageScope(tournaments, tournamentTeams, scopedProfileIds);
    const matchScope = collectMatchPageScope(matches, matchPlayers, matchResults, playerStats, agreements, approvals, disputes, tournamentScope.profileIds);
    const teamIds = uniqueScopeIds([...tournamentScope.teamIds, ...matchScope.teamIds, ...uniqueScopeIds(options.teamIds)]);
    const courtIds = uniqueScopeIds([...tournamentScope.courtIds, ...matchScope.courtIds]);
    const profileIds = uniqueScopeIds([...tournamentScope.profileIds, ...matchScope.profileIds]);
    [teams, teamMembers, courts] = await Promise.all([
      fetchRowsByIds("teams", TEAM_COLUMNS, "id", teamIds, "id", client),
      fetchRowsByIds("team_members", TEAM_MEMBER_COLUMNS, "team_id", teamIds, null, client),
      fetchCourtRows(client, courtIds),
    ]);
    publicProfiles = await fetchRowsByIds(
      "public_profiles",
      PUBLIC_PROFILE_COLUMNS,
      "id",
      [...profileIds, ...teamMembers.map((member) => member.user_id)],
      "id",
      client,
      true,
    );
    publicProfiles.forEach((profile) => {
      const mergedProfile = { ...profile, ...(privateProfileById.get(profile.id) ?? {}) };
      const existingIndex = profiles.findIndex((item) => item.id === mergedProfile.id);
      if (existingIndex >= 0) profiles[existingIndex] = { ...profiles[existingIndex], ...mergedProfile };
      else profiles.push(mergedProfile);
    });
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
    [teams, teamMembers, courts] = await Promise.all([
      fetchRowsByIds("teams", TEAM_COLUMNS, "id", teamIds, "id", client),
      fetchRowsByIds("team_members", TEAM_MEMBER_COLUMNS, "team_id", teamIds, null, client),
      fetchCourtRows(client, courtIds),
    ]);
    publicProfiles = await fetchRowsByIds(
      "public_profiles",
      PUBLIC_PROFILE_COLUMNS,
      "id",
      [...profileIds, ...teamMembers.map((member) => member.user_id)],
      "id",
      client,
      true,
    );
    publicProfiles.forEach((profile) => {
      const mergedProfile = { ...profile, ...(privateProfileById.get(profile.id) ?? {}) };
      const existingIndex = profiles.findIndex((item) => item.id === mergedProfile.id);
      if (existingIndex >= 0) profiles[existingIndex] = { ...profiles[existingIndex], ...mergedProfile };
      else profiles.push(mergedProfile);
    });
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
    settings: {
      ...DEFAULT_SETTINGS,
      ...remoteAppSettings,
      favoritePlayerIds: favoriteRows.filter((favorite) => favorite.target_type === "player").map((favorite) => favorite.target_id),
      favoriteTeamIds: favoriteRows.filter((favorite) => favorite.target_type === "team").map((favorite) => favorite.target_id),
      favoriteCourtIds: favoriteRows.filter((favorite) => favorite.target_type === "court").map((favorite) => favorite.target_id),
      favoriteRefereeIds: favoriteRows.filter((favorite) => favorite.target_type === "referee").map((favorite) => favorite.target_id),
      courtMetrics: legacyCourtMetrics.map(fromRemoteCourtMetric),
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
      getMaxUpdatedAt(legacyCourtMetrics),
      getMaxUpdatedAt(approvedCourts),
      getMaxUpdatedAt(courtReviews),
      getMaxUpdatedAt(reports),
      getMaxUpdatedAt(notifications),
    ),
  };
}

async function loadNormalizedRemoteState(authUserId = "", authEmail = "", options = {}) {
  return loadNormalizedRemoteStateFromClient(supabase, authUserId, authEmail, options);
}

export async function loadRemoteState(authUserId = "", authEmail = "", options = {}) {
  if (!isSupabaseConfigured) return null;

  try {
    const normalizedRemote = await loadNormalizedRemoteState(authUserId, authEmail, { clientState: true, ...options });
    return normalizedRemote?.state ?? null;
  } catch (error) {
    console.warn("Supabase normalized state load failed. Remote state remains empty.", error.message);
    return null;
  }
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
  const matchRows = state.matches.map((match) => {
    const schedule = getDbScheduleParts(match);
    const statRecorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
    return {
      id: match.id,
      title: match.title,
      mode: match.mode,
      court_id: getCourtId(match),
      court_name: match.court,
      visibility: match.visibility ?? match.rules?.visibility ?? "private",
      status: match.status ?? "contract",
      ranked: match.ranked !== false,
      mmr_limit_mode: match.mmrLimitMode ?? "block",
      trust_feedback: match.trustFeedback ?? {},
      referee_id: match.refereeId || null,
      former_referee_id: match.formerRefereeId || null,
      referee_trust_min: Number(match.refereeTrustMin ?? REFEREE_TRUST_MIN),
      stat_entry_minutes: Number(match.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
      dispute_minutes: normalizeDisputeWindowMinutes(match.disputeMinutes),
      stat_recorders: statRecorders,
      played_player_ids: match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {},
      reserve_players: match.reservePlayers ?? match.rules?.reservePlayers ?? {},
      promoted_reserve_ids: match.promotedReserveIds ?? {},
      attendance: match.attendance ?? { teamA: [], teamB: [] },
      referee_absence_request: match.refereeAbsenceRequest ?? null,
      dispute_draft_result: match.disputeDraftResult ?? null,
      dispute_draft_updated_at: match.disputeDraftUpdatedAt ?? null,
      dispute_resolved_at: match.disputeResolvedAt ?? null,
      mmr_excluded_player_ids: match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? [],
      anonymous_players: match.anonymousPlayers ?? {},
      tournament_id: match.tournamentId ?? null,
      tournament_format: match.tournamentFormat ?? null,
      tournament_round: match.tournamentRound ?? null,
      tournament_fixture: match.tournamentFixture ?? null,
      tournament_mmr_policy: match.tournamentMmrPolicy ?? null,
      official: Boolean(match.official),
      pre_registered: Boolean(match.preRegistered),
      scheduled_at: schedule.scheduledAt,
      scheduled_date: schedule.scheduledDate,
      scheduled_time: schedule.scheduledTime,
      team_a_id: match.teamA?.teamId || null,
      team_b_id: match.teamB?.teamId || null,
      score_a: Number(match.result?.scoreA ?? 0),
      score_b: Number(match.result?.scoreB ?? 0),
      rules: { ...(match.rules ?? {}), timingType: schedule.timingType, visibility: match.visibility ?? match.rules?.visibility ?? "private", statRecorders },
      memo: match.memo,
      stakes: match.stakes,
      objection_window: match.objectionWindow,
      evidence: match.evidence ?? [],
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
      rating_result: match.ratingResult ?? null,
      team_rating_result: match.teamRatingResult ?? null,
      updated_at: new Date().toISOString(),
    };
  });
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
  const statRows = state.matches.flatMap((match) =>
    Object.entries(match.result?.playerStats ?? {}).map(([userId, stat]) => ({
      match_id: match.id,
      user_id: userId,
      recorded_by: match.result?.statSubmissions?.[userId]?.by ?? null,
      record_source: match.result?.statSubmissions?.[userId]?.source ?? "player",
      points: Number(stat.points ?? 0),
      rebounds: Number(stat.rebounds ?? 0),
      assists: Number(stat.assists ?? 0),
      steals: Number(stat.steals ?? 0),
      blocks: Number(stat.blocks ?? 0),
      fouls: Number(stat.fouls ?? 0),
      updated_at: new Date().toISOString(),
    })),
  );
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

export function subscribeRemoteState() {
  return () => {};
}

export function resetState(options = {}) {
  clearState();
  return options.includeDemo === false ? createEmptyState(options) : clone(getDemoInitialState());
}

function getMatchRecordComposition(draft = {}) {
  return draft.recordComposition === "team" ? "team" : "individual";
}

function getMatchRecordDraftInvalidReason(state, draft = {}, mode = "") {
  if (draft.visibility && draft.visibility !== "private") return "경기 기록방은 비공개로만 만들 수 있습니다.";
  if (!isSupportedMatchMode(mode)) return "지원하지 않는 경기 인원입니다.";
  const requestedComposition = draft.recordComposition ?? getMatchRecordComposition(draft);
  if (!["individual", "team"].includes(requestedComposition)) return "경기 기록 구성 방식을 확인해 주세요.";
  if (!state.currentUserId || !state.users.some((user) => user.id === state.currentUserId && !user.anonymous)) return "기록방 생성자를 확인할 수 없습니다.";
  return "";
}

function getTrustedRefereeId(state, refereeId, playerIds = []) {
  if (!refereeId || playerIds.includes(refereeId)) return "";
  const user = state.users.find((item) => item.id === refereeId);
  return isEligibleReferee(user, REFEREE_TRUST_MIN, state.settings?.refereeAppointments) ? refereeId : "";
}

function getRecruitingReserveLimitNotification(postId, sideName, benchCapacity = DEFAULT_BENCH_CAPACITY) {
  return {
    id: makeId("n"),
    title: "후보 슬롯 초과",
    body: `${SIDE_LABEL_TEXT[sideName] ?? "해당 사이드"} 후보는 최대 ${benchCapacity}명까지 가능합니다.`,
    tone: "orange",
    recruitingPostId: postId,
  };
}

function getLocalTournamentMatchRefereeId(state, tournament, teamAId, teamBId) {
  const assignmentCounts = new Map();
  (state.matches ?? []).forEach((match) => {
    if (match.tournamentId === tournament.id && match.refereeId) {
      assignmentCounts.set(match.refereeId, (assignmentCounts.get(match.refereeId) ?? 0) + 1);
    }
  });
  return getAcceptedTournamentRefereeIds(tournament)
    .filter((refereeId) => isEligibleReferee(
      state.users.find((user) => user.id === refereeId),
      REFEREE_TRUST_MIN,
      state.settings?.refereeAppointments,
      tournament.endDate,
    ))
    .filter((refereeId) => isTournamentRefereeNeutral(tournament, refereeId, teamAId, teamBId, state.teams))
    .sort((left, right) => (
      (assignmentCounts.get(left) ?? 0) - (assignmentCounts.get(right) ?? 0)
      || String(left).localeCompare(String(right))
    ))[0] ?? "";
}

function makeTournamentMatch(state, tournament, teamA, teamB, pairing, now, matchId = "") {
  const mode = tournament.mode || "5v5";
  const size = MODE_SIZES[mode] ?? 5;
  const disputeMinutes = normalizeDisputeWindowMinutes(tournament.rules?.disputeMinutes ?? tournament.disputeMinutes);
  const roundLabel = tournament.format === "tournament" ? `${pairing.round}R-${pairing.fixture}` : `L-${pairing.fixture}`;
  const teamAPlayers = [];
  const teamBPlayers = [];

  return {
    id: matchId || makeId("m"),
    title: `${roundLabel} · ${teamA.name} vs ${teamB.name}`,
    mode,
    courtId: tournament.courtId ?? getCourtId(tournament),
    court: tournament.court || "미정",
    scheduledDate: "",
    scheduledTime: "",
    scheduledAt: "일정 미정",
    visibility: tournament.visibility ?? "private",
    status: "agreed",
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    preRegistered: true,
    refereeId: getLocalTournamentMatchRefereeId(state, tournament, teamA.id, teamB.id),
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes,
    tournamentId: tournament.id,
    tournamentFormat: tournament.format,
    tournamentRound: pairing.round,
    tournamentFixture: pairing.fixture,
    tournamentBracketMatch: pairing.bracketMatch ?? pairing.fixture,
    tournamentMmrPolicy: tournament.mmrPolicy,
    rules: {
      ...(tournament.rules ?? {}),
      sideCapacity: size,
      visibility: tournament.visibility ?? "private",
      rosterReady: { teamA: false, teamB: false },
      rosterReadyAt: {},
      tournamentOrganizerId: tournament.createdBy,
      tournamentSideAssignmentLocked: false,
      tournamentHostRosterSelected: false,
    },
    memo: tournament.memo || "대회 경기입니다.",
    stakes: "대회 경기 MMR 가중치가 적용됩니다.",
    mmrLimitMode: tournament.mmrLimitMode ?? "warn",
    objectionWindow: `${disputeMinutes}분`,
    evidence: [],
    teamA: { name: teamA.name, teamId: teamA.id, players: teamAPlayers, score: 0 },
    teamB: { name: teamB.name, teamId: teamB.id, players: teamBPlayers, score: 0 },
    agreements: { teamA: teamAPlayers, teamB: teamBPlayers },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    createdBy: tournament.createdBy,
    agreedAt: now,
    createdAt: now,
  };
}

function generateTournamentMatches(state, tournament, options = {}) {
  if (tournament.matchIds?.length) return { matches: [], tournament };

  const teamById = Object.fromEntries(state.teams.map((team) => [team.id, team]));
  const now = new Date().toISOString();
  const pairSource = tournament.format === "tournament"
    ? buildTournamentPairings(tournament.teamIds ?? [])
    : { seedOrder: tournament.teamIds ?? [], pairings: buildLeaguePairings(tournament.teamIds ?? []), byes: [] };
  const preferredMatchIds = Array.isArray(options.preferredMatchIds) ? options.preferredMatchIds : [];
  const matches = [];
  pairSource.pairings.forEach((pairing, index) => {
    const teamA = teamById[pairing.teamAId];
    const teamB = teamById[pairing.teamBId];
    if (!teamA || !teamB) return;
    const match = makeTournamentMatch(
      { ...state, matches: [...(state.matches ?? []), ...matches] },
      tournament,
      teamA,
      teamB,
      pairing,
      now,
      preferredMatchIds[index],
    );
    matches.push(match);
  });
  const matchIds = matches.map((match) => match.id);
  const fixtureRows = matches.map((match) => ({
    matchId: match.id,
    round: match.tournamentRound,
    fixture: match.tournamentFixture,
    bracketMatch: match.tournamentBracketMatch ?? match.tournamentFixture,
    teamAId: match.teamA.teamId,
    teamBId: match.teamB.teamId,
  }));
  const bracket = tournament.format === "tournament"
    ? {
        format: "tournament",
        generatedAt: now,
        seedOrder: pairSource.seedOrder,
        bracketSize: pairSource.bracketSize,
        slots: pairSource.slots,
        firstRound: pairSource.firstRound,
        rounds: [{ id: "round-1", name: "1라운드", pairings: fixtureRows, byes: pairSource.byes }],
      }
    : {
        format: "league",
        generatedAt: now,
        fixtures: fixtureRows,
      };

  return {
    matches,
    tournament: {
      ...tournament,
      status: "active",
      startedAt: now,
      matchIds,
      bracket,
    },
  };
}

function getStateRepresentativeTeamId(state, userId) {
  const user = state.users.find((item) => item.id === userId);
  const explicitTeamId = userId === state.currentUserId
    ? state.settings?.representativeTeamId ?? user?.representativeTeamId ?? ""
    : user?.representativeTeamId ?? "";
  const memberTeams = state.teams
    .filter((team) => team.members?.some((member) => member.userId === userId))
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || String(a.id).localeCompare(String(b.id)));
  return memberTeams.some((team) => team.id === explicitTeamId) ? explicitTeamId : memberTeams[0]?.id ?? "";
}

function getLocalTournamentTeamSnapshot(state, team, options = {}) {
  const eligibility = getTeamEventEligibility(team, state.users, options);
  const representativeMemberIds = getSelectableTeamPlayerIds(team)
    .filter((playerId) => getStateRepresentativeTeamId(state, playerId) === team.id);
  const representativeMemberSet = new Set(representativeMemberIds);
  const eligiblePlayerIds = eligibility.eligiblePlayerIds.filter((playerId) => representativeMemberSet.has(playerId));
  const captainId = getTeamCaptainId(state.teams, team.id);
  const capacity = Math.max(1, Math.min(5, Number(options.capacity) || 1));
  return {
    teamId: team.id,
    captainId,
    captainRepresentative: Boolean(captainId && getStateRepresentativeTeamId(state, captainId) === team.id),
    representativeMemberIds,
    eligiblePlayerIds,
    eligibleCount: eligiblePlayerIds.length,
    capacity,
    allowed: Boolean(captainId && getStateRepresentativeTeamId(state, captainId) === team.id && eligiblePlayerIds.length >= capacity),
  };
}

function getTournamentMatchWinnerTeamId(match = {}) {
  if (!match || match.status !== "confirmed") return "";
  const scoreA = Number(match.result?.scoreA ?? match.teamA?.score ?? 0);
  const scoreB = Number(match.result?.scoreB ?? match.teamB?.score ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA?.teamId ?? "" : match.teamB?.teamId ?? "";
}

function findTournamentRoundMatch(matches = [], tournamentId = "", round = 1, fixture = 1) {
  return matches.find((match) => (
    match.tournamentId === tournamentId &&
    Number(match.tournamentRound ?? 0) === Number(round) &&
    Number(match.tournamentFixture ?? 0) === Number(fixture)
  )) ?? null;
}

function getTournamentNodeWinnerTeamId(state, tournament, round, fixture) {
  const bracket = tournament.bracket ?? {};
  if (round === 1) {
    const row = (bracket.firstRound ?? [])[fixture - 1];
    if (row?.byeTeamId) return row.byeTeamId;
  }
  return getTournamentMatchWinnerTeamId(findTournamentRoundMatch(state.matches, tournament.id, round, fixture));
}

function advanceTournamentAfterMatch(state, confirmedMatch) {
  if (!confirmedMatch?.tournamentId || confirmedMatch.tournamentFormat !== "tournament") return state;
  const tournament = (state.tournaments ?? []).find((item) => item.id === confirmedMatch.tournamentId);
  if (!tournament || tournament.format !== "tournament" || tournament.status !== "active") return state;
  const winnerTeamId = getTournamentMatchWinnerTeamId(confirmedMatch);
  if (!winnerTeamId) return state;

  const bracket = tournament.bracket ?? {};
  const bracketSize = Number(bracket.bracketSize ?? 0);
  const totalRounds = Math.max(1, Math.ceil(Math.log2(Math.max(bracketSize, 2))));
  const currentRound = Number(confirmedMatch.tournamentRound ?? 1);
  const currentFixture = Number(confirmedMatch.tournamentFixture ?? 1);
  const now = new Date().toISOString();

  if (currentRound >= totalRounds) {
    const closedTournament = {
      ...tournament,
      status: "closed",
      bracket: {
        ...bracket,
        championTeamId: winnerTeamId,
        completedAt: now,
      },
    };
    return {
      ...state,
      tournaments: (state.tournaments ?? []).map((item) => (item.id === tournament.id ? closedTournament : item)),
      notifications: [
        {
          id: makeId("n"),
          title: "대회 종료",
          body: `${tournament.title} 우승팀이 확정됐습니다.`,
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  const nextRound = currentRound + 1;
  const nextFixture = Math.ceil(currentFixture / 2);
  const sourceFixtureA = (nextFixture - 1) * 2 + 1;
  const sourceFixtureB = sourceFixtureA + 1;
  const teamAId = getTournamentNodeWinnerTeamId(state, tournament, currentRound, sourceFixtureA);
  const teamBId = getTournamentNodeWinnerTeamId(state, tournament, currentRound, sourceFixtureB);
  if (!teamAId || !teamBId) return state;
  if (findTournamentRoundMatch(state.matches, tournament.id, nextRound, nextFixture)) return state;

  const teamById = Object.fromEntries(state.teams.map((team) => [team.id, team]));
  const teamA = teamById[teamAId];
  const teamB = teamById[teamBId];
  if (!teamA || !teamB) return state;

  const nextMatch = makeTournamentMatch(state, tournament, teamA, teamB, {
    round: nextRound,
    fixture: nextFixture,
    bracketMatch: nextFixture,
  }, now);
  const nextRoundIndex = nextRound - 1;
  const rounds = [...(bracket.rounds ?? [])];
  const currentRoundEntry = rounds[nextRoundIndex] ?? {
    id: `round-${nextRound}`,
    name: `${nextRound}라운드`,
    pairings: [],
    byes: [],
  };
  const nextPairing = {
    matchId: nextMatch.id,
    round: nextRound,
    fixture: nextFixture,
    bracketMatch: nextFixture,
    sourceRound: currentRound,
    sourceFixtures: [sourceFixtureA, sourceFixtureB],
    teamAId,
    teamBId,
  };
  rounds[nextRoundIndex] = {
    ...currentRoundEntry,
    pairings: [
      ...(currentRoundEntry.pairings ?? []).filter((pairing) => Number(pairing.fixture) !== nextFixture),
      nextPairing,
    ].sort((a, b) => Number(a.fixture ?? 0) - Number(b.fixture ?? 0)),
  };
  const nextTournament = {
    ...tournament,
    matchIds: [...new Set([...(tournament.matchIds ?? []), nextMatch.id])],
    bracket: {
      ...bracket,
      rounds,
      updatedAt: now,
    },
  };

  return {
    ...state,
    matches: [nextMatch, ...state.matches],
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournament.id ? nextTournament : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "후속 라운드 생성",
        body: `${tournament.title} ${nextRound}라운드 ${nextFixture}경기가 생성됐습니다.`,
        tone: "match",
        matchId: nextMatch.id,
      },
      ...state.notifications,
    ],
  };
}

function updateAffiliationScores(state) {
  const users = state.users;
  return state.affiliations.filter((affiliation) => affiliation.type !== "club").map((affiliation) => {
    const members = users.filter((user) => {
      if (affiliation.type === "region") return user.region === affiliation.name;
      if (affiliation.type === "school") return user.school === affiliation.name;
      if (affiliation.type === "company") return user.company === affiliation.name;
      if (affiliation.type === "organization") return user.affiliationId === affiliation.id;
      return false;
    });
    if (!members.length) return affiliation;
    const average = members.reduce((sum, user) => sum + user.ratings.integrated, 0) / members.length;
    return { ...affiliation, memberCount: members.length, score: Math.round(average + affiliation.wins * 2 - affiliation.losses) };
  });
}

function finalizeMatch(state, targetMatch) {
  if (isPracticeEntity(targetMatch)) {
    const confirmedMatch = {
      ...targetMatch,
      status: "confirmed",
      ratingResult: [],
      teamRatingResult: null,
      confirmedAt: new Date().toISOString(),
    };
    return {
      ...state,
      matches: state.matches.map((match) => (match.id === targetMatch.id ? confirmedMatch : match)),
    };
  }
  const ratingContext = getFinalizationRatingContext(targetMatch, state.teams);
  const ratingMatch = ratingContext.matchForRating;
  const ratings = Object.fromEntries(state.users.map((user) => [user.id, clone(user.ratings)]));
  const ratingResult = ratingContext.canApplyPersonalMmr
    ? applyMatchRating(ratingMatch, state.users, ratings, state.matches, state.teams)
    : { ratings: {}, changes: [] };
  const scoreA = Number(targetMatch.result.scoreA);
  const scoreB = Number(targetMatch.result.scoreB);
  const actualA = scoreA === scoreB ? 0.5 : scoreA > scoreB ? 1 : 0;
  const actualB = 1 - actualA;
  const teamAGroups = ratingContext.canApplyTeamMmr ? getMatchSideTeamGroups(state, ratingMatch, "teamA") : [];
  const teamBGroups = ratingContext.canApplyTeamMmr ? getMatchSideTeamGroups(state, ratingMatch, "teamB") : [];
  const teamAMmr = averageTeamMmr(teamAGroups);
  const teamBMmr = averageTeamMmr(teamBGroups);
  const teamDeltaEntries = [
    ...teamAGroups.map((group) => ({
      teamId: group.team.id,
      side: "teamA",
      actual: actualA,
      delta: calculateTeamDelta({
        teamMmr: group.team.mmr,
        opponentTeamMmr: teamBMmr,
        actual: actualA,
        match: ratingMatch,
        regularRatio: teamRegularRatio(group.team, group.playerIds, state.users),
      }),
    })),
    ...teamBGroups.map((group) => ({
      teamId: group.team.id,
      side: "teamB",
      actual: actualB,
      delta: calculateTeamDelta({
        teamMmr: group.team.mmr,
        opponentTeamMmr: teamAMmr,
        actual: actualB,
        match: ratingMatch,
        regularRatio: teamRegularRatio(group.team, group.playerIds, state.users),
      }),
    })),
  ];
  const teamDeltaById = teamDeltaEntries.reduce((acc, entry) => {
    acc[entry.teamId] = entry;
    return acc;
  }, {});
  const teamADelta = teamDeltaEntries
    .filter((entry) => entry.side === "teamA")
    .reduce((sum, entry) => sum + entry.delta, 0);
  const teamBDelta = teamDeltaEntries
    .filter((entry) => entry.side === "teamB")
    .reduce((sum, entry) => sum + entry.delta, 0);
  const trustRewards = new Map();
  Object.values(targetMatch.result?.statSubmissions ?? {}).forEach((submission) => {
    if (submission?.source === "candidate_recorder" && submission.by) {
      trustRewards.set(submission.by, (trustRewards.get(submission.by) ?? 0) + 2);
    }
  });
  if (targetMatch.refereeId) {
    trustRewards.set(targetMatch.refereeId, (trustRewards.get(targetMatch.refereeId) ?? 0) + 1);
  }

  const users = state.users.map((user) => {
    const nextRatings = ratingResult.ratings[user.id];
    const trustReward = trustRewards.get(user.id) ?? 0;
    if (!nextRatings && !trustReward) return user;
    const change = ratingResult.changes.find((item) => item.playerId === user.id);
    const foulPenalty = getFoulTrustPenalty(targetMatch.result?.playerStats?.[user.id]);
    return {
      ...user,
      trustScore: clampTrustScore((user.trustScore ?? 80) + (nextRatings ? 1 : 0) + trustReward + foulPenalty),
      streak: nextRatings
        ? change?.result === "win"
          ? Math.max(1, user.streak + 1)
          : change?.result === "loss"
            ? Math.min(-1, user.streak - 1)
            : user.streak
        : user.streak,
      ratings: nextRatings ?? user.ratings,
    };
  });

  const teams = state.teams.map((team) => {
    const teamDelta = teamDeltaById[team.id];
    if (teamDelta) {
      return {
        ...team,
        mmr: Math.round(team.mmr + teamDelta.delta),
        wins: team.wins + (teamDelta.actual === 1 ? 1 : 0),
        losses: team.losses + (teamDelta.actual === 0 ? 1 : 0),
      };
    }
    return team;
  });

  const confirmedMatch = {
    ...targetMatch,
    status: "confirmed",
    ratingResult: ratingResult.changes,
    teamRatingResult: {
      teamA: teamADelta,
      teamB: teamBDelta,
      teams: Object.fromEntries(teamDeltaEntries.map((entry) => [entry.teamId, entry.delta])),
    },
    confirmedAt: new Date().toISOString(),
  };
  const nextState = {
    ...state,
    users,
    teams,
    matches: state.matches.map((match) => (match.id === targetMatch.id ? confirmedMatch : match)),
    notifications: [
      {
        id: makeId("n"),
        title: "경기 확정",
        body: ratingResult.changes.length || teamDeltaEntries.length
          ? `${targetMatch.title} 결과가 티어와 랭킹에 반영됐습니다.`
          : `${targetMatch.title} 결과가 공식 기록으로 확정됐습니다.`,
        tone: ratingResult.changes.length || teamDeltaEntries.length ? "tier" : "match",
        matchId: targetMatch.id,
      },
      ...state.notifications,
    ],
  };

  const advancedState = advanceTournamentAfterMatch(nextState, confirmedMatch);
  return { ...advancedState, affiliations: updateAffiliationScores(advancedState) };
}

function applyAutomaticMatchDecisions(state, now = new Date()) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  let nextState = state;

  for (const match of state.matches ?? []) {
    const current = nextState.matches.find((item) => item.id === match.id);
    if (!current) continue;

    if ((current.status === "approval" || current.status === "disputed") && current.result) {
      const recordWindow = getMatchRecordWindow(current, nowMs);
      if (!recordWindow.disputeExpired) continue;
      if (current.status === "disputed" && (current.disputes ?? []).some((dispute) => dispute.status === "open")) continue;
      const result = current.disputeDraftResult ?? current.result;
      const nextMatch = {
        ...current,
        result,
        teamA: { ...current.teamA, score: result.scoreA },
        teamB: { ...current.teamB, score: result.scoreB },
        disputeDraftResult: undefined,
        disputeDraftUpdatedAt: undefined,
        approvals: fillMatchDecision(current, "approvals"),
        autoConfirmedAt: current.autoConfirmedAt ?? nowIso,
      };
      nextState = finalizeMatch(
        {
          ...nextState,
          matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        },
        nextMatch,
      );
      continue;
    }

    if (!isAutoDecisionDue(current, nowMs)) continue;

    if (current.status === "contract") {
      const nextMatch = {
        ...current,
        status: "agreed",
        agreements: fillMatchDecision(current, "agreements"),
        agreedAt: current.agreedAt ?? nowIso,
        autoAgreedAt: current.autoAgreedAt ?? nowIso,
      };
      nextState = {
        ...nextState,
        matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        notifications: [
          {
            id: makeId("n"),
            title: "동의 자동 처리",
            body: `${current.title} 동의가 24시간 안에 처리되지 않아 자동 동의 처리됐습니다.`,
            tone: "match",
            matchId: current.id,
          },
          ...nextState.notifications,
        ],
      };
      continue;
    }

    if (current.status === "approval" && current.result) {
      const statStatus = getStatSubmissionStatus(current);
      const pointAudit = getResultPointAudit(current);
      if (!statStatus.complete || !pointAudit.matched) continue;
      const nextMatch = {
        ...current,
        approvals: fillMatchDecision(current, "approvals"),
        autoApprovedAt: current.autoApprovedAt ?? nowIso,
      };
      nextState = finalizeMatch(
        {
          ...nextState,
          matches: nextState.matches.map((item) => (item.id === current.id ? nextMatch : item)),
        },
        nextMatch,
      );
    }

  }

  return nextState;
}

function applyExpiredRecruitingRooms(state, now = new Date()) {
  const expiredRows = (state.recruitingPosts ?? []).map((post) => {
    if (post.status !== "open") return false;
    const lobby = getRecruitingLobby(post, state);
    const timing = getPublicRoomTimingStatus(post, now);
    if (timing.expired) return { post, lobby, penalizeHost: lobby.projectedFull };
    const deadlineMs = getScheduledStartMs(post);
    if (!Number.isFinite(deadlineMs) || now.getTime() <= deadlineMs || lobby.projectedFull) return false;
    return { post, lobby, penalizeHost: false };
  }).filter(Boolean);
  if (!expiredRows.length) return state;

  const expiredPosts = expiredRows.map((row) => row.post);
  const expiredIds = new Set(expiredPosts.map((post) => post.id));
  const penalizedHostIds = expiredRows.filter((row) => row.penalizeHost).map((row) => getRecruitingRoomOwnerId(row.post) || row.post.playerId);
  const nowIso = now.toISOString();

  return {
    ...state,
    users: penalizedHostIds.reduce((users, userId) => adjustUserTrust(users, userId, -4), state.users),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => {
      if (!expiredIds.has(post.id)) return post;
      const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
      return {
        ...post,
        status: "cancelled",
        cancelledAt: post.cancelledAt ?? nowIso,
        roomState: {
          ...roomState,
          invitations: roomState.invitations.map((invitation) => (
            invitation.status === "pending" ? { ...invitation, status: "expired", updatedAt: nowIso } : invitation
          )),
        },
      };
    }),
    notifications: [
      ...expiredPosts.map((post) => ({
        id: makeId("n"),
        title: "매칭방 자동 취소",
        body: `${post.title} 인원이 제한시간 안에 차지 않아 취소됐습니다.`,
        tone: "orange",
        recruitingPostId: post.id,
      })),
      ...state.notifications,
    ],
  };
}

function applyAutomaticRecruitingConfirmations(state) {
  return state;
}

function repairRecruitingSameTeamPersonalParties(state) {
  let changed = false;
  const recruitingPosts = (state.recruitingPosts ?? []).map((post) => {
    if (!post || post.status !== "open" || post.visibility !== "public") return post;
    let postChanged = false;
    const normalizedPost = normalizeRecruitingPost(post);
    let applicants = normalizeRecruitingApplicants(normalizedPost.applicants ?? []);
    const lobby = getRecruitingLobby({ ...normalizedPost, applicants }, state);
    const roomState = normalizeRecruitingRoomState(normalizedPost.roomState ?? {});
    const capacity = getRecruitingSideCapacity(normalizedPost);
    const partyTargetsBySide = MATCH_SIDES.reduce((acc, sideName) => {
      acc[sideName] = (lobby.sides?.[sideName]?.entries ?? [])
        .filter((entry) => isRecruitingPartyEntry(entry) && entry.team?.id)
        .map((entry) => ({
          entryId: entry.id,
          teamId: entry.team.id,
          fixed: Boolean(entry.fixed),
          memberIds: new Set((entry.team.members ?? []).map((member) => member.userId)),
          playerIds: uniquePlayerIds(entry.players ?? []),
        }));
      return acc;
    }, {});
    const nextPartyReserves = { ...(roomState.partyReserves ?? {}) };

    applicants.forEach((applicant) => {
      if (
        applicant.kind !== "player" ||
        applicant.status !== "ready" ||
        !applicant.playerId ||
        applicant.sourceTeamId ||
        applicant.sourceEntryId
      ) return;

      const targets = (partyTargetsBySide[applicant.side] ?? [])
        .filter((target) => target.memberIds.has(applicant.playerId));
      if (targets.length !== 1) return;

      const target = targets[0];
      const applicantKey = getRecruitingApplicantKey(applicant);
      if (applicant.reserve) {
        const reserveIds = uniquePlayerIds([...(nextPartyReserves[target.entryId] ?? []), applicant.playerId]);
        nextPartyReserves[target.entryId] = reserveIds;
      } else if (target.fixed) {
        const currentPlayerIds = uniquePlayerIds(normalizedPost.playerIds ?? []);
        const nextPlayerIds = uniquePlayerIds([...currentPlayerIds, applicant.playerId]).slice(0, capacity);
        if (!nextPlayerIds.includes(applicant.playerId)) return;
        normalizedPost.playerIds = nextPlayerIds;
        target.playerIds = nextPlayerIds;
      } else {
        let absorbed = false;
        applicants = applicants.map((item) => {
          if (getRecruitingApplicantKey(item) !== target.entryId) return item;
          const currentPlayerIds = uniquePlayerIds(item.playerIds ?? []);
          const nextPlayerIds = uniquePlayerIds([...currentPlayerIds, applicant.playerId]).slice(0, capacity);
          if (!nextPlayerIds.includes(applicant.playerId)) return item;
          target.playerIds = nextPlayerIds;
          absorbed = true;
          return {
            ...item,
            playerId: nextPlayerIds.includes(item.playerId) ? item.playerId : nextPlayerIds[0],
            playerIds: nextPlayerIds,
          };
        });
        if (!absorbed) return;
      }

      applicants = applicants.filter((item) => getRecruitingApplicantKey(item) !== applicantKey);
      postChanged = true;
      changed = true;
    });

    return postChanged
      ? {
          ...post,
          hostJoinMode: normalizedPost.hostJoinMode,
          teamId: normalizedPost.teamId,
          playerIds: normalizedPost.playerIds,
          roomState: { ...roomState, partyReserves: nextPartyReserves },
          applicants,
        }
      : post;
  });

  return changed ? { ...state, recruitingPosts } : state;
}

export function runAutomaticStateMaintenance(state, now = new Date()) {
  return repairRecruitingSameTeamPersonalParties(applyAutomaticRecruitingConfirmations(applyExpiredRecruitingRooms(applyAutomaticMatchDecisions(state, now), now)));
}

function withSoloRecordNotification(state, title, body) {
  return {
    ...state,
    notifications: [
      { id: makeId("n"), title, body, tone: "match" },
      ...(state.notifications ?? []),
    ],
  };
}

function createSoloRecordMatch(state, draft = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "개인 기록 저장");
  if (disciplineBlock) return disciplineBlock;
  const playerId = state.currentUserId;
  const player = state.users.find((user) => user.id === playerId);
  if (!playerId || !player) return state;

  const now = new Date();
  const nowIso = now.toISOString();
  const recordDate = /^\d{4}-\d{2}-\d{2}$/.test(String(draft.scheduledDate ?? ""))
    ? String(draft.scheduledDate)
    : nowIso.slice(0, 10);
  const recordTime = /^\d{2}:\d{2}$/.test(String(draft.scheduledTime ?? ""))
    ? String(draft.scheduledTime)
    : getSeoulTimeInputValue(now);
  const recordWindow = getRecordCreationWindowStatus(recordDate, recordTime, now);
  if (!recordWindow.valid) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "개인 기록 날짜 확인",
          body: recordWindow.reason === "future"
            ? "경기가 끝난 뒤에만 개인 기록을 저장할 수 있습니다."
            : "개인 기록은 경기 종료 후 24시간 이내에만 저장할 수 있습니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }
  const scoreA = toSoloRecordNumber(draft.soloScoreFor);
  const scoreB = toSoloRecordNumber(draft.soloScoreAgainst);
  const mode = normalizeSoloRecordMode(draft.mode);
  const sideSize = getSoloRecordSideSize(mode);
  const recordEntryMode = draft.recordEntryMode === "named" ? "named" : "quick";
  const teamAName = String(draft.soloTeamAName ?? "").trim() || "우리팀";
  const teamBName = String(draft.soloTeamBName ?? draft.soloOpponentName ?? "").trim() || "상대팀";
  const teamAEntries = recordEntryMode === "named" ? parseSoloRecordRosterText(draft.soloTeamAPlayersText) : [];
  const teamBEntries = recordEntryMode === "named" ? parseSoloRecordRosterText(draft.soloTeamBPlayersText) : [];
  if (recordEntryMode === "named" && !teamBEntries.length && String(draft.soloOpponentName ?? "").trim()) {
    teamBEntries.push({ name: String(draft.soloOpponentName).trim(), position: SOLO_RECORD_ANONYMOUS_POSITION });
  }
  const rosterError = getSoloRecordRosterError(teamAEntries, teamBEntries, sideSize);
  if (rosterError) return withSoloRecordNotification(state, "개인 기록 선수 확인", rosterError);
  const teamAAnonymous = makeSoloRecordAnonymousSide({
    count: teamAEntries.length,
    entries: teamAEntries,
  });
  const teamBAnonymous = makeSoloRecordAnonymousSide({
    count: teamBEntries.length,
    entries: teamBEntries,
  });
  const anonymousPlayers = Object.fromEntries(
    [...teamAAnonymous, ...teamBAnonymous].map((entry) => [
      entry.id,
      makeAnonymousMatchPlayer(entry.id, entry.name, entry.position),
    ]),
  );
  const playedPlayerIds = {
    teamA: uniquePlayerIds([playerId, ...teamAAnonymous.map((entry) => entry.id)]),
    teamB: teamBAnonymous.map((entry) => entry.id),
  };
  const mmrExcludedPlayerIds = uniquePlayerIds([...playedPlayerIds.teamA, ...playedPlayerIds.teamB]);
  const statSubmissions = {
    [playerId]: { by: playerId, source: "host_postgame", submittedAt: nowIso },
  };
  const result = {
    scoreA,
    scoreB,
    playerStats: {
      [playerId]: makeSoloRecordStats(scoreA, draft.soloStats),
    },
    statSubmissions,
    submittedBy: playerId,
    submittedAt: nowIso,
    updatedAt: nowIso,
  };
  const selectedCourt = getRegisteredCourts(state).find((court) => court.name === draft.court || court.id === getCourtId(draft)) ?? null;
  const rules = {
    recordType: RECORD_TYPES.personalRecord,
    recordEntryMode,
    mmrExcludedPlayerIds,
    playedPlayerIds,
    statRecorders: {},
    visibility: "private",
    region: selectedCourt?.region ?? draft.region,
    ratingScale: 0,
    recordSummary: {
      mode,
      recordEntryMode,
      teamAName,
      teamBName,
      teamAPlayers: [player.name || "나", ...teamAAnonymous.map((entry) => entry.name)],
      teamBPlayers: teamBAnonymous.map((entry) => entry.name),
    },
  };
  const match = {
    id: draft.id || makeId("m"),
    title: String(draft.title ?? "").trim() || "개인 기록",
    mode,
    courtId: selectedCourt?.id ?? getCourtId(draft),
    court: draft.court || "미정",
    scheduledDate: recordDate,
    scheduledTime: recordTime,
    scheduledAt: `${recordDate} ${recordTime}`,
    timingType: "scheduled",
    visibility: "private",
    status: "confirmed",
    ranked: false,
    official: false,
    preRegistered: false,
    refereeId: "",
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    rules,
    memo: draft.memo || "혼자 저장한 개인 기록입니다.",
    stakes: draft.stakes || "MMR 미반영",
    mmrLimitMode: "off",
    mmrRangeMode: "wide",
    ratingScale: 0,
    objectionWindow: "없음",
    evidence: [],
    teamA: { name: teamAName, teamId: "", players: [playerId], score: scoreA },
    teamB: { name: teamBName, teamId: "", players: [], score: scoreB },
    agreements: { teamA: [playerId], teamB: [] },
    approvals: { teamA: [playerId], teamB: [] },
    disputes: [],
    playedPlayerIds,
    reservePlayers: { teamA: [], teamB: [] },
    anonymousPlayers,
    mmrExcludedPlayerIds,
    statRecorders: {},
    result,
    ratingResult: [],
    teamRatingResult: { teamA: 0, teamB: 0, teams: {} },
    createdBy: playerId,
    agreedAt: nowIso,
    startedAt: nowIso,
    endedAt: nowIso,
    confirmedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    notifications: [
      { id: makeId("n"), title: "개인 기록 저장", body: `${match.title} 기록이 저장됐습니다. MMR은 반영하지 않습니다.`, tone: "match", matchId: match.id },
      ...state.notifications,
    ],
  };
}

export function createMatch(state, draft) {
  if (draft?.recordType === RECORD_TYPES.personalRecord) return createSoloRecordMatch(state, draft);
  const isMatchRecord = draft?.recordType === RECORD_TYPES.matchRecord;
  if (!isMatchRecord) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "경기 생성 불가", body: "일반 방은 모집/초대방 생성 경로로만 만듭니다.", tone: "orange" },
        ...state.notifications,
      ],
    };
  }
  const disciplineBlock = getDisciplineBlockedState(state, "경기방 생성");
  if (disciplineBlock) return disciplineBlock;
  const effectiveDraft = isMatchRecord
    ? {
        ...draft,
        visibility: "private",
        ranked: false,
        official: false,
        preRegistered: false,
        mmrLimitMode: "off",
        ageRestriction: "any",
        allowedAgeGroups: [],
        courtReserved: false,
        courtFee: "",
        refereeWanted: false,
        refereeId: "",
        stakes: "",
      }
    : draft;
  const hostTrustBlock = getHostTrustBlockNotification(state, effectiveDraft);
  if (hostTrustBlock) return { ...state, notifications: [hostTrustBlock, ...state.notifications] };
  const mode = effectiveDraft.mode ?? "5v5";
  const size = MODE_SIZES[mode] ?? 5;
  const timingType = effectiveDraft.timingType === "instant" ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "즉시" : `${effectiveDraft.scheduledDate ?? ""} ${effectiveDraft.scheduledTime ?? ""}`.trim();
  const recordDate = String(effectiveDraft.scheduledDate ?? "");
  const recordTime = /^\d{2}:\d{2}$/.test(String(effectiveDraft.scheduledTime ?? ""))
    ? String(effectiveDraft.scheduledTime)
    : "";
  const recordWindow = getRecordCreationWindowStatus(recordDate, recordTime, new Date());
  if (!recordWindow.valid) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "경기 기록 시간 확인",
          body: recordWindow.reason === "future"
            ? "경기가 끝난 뒤에만 경기 기록방을 만들 수 있습니다."
            : "경기 기록방은 경기 종료 후 24시간 이내에만 만들 수 있습니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }
  if (!isMatchRecord && timingType !== "instant" && !isScheduleDateInAllowedWindow(effectiveDraft.scheduledDate, new Date(), ROOM_SCHEDULE_MAX_DAYS)) {
    return { ...state, notifications: [getInvalidScheduleNotification(ROOM_SCHEDULE_MAX_DAYS), ...state.notifications] };
  }
  const nowIso = new Date().toISOString();
  const matchRecordInvalidReason = isMatchRecord ? getMatchRecordDraftInvalidReason(state, effectiveDraft, mode) : "";
  if (matchRecordInvalidReason) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "경기 기록방 생성 불가", body: matchRecordInvalidReason, tone: "orange" },
        ...state.notifications,
      ],
    };
  }
  const evidence = (effectiveDraft.evidence ?? []).map((item) => ({ id: item.id, label: item.label }));
  const teamAPlayers = [state.currentUserId].filter(Boolean);
  const teamBPlayers = [];
  const refereeId = getTrustedRefereeId(state, effectiveDraft.refereeId, [...teamAPlayers, ...teamBPlayers]);
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(effectiveDraft.mmrRangeMode);
  const ranked = isMatchRecord ? false : effectiveDraft.ranked !== false;
  const ratingScale = ranked ? getRecruitingRatingScale({ ranked, mmrRangeMode }) : 0;
  const disputeMinutes = DISPUTE_WINDOW_MINUTES;
  const selectedCourt = getRegisteredCourts(state).find((court) => court.name === effectiveDraft.court || court.id === getCourtId(effectiveDraft)) ?? null;
  const creator = state.users.find((user) => user.id === state.currentUserId);
  const recordComposition = getMatchRecordComposition(effectiveDraft);
  const creationPolicy = getMatchCreationPolicyPayload(effectiveDraft);
  const match = {
    id: effectiveDraft.id || makeId("m"),
    title: effectiveDraft.title || `${effectiveDraft.court} ${mode} 판`,
    mode,
    courtId: selectedCourt?.id ?? "",
    court: selectedCourt?.name ?? (String(effectiveDraft.court ?? "").trim() || "미정"),
    scheduledDate: timingType === "instant" ? "" : effectiveDraft.scheduledDate,
    scheduledTime: timingType === "instant" ? "" : effectiveDraft.scheduledTime,
    scheduledAt: scheduledAt || "일정 미정",
    timingType,
    matchIntent: creationPolicy.matchIntent,
    matchPurpose: creationPolicy.matchPurpose,
    formationMode: creationPolicy.formationMode,
    visibility: "private",
    status: "agreed",
    ranked,
    official: ranked && Boolean(effectiveDraft.official),
    preRegistered: isMatchRecord ? false : Boolean(draft.preRegistered),
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes,
    rules: {
      recordType: RECORD_TYPES.matchRecord,
      recordComposition,
      recordSetupReady: false,
      recordApprovalMode: {
        teamA: recordComposition === "team" ? "captain" : "all",
        teamB: recordComposition === "team" ? "captain" : "all",
      },
      recordApproverIds: { teamA: [], teamB: [] },
      participantAcceptedIds: [],
      rosterReady: { teamA: false, teamB: false },
      sideCapacity: size,
      onCourtCount: size,
      starterCount: size,
      teamCapacity: size,
      benchCapacity: 0,
      waitlistCapacity: 0,
      mmrRangeMode: "off",
      ratingScale: 0,
      ageRestriction: "any",
      allowedAgeGroups: [],
      courtReserved: false,
      visibility: "private",
      region: selectedCourt?.region ?? effectiveDraft.region,
    },
    memo: effectiveDraft.memo || (isMatchRecord ? "경기 종료 후 기록 입력 대기." : "결과 승인 대기."),
    stakes: isMatchRecord ? "" : effectiveDraft.stakes || "다음 경기 우선권.",
    mmrLimitMode: isMatchRecord ? "off" : effectiveDraft.mmrLimitMode ?? "block",
    mmrRangeMode,
    ratingScale,
    objectionWindow: `${disputeMinutes}분`,
    evidence,
    teamA: { name: creator?.name ?? "A사이드", teamId: "", players: teamAPlayers, score: 0 },
    teamB: { name: "B사이드", teamId: "", players: teamBPlayers, score: 0 },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    createdBy: state.currentUserId,
    agreedAt: nowIso,
    startedAt: isMatchRecord ? nowIso : undefined,
    endedAt: isMatchRecord ? nowIso : undefined,
    createdAt: nowIso,
  };
  return {
    ...state,
    matches: [match, ...state.matches],
    notifications: [
      { id: makeId("n"), title: "경기 기록방", body: `${match.title} 빈 기록방이 만들어졌습니다. 방에서 ${recordComposition === "team" ? "두 팀" : "A/B 선수"}을 구성해 주세요.`, tone: "match", matchId: match.id },
      ...state.notifications,
    ],
  };
}

export function createTournament(state, draft) {
  const disciplineBlock = getDisciplineBlockedState(state, "대회 생성");
  if (disciplineBlock) return disciplineBlock;
  const tournamentStartDate = draft.scheduledDate || draft.tournamentStartDate || "";
  const tournamentEndDate = draft.tournamentEndDate || tournamentStartDate;
  if (!isScheduleDateInAllowedWindow(tournamentStartDate) || !isScheduleDateInAllowedWindow(tournamentEndDate)) {
    return { ...state, notifications: [getInvalidScheduleNotification(), ...state.notifications] };
  }
  const teamIds = [...new Set(draft.teamIds ?? draft.tournamentTeamIds ?? [])]
    .filter((teamId) => state.teams.some((team) => team.id === teamId));
  const invitedTeams = teamIds.map((teamId) => state.teams.find((team) => team.id === teamId)).filter(Boolean);
  const mmrs = invitedTeams.map((team) => Number(team.mmr ?? DEFAULT_RATING));
  const mmrSpread = mmrs.length ? Math.max(...mmrs) - Math.min(...mmrs) : 0;
  const maxMmrGap = Number(draft.tournamentMaxMmrGap ?? draft.maxMmrGap ?? DEFAULT_TOURNAMENT_MMR_GAP);
  const mmrLimitMode = draft.mmrLimitMode ?? "warn";
  const sideCapacity = getRecruitingSideCapacity(draft);
  const tournamentRules = {
    ...(draft.rules ?? {}),
    ...getMatchRulesPayload({ ...(draft.rules ?? {}), ...draft }, { mode: draft.mode }),
    governanceVersion: 2,
    sanctionStatus: TOURNAMENT_SANCTION_STATUS.pending,
    sanctionFactor: 1,
    ratingScale: 1,
    disputeMinutes: normalizeDisputeWindowMinutes(Number.parseInt(draft.objectionWindow, 10) || draft.disputeMinutes),
    sideCapacity,
    mmrLimitMode,
    mmrRangeMode: draft.mmrRangeMode ?? draft.rules?.mmrRangeMode ?? "narrow",
    ageRestriction: draft.ageRestriction ?? draft.rules?.ageRestriction ?? "any",
    allowedAgeGroups: draft.allowedAgeGroups ?? draft.rules?.allowedAgeGroups ?? [],
    rosterReady: { teamA: false, teamB: false },
  };
  const tournamentTeamSnapshots = Object.fromEntries(invitedTeams.map((team) => [team.id, getLocalTournamentTeamSnapshot(state, team, {
    capacity: sideCapacity,
    ranked: draft.ranked,
    mmrLimitMode,
    mmrRangeMode: tournamentRules.mmrRangeMode,
    targetMmr: team.mmr,
    allowedAgeGroups: tournamentRules.allowedAgeGroups,
  })]));
  const creatorRepresentativeTeamId = getStateRepresentativeTeamId(state, state.currentUserId);
  const ineligibleTeam = invitedTeams.find((team) => !tournamentTeamSnapshots[team.id]?.allowed);
  const refereeIds = [...new Set(draft.refereeIds ?? draft.tournamentRefereeIds ?? [])]
    .filter((refereeId) => state.users.some((user) => user.id === refereeId));
  const organizer = state.users.find((user) => user.id === state.currentUserId);
  const organizerEligible = isEligibleReferee(
    organizer,
    REFEREE_TRUST_MIN,
    state.settings?.refereeAppointments,
    tournamentEndDate,
  );
  const refereePoolValidation = getTournamentRefereePoolValidation({
    tournament: {
      teamIds,
      refereeIds,
      endDate: tournamentEndDate,
      rules: { teamRosterSnapshot: { teams: tournamentTeamSnapshots } },
    },
    teams: invitedTeams,
    users: state.users,
    refereeAppointments: state.settings?.refereeAppointments,
  });

  if (teamIds.length < 2) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "대회 생성 불가",
          body: "비공개 대회는 최소 2개 팀을 초대해야 합니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  if (draft.ranked !== false && mmrLimitMode === "block" && mmrSpread > maxMmrGap) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "MMR 제한",
          body: `초대 팀 MMR 차이 ${mmrSpread}점이 제한 ${maxMmrGap}점을 넘었습니다.`,
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  if (!creatorRepresentativeTeamId || !teamIds.includes(creatorRepresentativeTeamId) || getTeamCaptainId(state.teams, creatorRepresentativeTeamId) !== state.currentUserId) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "대표팀 필요",
        body: "대회 생성자는 자신이 팀장인 대표팀으로만 참가할 수 있습니다.",
        tone: "match",
      }, ...state.notifications],
    };
  }

  if (!organizerEligible) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "심판 자격 필요",
        body: `대회 주최자는 신뢰도 ${REFEREE_TRUST_MIN} 이상인 자격심판이어야 합니다.`,
        tone: "match",
      }, ...state.notifications],
    };
  }

  if (!refereePoolValidation.allowed) {
    const body = refereePoolValidation.refereeIds.length < refereePoolValidation.requiredCount
      ? `${teamIds.length}팀 대회는 자격심판 ${refereePoolValidation.requiredCount}명 이상을 초대해야 합니다.`
      : refereePoolValidation.ineligibleRefereeId
        ? "자격 또는 신뢰도 조건을 충족하지 못한 심판이 포함되어 있습니다."
        : "모든 가능한 대진에 양 팀과 무관한 중립 심판을 배정할 수 있어야 합니다.";
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "심판 구성 필요",
        body,
        tone: "match",
      }, ...state.notifications],
    };
  }

  if (ineligibleTeam) {
    const eligibility = tournamentTeamSnapshots[ineligibleTeam.id];
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "대회 참가 제한",
        body: `${ineligibleTeam.name}: 대표팀 기준 참가 가능 선수가 ${eligibility.eligibleCount}/${eligibility.capacity}명입니다.`,
        tone: "match",
      }, ...state.notifications],
    };
  }

  const createdAt = new Date().toISOString();
  const ranked = draft.ranked !== false;
  tournamentRules.teamRosterSnapshot = {
    version: 1,
    capturedAt: createdAt,
    teams: tournamentTeamSnapshots,
  };
  const teamStatuses = Object.fromEntries(
    teamIds.map((teamId) => [
      teamId,
      teamId === creatorRepresentativeTeamId ? "accepted" : "invited",
    ]),
  );
  const teamApprovals = Object.fromEntries(
    teamIds
      .filter((teamId) => teamStatuses[teamId] === "accepted")
      .map((teamId) => [teamId, { by: state.currentUserId, approvedAt: createdAt }]),
  );
  const refereeStatuses = Object.fromEntries(
    refereeIds.map((refereeId) => [
      refereeId,
      refereeId === state.currentUserId ? "accepted" : "invited",
    ]),
  );
  const refereeApprovals = state.currentUserId && refereeStatuses[state.currentUserId] === "accepted"
    ? { [state.currentUserId]: { by: state.currentUserId, approvedAt: createdAt } }
    : {};
  const selectedCourt = getRegisteredCourts(state).find((court) => court.name === draft.court || court.id === getCourtId(draft)) ?? null;
  const tournament = {
    id: draft.id || makeId("trn"),
    title: draft.title?.trim() || `${draft.mode || "5v5"} 비공개 대회`,
    format: draft.tournamentFormat ?? "league",
    visibility: "private",
    status: "draft",
    region: selectedCourt?.region ?? draft.region ?? state.users.find((user) => user.id === state.currentUserId)?.region ?? "전체",
    courtId: selectedCourt?.id ?? getCourtId(draft),
    court: draft.court || "미정",
    mode: draft.mode || "5v5",
    ranked,
    official: false,
    startDate: tournamentStartDate,
    endDate: tournamentEndDate,
    schedulePolicy: draft.tournamentSchedulePolicy ?? "weekly",
    scheduleNote: draft.tournamentScheduleNote?.trim() || "초대팀 확정 후 경기별 일정을 배정합니다.",
    mmrLimitMode,
    maxMmrGap,
    mmrPolicy: draft.tournamentMmrPolicy ?? "gap_adjusted",
    rules: tournamentRules,
    memo: draft.memo || "비공개 초대 대회입니다.",
    createdBy: state.currentUserId,
    createdAt,
    teamIds,
    teamStatuses,
    teamApprovals,
    refereeIds,
    refereeStatuses,
    refereeApprovals,
    sanctionStatus: TOURNAMENT_SANCTION_STATUS.pending,
    matchIds: [],
    bracket: null,
  };

  return {
    ...state,
    tournaments: [tournament, ...(state.tournaments ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "대회 생성",
        body: `${tournament.title} 대회방을 만들었습니다. ${teamIds.length}팀·심판 ${refereeIds.length}명 승인을 기다립니다.`,
        tone: "match",
        tournamentId: tournament.id,
      },
      ...state.notifications,
    ],
  };
}

function getLocalTournamentReadiness(state, tournament) {
  const allTeamsAccepted = (tournament.teamIds ?? []).length >= 2
    && (tournament.teamIds ?? []).every((teamId) => getTournamentTeamStatuses(tournament)[teamId] === "accepted");
  const organizerEligible = !isTournamentGovernanceEnabled(tournament) || isEligibleReferee(
    (state.users ?? []).find((user) => user.id === tournament.createdBy),
    REFEREE_TRUST_MIN,
    state.settings?.refereeAppointments,
    tournament.endDate,
  );
  const refereePool = getTournamentRefereePoolValidation({
    tournament,
    teams: state.teams,
    users: state.users,
    refereeAppointments: state.settings?.refereeAppointments,
    requireAccepted: true,
  });
  return {
    ready: allTeamsAccepted && organizerEligible && refereePool.allowed,
    allTeamsAccepted,
    organizerEligible,
    refereePool,
  };
}

export function approveTournamentTeam(state, tournamentId, teamId, options = {}) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (!tournament || tournament.status !== "draft" || !(tournament.teamIds ?? []).includes(teamId)) return state;

  const captainId = getTeamCaptainId(state.teams, teamId);
  if (captainId !== state.currentUserId || getStateRepresentativeTeamId(state, state.currentUserId) !== teamId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "대회 승인 불가",
          body: "해당 팀을 대표팀으로 둔 팀장만 대회 참가를 승인할 수 있습니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  const now = new Date().toISOString();
  const teamStatuses = { ...getTournamentTeamStatuses(tournament), [teamId]: "accepted" };
  const teamApprovals = {
    ...(tournament.teamApprovals ?? {}),
    [teamId]: { by: state.currentUserId, approvedAt: now },
  };
  const approvedTournament = { ...tournament, teamStatuses, teamApprovals };
  if (!isTournamentGovernanceEnabled(approvedTournament)) {
    const allAccepted = (approvedTournament.teamIds ?? []).every((id) => teamStatuses[id] === "accepted");
    const generated = allAccepted
      ? generateTournamentMatches(state, approvedTournament, { preferredMatchIds: options.preferredMatchIds })
      : { matches: [], tournament: approvedTournament };
    return {
      ...state,
      matches: generated.matches.length ? [...generated.matches, ...state.matches] : state.matches,
      tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? generated.tournament : item)),
      notifications: [{
        id: makeId("n"),
        title: allAccepted ? "대회 시작" : "대회 참가 승인",
        body: allAccepted
          ? `${tournament.title} 대회가 시작됐습니다. 경기 ${generated.matches.length}개 생성.`
          : `${tournament.title} 참가 승인 완료. 남은 팀 승인을 기다립니다.`,
        tone: "match",
        tournamentId: tournament.id,
      }, ...state.notifications],
    };
  }
  const readiness = getLocalTournamentReadiness(state, approvedTournament);
  const nextTournament = {
    ...approvedTournament,
    sanctionStatus: readiness.ready
      ? TOURNAMENT_SANCTION_STATUS.regionalPending
      : TOURNAMENT_SANCTION_STATUS.pending,
  };

  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? nextTournament : item)),
    notifications: [
      {
        id: makeId("n"),
        title: readiness.ready ? "지역 승인 대기" : "대회 참가 승인",
        body: readiness.ready
          ? `${tournament.title} 팀장·심판 승인이 완료되어 지역관리자 승인을 기다립니다.`
          : `${tournament.title} 참가 승인 완료. 남은 팀장·심판 승인을 기다립니다.`,
        tone: "match",
        tournamentId: tournament.id,
      },
      ...state.notifications,
    ],
  };
}

export function updateTournamentMatchSchedule(state, tournamentId, matchId, schedule = {}) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const match = state.matches.find((item) => item.id === matchId && item.tournamentId === tournamentId);
  if (!tournament || !match) return state;

  if (tournament.createdBy !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "일정 수정 불가",
          body: "대회 생성자만 경기 일정을 수정할 수 있습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const scheduledDate = String(schedule.scheduledDate ?? "").slice(0, 10);
  const scheduledTime = String(schedule.scheduledTime ?? "").slice(0, 5);
  const allowedCourtIds = new Set([
    tournament.courtId,
    ...(tournament.rules?.allowedCourtIds ?? []),
  ].filter(Boolean));
  const courtId = String(schedule.courtId ?? match.courtId ?? tournament.courtId ?? "");
  const selectedCourt = getRegisteredCourts(state).find((court) => court.id === courtId) ?? null;
  if (!selectedCourt || (allowedCourtIds.size && !allowedCourtIds.has(courtId))) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "일정 수정 불가",
        body: "대회 사용 구장으로 등록된 승인 구장만 선택할 수 있습니다.",
        tone: "match",
        matchId,
      }, ...state.notifications],
    };
  }
  const maxDays = match.tournamentId ? SCHEDULE_MAX_DAYS : ROOM_SCHEDULE_MAX_DAYS;
  if (!isScheduleDateInAllowedWindow(scheduledDate, new Date(), maxDays)) {
    return { ...state, notifications: [getInvalidScheduleNotification(maxDays), ...state.notifications] };
  }
  const scheduleChanged = (
    match.scheduledDate !== scheduledDate ||
    String(match.scheduledTime ?? "").slice(0, 5) !== scheduledTime ||
    String(match.courtId ?? "") !== selectedCourt.id
  );
  if (!scheduleChanged) return state;
  const scheduleEditPolicy = getTournamentScheduleEditPolicy(match);
  if (!scheduleEditPolicy.allowed) {
    const body = scheduleEditPolicy.reason === "lineup_submitted"
      ? "한 팀이라도 출전 명단을 제출한 뒤에는 경기 일정을 변경할 수 없습니다."
      : scheduleEditPolicy.reason === "revision_limit"
        ? "경기 일정은 최초 지정 후 한 번만 변경할 수 있습니다."
        : "이미 시작·종료·취소·무효 처리된 경기는 일정을 변경할 수 없습니다.";
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "일정 수정 불가",
        body,
        tone: "match",
        matchId,
      }, ...state.notifications],
    };
  }
  if (isTournamentGovernanceEnabled(tournament)) {
    const referee = (state.users ?? []).find((user) => user.id === match.refereeId);
    const teamAId = match.teamA?.teamId ?? match.teamAId;
    const teamBId = match.teamB?.teamId ?? match.teamBId;
    const refereeAccepted = Boolean(match.refereeId)
      && getTournamentRefereeStatus(tournament, match.refereeId) === "accepted";
    const refereeEligible = refereeAccepted && isEligibleReferee(
      referee,
      REFEREE_TRUST_MIN,
      state.settings?.refereeAppointments,
      tournament.endDate,
    );
    const refereeNeutral = refereeEligible
      && isTournamentRefereeNeutral(tournament, match.refereeId, teamAId, teamBId, state.teams);
    if (!refereeNeutral) {
      return {
        ...state,
        notifications: [{
          id: makeId("n"),
          title: "일정 수정 불가",
          body: "자격이 유효한 승인 중립 심판을 먼저 배정해야 대회 경기 일정을 수정할 수 있습니다.",
          tone: "match",
          matchId,
        }, ...state.notifications],
      };
    }
    const refereeScheduleConflict = scheduledDate && scheduledTime && (state.matches ?? []).some((item) => (
      item.id !== match.id
      && item.refereeId === match.refereeId
      && doTournamentMatchSchedulesOverlap(match, item, { scheduledDate, scheduledTime })
      && !["confirmed", "cancelled", "void", "voided", "closed"].includes(item.status)
      && !item.endedAt
    ));
    if (refereeScheduleConflict) {
      return {
        ...state,
        notifications: [{
          id: makeId("n"),
          title: "일정 수정 불가",
          body: "배정 심판의 다른 경기와 일정이 겹칩니다.",
          tone: "match",
          matchId,
        }, ...state.notifications],
      };
    }
  }
  const now = new Date().toISOString();
  const scheduleRevisionCount = scheduleEditPolicy.revisionCount + (scheduleEditPolicy.hasSchedule ? 1 : 0);
  const updatedMatch = {
    ...match,
    scheduledDate,
    scheduledTime,
    scheduledAt: getScheduleText(scheduledDate, scheduledTime),
    courtId: selectedCourt.id,
    court: selectedCourt.name,
    rules: {
      ...(match.rules ?? {}),
      tournamentScheduleRevisionCount: scheduleRevisionCount,
      tournamentScheduleSetAt: match.rules?.tournamentScheduleSetAt ?? now,
      tournamentScheduleUpdatedAt: scheduleEditPolicy.hasSchedule ? now : null,
      lineupDeadlineState: "pending",
      lineupDeadlineCheckedAt: null,
    },
  };
  const captainNotifications = MATCH_SIDES.map((sideName) => {
    const teamId = match[sideName]?.teamId;
    const captainId = getTeamCaptainId(state.teams, teamId);
    if (!teamId || !captainId) return null;
    return {
      id: makeId("n"),
      title: scheduleEditPolicy.hasSchedule ? "대회 경기 일정 변경" : "대회 경기 일정 확정",
      body: `${updatedMatch.scheduledAt} 경기의 출전 선수와 후보 선수를 구성해 주세요.`,
      tone: "match",
      type: "tournament_match_schedule",
      discordEvent: "match",
      targetUserId: captainId,
      matchId,
      tournamentId,
      teamId,
      sideName,
      actionRequired: true,
      homeAction: true,
      webPath: `/app/matches?match=${encodeURIComponent(matchId)}`,
      createdAt: now,
    };
  }).filter(Boolean);

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? updatedMatch : item)),
    notifications: [
      ...captainNotifications,
      {
        id: makeId("n"),
        title: scheduleEditPolicy.hasSchedule ? "대회 일정 수정" : "대회 일정 확정",
        body: scheduleEditPolicy.hasSchedule
          ? `${match.title} 경기 일정이 변경되었습니다. 새 일정: ${updatedMatch.scheduledAt}`
          : `${match.title} 경기 일정이 확정되었습니다: ${updatedMatch.scheduledAt}`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

function getSelfDecisionId(state, match, sideName, decisionKey, playerId) {
  const currentUserId = state.currentUserId;
  if (!currentUserId || playerId !== currentUserId) return null;
  const sidePlayers = match[sideName]?.players ?? [];
  if (decisionKey === "approvals" && isMatchRecordMatch(match)) {
    const requiredIds = match.rules?.recordApproverIds?.[sideName] ?? [];
    if (!requiredIds.includes(currentUserId)) return null;
    if ((match.approvals?.[sideName] ?? []).includes(currentUserId)) return null;
    return currentUserId;
  }
  const sideTeamId = match[sideName]?.teamId;
  const captainId = decisionKey === "agreements" && sideTeamId
    ? getTeamCaptainId(state.teams, sideTeamId)
    : "";
  if (captainId) {
    if (currentUserId !== captainId) return null;
  } else if (!sidePlayers.includes(currentUserId)) {
    return null;
  }
  if ((match[decisionKey]?.[sideName] ?? []).includes(currentUserId)) return null;
  return currentUserId;
}

export function agreeMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;

  const agreementId = getSelfDecisionId(state, match, sideName, "agreements", playerId);
  if (!agreementId) return state;

  const updatedMatch = {
    ...match,
    agreements: {
      ...(match.agreements ?? { teamA: [], teamB: [] }),
      [sideName]: Array.from(new Set([...(match.agreements?.[sideName] ?? []), agreementId])),
    },
  };
  const ready =
    match.status !== "agreed" &&
    getAgreementStatus(updatedMatch, state.teams, "teamA").approved &&
    getAgreementStatus(updatedMatch, state.teams, "teamB").approved;
  const nextMatch = ready
    ? { ...updatedMatch, status: "agreed", agreedAt: updatedMatch.agreedAt ?? new Date().toISOString() }
    : updatedMatch;

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: ready
      ? [
          {
            id: makeId("n"),
            title: "경기 전 동의 완료",
            body: `${match.title} 경기 결과를 입력할 수 있습니다.`,
            tone: "match",
            matchId,
          },
          ...state.notifications,
        ]
      : state.notifications,
  };
}

export function submitMatchResult(state, matchId, result) {
  const disciplineBlock = getDisciplineBlockedState(state, "기록 저장");
  if (disciplineBlock) return disciplineBlock;
  const storedMatch = state.matches.find((item) => item.id === matchId);
  if (!storedMatch) return state;
  if (isMatchRecordMatch(storedMatch) && storedMatch.rules?.recordSetupReady !== true) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "기록 참가자 확인 필요",
        body: "방에서 A/B 참가자 또는 양 팀 출전 명단을 먼저 확정해 주세요.",
        tone: "orange",
        matchId,
      }, ...(state.notifications ?? [])],
    };
  }
  const match = withEffectiveMatchStatRecorders(storedMatch);
  const syncedStatRecorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const currentUserId = state.currentUserId;
  const hasReferee = Boolean(match.refereeId);
  const currentUser = state.users.find((user) => user.id === currentUserId);
  const currentUserIsReferee = isMatchReferee(match, currentUserId);
  const currentUserIsEligibleReferee = currentUserIsReferee && isEligibleReferee(currentUser, match.refereeTrustMin, state.settings?.refereeAppointments);
  const recorderSides = getStatRecorderSides(match, currentUserId);
  const currentUserCanOperatePostStart = currentUserCanOperateStartedMatch(state, match);
  const resultEntryPermission = getMatchResultEntryPermission(match, currentUserId, {
    canOperatePostStart: currentUserCanOperatePostStart,
    refereeEligible: currentUserIsEligibleReferee,
  });
  const currentUserCanDisputeDraft = resultEntryPermission.canEditDisputeDraft;
  const currentUserCanPostgameScore = resultEntryPermission.operatorPostgamePoints;
  const currentUserCanRecord = currentUserCanDisputeDraft || resultEntryPermission.editablePlayerIds.length > 0;

  if (hasReferee && !currentUserIsEligibleReferee) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 기록 전용",
          body: "심판이 초대된 경기는 해당 심판만 스코어와 개인 활약을 입력할 수 있습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  if (!hasReferee && !currentUserCanRecord) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "결과 입력 권한 없음",
          body: "경기 참가자 또는 후보 기록자만 스코어와 개인 활약을 입력할 수 있습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (match.status === "contract") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "경기 전 동의 필요",
          body: `${match.title}는 양팀 동의가 끝나야 결과를 입력할 수 있습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (match.status === "disputed" && !currentUserCanDisputeDraft) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의신청 처리 중",
          body: "이의신청 중에는 심판 또는 방장만 임시 수정안을 저장할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (["confirmed", "void", "cancelled"].includes(match.status)) return state;
  const recordWindow = getMatchRecordWindow(match);
  const matchStartsAt = getMatchStartDate(match);
  const beforeStart = !matchStartsAt || (Number.isFinite(matchStartsAt.getTime()) && Date.now() < matchStartsAt.getTime());
  const liveRecordAllowed = resultEntryPermission.canSubmitLive;
  if (currentUserCanDisputeDraft && !recordWindow.disputeOpen) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의 처리 마감",
          body: "이의 처리 시간이 지나 수정안을 저장할 수 없습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (!resultEntryPermission.canSubmit) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: beforeStart ? "경기 시작 전" : recordWindow.beforeEnd ? "실시간 기록 권한 없음" : "기록 입력 마감",
          body: beforeStart
            ? "경기 시작 후 심판이 있으면 심판만, 심판이 없으면 배정 기록자만 실시간 기록을 저장할 수 있습니다."
            : recordWindow.beforeEnd
              ? "경기 중 실시간 기록은 심판이 있으면 심판만 저장할 수 있습니다."
            : "경기 종료 후 1시간이 지나 개인 기록 입력이 마감됐습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const now = new Date().toISOString();
  const draftEntry = currentUserCanDisputeDraft;
  const liveEntry = !draftEntry && liveRecordAllowed;
  const recordPlayerIds = getMatchRecordPlayerIds(match);
  const existingStats = normalizePlayerStats((draftEntry ? match.disputeDraftResult : match.result)?.playerStats ?? match.result?.playerStats ?? {}, recordPlayerIds);
  const endedAt = liveEntry ? match.endedAt : match.endedAt ?? recordWindow.endAt?.toISOString() ?? now;
  const targetPlayerIds = resultEntryPermission.editablePlayerIds;
  if (!hasReferee && !targetPlayerIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "후보 기록자 배정됨",
          body: "이 팀은 후보 기록자가 개인 활약을 입력합니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const submittedStatPatch = getSubmittedStatPatch(result.playerStats ?? {}, targetPlayerIds);
  const touchedPlayerIds = Object.keys(submittedStatPatch);
  const nextPlayerStats = { ...existingStats };
  touchedPlayerIds.forEach((playerId) => {
    const allowedFieldIds = new Set(
      resultEntryPermission.getEditableStatFields(playerId).map((field) => field.id),
    );
    const currentStats = nextPlayerStats[playerId] ?? {};
    nextPlayerStats[playerId] = {
      ...currentStats,
      ...Object.fromEntries(
        Object.entries(submittedStatPatch[playerId])
          .filter(([fieldId]) => currentUserIsEligibleReferee || draftEntry || allowedFieldIds.has(fieldId)),
      ),
    };
  });
  const scoringMatch = match;
  const nextSubmissions = {
    ...(match.result?.statSubmissions ?? {}),
    ...Object.fromEntries(touchedPlayerIds.map((playerId) => {
      const sideName = getMatchRosterSideName(scoringMatch, playerId);
      const source = currentUserIsEligibleReferee
        ? "referee"
        : draftEntry
          ? "dispute_operator"
        : isMatchStatRecorder(match, currentUserId, sideName)
          ? "candidate_recorder"
          : currentUserCanPostgameScore && playerId !== currentUserId
            ? "host_postgame"
        : "player";
      return [playerId, { by: currentUserId, side: sideName, source, submittedAt: now }];
    })),
  };
  const nextScoreA = getMergedResultScore(scoringMatch, nextPlayerStats, "teamA", result.scoreA);
  const nextScoreB = getMergedResultScore(scoringMatch, nextPlayerStats, "teamB", result.scoreB);
  const nextResult = {
    scoreA: nextScoreA,
    scoreB: nextScoreB,
    playerStats: nextPlayerStats,
    statSubmissions: nextSubmissions,
    submittedBy: currentUserId,
    submittedAt: (draftEntry ? match.disputeDraftResult?.submittedAt : match.result?.submittedAt) ?? now,
    updatedAt: now,
  };

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? draftEntry
          ? {
              ...item,
              statRecorders: syncedStatRecorders,
              rules: { ...(item.rules ?? {}), statRecorders: syncedStatRecorders },
              disputeDraftResult: nextResult,
              disputeDraftUpdatedAt: now,
            }
          : {
            ...item,
            statRecorders: syncedStatRecorders,
            playedPlayerIds: item.playedPlayerIds,
            status: liveEntry ? item.status : "approval",
            teamA: { ...item.teamA, score: nextResult.scoreA },
            teamB: { ...item.teamB, score: nextResult.scoreB },
            approvals: liveEntry ? item.approvals : { teamA: [], teamB: [] },
            result: nextResult,
            endedAt,
            rules: { ...(item.rules ?? {}), statRecorders: syncedStatRecorders },
          }
        : item,
    ),
    notifications: [
      {
        id: makeId("n"),
        title: draftEntry ? "이의 수정안 저장" : currentUserIsEligibleReferee ? "심판 기록 제출" : recorderSides.length ? "후보 기록 제출" : "내 득점 제출",
        body: draftEntry
          ? `${match.title} 이의 수정안이 임시 저장됐습니다. 확인하면 결과가 바로 확정됩니다.`
          : currentUserIsEligibleReferee
          ? `${match.title} 스코어와 전체 개인 활약이 저장됐습니다.`
          : recorderSides.length
            ? `${match.title} 후보 기록자가 팀 개인 활약을 저장했습니다.`
          : `${match.title} 스코어와 내 득점이 저장됐습니다. 전원 제출 후 결과 승인이 가능합니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function handoffMatchRecorder(state, matchId, sideName, nextRecorderId) {
  const storedMatch = state.matches.find((item) => item.id === matchId);
  const match = withEffectiveMatchStatRecorders(storedMatch);
  if (!match || match.refereeId || !["agreed", "approval"].includes(match.status)) return state;
  if (!MATCH_SIDES.includes(sideName)) return state;

  const currentRecorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const currentRecorderId = currentRecorders[sideName];
  if (!currentRecorderId || currentRecorderId !== state.currentUserId) return state;

  const handoffPatch = { valid: getMatchReservePlayerIds(match, sideName).includes(nextRecorderId) && nextRecorderId !== currentRecorderId, match, swapped: false };
  if (!handoffPatch.valid) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "인수인계 불가",
          body: "같은 사이드의 다른 후보에게만 기록 권한을 넘길 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const nextRecorders = { ...currentRecorders, [sideName]: nextRecorderId };
  const nextUser = state.users.find((user) => user.id === nextRecorderId);
  const now = new Date().toISOString();
  const handoffEvent = {
    id: makeId("handoff"),
    side: sideName,
    from: currentRecorderId,
    to: nextRecorderId,
    createdAt: now,
  };
  return {
    ...state,
    matches: state.matches.map((item) => (
      item.id === matchId
        ? (() => {
            const patched = item;
            return {
              ...patched,
              statRecorders: nextRecorders,
              rules: {
                ...(patched.rules ?? {}),
                statRecorders: nextRecorders,
              },
              recorderHandoffs: [
                handoffEvent,
                ...(patched.recorderHandoffs ?? []),
              ],
            };
        })()
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "기록자 인수인계",
        body: `${match.title} ${SIDE_LABEL_TEXT[sideName]} 기록 권한이 ${nextUser?.name ?? "후보"}에게 넘어갔습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function approveTournamentReferee(state, tournamentId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (!tournament || !["draft", "active"].includes(tournament.status)) return state;
  const refereeId = state.currentUserId;
  if (!(tournament.refereeIds ?? []).includes(refereeId)) return state;
  const referee = state.users.find((user) => user.id === refereeId);
  if (!isEligibleReferee(
    referee,
    REFEREE_TRUST_MIN,
    state.settings?.refereeAppointments,
    tournament.endDate,
  )) return state;

  const now = new Date().toISOString();
  const approvedTournament = {
    ...tournament,
    refereeStatuses: { ...(tournament.refereeStatuses ?? {}), [refereeId]: "accepted" },
    refereeApprovals: {
      ...(tournament.refereeApprovals ?? {}),
      [refereeId]: { by: refereeId, approvedAt: now },
    },
  };
  const readiness = getLocalTournamentReadiness(state, approvedTournament);
  const nextTournament = {
    ...approvedTournament,
    sanctionStatus: tournament.status === "draft" && readiness.ready
      ? TOURNAMENT_SANCTION_STATUS.regionalPending
      : tournament.sanctionStatus,
  };
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? nextTournament : item)),
    notifications: [{
      id: makeId("n"),
      title: readiness.ready ? "지역 승인 대기" : "대회 심판 승인",
      body: readiness.ready
        ? `${tournament.title} 팀장·심판 승인이 완료되어 지역관리자 승인을 기다립니다.`
        : `${tournament.title} 심판 참여를 승인했습니다.`,
      tone: "match",
      tournamentId,
    }, ...state.notifications],
  };
}

export function declineTournamentReferee(state, tournamentId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const refereeId = state.currentUserId;
  const currentStatus = tournament ? getTournamentRefereeStatus(tournament, refereeId) : "";
  if (
    !tournament
    || !["draft", "active"].includes(tournament.status)
    || !(tournament.refereeIds ?? []).includes(refereeId)
    || (tournament.status === "active" && currentStatus === "accepted")
  ) {
    return state;
  }
  const declinedTournament = {
    ...tournament,
    refereeStatuses: { ...(tournament.refereeStatuses ?? {}), [refereeId]: "declined" },
    refereeApprovals: Object.fromEntries(
      Object.entries(tournament.refereeApprovals ?? {}).filter(([id]) => id !== refereeId),
    ),
  };
  const readiness = getLocalTournamentReadiness(state, declinedTournament);
  const nextTournament = {
    ...declinedTournament,
    sanctionStatus: tournament.status === "draft"
      ? readiness.ready ? TOURNAMENT_SANCTION_STATUS.regionalPending : TOURNAMENT_SANCTION_STATUS.pending
      : tournament.sanctionStatus,
  };
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? nextTournament : item)),
    matches: (state.matches ?? []).map((match) => (
      match.tournamentId === tournamentId && match.refereeId === refereeId && !match.startedAt && !match.endedAt
        ? { ...match, refereeId: "" }
        : match
    )),
  };
}

export function inviteTournamentReferee(state, tournamentId, refereeId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const referee = (state.users ?? []).find((user) => user.id === refereeId);
  if (
    !tournament
    || tournament.createdBy !== state.currentUserId
    || !["draft", "active"].includes(tournament.status)
    || !isEligibleReferee(
      referee,
      REFEREE_TRUST_MIN,
      state.settings?.refereeAppointments,
      tournament.endDate,
    )
  ) {
    return state;
  }
  const invitedTournament = {
    ...tournament,
    refereeIds: [...new Set([...(tournament.refereeIds ?? []), refereeId])],
    refereeStatuses: { ...(tournament.refereeStatuses ?? {}), [refereeId]: "invited" },
    refereeApprovals: Object.fromEntries(
      Object.entries(tournament.refereeApprovals ?? {}).filter(([id]) => id !== refereeId),
    ),
    sanctionStatus: tournament.status === "draft"
      ? TOURNAMENT_SANCTION_STATUS.pending
      : tournament.sanctionStatus,
  };
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? invitedTournament : item)),
    notifications: [{
      id: makeId("n"),
      title: "대회 심판 초대",
      body: `${tournament.title} 심판으로 초대했습니다.`,
      tone: "match",
      tournamentId,
      targetUserId: refereeId,
    }, ...state.notifications],
  };
}

function currentUserCanReviewTournamentRegion(state, tournament) {
  const authorityLevel = getAdminAuthorityLevel(state);
  if (authorityLevel >= ADMIN_GRADE_META.senior.level) return true;
  if (authorityLevel < ADMIN_GRADE_META.regionManager.level) return false;
  const currentUser = (state.users ?? []).find((user) => user.id === state.currentUserId);
  const regionalAppointment = (state.settings?.adminAppointments ?? []).find((appointment) => (
    appointment.source === "server_context"
    && appointment.userId === state.currentUserId
    && appointment.role === "admin"
    && appointment.grade === "regionManager"
    && isAppointmentActive(appointment)
  ));
  const assignedRegion = regionalAppointment?.payload?.region
    ?? regionalAppointment?.region
    ?? currentUser?.region;
  return isSameRegion(assignedRegion, tournament?.region ?? tournament?.rules?.region);
}

export function activateTournamentSanction(state, tournamentId, sanctionStatus, reviewerId = "") {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (!tournament || tournament.status !== "draft") return state;
  if (![TOURNAMENT_SANCTION_STATUS.approved, TOURNAMENT_SANCTION_STATUS.community].includes(sanctionStatus)) return state;
  if (
    sanctionStatus === TOURNAMENT_SANCTION_STATUS.approved
      ? !currentUserCanReviewTournamentRegion(state, tournament)
      : tournament.createdBy !== state.currentUserId
  ) return state;
  const readiness = getLocalTournamentReadiness(state, tournament);
  if (!readiness.ready) return state;
  const official = sanctionStatus === TOURNAMENT_SANCTION_STATUS.approved;
  const ratingScale = official ? 1 : TOURNAMENT_COMMUNITY_RATING_SCALE;
  const now = new Date().toISOString();
  const approvedTournament = {
    ...tournament,
    official,
    sanctionStatus,
    sanctionReviewedBy: reviewerId || null,
    sanctionReviewedAt: reviewerId ? now : null,
    rules: {
      ...(tournament.rules ?? {}),
      sanctionStatus,
      sanctionFactor: ratingScale,
      ratingScale,
    },
  };
  const generated = generateTournamentMatches(state, approvedTournament);
  return {
    ...state,
    matches: generated.matches.length ? [...generated.matches, ...state.matches] : state.matches,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? generated.tournament : item)),
    notifications: [{
      id: makeId("n"),
      title: official ? "공식 대회 시작" : "지역 비승인 대회 시작",
      body: official
        ? `${tournament.title} 지역 승인이 완료되어 공식 대회가 시작됐습니다.`
        : `${tournament.title} 지역 비승인 대회가 시작됐습니다. MMR은 0.8 계수로 반영됩니다.`,
      tone: "match",
      tournamentId,
    }, ...state.notifications],
  };
}

export function rejectTournamentRegion(state, tournamentId, note = "") {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (
    !tournament
    || tournament.status !== "draft"
    || !isTournamentGovernanceEnabled(tournament)
    || !currentUserCanReviewTournamentRegion(state, tournament)
  ) return state;
  const readiness = getLocalTournamentReadiness(state, tournament);
  if (!readiness.ready) return state;
  const now = new Date().toISOString();
  const rejectedTournament = {
    ...tournament,
    official: false,
    sanctionStatus: TOURNAMENT_SANCTION_STATUS.regionalRejected,
    sanctionReviewedBy: state.currentUserId,
    sanctionReviewedAt: now,
    sanctionReviewNote: String(note ?? "").trim().slice(0, 500),
    rules: {
      ...(tournament.rules ?? {}),
      sanctionStatus: TOURNAMENT_SANCTION_STATUS.regionalRejected,
    },
  };
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (
      item.id === tournamentId ? rejectedTournament : item
    )),
    notifications: [{
      id: makeId("n"),
      title: "대회 지역 비승인",
      body: `${tournament.title}은 지역 비승인 대회로 개최할 수 있습니다. 필수 심판 조건은 그대로 유지됩니다.`,
      tone: "match",
      tournamentId,
      targetUserId: tournament.createdBy,
    }, ...state.notifications],
  };
}

export function assignTournamentMatchReferee(state, tournamentId, matchId, refereeId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const match = (state.matches ?? []).find((item) => item.id === matchId && item.tournamentId === tournamentId);
  if (!tournament || !match || tournament.createdBy !== state.currentUserId || match.startedAt || match.endedAt) return state;
  if (getTournamentRefereeStatus(tournament, refereeId) !== "accepted") return state;
  if (!isEligibleReferee(
    state.users.find((user) => user.id === refereeId),
    REFEREE_TRUST_MIN,
    state.settings?.refereeAppointments,
    tournament.endDate,
  )) return state;
  const teamAId = match.teamA?.teamId ?? match.teamAId;
  const teamBId = match.teamB?.teamId ?? match.teamBId;
  if (!isTournamentRefereeNeutral(tournament, refereeId, teamAId, teamBId, state.teams)) return state;
  if (match.scheduledDate && match.scheduledTime && (state.matches ?? []).some((item) => (
    item.id !== match.id
    && item.refereeId === refereeId
    && doTournamentMatchSchedulesOverlap(match, item)
    && !["confirmed", "cancelled", "void", "voided", "closed"].includes(item.status)
    && !item.endedAt
  ))) return state;
  return {
    ...state,
    matches: (state.matches ?? []).map((item) => (
      item.id === matchId ? { ...item, refereeId } : item
    )),
  };
}

export function forfeitTournamentMatch(state, tournamentId, matchId, losingSide, reason = "팀 불참") {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const match = (state.matches ?? []).find((item) => item.id === matchId && item.tournamentId === tournamentId);
  if (!tournament || !match || !MATCH_SIDES.includes(losingSide)) return state;

  if (tournament.createdBy !== state.currentUserId) {
    return {
      ...state,
      notifications: [{ id: makeId("n"), title: "몰수 처리 불가", body: "대회 개최자만 불참을 확정할 수 있습니다.", tone: "match", matchId }, ...state.notifications],
    };
  }

  const scheduledAt = getMatchScheduledDate(match)?.getTime();
  const locked = ["confirmed", "cancelled", "void", "voided", "closed"].includes(match.status) || match.startedAt || match.endedAt || match.result;
  if (locked || !Number.isFinite(scheduledAt) || Date.now() < scheduledAt) {
    return {
      ...state,
      notifications: [{ id: makeId("n"), title: "몰수 처리 불가", body: "확정된 경기 시작 시각 이후, 시작 전 경기만 몰수 처리할 수 있습니다.", tone: "match", matchId }, ...state.notifications],
    };
  }

  const scoreA = losingSide === "teamA" ? 0 : 1;
  const scoreB = losingSide === "teamB" ? 0 : 1;
  const now = new Date().toISOString();
  const excludedPlayerIds = Array.from(new Set([
    ...(match.teamA?.players ?? []).map((player) => player.id),
    ...(match.teamB?.players ?? []).map((player) => player.id),
  ].filter(Boolean)));
  const confirmedMatch = {
    ...match,
    status: "confirmed",
    result: {
      scoreA,
      scoreB,
      playerStats: {},
      statSubmissions: {},
      submittedBy: state.currentUserId,
      submittedAt: now,
    },
    teamA: { ...match.teamA, score: scoreA },
    teamB: { ...match.teamB, score: scoreB },
    forfeitSide: losingSide,
    forfeitReason: reason,
    forfeitedAt: now,
    forfeitedBy: state.currentUserId,
    mmrExcludedPlayerIds: excludedPlayerIds,
    rules: {
      ...(match.rules ?? {}),
      forfeit: { losingSide, reason, decidedBy: state.currentUserId, decidedAt: now, mmrCommitted: false },
    },
    endedAt: now,
    confirmedAt: now,
  };
  const winnerName = losingSide === "teamA" ? match.teamB?.name ?? "B팀" : match.teamA?.name ?? "A팀";
  const nextState = {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? confirmedMatch : item)),
    notifications: [{
      id: makeId("n"),
      title: "대회 경기 몰수 확정",
      body: `${winnerName} 1:0 몰수승. MMR에는 반영하지 않습니다.`,
      tone: "match",
      type: "tournament_match_forfeit",
      matchId,
      tournamentId,
      createdAt: now,
    }, ...state.notifications],
  };
  return advanceTournamentAfterMatch(nextState, confirmedMatch);
}

export function substituteMatchPlayer(state, matchId, sideName, activePlayerId, reservePlayerId, reason = "operator") {
  const storedMatch = state.matches.find((item) => item.id === matchId);
  const match = withEffectiveMatchStatRecorders(storedMatch);
  if (!match || match.status !== "agreed" || match.endedAt) return state;
  if (getMatchRoomPhase(match).phase !== "live") return state;
  if (!MATCH_SIDES.includes(sideName)) return state;
  if (!["late", "ejection", "operator"].includes(reason)) return state;
  const substitutionAccess = getMatchSubstitutionAccess(match, state.currentUserId, sideName, {
    canOperate: currentUserIsEligibleMatchReferee(state, match),
    recorderSides: getStatRecorderSides(match, state.currentUserId),
  });
  if (!substitutionAccess.allowedReservePlayerIds.includes(reservePlayerId)) return state;
  if (!substitutionAccess.canManage && !substitutionAccess.canSelfSubstitute) return state;
  if (reason === "late" && !isMatchLateAttendancePlayer(match, reservePlayerId)) return state;

  const activeIds = match[sideName]?.players ?? [];
  const reserveIds = getMatchReservePlayerIds(match, sideName);
  if (!activeIds.includes(activePlayerId) || !reserveIds.includes(reservePlayerId)) return state;

  const substitutionPatch = getRecorderHandoffPatch(match, sideName, activePlayerId, reservePlayerId);
  if (!substitutionPatch.valid || !substitutionPatch.swapped) return state;
  const now = new Date().toISOString();
  const currentRecorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const nextRecorders = !match.refereeId && currentRecorders[sideName] === reservePlayerId
    ? { ...currentRecorders, [sideName]: activePlayerId }
    : currentRecorders;
  const substitutionEvent = {
    id: makeId("substitution"),
    side: sideName,
    activeOutPlayerId: activePlayerId,
    activeInPlayerId: reservePlayerId,
    reason,
    confirmedBy: state.currentUserId,
    createdAt: now,
  };
  const nextMatch = {
    ...substitutionPatch.match,
    statRecorders: nextRecorders,
    rules: {
      ...(substitutionPatch.match.rules ?? {}),
      statRecorders: nextRecorders,
      lastSubstitutionAt: now,
    },
    substitutionEvents: [substitutionEvent, ...(substitutionPatch.match.substitutionEvents ?? [])],
  };

  const activeUser = state.users.find((user) => user.id === activePlayerId);
  const reserveUser = state.users.find((user) => user.id === reservePlayerId);

  return {
    ...state,
    matches: state.matches.map((item) => (
      item.id === matchId
        ? nextMatch
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "선수 교체",
        body: `${match.title} ${SIDE_LABEL_TEXT[sideName]}에서 ${reserveUser?.name ?? "후보 선수"} 선수가 출전 명단으로, ${activeUser?.name ?? "출전 선수"} 선수가 후보 명단으로 이동했습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}


export function setMatchDualScoreRecorderSide(state, matchId, sideName = null) {
  const storedMatch = state.matches.find((item) => item.id === matchId);
  const match = withEffectiveMatchStatRecorders(storedMatch);
  if (!match || match.refereeId || match.startedAt || match.endedAt) return state;
  if (getMatchHostPlayerId(state, match) !== state.currentUserId) return state;
  const safeSide = MATCH_SIDES.includes(sideName) ? sideName : null;
  const recorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const recorderSides = MATCH_SIDES.filter((side) => recorders[side]);
  if (safeSide && (recorderSides.length !== 1 || recorderSides[0] !== safeSide)) return state;
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? {
      ...item,
      dualScoreRecorderSide: safeSide,
      rules: { ...(item.rules ?? {}), dualScoreRecorderSide: safeSide },
      updatedAt: new Date().toISOString(),
    } : item),
  };
}

export function incrementMatchScore(state, matchId, deltaA = 0, deltaB = 0, revisions = {}) {
  const storedMatch = state.matches.find((item) => item.id === matchId);
  const match = withEffectiveMatchStatRecorders(storedMatch);
  if (!match || !match.startedAt || match.confirmedAt || !Number.isInteger(deltaA) || !Number.isInteger(deltaB)) return state;
  if ((!deltaA && !deltaB) || Math.abs(deltaA) > 3 || Math.abs(deltaB) > 3) return state;
  const canOperate = currentUserCanOperateStartedMatch(state, match);
  const live = !match.endedAt && match.status === "agreed";
  const postgameAuthority = Boolean(match.endedAt && canOperate && ["agreed", "approval", "disputed"].includes(match.status));
  if (!live && !postgameAuthority) return state;
  const editableSides = postgameAuthority
    ? MATCH_SIDES
    : getMatchScoreEditableSides(match, state.currentUserId, { canOperatePostStart: canOperate });
  if ((deltaA && !editableSides.includes("teamA")) || (deltaB && !editableSides.includes("teamB"))) return state;
  const result = match.result ?? { playerStats: {}, statSubmissions: {}, scoreSubmissions: {} };
  const revisionA = Number(result.scoreRevisionA ?? 0);
  const revisionB = Number(result.scoreRevisionB ?? 0);
  if (deltaA && (revisions.expectedRevisionA == null || Number(revisions.expectedRevisionA) !== revisionA)) return state;
  if (deltaB && (revisions.expectedRevisionB == null || Number(revisions.expectedRevisionB) !== revisionB)) return state;
  const scoreA = Number(result.scoreA ?? match.teamA?.score ?? 0) + deltaA;
  const scoreB = Number(result.scoreB ?? match.teamB?.score ?? 0) + deltaB;
  if (scoreA < 0 || scoreB < 0 || scoreA > 999 || scoreB > 999) return state;
  const now = new Date().toISOString();
  const nextResult = {
    ...result,
    scoreA,
    scoreB,
    playerStats: match.refereeId ? result.playerStats ?? {} : {},
    statSubmissions: match.refereeId ? result.statSubmissions ?? {} : {},
    scoreRevisionA: revisionA + (deltaA ? 1 : 0),
    scoreRevisionB: revisionB + (deltaB ? 1 : 0),
    submittedBy: state.currentUserId,
    submittedAt: now,
  };
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? {
      ...item,
      status: item.endedAt ? "approval" : item.status,
      teamA: { ...item.teamA, score: scoreA },
      teamB: { ...item.teamB, score: scoreB },
      result: nextResult,
      updatedAt: now,
    } : item),
  };
}

export function requestMatchRecorderTakeover(state, matchId, sideName) {
  const storedMatch = state.matches.find((item) => item.id === matchId);
  const match = withEffectiveMatchStatRecorders(storedMatch);
  if (!match || match.refereeId || !MATCH_SIDES.includes(sideName) || !match.startedAt || match.endedAt) return state;
  const reserveIds = getMatchReservePlayerIds(match, sideName);
  const recorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  if (!reserveIds.includes(state.currentUserId) || !recorders[sideName] || recorders[sideName] === state.currentUserId) return state;
  if ((match.recorderTakeoverRequests ?? []).some((request) => request.side === sideName && request.status === "open")) return state;
  const request = {
    id: makeId("recorder-takeover"),
    side: sideName,
    requestedBy: state.currentUserId,
    expectedRecorderId: recorders[sideName],
    status: "open",
    createdAt: new Date().toISOString(),
  };
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? {
      ...item,
      recorderTakeoverRequests: [request, ...(item.recorderTakeoverRequests ?? [])],
    } : item),
  };
}

export function resolveMatchRecorderTakeover(state, matchId, sideName, requestId, decision) {
  const storedMatch = state.matches.find((item) => item.id === matchId);
  const match = withEffectiveMatchStatRecorders(storedMatch);
  const request = (match?.recorderTakeoverRequests ?? []).find((item) => item.id === requestId && item.side === sideName && item.status === "open");
  if (!match || !request || match.refereeId || match.endedAt) return state;
  const recorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const isHost = getMatchHostPlayerId(state, match) === state.currentUserId;
  const isRecorder = recorders[sideName] === state.currentUserId;
  const isRequester = request.requestedBy === state.currentUserId;
  if ((decision === "cancelled" && !isRequester) || (["approved", "rejected"].includes(decision) && !isHost && !isRecorder)) return state;
  if (decision === "approved" && (request.expectedRecorderId !== recorders[sideName] || !getMatchReservePlayerIds(match, sideName).includes(request.requestedBy))) return state;
  const nextRecorders = decision === "approved" ? { ...recorders, [sideName]: request.requestedBy } : recorders;
  const now = new Date().toISOString();
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? {
      ...item,
      statRecorders: nextRecorders,
      rules: { ...(item.rules ?? {}), statRecorders: nextRecorders },
      recorderTakeoverRequests: (item.recorderTakeoverRequests ?? []).map((entry) => entry.id === requestId ? {
        ...entry,
        status: decision,
        resolvedAt: now,
        resolvedBy: state.currentUserId,
      } : entry),
      updatedAt: now,
    } : item),
  };
}

export function finalizeMatchByAuthority(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.result || !match.endedAt || match.confirmedAt || match.status === "disputed") return state;
  if (!currentUserCanOperateStartedMatch(state, match) || (match.disputes ?? []).some((dispute) => dispute.status === "open")) return state;
  const result = match.refereeId ? match.result : { ...match.result, playerStats: {}, statSubmissions: {} };
  return finalizeMatch(state, { ...match, result, finalizedBy: state.currentUserId });
}
export function approveMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.result || ["confirmed", "void", "cancelled", "disputed"].includes(match.status)) return state;

  const approvalId = getSelfDecisionId(state, match, sideName, "approvals", playerId);
  if (!approvalId) return state;
  const statStatus = getStatSubmissionStatus(match);
  const pointAudit = getResultPointAudit(match);
  if (!statStatus.complete || !pointAudit.matched) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "결과 승인 보류",
          body: !statStatus.complete
            ? `개인 기록 ${statStatus.submitted}/${statStatus.total}명 제출 상태입니다. 전원 제출 후 승인할 수 있습니다.`
            : `득점 합계가 팀 스코어와 맞지 않습니다. A ${pointAudit.teamA.statPoints}/${pointAudit.teamA.teamScore}, B ${pointAudit.teamB.statPoints}/${pointAudit.teamB.teamScore}.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const updatedMatch = {
    ...match,
    rules: isMatchRecordMatch(match)
      ? {
          ...(match.rules ?? {}),
          participantAcceptedIds: uniquePlayerIds([
            ...(match.rules?.participantAcceptedIds ?? []),
            approvalId,
          ]),
        }
      : match.rules,
    approvals: {
      ...(match.approvals ?? { teamA: [], teamB: [] }),
      [sideName]: Array.from(new Set([...(match.approvals?.[sideName] ?? []), approvalId])),
    },
  };
  const stateWithApproval = {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? updatedMatch : item)),
  };

  if (getApprovalStatus(updatedMatch, state.teams, "teamA").approved && getApprovalStatus(updatedMatch, state.teams, "teamB").approved) {
    return finalizeMatch(stateWithApproval, updatedMatch);
  }

  return stateWithApproval;
}

function applyDisputeRequestToResult(match = {}, baseResult = null, disputeRequest = {}) {
  const nextResult = clone(baseResult ?? match.disputeDraftResult ?? match.result);
  const requestedPlayerId = String(disputeRequest.playerId ?? "");
  const requestedPoints = Number(disputeRequest.requestedPoints);
  if (!nextResult || !requestedPlayerId || !Number.isFinite(requestedPoints)) return nextResult;
  const recordPlayerIds = getMatchRecordPlayerIds(match);
  if (!recordPlayerIds.includes(requestedPlayerId)) return nextResult;
  const playerStats = normalizePlayerStats(nextResult.playerStats ?? {}, recordPlayerIds);
  playerStats[requestedPlayerId] = {
    ...(playerStats[requestedPlayerId] ?? {}),
    points: Math.min(999, Math.max(0, Math.round(requestedPoints))),
  };
  return {
    ...nextResult,
    scoreA: getMergedResultScore(match, playerStats, "teamA", nextResult.scoreA),
    scoreB: getMergedResultScore(match, playerStats, "teamB", nextResult.scoreB),
    playerStats,
    updatedAt: new Date().toISOString(),
  };
}

export function confirmMatchRecordParticipation(state, matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!isMatchRecordMatch(match) || match.rules?.recordSetupReady !== true) return state;
  if (!playerId || playerId !== state.currentUserId) return state;
  if (match.confirmedAt || match.cancelledAt || match.voidedAt) return state;
  const requiredIds = MATCH_SIDES.flatMap((sideName) => match.rules?.recordApproverIds?.[sideName] ?? []);
  if (!requiredIds.includes(playerId)) return state;
  const participantAcceptedIds = Array.from(new Set([
    ...(match.rules?.participantAcceptedIds ?? []),
    playerId,
  ]));
  const updatedAt = new Date().toISOString();
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? {
      ...item,
      rules: { ...(item.rules ?? {}), participantAcceptedIds },
      updatedAt,
    } : item),
  };
}

export function disputeMatch(state, matchId, disputeInput = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "이의제기");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  const canOpenDispute = ["approval", "disputed"].includes(match?.status) || Boolean(match?.status === "agreed" && match?.endedAt && match?.result);
  if (!match?.result || !canOpenDispute) return state;
  const disputeRequest = normalizeDisputeRequest(disputeInput);
  if (!currentUserCanFileMatchDispute(state, match)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의신청 권한 없음",
          body: "실제 경기에 참여한 선수만 이의제기할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const recordWindow = getMatchRecordWindow(match);
  if (!recordWindow.disputeOpen) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의제기 마감",
          body: `경기 종료 후 ${normalizeDisputeWindowMinutes(match.disputeMinutes)}분이 지나 이의제기를 접수할 수 없습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  if ((match.disputes ?? []).some((dispute) => dispute.status === "open" && dispute.by === state.currentUserId)) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "이의제기 처리 대기",
        body: "이미 접수한 이의제기가 처리 대기 중입니다.",
        tone: "match",
        matchId,
      }, ...state.notifications],
    };
  }

  const now = new Date().toISOString();
  const dispute = {
    id: makeUuid(),
    by: state.currentUserId,
    reason: disputeRequest.reason || "스코어 또는 개인 기록 확인이 필요합니다.",
    request: disputeRequest,
    status: "open",
    createdAt: now,
  };
  const disputeDraftResult = clone(match.disputeDraftResult ?? match.result);

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            status: "disputed",
            disputes: [dispute, ...(item.disputes ?? [])],
            disputeDraftResult,
            disputeDraftUpdatedAt: now,
          }
        : item,
    ),
    notifications: [
      {
        id: makeId("n"),
        title: "이의제기 접수",
        body: `${match.title} 결과가 보류됐습니다. 방장이 이의제기 큐에서 건별로 가결 또는 부결합니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

function getMatchHostPlayerId(state, match) {
  const sourcePost = match?.recruitingPostId
    ? state.recruitingPosts?.find((post) => post.id === match.recruitingPostId)
    : null;
  return getMatchHostPlayerIdFromMatch(match, sourcePost);
}

function currentUserIsMatchHost(state, match) {
  const hostPlayerId = getMatchHostPlayerId(state, match);
  return Boolean(hostPlayerId && hostPlayerId === state.currentUserId);
}

function currentUserIsEligibleMatchReferee(state, match) {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  return Boolean(isMatchReferee(match, state.currentUserId) && isEligibleReferee(currentUser, match?.refereeTrustMin, state.settings?.refereeAppointments));
}

function currentUserCanOperateStartedMatch(state, match) {
  if (!match) return false;
  if (match.refereeId) return currentUserIsEligibleMatchReferee(state, match);
  return currentUserIsMatchHost(state, match);
}

function currentUserCanResolveMatchDispute(state, match) {
  if (!match) return false;
  const hostPlayerId = getMatchHostPlayerId(state, match);
  return Boolean(hostPlayerId && hostPlayerId === state.currentUserId);
}

function currentUserCanOperateMatchPreparation(state, match) {
  if (!match) return false;
  if (match.refereeId && getMatchRoomPhase(match).phase === "checkin") {
    return currentUserIsEligibleMatchReferee(state, match);
  }
  return currentUserIsMatchHost(state, match);
}

function currentUserCanStartMatch(state, match) {
  if (!match) return false;
  if (match.refereeId) return currentUserIsEligibleMatchReferee(state, match);
  return currentUserIsMatchHost(state, match);
}

function getMatchRefereeAbsenceOpponentLeaderId(state, match) {
  const hostId = getMatchHostPlayerId(state, match);
  const hostSideName = getMatchRosterSideName(match, hostId) ?? "teamA";
  const opponentSideName = hostSideName === "teamA" ? "teamB" : "teamA";
  return getMatchSideLeaderId(match, state.teams, opponentSideName);
}

function currentUserCanConfirmRefereeAbsence(state, match) {
  const leaderId = getMatchRefereeAbsenceOpponentLeaderId(state, match);
  return Boolean(leaderId && leaderId === state.currentUserId);
}

function currentUserCanFileMatchDispute(state, match) {
  if (!match) return false;
  return getMatchRecordPlayerIds(match).includes(state.currentUserId);
}

export function checkInMatchPlayer(state, matchId, sideName, playerId) {
  const disciplineBlock = getDisciplineBlockedState(state, "출석 처리");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !playerId) return state;
  if (!currentUserCanStartMatch(state, match)) return state;
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  const placement = getMatchPlayerPlacement(match, playerId);
  if (!placement || placement.side !== sideName) return state;

  const attendance = getMatchAttendance(match);
  const nextMatch = {
    ...match,
    attendance: {
      ...attendance,
      [sideName]: uniquePlayerIds([...attendance[sideName], playerId]),
    },
  };

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "출석 완료", body: "경기준비방 출석체크가 완료됐습니다.", tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function requestMatchRefereeAbsence(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.refereeId || !currentUserIsMatchHost(state, match)) return state;
  const tournament = match.tournamentId
    ? (state.tournaments ?? []).find((item) => item.id === match.tournamentId)
    : null;
  if (isTournamentGovernanceEnabled(tournament)) return state;
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  if (match.refereeAbsenceRequest?.confirmedAt) return state;
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    refereeAbsenceRequest: {
      by: state.currentUserId,
      createdAt: match.refereeAbsenceRequest?.createdAt ?? now,
      status: "pending",
    },
  };

  return {
    ...state,
    users: adjustUserTrust(state.users, match.refereeId, -REFEREE_ABSENCE_TRUST_PENALTY),
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "심판 미출석 요청",
        body: "상대 사이드장이 인정하면 심판 없는 경기로 전환됩니다.",
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function confirmMatchRefereeAbsence(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.refereeId || !match.refereeAbsenceRequest || match.refereeAbsenceRequest.confirmedAt) return state;
  const tournament = match.tournamentId
    ? (state.tournaments ?? []).find((item) => item.id === match.tournamentId)
    : null;
  if (isTournamentGovernanceEnabled(tournament)) return state;
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  if (!currentUserCanConfirmRefereeAbsence(state, match)) return state;
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    formerRefereeId: match.formerRefereeId ?? match.refereeId,
    refereeId: "",
    refereeAbsenceRequest: {
      ...match.refereeAbsenceRequest,
      status: "confirmed",
      confirmedBy: state.currentUserId,
      confirmedAt: now,
    },
  };

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "심판 미출석 인정",
        body: "심판 없는 경기로 전환됐습니다. 이후 출석, 시작, 종료, 결과 처리는 방장이 맡습니다.",
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function startMatch(state, matchId) {
  const rawMatch = state.matches.find((item) => item.id === matchId);
  const match = applyOperatorAttendance(rawMatch, state.currentUserId);
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt) return state;
  if (!currentUserCanStartMatch(state, match)) return state;
  if (getMatchRoomPhase(match).phase !== "checkin") return state;
  if (match.tournamentId) {
    const tournament = (state.tournaments ?? []).find((item) => item.id === match.tournamentId);
    if (isTournamentGovernanceEnabled(tournament)) {
      const teamAId = match.teamA?.teamId ?? match.teamAId;
      const teamBId = match.teamB?.teamId ?? match.teamBId;
      const refereeReady = [TOURNAMENT_SANCTION_STATUS.approved, TOURNAMENT_SANCTION_STATUS.community].includes(tournament.sanctionStatus)
        && match.refereeId
        && getTournamentRefereeStatus(tournament, match.refereeId) === "accepted"
        && isEligibleReferee(
          (state.users ?? []).find((user) => user.id === match.refereeId),
          REFEREE_TRUST_MIN,
          state.settings?.refereeAppointments,
          tournament.endDate,
        )
        && isTournamentRefereeNeutral(tournament, match.refereeId, teamAId, teamBId, state.teams);
      if (!refereeReady) {
        return {
          ...state,
          notifications: [{
            id: makeId("n"),
            title: "중립 심판 필요",
            body: "승인된 대회 심판 중 양 팀에 속하지 않은 심판을 배정해야 경기를 시작할 수 있습니다.",
            tone: "orange",
            matchId,
          }, ...state.notifications],
        };
      }
    }
  }
  if (isRoomScheduleChangePending(match)) {
    return {
      ...state,
      notifications: [getPendingScheduleChangeNotification({ matchId }), ...state.notifications],
    };
  }
  const currentRequiredIds = getMatchChangeRequiredIds(match);
  const ruleRequiredIds = uniquePlayerIds(match.rules?.ruleAcknowledgementRequiredIds ?? [])
    .filter((playerId) => currentRequiredIds.includes(playerId));
  const ruleAcknowledgedIds = new Set(match.rules?.ruleAcknowledgedIds ?? []);
  if (ruleRequiredIds.some((playerId) => !ruleAcknowledgedIds.has(playerId))) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "변경 내용 확인 필요",
        body: "현재 참가자 전원이 최신 경기 규칙을 확인해야 시작할 수 있습니다.",
        tone: "orange",
        matchId,
      }, ...state.notifications],
    };
  }
  const pickup = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  if (pickup && match.rules?.sideAssignmentStatus !== "confirmed") {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "팀 배정 확정 필요",
        body: "출석한 참가자의 A/B사이드와 대기 선수를 배정한 뒤 배정 확정을 눌러 주세요.",
        tone: "orange",
        matchId,
      }, ...state.notifications],
    };
  }
  if (match.tournamentId && (!match.rules?.rosterReady?.teamA || !match.rules?.rosterReady?.teamB)) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "출전 명단 미확정",
        body: "양 팀장이 출전·후보 명단을 확정해야 경기를 시작할 수 있습니다.",
        tone: "orange",
        matchId,
      }, ...state.notifications],
    };
  }
  const missingAttendance = getMissingMatchAttendance(match);
  if (missingAttendance.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "출석체크 필요",
          body: "출전선수와 후보 전원이 출석체크되거나 미도착 정리되어야 경기 시작이 가능합니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    status: "agreed",
    agreedAt: match.agreedAt ?? now,
    startedAt: match.startedAt ?? now,
    rules: {
      ...(match.rules ?? {}),
      startedAt: match.rules?.startedAt ?? now,
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "경기 시작", body: `${match.title} 경기가 시작됐습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function endMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "agreed" || match.endedAt) return state;
  if (!currentUserCanOperateStartedMatch(state, match)) return state;
  const now = new Date().toISOString();
  const hasLiveResult = Boolean(match.result);
  const nextMatch = {
    ...match,
    status: hasLiveResult ? "approval" : match.status,
    approvals: hasLiveResult ? { teamA: [], teamB: [] } : match.approvals,
    startedAt: match.startedAt ?? match.rules?.startedAt ?? now,
    endedAt: now,
    rules: {
      ...(match.rules ?? {}),
      startedAt: match.rules?.startedAt ?? match.startedAt ?? now,
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "경기 종료", body: `${match.title} 경기가 종료됐습니다. 결과 입력이 열렸습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

function canEditPostgameRoster(state, match) {
  if (!match || ["approval", "confirmed", "void", "cancelled", "disputed"].includes(match.status)) return false;
  if (getMatchRoomPhase(match).phase !== "postgame") return false;
  const canOperatePostStart = currentUserCanOperateStartedMatch(state, match);
  if (getMatchRecordWindow(match).statExpired && !canOperatorSubmitMissingPostgameResult(match, canOperatePostStart)) return false;
  return canOperatePostStart;
}

export function deleteSoloRecord(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !isPersonalRecordMatch(match) || match.createdBy !== state.currentUserId || match.status === "cancelled") return state;
  const nowIso = new Date().toISOString();

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "cancelled", cancelledAt: nowIso, updatedAt: nowIso }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "개인 기록 삭제", body: `${match.title} 기록을 삭제했습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function addMatchLatePlayer(state, matchId, draft = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditPostgameRoster(state, match)) return state;
  const sideName = MATCH_SIDES.includes(draft.sideName) ? draft.sideName : "teamA";
  const registeredUserId = state.users.some((user) => user.id === draft.userId) ? draft.userId : "";
  const anonymousName = String(draft.name ?? "").trim();
  if (!registeredUserId && !anonymousName) return state;

  const playerId = registeredUserId || makeId("anon");
  if (getPlayerSideName(match, playerId)) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "이미 기록 대상", body: "이미 출전 또는 교체 출전 기록에 포함된 선수입니다.", tone: "orange", matchId },
        ...state.notifications,
      ],
    };
  }

  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const nextPlayedPlayerIds = {
    ...playedPlayerIds,
    [sideName]: uniquePlayerIds([...(playedPlayerIds[sideName] ?? []), playerId]),
  };
  const nextReservePlayers = {
    teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
    teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
  };
  const nextExcludedIds = uniquePlayerIds([...(match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? []), playerId]);
  const nextAnonymousPlayers = registeredUserId
    ? match.anonymousPlayers ?? {}
    : { ...(match.anonymousPlayers ?? {}), [playerId]: makeAnonymousMatchPlayer(playerId, anonymousName) };
  const nextMatch = {
    ...match,
    playedPlayerIds: nextPlayedPlayerIds,
    reservePlayers: nextReservePlayers,
    anonymousPlayers: nextAnonymousPlayers,
    mmrExcludedPlayerIds: nextExcludedIds,
    rules: {
      ...(match.rules ?? {}),
      playedPlayerIds: nextPlayedPlayerIds,
      mmrExcludedPlayerIds: nextExcludedIds,
    },
  };

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "경기 후 선수 추가", body: `${SIDE_LABEL_TEXT[sideName]} 기록 대상에 추가했습니다. MMR에는 반영되지 않습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function removeMatchLatePlayer(state, matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditPostgameRoster(state, match) || !playerId) return state;
  const excludedIds = new Set(match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? []);
  if (!excludedIds.has(playerId)) return state;
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const nextPlayedPlayerIds = {
    teamA: uniquePlayerIds(playedPlayerIds.teamA ?? []).filter((id) => id !== playerId),
    teamB: uniquePlayerIds(playedPlayerIds.teamB ?? []).filter((id) => id !== playerId),
  };
  const nextExcludedIds = [...excludedIds].filter((id) => id !== playerId);
  const nextAnonymousPlayers = { ...(match.anonymousPlayers ?? {}) };
  delete nextAnonymousPlayers[playerId];

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            playedPlayerIds: nextPlayedPlayerIds,
            anonymousPlayers: nextAnonymousPlayers,
            mmrExcludedPlayerIds: nextExcludedIds,
            rules: {
              ...(item.rules ?? {}),
              playedPlayerIds: nextPlayedPlayerIds,
              mmrExcludedPlayerIds: nextExcludedIds,
            },
          }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "경기 후 선수 제거", body: "기록 전용 추가 선수를 제거했습니다.", tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function cancelMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;
  const afterStart = Boolean(match.startedAt || match.endedAt || match.result || ["live", "postgame", "dispute", "record"].includes(getMatchRoomPhase(match).phase));
  if (afterStart ? !currentUserCanOperateStartedMatch(state, match) : !currentUserIsMatchHost(state, match)) return state;
  const cancellationPolicy = isMatchRecordMatch(match)
    ? { allowed: true, penalty: 0, waived: false, waiverReason: "" }
    : getRoomCancellationPolicy(match);
  if (!cancellationPolicy.allowed) {
    return {
      ...state,
      notifications: [getRoomCancelLockedNotification({ matchId }), ...state.notifications],
    };
  }
  const cancelCopy = getMatchCancelCopy(match);
  const hostPlayerId = getMatchHostPlayerIdFromMatch(match);
  const cancelledAt = new Date().toISOString();

  return {
    ...state,
    users: cancellationPolicy.penalty > 0 && hostPlayerId
      ? adjustUserTrust(state.users, hostPlayerId, -cancellationPolicy.penalty)
      : state.users,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            status: "cancelled",
            cancelledAt,
            rules: {
              ...(item.rules ?? {}),
              cancelPenalty: cancellationPolicy.penalty,
              cancelPenaltyWaived: cancellationPolicy.waived,
              cancelWaiverReason: cancellationPolicy.waiverReason,
            },
          }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: cancelCopy.notificationTitle, body: cancelCopy.notificationBody, tone: "match", matchId },
      ...(cancellationPolicy.penalty > 0 ? [{
        id: makeId("n"),
        targetUserId: hostPlayerId,
        title: "경기 취소 신뢰도 반영",
        body: `경기 시작 12시간 이내에 취소해 신뢰도 ${cancellationPolicy.penalty}점이 감소했습니다.`,
        tone: "orange",
        matchId,
      }] : []),
      ...state.notifications,
    ],
  };
}

export function voidMatch(state, matchId, reason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "disputed") return state;
  if (!currentUserCanResolveMatchDispute(state, match)) return state;
  const safeReason = String(reason).trim();
  if (safeReason.length < 10 || safeReason.length > 500) return state;
  const now = new Date().toISOString();
  const hostPenalty = Math.max(0, Math.min(10, Number(state.settings?.ratingPolicy?.trust?.matchVoidHostPenalty ?? 2)));
  const hostPlayerId = getMatchHostPlayerId(state, match);

  return {
    ...state,
    users: hostPlayerId ? adjustUserTrust(state.users, hostPlayerId, -hostPenalty) : state.users,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            status: "void",
            ranked: false,
            voidedAt: now,
            voidedBy: state.currentUserId,
            voidReason: safeReason,
            voidSnapshot: {
              ranked: item.ranked !== false,
              ratingScale: Number(item.rules?.ratingScale ?? 1),
              result: item.result ? JSON.parse(JSON.stringify(item.result)) : null,
            },
            disputes: (item.disputes ?? []).map((dispute) => dispute.status === "open"
              ? { ...dispute, status: "accepted", resolution: "match_voided", resolvedAt: now, resolvedBy: state.currentUserId }
              : dispute),
          }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "경기 무효 처리", body: `${match.title} 경기가 무효 처리됐습니다. 사유: ${safeReason}`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function confirmPickupSideAssignment(state, matchId, rotation = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  if (!currentUserCanStartMatch(state, match)) return state;
  const pickup = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  if (!pickup || getMissingMatchAttendance(match).length) return state;
  if (match.rules?.sideAssignmentStatus !== "draft"
    || Number(match.rules?.sideAssignmentRevision ?? 0) < 1) return state;
  const sideCapacity = getRecruitingSideCapacity(match);
  if (getMatchSidePlayerIds(match, "teamA").length !== sideCapacity || getMatchSidePlayerIds(match, "teamB").length !== sideCapacity) return state;
  const rotationMode = ["period", "interval", "manual"].includes(rotation.rotationMode)
    ? rotation.rotationMode
    : "manual";
  const rotationIntervalMinutes = [3, 5, 7, 10].includes(Number(rotation.rotationIntervalMinutes))
    ? Number(rotation.rotationIntervalMinutes)
    : 5;
  const nextMatch = {
    ...match,
    rules: {
      ...(match.rules ?? {}),
      sideAssignmentStatus: "confirmed",
      sideAssignmentConfirmedAt: new Date().toISOString(),
      sideAssignmentConfirmedBy: state.currentUserId,
      rotationMode,
      rotationIntervalMinutes: rotationMode === "interval" ? rotationIntervalMinutes : undefined,
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
  };
}

export function generatePickupSideAssignment(state, matchId, assignmentMode = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  const pickup = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  const safeMode = ["manual", "random", "mmr_balanced"].includes(assignmentMode)
    ? assignmentMode
    : "manual";
  if (!pickup) return state;

  const attendance = getMatchAttendance(match);
  const playerIds = uniquePlayerIds(MATCH_SIDES.flatMap((sideName) => attendance[sideName] ?? []));
  const sideCapacity = getRecruitingSideCapacity(match);
  const benchCapacity = getRecruitingBenchCapacity(match);
  if (playerIds.length < sideCapacity * 2 || playerIds.length > (sideCapacity + benchCapacity) * 2) return state;

  const assignmentRevision = Number(match.rules?.sideAssignmentRevision ?? 0);
  const operator = currentUserCanStartMatch(state, match);
  const currentUserAttended = playerIds.includes(state.currentUserId);
  const reroll = assignmentRevision > 0 && safeMode !== "manual";
  const rerollState = getPickupRerollState(match, state.currentUserId);
  if (!reroll && !operator) return state;
  if (reroll && (!operator && !currentUserAttended || rerollState.count >= rerollState.limit || rerollState.usedByCurrentUser)) return state;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  if (reroll && Number(currentUser?.trustScore ?? 0) < 1) return state;

  const assignment = buildPickupTeamAssignment({
    playerIds,
    users: state.users,
    sideCapacity,
    benchCapacity,
    mode: safeMode,
    seed: `${matchId}:${assignmentRevision}:${playerIds.join(",")}`,
  });
  if (!assignment || assignment.teamA.active.length !== sideCapacity
    || assignment.teamB.active.length !== sideCapacity) return state;

  const agreedIds = new Set([
    ...(match.agreements?.teamA ?? []),
    ...(match.agreements?.teamB ?? []),
  ]);
  const nextAgreements = Object.fromEntries(MATCH_SIDES.map((sideName) => [
    sideName,
    [...assignment[sideName].active, ...assignment[sideName].reserve].filter((playerId) => agreedIds.has(playerId)),
  ]));
  const nextAttendance = Object.fromEntries(MATCH_SIDES.map((sideName) => [
    sideName,
    uniquePlayerIds([...assignment[sideName].active, ...assignment[sideName].reserve]),
  ]));
  const generatedAt = new Date().toISOString();
  const pickupRerollUserIds = reroll
    ? [...rerollState.usedByIds, state.currentUserId]
    : rerollState.usedByIds;
  const pickupRerollCount = reroll ? rerollState.count + 1 : rerollState.count;
  const ratingScale = match.ranked === false ? 0 : getPickupTeamAssignmentRatingScale(safeMode);
  const nextMatch = {
    ...match,
    teamA: { ...(match.teamA ?? {}), name: SIDE_LABEL_TEXT.teamA, teamId: null, playerTeams: {}, players: assignment.teamA.active },
    teamB: { ...(match.teamB ?? {}), name: SIDE_LABEL_TEXT.teamB, teamId: null, playerTeams: {}, players: assignment.teamB.active },
    reservePlayers: { teamA: assignment.teamA.reserve, teamB: assignment.teamB.reserve },
    attendance: nextAttendance,
    agreements: nextAgreements,
    approvals: { teamA: [], teamB: [] },
    parties: [],
    rules: {
      ...(match.rules ?? {}),
      pickupTeamAssignmentMode: safeMode,
      sideAssignmentStatus: "draft",
      sideAssignmentGeneratedAt: generatedAt,
      sideAssignmentGeneratedBy: state.currentUserId,
      sideAssignmentRevision: assignmentRevision + 1,
      sideAssignmentConfirmedAt: null,
      sideAssignmentConfirmedBy: null,
      pickupRerollUserIds,
      pickupRerollCount,
      ratingScale,
    },
    ratingScale,
    agreedAt: null,
  };
  const rerollMessage = reroll ? {
    id: makeId("chat"),
    userId: state.currentUserId,
    body: `${currentUser?.name ?? "참가자"}님이 신뢰도 1점을 사용해 ${safeMode === "random" ? "랜덤" : "MMR 균형"} 배치를 다시 돌렸습니다.`,
    createdAt: generatedAt,
  } : null;
  return {
    ...state,
    users: reroll ? adjustUserTrust(state.users, state.currentUserId, -1) : state.users,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
    recruitingPosts: rerollMessage && (match.recruitingPostId || match.rules?.recruitingPostId)
      ? (state.recruitingPosts ?? []).map((post) => {
          if (post.id !== (match.recruitingPostId || match.rules?.recruitingPostId)) return post;
          const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
          return { ...post, roomState: { ...roomState, chatMessages: [...roomState.chatMessages, rerollMessage] } };
        })
      : state.recruitingPosts,
  };
}

export function swapPickupMatchPlayers(state, matchId, firstPlayerId, secondPlayerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !firstPlayerId || !secondPlayerId || firstPlayerId === secondPlayerId) return state;
  if (!canEditMatchPreparation(state, match) || getMatchRoomPhase(match).phase !== "checkin") return state;
  const pickup = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  if (!pickup
    || match.rules?.sideAssignmentStatus !== "draft"
    || Number(match.rules?.sideAssignmentRevision ?? 0) < 1) return state;

  const firstPlacement = getMatchPlayerPlacement(match, firstPlayerId);
  const secondPlacement = getMatchPlayerPlacement(match, secondPlayerId);
  if (!firstPlacement || !secondPlacement || firstPlacement.side === secondPlacement.side) return state;

  const swapIds = (playerIds = []) => uniquePlayerIds(playerIds.map((playerId) => (
    playerId === firstPlayerId
      ? secondPlayerId
      : playerId === secondPlayerId
        ? firstPlayerId
        : playerId
  )));
  const firstAttended = MATCH_SIDES.some((sideName) => getMatchAttendance(match)[sideName].includes(firstPlayerId));
  const secondAttended = MATCH_SIDES.some((sideName) => getMatchAttendance(match)[sideName].includes(secondPlayerId));
  const nextAttendance = Object.fromEntries(MATCH_SIDES.map((sideName) => {
    const existingIds = getMatchAttendance(match)[sideName].filter((playerId) => (
      playerId !== firstPlayerId && playerId !== secondPlayerId
    ));
    return [sideName, uniquePlayerIds([
      ...existingIds,
      ...(firstAttended && secondPlacement.side === sideName ? [firstPlayerId] : []),
      ...(secondAttended && firstPlacement.side === sideName ? [secondPlayerId] : []),
    ])];
  }));
  const nextAgreements = Object.fromEntries(MATCH_SIDES.map((sideName) => {
    const existingIds = (match.agreements?.[sideName] ?? []).filter((playerId) => (
      playerId !== firstPlayerId && playerId !== secondPlayerId
    ));
    const firstAgreed = MATCH_SIDES.some((candidateSide) => (match.agreements?.[candidateSide] ?? []).includes(firstPlayerId));
    const secondAgreed = MATCH_SIDES.some((candidateSide) => (match.agreements?.[candidateSide] ?? []).includes(secondPlayerId));
    return [sideName, uniquePlayerIds([
      ...existingIds,
      ...(firstAgreed && secondPlacement.side === sideName ? [firstPlayerId] : []),
      ...(secondAgreed && firstPlacement.side === sideName ? [secondPlayerId] : []),
    ])];
  }));

  const nextMatch = {
    ...match,
    teamA: {
      ...(match.teamA ?? {}),
      name: SIDE_LABEL_TEXT.teamA,
      teamId: null,
      playerTeams: {},
      players: swapIds(match.teamA?.players ?? []),
    },
    teamB: {
      ...(match.teamB ?? {}),
      name: SIDE_LABEL_TEXT.teamB,
      teamId: null,
      playerTeams: {},
      players: swapIds(match.teamB?.players ?? []),
    },
    reservePlayers: {
      teamA: swapIds(getMatchReservePlayerIds(match, "teamA")),
      teamB: swapIds(getMatchReservePlayerIds(match, "teamB")),
    },
    attendance: nextAttendance,
    agreements: nextAgreements,
    approvals: { teamA: [], teamB: [] },
    parties: [],
    rules: {
      ...(match.rules ?? {}),
      sideAssignmentStatus: "draft",
      sideAssignmentConfirmedAt: null,
      sideAssignmentConfirmedBy: null,
    },
    agreedAt: null,
  };

  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
  };
}

export function resolveMatchDispute(state, matchId, disputeId, decision) {
  const match = state.matches.find((item) => item.id === matchId);
  const safeDecision = decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "";
  const targetDispute = (match?.disputes ?? []).find((dispute) => dispute.id === disputeId && dispute.status === "open");
  if (!match?.result || match.status !== "disputed" || !targetDispute || !safeDecision) return state;
  if (!currentUserCanResolveMatchDispute(state, match)) return state;

  const resolvedAt = new Date().toISOString();
  const nextDraft = safeDecision === "accepted"
    ? applyDisputeRequestToResult(match, match.disputeDraftResult ?? match.result, targetDispute.request ?? {})
    : clone(match.disputeDraftResult ?? match.result);
  const disputes = (match.disputes ?? []).map((dispute) => dispute.id === targetDispute.id
    ? {
        ...dispute,
        status: safeDecision,
        resolution: safeDecision === "accepted" ? "request_applied" : "request_rejected",
        resolvedAt,
        resolvedBy: state.currentUserId,
      }
    : dispute);
  const openCount = disputes.filter((dispute) => dispute.status === "open").length;
  const decisionLabel = safeDecision === "accepted" ? "가결" : "부결";

  if (!openCount) {
    const resolvedMatch = {
      ...match,
      result: nextDraft,
      teamA: { ...match.teamA, score: nextDraft.scoreA },
      teamB: { ...match.teamB, score: nextDraft.scoreB },
      approvals: { teamA: [], teamB: [] },
      disputes,
      disputeDraftResult: undefined,
      disputeDraftUpdatedAt: undefined,
      disputeResolvedAt: resolvedAt,
    };
    const finalizedState = finalizeMatch({
      ...state,
      matches: state.matches.map((item) => item.id === matchId ? resolvedMatch : item),
    }, resolvedMatch);
    return {
      ...finalizedState,
      notifications: [{
        id: makeId("n"),
        title: `이의제기 ${decisionLabel}`,
        body: `${match.title} 이의제기를 모두 판정해 결과를 확정했습니다. 불복은 신고로 접수해 주세요.`,
        tone: "match",
        matchId,
        targetUserId: targetDispute.by,
      }, ...finalizedState.notifications],
    };
  }

  const nextMatch = {
    ...match,
    disputes,
    disputeDraftResult: nextDraft,
    disputeDraftUpdatedAt: resolvedAt,
  };
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
    notifications: [{
      id: makeId("n"),
      title: `이의제기 ${decisionLabel}`,
      body: `${match.title} 이의제기 1건을 ${decisionLabel}했습니다. 남은 요청 ${openCount}건을 처리해 주세요.`,
      tone: "match",
      matchId,
      targetUserId: targetDispute.by,
    }, ...state.notifications],
  };
}

export function toggleMatchStar(state, matchId, targetUserId) {
  const disciplineBlock = getDisciplineBlockedState(state, "경기 평가");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  const feedbackIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
  if (!match || !isMatchTrustFeedbackOpen(match)) return state;
  if (!feedbackIds.includes(state.currentUserId) || !feedbackIds.includes(targetUserId) || targetUserId === state.currentUserId) return state;

  const maxStars = getMatchTrustFeedbackLimit(match);
  const trustFeedback = match.trustFeedback ?? {};
  const stars = trustFeedback.stars ?? {};
  const myStars = stars[state.currentUserId] ?? [];
  const alreadyStarred = myStars.includes(targetUserId);
  if (!alreadyStarred && myStars.length >= maxStars) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "추천 한도 도달",
          body: `한 경기에서 최대 ${maxStars}명에게 추천을 보낼 수 있습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const nextMyStars = alreadyStarred
    ? myStars.filter((userId) => userId !== targetUserId)
    : [...myStars, targetUserId];
  const nextStars = { ...stars, [state.currentUserId]: nextMyStars };

  return {
    ...state,
    users: adjustUserTrust(state.users, targetUserId, alreadyStarred ? -1 : 1),
    matches: state.matches.map((item) => (
      item.id === matchId
        ? {
            ...item,
            trustFeedback: {
              ...trustFeedback,
              stars: nextStars,
              updatedAt: new Date().toISOString(),
            },
          }
        : item
    )),
  };
}

export function submitMatchThumbs(state, matchId, targetUserIds = []) {
  const disciplineBlock = getDisciplineBlockedState(state, "경기 평가");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  const feedbackIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
  if (!match || !isMatchTrustFeedbackOpen(match)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "추천 마감",
          body: "추천은 기록 확정 후 24시간 안에만 보낼 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (!feedbackIds.includes(state.currentUserId)) return state;

  const userIds = new Set(state.users.map((user) => user.id));
  const maxThumbs = getMatchTrustFeedbackLimit(match);
  const nextMyThumbs = Array.from(new Set(targetUserIds))
    .filter((targetUserId) => feedbackIds.includes(targetUserId) && userIds.has(targetUserId) && targetUserId !== state.currentUserId)
    .slice(0, maxThumbs);
  const trustFeedback = match.trustFeedback ?? {};
  const thumbs = trustFeedback.stars ?? {};
  const previousThumbs = thumbs[state.currentUserId] ?? [];
  const previousSet = new Set(previousThumbs);
  const nextSet = new Set(nextMyThumbs);
  const adjustedUsers = state.users.map((user) => {
    if (!feedbackIds.includes(user.id) || user.id === state.currentUserId) return user;
    const gained = nextSet.has(user.id) && !previousSet.has(user.id);
    const lost = previousSet.has(user.id) && !nextSet.has(user.id);
    if (!gained && !lost) return user;
    return {
      ...user,
      trustScore: clampTrustScore((user.trustScore ?? 80) + (gained ? 1 : -1)),
    };
  });

  return {
    ...state,
    users: adjustedUsers,
    matches: state.matches.map((item) => (
      item.id === matchId
        ? {
            ...item,
            trustFeedback: {
              ...trustFeedback,
              stars: { ...thumbs, [state.currentUserId]: nextMyThumbs },
              updatedAt: new Date().toISOString(),
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "추천 저장 완료",
        body: `${nextMyThumbs.length}명에게 추천을 보냈습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function submitCourtReview(state, matchId, draft = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 리뷰");
  if (disciplineBlock) return disciplineBlock;

  const match = state.matches.find((item) => item.id === matchId);
  const participantIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
  const currentUserId = state.currentUserId;
  const matchFinished = Boolean(match?.endedAt || match?.result || ["approval", "disputed", "confirmed"].includes(match?.status)) && !["void", "cancelled"].includes(match?.status);
  if (!match || !matchFinished || !participantIds.includes(currentUserId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 리뷰 불가",
          body: "구장 리뷰는 해당 경기 참가자만 경기 후 작성할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const rating = normalizeCourtReviewRating(draft.rating, null);
  if (!rating) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "별점 필요",
          body: "구장 별점은 1점부터 5점까지 선택해야 합니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const reviews = state.settings?.courtReviews ?? [];
  const existing = reviews.find((review) => review.matchId === matchId && review.reviewerId === currentUserId);
  const registeredCourt = getRegisteredCourts(state).find((court) => court.name === match.court);
  const now = new Date().toISOString();
  const review = {
    ...(existing ?? {}),
    id: existing?.id ?? `cvr_${matchId}_${currentUserId}`.replace(/[^a-zA-Z0-9_]/g, "_"),
    courtId: registeredCourt?.id ?? existing?.courtId ?? null,
    courtName: match.court,
    matchId,
    reviewerId: currentUserId,
    rating,
    surfaceRating: normalizeCourtReviewRating(draft.surfaceRating, null),
    rimRating: normalizeCourtReviewRating(draft.rimRating, null),
    lightingRating: normalizeCourtReviewRating(draft.lightingRating, null),
    crowdRating: normalizeCourtReviewRating(draft.crowdRating, null),
    locationAccuracy: normalizeCourtReviewRating(draft.locationAccuracy, null),
    fitModes: Array.isArray(draft.fitModes) ? draft.fitModes : existing?.fitModes ?? [],
    tags: Array.isArray(draft.tags) ? draft.tags : existing?.tags ?? [],
    memo: String(draft.memo ?? "").trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const nextReviews = existing
    ? reviews.map((item) => (item.id === existing.id ? review : item))
    : [review, ...reviews];

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      courtReviews: nextReviews,
    }),
    notifications: [
      {
        id: makeId("n"),
        title: existing ? "구장 리뷰 수정" : "구장 리뷰 제출",
        body: `${match.court} 리뷰가 저장되었습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function updatePrivacySettings(state, patch) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      privacy: {
        ...(state.settings?.privacy ?? DEFAULT_SETTINGS.privacy),
        ...patch,
      },
    }),
  };
}

export function updateSettings(state, patch) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      ...patch,
    }),
  };
}

export function blockUser(state, userId) {
  if (!state.users.some((user) => user.id === userId) || userId === state.currentUserId) return state;
  const blockedUserIds = Array.from(new Set([...(state.settings?.blockedUserIds ?? []), userId]));
  const blockedUserIdSet = new Set(blockedUserIds);
  const blockedUser = state.users.find((user) => user.id === userId);
  const isBlockedIncomingInvitation = (invitation = {}) => (
    invitation.targetUserId === state.currentUserId && blockedUserIdSet.has(invitation.fromUserId)
  );
  const visibleRecruitingPosts = (state.recruitingPosts ?? []).map((post) => {
    const roomState = post.roomState ?? {};
    const invitations = (roomState.invitations ?? []).filter((invitation) => !isBlockedIncomingInvitation(invitation));
    return invitations.length === (roomState.invitations ?? []).length
      ? post
      : { ...post, roomState: { ...roomState, invitations } };
  });

  return {
    ...state,
    settings: normalizeSettings({ ...(state.settings ?? {}), blockedUserIds }),
    teamInvitations: (state.teamInvitations ?? []).filter((invitation) => !isBlockedIncomingInvitation(invitation)),
    recruitingPosts: visibleRecruitingPosts,
    notifications: [
      {
        id: makeId("n"),
        title: "플레이어 차단",
        body: `${blockedUser?.name ?? "선택한 플레이어"}가 홈 검색과 추천 목록에서 숨겨집니다.`,
        tone: "team",
      },
      ...(state.notifications ?? []).filter((notification) => !(
        notification.targetUserId === state.currentUserId && isNotificationFromBlockedUser(notification, blockedUserIds)
      )),
    ],
  };
}

export function unblockUser(state, userId) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      blockedUserIds: (state.settings?.blockedUserIds ?? []).filter((id) => id !== userId),
    }),
  };
}

export function toggleFavoritePlayer(state, userId) {
  if (!state.users.some((user) => user.id === userId)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoritePlayerIds: toggleId(state.settings?.favoritePlayerIds, userId, FAVORITE_LIMIT),
    }),
  };
}

export function toggleFavoriteTeam(state, teamId) {
  if (!state.teams.some((team) => team.id === teamId)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoriteTeamIds: toggleId(state.settings?.favoriteTeamIds, teamId, FAVORITE_LIMIT),
    }),
  };
}

export function toggleFavoriteCourt(state, courtId) {
  if (!getRegisteredCourts(state).some((court) => court.id === courtId)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoriteCourtIds: toggleId(state.settings?.favoriteCourtIds, courtId, FAVORITE_LIMIT),
    }),
  };
}

export function toggleFavoriteReferee(state, userId) {
  const referee = state.users.find((user) => user.id === userId);
  if (!referee || !isEligibleReferee(referee, REFEREE_TRUST_MIN, state.settings?.refereeAppointments)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoriteRefereeIds: toggleId(state.settings?.favoriteRefereeIds, userId, FAVORITE_LIMIT),
    }),
  };
}

function getCourtAddressDong(draft = {}) {
  const direct = String(draft.addressDong ?? draft.bname ?? draft.hname ?? "").trim();
  if (direct) return direct;
  const addressText = String(draft.addressText ?? draft.roadAddress ?? draft.jibunAddress ?? "").trim();
  return addressText.match(/[가-힣0-9]+동/)?.[0] ?? "";
}

export function submitCourtRequest(state, draft = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 등록요청");
  if (disciplineBlock) return disciplineBlock;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (trustScore < COURT_REQUEST_TRUST_MIN) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 등록 제한",
          body: `구장 등록요청은 신뢰도 ${COURT_REQUEST_TRUST_MIN}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const rawName = normalizeCourtFacilityName(draft.buildingName || draft.facilityName || draft.name);
  const addressDong = getCourtAddressDong(draft);
  const courtUnit = normalizeCourtNamePart(draft.courtUnit);
  const addressText = String(draft.addressText ?? "").trim();
  const sigungu = normalizeCourtSigungu(draft.sigungu, addressText, draft.sido, draft.region);
  const facilityName = getCourtFacilityBaseName(rawName, sigungu, courtUnit);
  const name = getCourtCanonicalName({ ...draft, name: facilityName, facilityName, sigungu, courtUnit }, state);
  const canonicalBaseName = name;
  const lat = getOptionalCourtCoordinate(draft.lat, -90, 90);
  const lng = getOptionalCourtCoordinate(draft.lng, -180, 180);
  if (!facilityName || !sigungu || !addressText || lat === null || lng === null) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 등록 보류",
          body: "구장명과 핀 기준 실제 주소·좌표는 필요합니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const sameLocationCourts = getCourtLocationMatches({ ...draft, name, canonicalBaseName, addressText }, state);
  if (sameLocationCourts.length && !courtUnit) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "코트 구분 필요",
          body: "같은 장소에 등록된 구장이 있습니다. 물리적으로 다른 코트라면 번호나 구분을 입력해 주세요.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const duplicateCourt = findCourtDuplicate({ ...draft, name, canonicalBaseName, addressText }, state);
  if (duplicateCourt) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 중복",
          body: getCourtDuplicateMessage(duplicateCourt),
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const hashtag = normalizeCourtHashtag(draft.hashtag) || makeRandomCourtHashtag(state);
  const type = normalizeCourtType(draft.type);
  const accessType = normalizeCourtAccessType(draft.accessType, draft.reservation);
  const publicAccess = normalizeCourtPublicAccess(draft.publicAccess);

  const request = {
    id: makeId("cr"),
    status: "pending",
    requestedBy: state.currentUserId,
    requestedByTrustScore: trustScore,
    name,
    baseName: facilityName,
    buildingName: normalizeCourtFacilityName(draft.buildingName),
    facilityName,
    courtUnit,
    canonicalBaseName,
    hashtag,
    region: String(draft.region ?? "").trim() || addressDong || currentUser?.region || "미정",
    sido: String(draft.sido ?? "").trim(),
    sigungu,
    type,
    addressText,
    roadAddress: String(draft.roadAddress ?? "").trim(),
    jibunAddress: String(draft.jibunAddress ?? "").trim(),
    addressDong,
    searchAddressText: String(draft.searchAddressText ?? "").trim(),
    zonecode: String(draft.zonecode ?? "").trim(),
    detailAddress: String(draft.detailAddress ?? "").trim(),
    locationNote: String(draft.locationNote ?? "").trim(),
    lat,
    lng,
    courtKind: normalizeCourtKind(draft.courtKind),
    surfaceType: normalizeCourtSurfaceType(draft.surfaceType),
    courtLayout: normalizeCourtLayout(draft.courtLayout),
    accessType,
    publicAccess,
    reservation: getCourtReservationValue({ accessType }),
    lighting: type === "야외" ? normalizeCourtOptionalBoolean(draft.lighting) : null,
    paid: normalizeCourtOptionalBoolean(draft.paid),
    sourceUrl: normalizeCourtSourceUrl(draft.sourceUrl),
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      courtRequests: [request, ...(state.settings?.courtRequests ?? [])],
    }),
    notifications: [
      {
        id: makeId("n"),
        title: "구장 등록요청",
        body: `${request.name} 등록요청이 접수됐습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

function getLatestRefereeExamAttempt(settings = {}, userId) {
  return [...(settings.refereeExamAttempts ?? [])]
    .filter((attempt) => attempt.userId === userId)
    .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())[0] ?? null;
}

function hashAttemptSeed(value = "") {
  return Array.from(String(value)).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0).toString(36);
}

function getRefereeExamLockNotification(availableAfter) {
  return {
    id: makeId("n"),
    title: "심판 시험 제한",
    body: `심판 시험은 주 1회만 가능합니다. 다음 응시 가능: ${new Date(availableAfter).toLocaleString("ko-KR")}`,
    tone: "orange",
  };
}

export function startRefereeExamAttempt(state, draft = {}) {
  const now = Date.now();
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (trustScore < REFEREE_TRUST_MIN) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 시험 제한",
          body: `심판 시험은 신뢰도 ${REFEREE_TRUST_MIN}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const latestAttempt = getLatestRefereeExamAttempt(state.settings, state.currentUserId);
  const lockedUntil = latestAttempt?.availableAfter ? new Date(latestAttempt.availableAfter).getTime() : 0;
  if (Number.isFinite(lockedUntil) && lockedUntil > now) {
    return {
      ...state,
      notifications: [getRefereeExamLockNotification(latestAttempt.availableAfter), ...state.notifications],
    };
  }

  const startedAt = new Date(now).toISOString();
  const attempt = {
    id: String(draft.id || makeId("rea")),
    userId: state.currentUserId,
    status: "started",
    examVersion: String(draft.examVersion ?? ""),
    seedHash: hashAttemptSeed(draft.seed),
    startedAt,
    availableAfter: new Date(now + REFEREE_EXAM_COOLDOWN_MS).toISOString(),
  };

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      refereeExamAttempts: [attempt, ...(state.settings?.refereeExamAttempts ?? [])],
    }),
  };
}

export function finishRefereeExamAttempt(state, attemptId, result = {}) {
  const attempts = state.settings?.refereeExamAttempts ?? [];
  const target = attempts.find((attempt) => attempt.id === attemptId && attempt.userId === state.currentUserId);
  if (!target) return state;

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      refereeExamAttempts: attempts.map((attempt) => (
        attempt.id === attemptId
          ? {
              ...attempt,
              status: result.passed ? "passed" : "failed",
              score: Math.max(0, Number(result.score ?? 0)),
              total: Math.max(0, Number(result.total ?? 0)),
              passed: Boolean(result.passed),
              finishedAt: new Date().toISOString(),
            }
          : attempt
      )),
    }),
  };
}

export function submitRefereeRequest(state, draft = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "심판 등록요청");
  if (disciplineBlock) return disciplineBlock;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (trustScore < REFEREE_TRUST_MIN) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 등록 제한",
          body: `심판 등록요청은 신뢰도 ${REFEREE_TRUST_MIN}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const qualification = draft.qualification === "official_license" ? "official_license" : "community_exam";
  const experience = String(draft.experience ?? "").trim();
  const memo = String(draft.memo ?? "").trim();
  const examScore = Math.max(0, Number(draft.examScore ?? 0));
  const examTotal = Math.max(0, Number(draft.examTotal ?? 0));
  const passedAttempt = (state.settings?.refereeExamAttempts ?? []).find((attempt) => (
    attempt.id === draft.examAttemptId &&
    attempt.userId === state.currentUserId &&
    attempt.examVersion === draft.examVersion &&
    attempt.passed === true
  ));

  if (qualification === "community_exam" && !passedAttempt) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 등록 보류",
          body: "통과한 심판 시험 기록이 있어야 커뮤니티 심판 등록요청이 가능합니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const request = {
    id: makeId("rr"),
    status: "pending",
    requestedBy: state.currentUserId,
    qualification,
    experience,
    memo,
    examVersion: String(draft.examVersion ?? ""),
    examScore,
    examTotal,
    examPassed: qualification === "community_exam" ? true : Boolean(draft.examPassed),
    examAttemptId: passedAttempt?.id ?? "",
    trustScore,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      refereeRequests: [request, ...(state.settings?.refereeRequests ?? [])],
    }),
    notifications: [
      {
        id: makeId("n"),
        title: "심판 등록요청",
        body: `${currentUser?.name ?? "플레이어"} 심판 등록요청을 접수했습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function reportMatch(state, matchId, reason = "", reportedUserIds = []) {
  const disciplineBlock = getDisciplineBlockedState(state, "경기 신고");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const safeReason = String(reason).trim();
  const isVoidRestoreRequest = safeReason.startsWith(VOID_MATCH_RESTORE_REPORT_REASON);
  if (isVoidRestoreRequest && !canRequestVoidMatchRestore(match, state.currentUserId)) return state;
  const now = Date.now();
  const reportTime = getReportableMatchTimeMs(match);
  const matchPlayerIds = new Set(getReportableMatchUserIds(match));
  if (!matchPlayerIds.has(state.currentUserId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "신고 보류",
          body: "내가 출전했거나 후보로 등록된 경기만 신고할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (reportTime < now - REPORT_MATCH_WINDOW_MS || reportTime > now) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "신고 기한 만료",
          body: "경기 기록 신고는 최근 7일 내 내 경기만 가능합니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const voidTargetUserId = isVoidRestoreRequest ? getVoidMatchRestoreTargetUserId(match) : "";
  const safeReportedUserIds = isVoidRestoreRequest
    ? [voidTargetUserId].filter(Boolean)
    : Array.from(new Set((reportedUserIds ?? []).filter((userId) => matchPlayerIds.has(userId))));
  const report = {
    id: makeId("r"),
    type: "match",
    targetId: matchId,
    by: state.currentUserId,
    reportedUserIds: safeReportedUserIds,
    reason: safeReason || "기타 운영 확인 필요",
    status: "open",
    createdAt: new Date().toISOString(),
    ...(isVoidRestoreRequest ? {
      matchReviewType: "void_restore",
      voidReason: match.voidReason ?? "",
      voidedBy: voidTargetUserId,
      matchHostId: match.createdBy ?? "",
      voidedAt: match.voidedAt ?? null,
    } : {}),
  };

  return {
    ...state,
    reports: [report, ...(state.reports ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "신고 접수",
        body: `${match.title} 신고가 접수됐습니다. 운영 검토 목록에 남겼습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function reportPlayer(state, playerId, matchId, reason = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "플레이어 신고");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  const player = state.users.find((item) => item.id === playerId);
  if (!match || !player || !playerId || playerId === state.currentUserId) return state;

  const now = Date.now();
  const reportTime = getReportableMatchTimeMs(match);
  const matchPlayerIds = new Set(getReportableMatchUserIds(match));
  if (!matchPlayerIds.has(state.currentUserId) || !matchPlayerIds.has(playerId)) return state;
  if (reportTime < now - REPORT_MATCH_WINDOW_MS || reportTime > now) return state;

  const duplicate = (state.reports ?? []).some((report) => (
    report.type === "player" &&
    report.targetId === playerId &&
    report.by === state.currentUserId &&
    !["resolved", "dismissed"].includes(report.status)
  ));
  if (duplicate) return state;

  const report = {
    id: makeId("r"),
    type: "player",
    targetId: playerId,
    by: state.currentUserId,
    reportedUserIds: [playerId],
    sourceMatchId: matchId,
    reason: String(reason).trim() || "기타 운영 확인 필요",
    status: "open",
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    reports: [report, ...(state.reports ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "신고 접수",
        body: `${player.name} 플레이어 신고가 접수됐습니다. 운영 검토 목록에 남겼습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function reportCourtRequest(state, requestId, reason = "허위 구장 등록", options = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 신고");
  if (disciplineBlock) return disciplineBlock;
  const request = (state.settings?.courtRequests ?? []).find((item) => item.id === requestId);
  if (!request) return state;
  if (!["pending", "reported"].includes(request.status ?? "pending")) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "구장 신고 불가",
        body: "검토 대기 중인 구장 등록요청만 신고할 수 있습니다.",
        tone: "orange",
      }, ...state.notifications],
    };
  }
  if (request.requestedBy === state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 신고 보류",
          body: "내가 올린 구장 등록요청은 직접 신고할 수 없습니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const duplicate = (state.reports ?? []).some((report) => (
    report.type === "court_request" &&
    report.targetId === requestId &&
    report.by === state.currentUserId &&
    report.status !== "dismissed"
  ));
  if (duplicate) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 신고 중복",
          body: "이미 같은 구장 등록요청을 신고했습니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const hasOpenReport = (state.reports ?? []).some((report) => (
    report.type === "court_request" &&
    report.targetId === requestId &&
    report.status === "open"
  ));

  const report = {
    id: String(options.reportId ?? "").trim() || makeId("r"),
    type: "court_request",
    targetId: requestId,
    by: state.currentUserId,
    reportedUserIds: [request.requestedBy].filter(Boolean),
    reason: String(reason || "허위 구장 등록").trim(),
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const nextRequests = (state.settings?.courtRequests ?? []).map((item) => (
    item.id === requestId
      ? {
        ...item,
        status: "reported",
        reportReviewPending: true,
        latestReportId: report.id,
        latestReportedAt: report.createdAt,
      }
      : item
  ));

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      courtRequests: nextRequests,
    }),
    reports: [report, ...(state.reports ?? [])],
    notifications: [
      ...(!hasOpenReport ? [{
        id: makeId("n"),
        targetUserId: request.requestedBy,
        title: "구장 등록요청 검토 중",
        body: `${request.name} 등록요청에 신고가 접수되어 운영자가 확인 중입니다. 판정 전에는 신뢰도에 영향이 없습니다.`,
        tone: "orange",
      }] : []),
      {
        id: makeId("n"),
        title: "구장 등록요청 신고 접수",
        body: `${request.name} 등록요청 신고가 접수되었습니다. 운영자 인정 전에는 요청자 신뢰도가 차감되지 않습니다.`,
        tone: "orange",
      },
      ...state.notifications,
    ],
  };
}

export function reportCourt(state, courtId, reason = "구장 위치 오류", courtSnapshot = null) {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 신고");
  if (disciplineBlock) return disciplineBlock;
  const court = (state.settings?.approvedCourts ?? []).find((item) => item.id === courtId)
    ?? (courtSnapshot?.id === courtId ? courtSnapshot : null);
  if (!court) return state;
  const duplicate = (state.reports ?? []).some((report) => (
    report.type === "court" &&
    report.targetId === courtId &&
    report.by === state.currentUserId &&
    report.status !== "dismissed" &&
    report.status !== "resolved"
  ));
  if (duplicate) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 신고 중복",
          body: "이미 같은 구장을 신고했습니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const report = {
    id: makeId("r"),
    type: "court",
    targetId: courtId,
    by: state.currentUserId,
    reportedUserIds: [],
    reason: String(reason || "구장 위치 오류").trim(),
    status: "open",
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    reports: [report, ...(state.reports ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "구장 신고 접수",
        body: `${court.name} 신고가 접수됐습니다. 운영 검토 목록에 남겼습니다.`,
        tone: "orange",
      },
      ...state.notifications,
    ],
  };
}

export function reportCourtReview(state, reviewId, reason = "구장 리뷰 문제") {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 리뷰 신고");
  if (disciplineBlock) return disciplineBlock;
  const review = (state.settings?.courtReviews ?? []).find((item) => item.id === reviewId);
  if (!review || review.reviewerId === state.currentUserId) return state;
  const duplicate = (state.reports ?? []).some((report) => (
    report.type === "court_review" &&
    report.targetId === reviewId &&
    report.by === state.currentUserId &&
    report.status !== "dismissed" &&
    report.status !== "resolved"
  ));
  if (duplicate) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "리뷰 신고 중복",
          body: "이미 같은 구장 리뷰를 신고했습니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const report = {
    id: makeId("r"),
    type: "court_review",
    targetId: reviewId,
    by: state.currentUserId,
    reportedUserIds: [review.reviewerId].filter(Boolean),
    reason: String(reason || "구장 리뷰 문제").trim(),
    status: "open",
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    reports: [report, ...(state.reports ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "구장 리뷰 신고 접수",
        body: `${review.courtName ?? "구장"} 리뷰 신고가 접수됐습니다.`,
        tone: "orange",
      },
      ...state.notifications,
    ],
  };
}

export function reportTeamEmblem(state, teamId, reason = "부적절한 이미지", teamSnapshot = null) {
  const disciplineBlock = getDisciplineBlockedState(state, "팀 엠블럼 신고");
  if (disciplineBlock) return disciplineBlock;
  const team = (state.teams ?? []).find((item) => item.id === teamId)
    ?? (teamSnapshot?.id === teamId ? teamSnapshot : null);
  const captainId = team?.members?.find((member) => member.role === "captain")?.userId;
  if (!team || !captainId || captainId === state.currentUserId || team.emblemSource !== "upload" || !team.emblemKey) {
    return state;
  }
  const duplicate = (state.reports ?? []).some((report) => (
    report.type === "team_emblem" &&
    report.targetId === teamId &&
    report.by === state.currentUserId &&
    report.status !== "dismissed" &&
    report.status !== "resolved"
  ));
  if (duplicate) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "엠블럼 신고 중복",
        body: "이미 같은 팀 엠블럼을 신고했습니다.",
        tone: "orange",
        type: "report",
      }, ...state.notifications],
    };
  }

  const now = new Date().toISOString();
  const report = {
    id: makeId("r"),
    type: "team_emblem",
    targetId: teamId,
    by: state.currentUserId,
    reportedUserIds: [captainId],
    reason: String(reason || "부적절한 이미지").trim().slice(0, 500) || "부적절한 이미지",
    teamName: team.name,
    captainId,
    emblemKey: team.emblemKey,
    emblemSource: team.emblemSource,
    emblemUpdatedAt: team.emblemUpdatedAt,
    status: "open",
    createdAt: now,
  };
  return {
    ...state,
    reports: [report, ...(state.reports ?? [])],
    notifications: [{
      id: makeId("n"),
      title: "팀 엠블럼 신고 접수",
      body: `${team.name} 엠블럼 신고를 접수했습니다. 관리자 확인 후 결과를 알려드립니다.`,
      tone: "orange",
      type: "report",
      createdAt: now,
    }, ...state.notifications],
  };
}

function getAdminActionNotification(body, tone = "orange") {
  return {
    id: makeId("n"),
    title: "관리자 처리",
    body,
    tone,
  };
}

function makeDisciplinaryAction({ state, report, actionType, targetUserId, durationDays, reason, now }) {
  if (!["maliciousReporter", "suspendTarget", "refereeDiscipline"].includes(actionType)) return null;
  const userId = actionType === "maliciousReporter" ? report.by : targetUserId;
  if (!userId) return null;
  const startsAt = now;
  const endsAt = new Date(new Date(now).getTime() + durationDays * DAY_MS).toISOString();
  return {
    id: makeId("ad"),
    userId,
    type: actionType === "refereeDiscipline" ? "referee_discipline" : "suspension",
    actionType,
    sourceReportId: report.id,
    reason,
    startsAt,
    endsAt,
    durationDays,
    createdAt: now,
    createdBy: state.currentUserId,
    status: "active",
  };
}

function commitVoidMatchReviewAction(state, report, draft = {}) {
  const actionType = ["keepMatchVoid", "restoreMatchHalf", "restoreMatchFull"].includes(draft.actionType)
    ? draft.actionType
    : "keepMatchVoid";
  const match = (state.matches ?? []).find((item) => item.id === report.targetId);
  if (!match || match.status !== "void") return state;
  const now = new Date().toISOString();
  const reason = String(draft.reason ?? "").trim() || ADMIN_REVIEW_ACTIONS[actionType].label;
  const feedback = String(draft.feedback ?? "").trim() || ADMIN_REVIEW_ACTIONS[actionType].feedback;
  const durationDays = getSuspensionTier(draft.durationDays).days;
  const penaltyType = ["public_room_suspension", "suspension"].includes(draft.penaltyType) ? draft.penaltyType : "";
  const targetUserId = String(draft.targetUserId ?? report.reportedUserIds?.[0] ?? "").trim();
  if (penaltyType && !targetUserId) return state;
  const actionLabel = actionType === "restoreMatchHalf"
    ? "경기 복구 · MMR 50% 반영"
    : actionType === "restoreMatchFull"
      ? "경기 복구 · MMR 100% 반영"
      : "경기 무효 유지";
  const disciplinaryAction = penaltyType ? {
    id: makeId("ad"),
    userId: targetUserId,
    type: penaltyType,
    actionType: penaltyType === "public_room_suspension" ? "publicRoomSuspend" : "suspendTarget",
    sourceReportId: report.id,
    reason,
    startsAt: now,
    endsAt: new Date(new Date(now).getTime() + durationDays * DAY_MS).toISOString(),
    durationDays,
    createdAt: now,
    createdBy: state.currentUserId,
    status: "active",
  } : null;
  const resolution = { actionType, actionLabel, feedback, reason, targetUserId: targetUserId || null, penaltyType: penaltyType || null, durationDays };
  const nextReport = { ...report, status: "resolved", resolvedAt: now, resolvedBy: state.currentUserId, resolution };
  const auditLog = {
    id: makeId("aa"), type: "void_match_review", status: "committed", reportId: report.id,
    actionType, reason, feedback, targetUserId, penaltyType, durationDays, createdAt: now, createdBy: state.currentUserId,
  };
  const reviewState = {
    ...state,
    reports: (state.reports ?? []).map((item) => item.id === report.id ? nextReport : item),
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
      adminDisciplinaryActions: disciplinaryAction
        ? [disciplinaryAction, ...(state.settings?.adminDisciplinaryActions ?? [])]
        : (state.settings?.adminDisciplinaryActions ?? []),
    }),
    notifications: [
      {
        id: makeId("n"), targetUserId: report.by, title: "신고 처리 결과",
        body: `신고 처리 결과는 ${actionLabel}입니다. ${feedback}`, tone: "team", type: "report", matchId: match.id,
      },
      ...(disciplinaryAction ? [{
        id: makeId("n"), targetUserId, title: "운영 제재 안내",
        body: `${penaltyType === "public_room_suspension" ? "공개방 참가" : "서비스 활동"}이 ${durationDays}일간 제한됩니다. 사유: ${reason}`,
        tone: "orange", type: "disciplinary",
      }] : []),
      ...state.notifications,
    ],
  };
  if (actionType === "keepMatchVoid") {
    return {
      ...reviewState,
      matches: reviewState.matches.map((item) => item.id === match.id ? { ...item, voidReview: resolution } : item),
    };
  }

  const ratingFactor = actionType === "restoreMatchHalf" ? 0.5 : 1;
  const snapshotResult = match.voidSnapshot?.result ?? match.result;
  if (!snapshotResult) return state;
  const restoredMatch = {
    ...match,
    status: "disputed",
    ranked: match.voidSnapshot?.ranked !== false,
    result: snapshotResult,
    disputeDraftResult: snapshotResult,
    rules: {
      ...(match.rules ?? {}),
      ratingScale: Number(match.voidSnapshot?.ratingScale ?? match.rules?.ratingScale ?? 1) * ratingFactor,
    },
    voidReview: resolution,
  };
  return finalizeMatch({
    ...reviewState,
    matches: reviewState.matches.map((item) => item.id === match.id ? restoredMatch : item),
  }, restoredMatch);
}

export function commitAdminReviewAction(state, draft = {}) {
  if (!hasAdminAccess(state.users.find((user) => user.id === state.currentUserId), state.settings)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("관리자 권한이 없습니다."), ...state.notifications],
    };
  }

  const reportId = draft.reportId;
  const report = (state.reports ?? []).find((item) => item.id === reportId);
  if (!report) {
    return {
      ...state,
      notifications: [getAdminActionNotification("처리할 신고를 찾을 수 없습니다."), ...state.notifications],
    };
  }

  const alreadyCommitted = (state.settings?.adminAuditLog ?? []).some((item) => item.reportId === reportId && item.status === "committed");
  if (alreadyCommitted || report.status !== "open") {
    return {
      ...state,
      notifications: [getAdminActionNotification("이미 다른 관리자 처리 또는 이전 처리 결과가 있습니다."), ...state.notifications],
    };
  }

  const actionType = ADMIN_REVIEW_ACTIONS[draft.actionType] ? draft.actionType : "validReport";
  const reason = String(draft.reason ?? "").trim() || ADMIN_REVIEW_ACTIONS[actionType].label;
  const feedback = String(draft.feedback ?? "").trim() || ADMIN_REVIEW_ACTIONS[actionType].feedback;
  const durationDays = getSuspensionTier(draft.durationDays).days;
  const targetUserId = draft.targetUserId || getReportTargetUserId(report);
  const needsTarget = ["suspendTarget", "refereeDiscipline"].includes(actionType);
  if (needsTarget && !targetUserId) {
    return {
      ...state,
      notifications: [getAdminActionNotification("제재 대상을 선택해야 합니다."), ...state.notifications],
    };
  }
  if (actionType === "hideCourt" && report.type !== "court") {
    return {
      ...state,
      notifications: [getAdminActionNotification("구장 신고만 구장 숨김 처리할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "hideCourtReview" && report.type !== "court_review") {
    return {
      ...state,
      notifications: [getAdminActionNotification("구장 리뷰 신고만 리뷰 숨김 처리할 수 있습니다."), ...state.notifications],
    };
  }
  if (
    actionType === "markCourtDuplicate"
    && (report.type !== "court" || report.courtCorrection?.field !== "duplicate")
  ) {
    return {
      ...state,
      notifications: [getAdminActionNotification("중복 구장 신고만 중복으로 확정할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "markCourtDuplicate" && getAdminAuthorityLevel(state) < 50) {
    return {
      ...state,
      notifications: [getAdminActionNotification("경기관리자 이상만 중복 구장을 확정할 수 있습니다."), ...state.notifications],
    };
  }

  if (report.matchReviewType === "void_restore") {
    return commitVoidMatchReviewAction(state, report, draft);
  }
  if (actionType === "resetTeamEmblem" && report.type !== "team_emblem") {
    return {
      ...state,
      notifications: [getAdminActionNotification("팀 엠블럼 신고만 기본값으로 전환할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "resetTeamEmblem" && getAdminAuthorityLevel(state) < 50) {
    return {
      ...state,
      notifications: [getAdminActionNotification("경기관리자 이상만 팀 엠블럼을 강제 전환할 수 있습니다."), ...state.notifications],
    };
  }
  const nameAction = ["renameTeam", "renameAffiliation", "mergeAffiliation"].includes(actionType);
  if (nameAction && getAdminAuthorityLevel(state) < 50) {
    return {
      ...state,
      notifications: [getAdminActionNotification("경기관리자 이상만 이름을 수정하거나 소속을 통합할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "renameTeam" && report.type !== "team_name") return state;
  if (["renameAffiliation", "mergeAffiliation"].includes(actionType) && report.type !== "affiliation_name") return state;
  const replacementName = String(draft.replacementName ?? "").trim().replace(/\s+/g, " ");
  const mergeTargetId = String(draft.mergeTargetId ?? "").trim();
  if (actionType === "renameTeam" && (!replacementName || replacementName.length > MAX_TEAM_NAME_LENGTH)) return state;
  if (actionType === "renameAffiliation" && (replacementName.length < 2 || replacementName.length > 40)) return state;
  if (actionType === "mergeAffiliation" && (!mergeTargetId || mergeTargetId === report.targetId)) return state;

  const now = new Date().toISOString();
  const moderatedTeam = actionType === "resetTeamEmblem"
    ? (state.teams ?? []).find((team) => team.id === report.targetId)
    : null;
  const emblemViolationCount = Number(moderatedTeam?.emblemViolationCount ?? 0) + (moderatedTeam ? 1 : 0);
  const emblemBlockDays = emblemViolationCount <= 1 ? 30 : emblemViolationCount === 2 ? 90 : 365;
  const emblemUploadBlockedUntil = moderatedTeam
    ? new Date(new Date(now).getTime() + emblemBlockDays * DAY_MS).toISOString()
    : null;
  const disciplinaryAction = makeDisciplinaryAction({ state, report, actionType, targetUserId, durationDays, reason, now });
  const nextStatus = actionType === "dismissReport" || actionType === "maliciousReporter" ? "dismissed" : "resolved";
  const nextReports = (state.reports ?? []).map((item) => (
    item.id === reportId
      ? {
        ...item,
        status: nextStatus,
        resolvedAt: now,
        resolvedBy: state.currentUserId,
        resolution: {
          actionType,
          feedback,
          reason,
          targetUserId,
          durationDays,
          ...(moderatedTeam ? { teamId: moderatedTeam.id, violationCount: emblemViolationCount, blockedUntil: emblemUploadBlockedUntil } : {}),
        },
      }
      : item
  ));
  const auditLog = {
    id: makeId("aa"),
    type: "report_action",
    status: "committed",
    reportId,
    actionType,
    reason,
    feedback,
    targetUserId,
    durationDays,
    reportVersion: report.updatedAt ?? report.createdAt ?? "",
    createdAt: now,
    createdBy: state.currentUserId,
  };
  const nextApprovedCourts = ["hideCourt", "markCourtDuplicate"].includes(actionType)
    ? (state.settings?.approvedCourts ?? []).map((court) => (
      court.id === report.targetId
        ? actionType === "markCourtDuplicate"
          ? {
            ...court,
            status: "disabled",
            verificationStatus: "verified",
            adminReviewCount: Number(court.adminReviewCount ?? 0) + 1,
            adminReviewedAt: now,
            adminReviewedBy: state.currentUserId,
            adminReviewScenario: "duplicate",
          }
          : { ...court, status: "hidden", hiddenAt: now, hiddenBy: state.currentUserId, hiddenReason: reason }
        : court
    ))
    : (state.settings?.approvedCourts ?? []);
  const nextCourtReviews = actionType === "hideCourtReview"
    ? (state.settings?.courtReviews ?? []).map((review) => (
      review.id === report.targetId
        ? { ...review, status: "hidden", hiddenAt: now, hiddenBy: state.currentUserId, hiddenReason: reason }
        : review
    ))
    : (state.settings?.courtReviews ?? []);
  const reviewedCourtRequest = report.type === "court_request"
    ? (state.settings?.courtRequests ?? []).find((request) => request.id === report.targetId)
    : null;
  const configuredCourtRequestPenalty = Number(
    state.settings?.ratingPolicy?.trust?.falseCourtReportPenalty ?? FALSE_COURT_REPORT_TRUST_PENALTY,
  );
  const courtRequestPenalty = Number.isFinite(configuredCourtRequestPenalty)
    ? Math.max(0, Math.min(20, Math.round(configuredCourtRequestPenalty)))
    : FALSE_COURT_REPORT_TRUST_PENALTY;
  const courtRequestPenaltyApplied = Boolean(
    reviewedCourtRequest?.trustPenaltyApplied || reviewedCourtRequest?.status === "rejected",
  );
  const shouldApplyCourtRequestPenalty = Boolean(
    reviewedCourtRequest && nextStatus === "resolved" && !courtRequestPenaltyApplied,
  );
  const hasAcceptedCourtRequestReport = reviewedCourtRequest && nextReports.some((item) => (
    item.type === "court_request" && item.targetId === report.targetId && item.status === "resolved"
  ));
  const hasOpenCourtRequestReport = reviewedCourtRequest && nextReports.some((item) => (
    item.type === "court_request" && item.targetId === report.targetId && item.status === "open"
  ));
  const nextCourtRequests = reviewedCourtRequest
    ? (state.settings?.courtRequests ?? []).map((request) => {
      if (request.id !== reviewedCourtRequest.id) return request;
      if (hasAcceptedCourtRequestReport || courtRequestPenaltyApplied) {
        return {
          ...request,
          status: "rejected",
          reportReviewPending: false,
          trustPenaltyApplied: true,
          trustPenalty: request.trustPenalty ?? courtRequestPenalty,
          trustPenaltyAppliedAt: request.trustPenaltyAppliedAt ?? now,
          trustPenaltyReportId: request.trustPenaltyReportId ?? report.id,
          trustPenaltyActionType: request.trustPenaltyActionType ?? actionType,
        };
      }
      return {
        ...request,
        status: hasOpenCourtRequestReport ? "reported" : "pending",
        reportReviewPending: Boolean(hasOpenCourtRequestReport),
        lastDismissedReportId: report.id,
        lastReviewedAt: now,
      };
    })
    : (state.settings?.courtRequests ?? []);
  const nextTeams = moderatedTeam
    ? (state.teams ?? []).map((team) => team.id === moderatedTeam.id ? {
      ...team,
      emblemKey: null,
      emblemSource: "initial",
      emblemUpdatedAt: now,
      emblemViolationCount,
      emblemUploadBlockedUntil,
      emblemModeratedAt: now,
      emblemModerationReason: reason,
    } : team)
    : actionType === "renameTeam"
      ? (state.teams ?? []).map((team) => team.id === report.targetId ? { ...team, name: replacementName, updatedAt: now } : team)
      : (state.teams ?? []);
  const mergedAffiliation = actionType === "mergeAffiliation"
    ? (state.affiliations ?? []).find((affiliation) => affiliation.id === mergeTargetId && (affiliation.status ?? "active") === "active")
    : null;
  if (actionType === "mergeAffiliation" && !mergedAffiliation) return state;
  const nextAffiliations = (state.affiliations ?? []).map((affiliation) => {
    if (actionType === "renameAffiliation" && affiliation.id === report.targetId) return { ...affiliation, name: replacementName, updatedAt: now };
    if (actionType === "mergeAffiliation" && affiliation.id === report.targetId) return { ...affiliation, status: "merged", mergedIntoId: mergeTargetId, memberCount: 0, updatedAt: now };
    return affiliation;
  });
  const affiliationAdjustedUsers = actionType === "mergeAffiliation" && mergedAffiliation
    ? (state.users ?? []).map((user) => user.affiliationId === report.targetId ? {
      ...user,
      affiliationId: mergedAffiliation.id,
      affiliationName: mergedAffiliation.name,
    } : user)
    : (state.users ?? []);
  const nextUsers = shouldApplyCourtRequestPenalty
    ? adjustUserTrust(affiliationAdjustedUsers, reviewedCourtRequest.requestedBy, -courtRequestPenalty)
    : affiliationAdjustedUsers;
  const reporterNotification = report.by
    ? {
      id: makeId("n"),
      targetUserId: report.by,
      title: "신고 처리 결과",
      body: feedback,
      tone: nextStatus === "resolved" ? "team" : "orange",
    }
    : null;
  const targetNotification = disciplinaryAction?.userId
    ? {
      id: makeId("n"),
      targetUserId: disciplinaryAction.userId,
      title: "운영 제재 안내",
      body: `운영 조치가 적용되었습니다. 기간: ${durationDays}일. 사유: ${reason}`,
      tone: "orange",
    }
    : null;
  const teamModerationNotification = moderatedTeam
    ? {
      id: makeId("n"),
      targetUserId: moderatedTeam.members?.find((member) => member.role === "captain")?.userId,
      title: "팀 엠블럼 운영 조치",
      body: `신고가 인정되어 엠블럼이 기본값으로 전환되었습니다. ${emblemBlockDays}일 동안 사진을 업로드할 수 없습니다.`,
      tone: "orange",
      type: "team_emblem_moderation",
    }
    : null;
  const courtRequestDecisionNotification = shouldApplyCourtRequestPenalty
    ? {
      id: makeId("n"),
      targetUserId: reviewedCourtRequest.requestedBy,
      title: "구장 등록요청 신고 인정",
      body: courtRequestPenalty > 0
        ? `${reviewedCourtRequest.name} 등록요청 신고가 인정되어 신뢰도 ${courtRequestPenalty}점이 차감되었습니다.`
        : `${reviewedCourtRequest.name} 등록요청 신고가 인정되었습니다. 현재 정책상 신뢰도 차감은 없습니다.`,
      tone: "orange",
    }
    : null;

  return {
    ...state,
    users: nextUsers,
    teams: nextTeams,
    affiliations: nextAffiliations,
    reports: nextReports,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      approvedCourts: nextApprovedCourts,
      courtReviews: nextCourtReviews,
      courtRequests: nextCourtRequests,
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
      adminDisciplinaryActions: disciplinaryAction
        ? [disciplinaryAction, ...(state.settings?.adminDisciplinaryActions ?? [])]
        : (state.settings?.adminDisciplinaryActions ?? []),
    }),
    notifications: [
      getAdminActionNotification("관리자 처리 결과가 커밋되었습니다.", "team"),
      ...[reporterNotification, targetNotification, teamModerationNotification, courtRequestDecisionNotification].filter((notification) => notification?.targetUserId),
      ...state.notifications,
    ],
  };
}

export function commitAdminAppointmentAction(state, draft = {}) {
  if (!hasAdminAccess(state.users.find((user) => user.id === state.currentUserId), state.settings)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("관리자 권한이 없습니다."), ...state.notifications],
    };
  }

  const actionType = ["appointAdmin", "appointReferee", "extendAppointment", "revokeAppointment"].includes(draft.actionType)
    ? draft.actionType
    : "appointReferee";
  const authorityLevel = getAdminAuthorityLevel(state);
  const now = new Date().toISOString();

  if (actionType === "revokeAppointment" || actionType === "extendAppointment") {
    const appointmentId = String(draft.appointmentId ?? "");
    const adminAppointment = (state.settings?.adminAppointments ?? []).find((appointment) => appointment.id === appointmentId);
    const refereeAppointment = (state.settings?.refereeAppointments ?? []).find((appointment) => appointment.id === appointmentId);
    const appointment = adminAppointment ?? refereeAppointment;
    const role = adminAppointment ? "admin" : refereeAppointment ? "referee" : "";
    if (!appointment || !role) {
      return {
        ...state,
        notifications: [getAdminActionNotification("회수할 임명 기록을 찾을 수 없습니다."), ...state.notifications],
      };
    }
    if (!canManageAppointmentRole(authorityLevel, role)) {
      return {
        ...state,
        notifications: [getAdminActionNotification("해당 임명을 회수할 권한이 없습니다."), ...state.notifications],
      };
    }
    if (!isAppointmentActive(appointment)) {
      return {
        ...state,
        notifications: [getAdminActionNotification("이미 비활성화된 임명입니다."), ...state.notifications],
      };
    }
    const termDays = getAppointmentTermDays(role, appointment.grade, draft.termDays);
    const currentEndMs = getTime(appointment.endsAt);
    const nextEndsAt = actionType === "extendAppointment"
      ? new Date(Math.max(currentEndMs, Date.now()) + termDays * DAY_MS).toISOString()
      : appointment.endsAt;
    const reason = String(draft.reason ?? "").trim() || (actionType === "extendAppointment" ? "임명 연장" : "임명 회수");
    const auditLog = {
      id: makeId("aa"),
      type: "appointment_action",
      status: "committed",
      actionType,
      appointmentId,
      targetUserId: appointment.userId,
      role,
      grade: appointment.grade,
      termDays,
      reason,
      createdAt: now,
      createdBy: state.currentUserId,
    };
    const patchAppointment = (item) => (
      item.id === appointmentId
        ? actionType === "extendAppointment"
          ? { ...item, endsAt: nextEndsAt, extendedAt: now, extendedBy: state.currentUserId, extendReason: reason, status: "active" }
          : { ...item, status: "revoked", revokedAt: now, revokedBy: state.currentUserId, revokeReason: reason }
        : item
    );
    return {
      ...state,
      settings: normalizeSettings({
        ...(state.settings ?? {}),
        adminAppointments: role === "admin" ? (state.settings?.adminAppointments ?? []).map(patchAppointment) : (state.settings?.adminAppointments ?? []),
        refereeAppointments: role === "referee" ? (state.settings?.refereeAppointments ?? []).map(patchAppointment) : (state.settings?.refereeAppointments ?? []),
        adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
      }),
      notifications: [
        getAdminActionNotification(actionType === "extendAppointment" ? "임명 기간을 연장했습니다." : "임명을 회수했습니다.", "team"),
        {
          id: makeId("n"),
          targetUserId: appointment.userId,
          title: actionType === "extendAppointment" ? "임명 연장" : "임명 회수",
          body: actionType === "extendAppointment" ? `임명 기간이 ${termDays}일 연장되었습니다. 사유: ${reason}` : `임명이 회수되었습니다. 사유: ${reason}`,
          tone: actionType === "extendAppointment" ? "team" : "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const role = actionType === "appointAdmin" ? "admin" : "referee";
  if (!canManageAppointmentRole(authorityLevel, role)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("해당 임명을 처리할 권한이 없습니다."), ...state.notifications],
    };
  }
  const userId = String(draft.userId ?? "");
  if (!state.users.some((user) => user.id === userId)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("임명할 플레이어를 찾을 수 없습니다."), ...state.notifications],
    };
  }
  const grade = role === "admin"
    ? (ADMIN_GRADE_META[draft.adminGrade] ? draft.adminGrade : "support")
    : (REFEREE_GRADE_META[draft.refereeGrade] ? draft.refereeGrade : "candidate");
  if (role === "admin" && grade === "owner") {
    return {
      ...state,
      notifications: [getAdminActionNotification("최고관리자는 추가 임명할 수 없습니다."), ...state.notifications],
    };
  }
  const targetAppointments = role === "admin" ? (state.settings?.adminAppointments ?? []) : (state.settings?.refereeAppointments ?? []);
  const duplicate = targetAppointments.some((appointment) => (
    appointment.userId === userId &&
    (appointment.role ?? role) === role &&
    isAppointmentActive(appointment)
  ));
  if (duplicate) {
    return {
      ...state,
      notifications: [getAdminActionNotification("이미 활성 임명이 있습니다."), ...state.notifications],
    };
  }
  const termDays = getAppointmentTermDays(role, grade, draft.termDays);
  const appointment = {
    id: makeId("ap"),
    role,
    grade,
    userId,
    status: "active",
    startsAt: now,
    endsAt: new Date(new Date(now).getTime() + termDays * DAY_MS).toISOString(),
    appointedBy: state.currentUserId,
    reason: String(draft.reason ?? "").trim() || "관리자 임명",
    createdAt: now,
  };
  const auditLog = {
    id: makeId("aa"),
    type: "appointment_action",
    status: "committed",
    actionType,
    appointmentId: appointment.id,
    targetUserId: userId,
    role,
    grade,
    termDays,
    reason: appointment.reason,
    createdAt: now,
    createdBy: state.currentUserId,
  };

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      adminAppointments: role === "admin" ? [appointment, ...(state.settings?.adminAppointments ?? [])] : (state.settings?.adminAppointments ?? []),
      refereeAppointments: role === "referee" ? [appointment, ...(state.settings?.refereeAppointments ?? [])] : (state.settings?.refereeAppointments ?? []),
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
    }),
    notifications: [
      getAdminActionNotification("임명 액션이 커밋되었습니다.", "team"),
      {
        id: makeId("n"),
        targetUserId: userId,
        title: role === "admin" ? "관리자 임명" : "심판 임명",
        body: `${appointment.reason} · ${termDays}일`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function approveCourtRequest(state, requestId, approval = {}) {
  if (!hasAdminAccess(state.users.find((user) => user.id === state.currentUserId), state.settings)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("관리자 권한이 없습니다."), ...state.notifications],
    };
  }
  const request = (state.settings?.courtRequests ?? []).find((item) => item.id === requestId);
  if (!request) {
    return {
      ...state,
      notifications: [getAdminActionNotification("승인할 구장 요청을 찾을 수 없습니다."), ...state.notifications],
    };
  }
  const hasOpenReport = (state.reports ?? []).some((report) => (
    report.type === "court_request" && report.targetId === requestId && report.status === "open"
  ));
  if (request.status !== "pending" || hasOpenReport) {
    return {
      ...state,
      notifications: [getAdminActionNotification("신고 검토 중이거나 종결된 구장 요청은 승인할 수 없습니다."), ...state.notifications],
    };
  }
  if (!approval.addressVerified) {
    return {
      ...state,
      notifications: [getAdminActionNotification("주소와 지도 위치 확인이 필요합니다."), ...state.notifications],
    };
  }
  const approvedSigungu = normalizeCourtSigungu(
    request.sigungu,
    request.addressText || request.roadAddress || request.jibunAddress,
    request.sido,
    request.region,
  );
  const approvedFacilityName = getCourtFacilityBaseName(
    approval.approvedName || request.facilityName || request.baseName || request.name,
    approvedSigungu,
    request.courtUnit,
  );
  const approvedName = getCourtStandardName({ ...request, name: approvedFacilityName, facilityName: approvedFacilityName });
  const approvalCourt = { ...request, name: approvedName, facilityName: approvedFacilityName, canonicalBaseName: approvedName };
  if (!approvedName) {
    return {
      ...state,
      notifications: [getAdminActionNotification("시군구와 시설명을 확인해야 합니다."), ...state.notifications],
    };
  }
  const sameLocationCourts = getCourtLocationMatches(
    approvalCourt,
    state,
    { excludeRequestId: requestId, includeRequests: false },
  );
  if (sameLocationCourts.length && !approval.multipleCourtsVerified) {
    return {
      ...state,
      notifications: [getAdminActionNotification("같은 장소의 복수 코트 여부를 확인해야 합니다."), ...state.notifications],
    };
  }
  const duplicateCourt = findCourtDuplicate(
    approvalCourt,
    state,
    { excludeRequestId: requestId, includeRequests: false },
  );
  if (duplicateCourt) {
    return {
      ...state,
      notifications: [getAdminActionNotification(getCourtDuplicateMessage(duplicateCourt)), ...state.notifications],
    };
  }
  const now = new Date().toISOString();
  const approvedCourt = {
    id: makeId("court"),
    name: approvedName,
    baseName: approvedFacilityName,
    facilityName: approvedFacilityName,
    courtUnit: request.courtUnit,
    sido: request.sido,
    sigungu: approvedSigungu,
    hashtag: request.hashtag,
    region: request.region,
    type: normalizeCourtType(request.type),
    addressText: request.addressText,
    roadAddress: request.roadAddress,
    jibunAddress: request.jibunAddress,
    addressDong: request.addressDong,
    zonecode: request.zonecode,
    detailAddress: request.detailAddress,
    locationNote: request.locationNote,
    lat: request.lat,
    lng: request.lng,
    courtKind: normalizeCourtKind(request.courtKind),
    surfaceType: normalizeCourtSurfaceType(request.surfaceType),
    courtLayout: normalizeCourtLayout(request.courtLayout),
    hoopCount: getCourtHoopCount(request),
    accessType: normalizeCourtAccessType(request.accessType, request.reservation),
    publicAccess: normalizeCourtPublicAccess(request.publicAccess),
    reservation: getCourtReservationValue(request),
    lighting: normalizeCourtOptionalBoolean(request.lighting),
    paid: normalizeCourtOptionalBoolean(request.paid),
    sourceUrl: normalizeCourtSourceUrl(request.sourceUrl),
    favorite: false,
    approvedAt: now,
    approvedBy: state.currentUserId,
    sourceRequestId: requestId,
  };
  const auditLog = {
    id: makeId("aa"),
    type: "court_approval",
    status: "committed",
    requestId,
    courtId: approvedCourt.id,
    targetUserId: request.requestedBy,
    createdAt: now,
    createdBy: state.currentUserId,
  };
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      approvedCourts: [approvedCourt, ...(state.settings?.approvedCourts ?? [])],
      courtRequests: (state.settings?.courtRequests ?? []).map((item) => (
        item.id === requestId
          ? { ...item, name: approvedName, status: "approved", approvedAt: now, approvedBy: state.currentUserId, approvedCourtId: approvedCourt.id }
          : item
      )),
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
    }),
    notifications: [
      getAdminActionNotification("구장 등록요청이 승인되어 등록 구장에 추가되었습니다.", "team"),
      {
        id: makeId("n"),
        targetUserId: request.requestedBy,
        title: "구장 등록 승인",
        body: `${approvedName} 구장 등록요청이 승인되었습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function createRecruitingPost(state, draft) {
  const requestedMode = draft.mode || "5v5";
  const requestedSideCapacity = getRecruitingSideCapacity(draft);
  if (!isSupportedMatchMode(requestedMode) || MODE_SIZES[requestedMode] !== requestedSideCapacity) return state;
  const disciplineBlock = getDisciplineBlockedState(state, "매칭방 생성");
  if (disciplineBlock) return disciplineBlock;
  const creationPolicy = getMatchCreationPolicyPayload({ ...(draft.rules ?? {}), ...draft });
  const pickup = creationPolicy.formationMode === "pickup";
  const hostJoinMode = pickup ? "player" : draft.hostJoinMode === "player" ? "player" : "team";
  const visibility = draft.visibility === "private" ? "private" : "public";
  const teamOnly = hostJoinMode === "team";
  const postType = teamOnly ? "need_team" : hostJoinMode === "team" ? "need_player" : "find_team";
  const hostTrustBlock = getHostTrustBlockNotification(state, { ...draft, ranked: creationPolicy.ranked, official: creationPolicy.official, visibility });
  if (hostTrustBlock) return { ...state, notifications: [hostTrustBlock, ...state.notifications] };
  const userTeamIds = new Set(
    state.teams
      .filter((team) => team.members.some((member) => member.userId === state.currentUserId))
      .map((team) => team.id),
  );

  if (hostJoinMode === "team" && !userTeamIds.has(draft.teamId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "소속 팀 필요",
          body: "팀으로 방을 열려면 내 팀을 먼저 선택해야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const sideCapacity = getRecruitingSideCapacity(draft);
  const benchCapacity = getRecruitingBenchCapacity(draft);
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(draft.mmrRangeMode);
  const mmrLimitMode = pickup ? "off" : normalizeRecruitingMmrLimitMode(draft.mmrLimitMode);
  const allowedAgeGroups = draft.allowedAgeGroups ?? draft.rules?.allowedAgeGroups ?? [];
  const hostTeam = hostJoinMode === "team" ? state.teams.find((team) => team.id === draft.teamId) : null;
  const hostPlayerIds = hostJoinMode === "team" ? [state.currentUserId].filter((playerId) => getTeamMemberIds(hostTeam).includes(playerId)) : [];
  const hostReservePlayerIds = [];
  const privateTeamInviteOnly = visibility === "private" && hostJoinMode === "team";
  const opponentTeam = visibility === "private" && hostJoinMode === "team"
    ? state.teams.find((team) => team.id === (draft.opponentTeamId ?? draft.targetTeamId))
    : null;
  const hostSidePlayerIds = new Set([...hostPlayerIds, ...hostReservePlayerIds]);
  const rawOpponentPlayerIds = opponentTeam
    ? getSelectedTeamPlayerIds(opponentTeam, sideCapacity, draft.opponentPlayerIds).filter((playerId) => !hostSidePlayerIds.has(playerId))
    : [];
  const requestedOpponentLeaderId = String(draft.opponentLeaderId || draft.opponentPlayerIds?.[0] || "").trim();
  const opponentMemberIds = new Set(getSelectableTeamPlayerIds(opponentTeam));
  const opponentLeaderId = privateTeamInviteOnly
    ? (requestedOpponentLeaderId && opponentMemberIds.has(requestedOpponentLeaderId) && !hostSidePlayerIds.has(requestedOpponentLeaderId) ? requestedOpponentLeaderId : "")
    : rawOpponentPlayerIds.includes(draft.opponentLeaderId) ? draft.opponentLeaderId : rawOpponentPlayerIds[0] ?? "";
  const hostEligibility = hostTeam ? getTeamEventEligibility(hostTeam, state.users, {
    capacity: sideCapacity,
    ranked: creationPolicy.ranked,
    mmrLimitMode,
    mmrRangeMode,
    targetMmr: hostTeam.mmr,
    allowedAgeGroups,
    requireCaptainEligible: true,
  }) : null;
  const opponentEligibility = opponentTeam ? getTeamEventEligibility(opponentTeam, state.users, {
    capacity: sideCapacity,
    ranked: creationPolicy.ranked,
    mmrLimitMode,
    mmrRangeMode,
    targetMmr: hostTeam?.mmr ?? opponentTeam.mmr,
    allowedAgeGroups,
    requireCaptainEligible: true,
  }) : null;
  const orderedOpponentPlayerIds = opponentTeam
    ? (privateTeamInviteOnly ? [] : ensureTeamPartyLeader(opponentTeam, rawOpponentPlayerIds, opponentLeaderId, sideCapacity))
    : [];
  const opponentReservePlayerIds = opponentTeam && !privateTeamInviteOnly
    ? getSelectedReservePlayerIds(opponentTeam, orderedOpponentPlayerIds, draft.opponentReservePlayerIds, benchCapacity).filter((playerId) => !hostSidePlayerIds.has(playerId))
    : [];
  const hostPlayerId = state.currentUserId;
  const selectedCourt = getRegisteredCourts(state).find((court) => court.name === draft.court || court.id === getCourtId(draft)) ?? null;
  const roomRegion = selectedCourt?.region || draft.region || state.users.find((user) => user.id === state.currentUserId)?.region || "전체";
  if (hostJoinMode === "team" && !hostPlayerIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "참여 팀원 필요",
          body: "팀으로 방을 열려면 방장이 해당 팀 소속이어야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  if (hostJoinMode === "team" && (!hostEligibility?.allowed || hostEligibility.captainId !== state.currentUserId)) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "팀전 생성 제한",
        body: hostEligibility?.captainId !== state.currentUserId ? "팀장만 팀전 방을 만들 수 있습니다." : hostEligibility?.reason,
        tone: "team",
      }, ...state.notifications],
    };
  }
  if (privateTeamInviteOnly && !opponentEligibility?.allowed) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "상대 팀 초대 제한",
        body: `${opponentTeam?.name ?? "상대 팀"}: ${opponentEligibility?.reason ?? "참가 조건을 확인해 주세요."}`,
        tone: "team",
      }, ...state.notifications],
    };
  }
  if (privateTeamInviteOnly && (!opponentTeam || opponentTeam.id === hostTeam?.id || !opponentLeaderId || opponentLeaderId !== opponentEligibility?.captainId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "상대 사이드 필요",
          body: "비공개 팀전은 A사이드 팀과 B사이드 확인 대표 1명이 필요합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const hostSize = hostJoinMode === "team" ? hostPlayerIds.length : 1;
  const opponentSize = orderedOpponentPlayerIds.length;
  const requestedRefereeId = getTrustedRefereeId(state, draft.refereeId, [state.currentUserId, ...hostPlayerIds, ...orderedOpponentPlayerIds]);
  const refereeWanted = Boolean(draft.refereeWanted || requestedRefereeId);
  const refereeId = "";
  const timingType = draft.timingType === "instant" ? "instant" : "scheduled";
  const fallbackSchedule = timingType === "instant" ? null : getNextQueueSchedule(state.recruitingPosts ?? []);
  const scheduledDate = timingType === "instant" ? "" : (draft.scheduledDate || fallbackSchedule.scheduledDate);
  const scheduledTime = timingType === "instant" ? "" : (draft.scheduledTime || fallbackSchedule.scheduledTime);
  const scheduledAt = timingType === "instant" ? "즉시" : `${scheduledDate} ${scheduledTime}`;
  const scheduleMaxDays = visibility === "public" ? PUBLIC_ROOM_SCHEDULE_MAX_DAYS : ROOM_SCHEDULE_MAX_DAYS;
  if (timingType !== "instant" && !isScheduleDateInAllowedWindow(scheduledDate, new Date(), scheduleMaxDays)) {
    return { ...state, notifications: [getInvalidScheduleNotification(scheduleMaxDays), ...state.notifications] };
  }
  const timingStatus = getPublicRoomTimingStatus({ visibility, timingType, scheduledDate, scheduledTime, scheduledAt, createdAt: new Date().toISOString() });
  if (visibility === "public" && !timingStatus.canCreate) {
    return { ...state, notifications: [getInvalidPublicScheduleNotification(timingStatus.detail), ...state.notifications] };
  }
  const ratingScale = creationPolicy.ranked === false ? 1 : getRecruitingRatingScale({ ranked: creationPolicy.ranked, mmrRangeMode });
  const createdAt = new Date().toISOString();
  const partyReserves = {};
  if (hostReservePlayerIds.length) partyReserves.host = hostReservePlayerIds;
  if (opponentTeam && opponentReservePlayerIds.length) partyReserves[`team:${opponentTeam.id}`] = opponentReservePlayerIds;
  const privatePlayerInviteTargets = visibility === "private" && hostJoinMode === "player"
    ? Array.from(new Set(Array.isArray(draft.invitePlayerIds) ? draft.invitePlayerIds : []))
        .filter((targetUserId) => targetUserId && targetUserId !== state.currentUserId)
        .filter((targetUserId) => state.users.some((user) => user.id === targetUserId && !user.anonymous))
    : [];
  const invitationTargets = visibility === "private" && hostJoinMode === "team" && opponentTeam && opponentLeaderId
    ? [{ targetUserId: opponentLeaderId, teamId: opponentTeam.id, joinMode: "team", side: "teamB" }]
    : privatePlayerInviteTargets.map((targetUserId) => ({ targetUserId, teamId: null, joinMode: "player", side: "teamB" }));
  const initialInvitations = invitationTargets.map((target) => ({
    id: makeId("inv"),
    role: "player",
    targetUserId: target.targetUserId,
    fromUserId: state.currentUserId,
    teamId: target.teamId,
    joinMode: target.joinMode,
    side: target.side,
    reserve: false,
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  }));
  const initialRefereeInvitations = refereeWanted && requestedRefereeId
    ? [{
        id: makeId("inv"),
        role: "referee",
        targetUserId: requestedRefereeId,
        fromUserId: state.currentUserId,
        teamId: null,
        side: "teamB",
        reserve: false,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
      }]
    : [];
  const applicants = opponentTeam && orderedOpponentPlayerIds.length
    ? [
        {
          kind: "team",
          joinMode: "team",
          teamId: opponentTeam.id,
          playerId: opponentLeaderId || orderedOpponentPlayerIds[0],
          side: "teamB",
          status: "waiting",
          reserve: false,
          playerIds: orderedOpponentPlayerIds,
          createdAt,
          updatedAt: createdAt,
        },
      ]
    : [];
  const post = {
    id: draft.id || makeId("q"),
    type: postType,
    title: draft.title?.trim() || `${creationPolicy.ranked === false ? "친선전" : "정규전"} ${draft.mode || "5v5"} 매치 큐`,
    region: roomRegion,
    courtId: selectedCourt?.id ?? getCourtId(draft),
    court: draft.court || "미정",
    mode: draft.mode || "5v5",
    scheduledDate,
    scheduledTime,
    scheduledAt,
    timingType,
    ranked: creationPolicy.ranked,
    mmrRangeMode,
    mmrLimitMode,
    ageRestriction: draft.ageRestriction ?? draft.rules?.ageRestriction ?? "any",
    allowedAgeGroups: draft.allowedAgeGroups ?? draft.rules?.allowedAgeGroups ?? [],
    ratingScale,
    spots: Math.max(0, sideCapacity * 2 - hostSize - opponentSize),
    teamId: hostJoinMode === "team" ? draft.teamId : null,
    targetTeamId: privateTeamInviteOnly ? opponentTeam.id : draft.targetTeamId ?? null,
    refereeWanted,
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: normalizeDisputeWindowMinutes(Number.parseInt(draft.objectionWindow, 10) || draft.disputeMinutes),
    ownerId: state.currentUserId,
    hostJoinMode,
    teamOnly,
    hostSide: pickup ? null : "teamA",
    hostReady: true,
    visibility,
    roomState: {
      ownerId: state.currentUserId,
      mmrRangeMode,
      mmrLimitMode,
      timingType,
      ruleRevision: 1,
      teamOnly,
      refereeWanted,
      approvalModeA: draft.approvalModeA === "all" ? "all" : "leader",
      approvalModeB: draft.approvalModeB === "all" ? "all" : "leader",
      partyReserves,
      partyLeaders: {
        host: state.currentUserId,
        ...(opponentTeam && orderedOpponentPlayerIds.length && opponentLeaderId ? { [`team:${opponentTeam.id}`]: opponentLeaderId } : {}),
      },
      invitations: [...initialInvitations, ...initialRefereeInvitations],
    },
    sideCapacity,
    benchCapacity,
    playerIds: hostPlayerIds,
    position: hostJoinMode === "player" ? draft.position || "포지션 자유" : "포지션 자유",
    playerId: hostPlayerId,
    rules: {
      ...(draft.rules ?? {}),
      ...getMatchRulesPayload({ ...(draft.rules ?? {}), ...draft }, { mode: draft.mode }),
      ...creationPolicy,
      sideAssignmentStatus: pickup ? "pending" : "confirmed",
      rotationMode: creationPolicy.rotationMode,
      rotationIntervalMinutes: creationPolicy.rotationIntervalMinutes,
      benchCapacity,
    },
    official: creationPolicy.official,
    preRegistered: draft.preRegistered !== false,
    stakes: draft.stakes ?? "",
    courtReserved: Boolean(draft.courtReserved),
    courtFee: draft.courtFee ?? "",
    memo: draft.memo?.trim() || (teamOnly ? "팀 대표가 방 안에서 출전/후보 명단을 확정합니다." : "개인이나 팀 파티로 빈자리에 들어올 수 있습니다."),
    status: "open",
    applicants,
    createdAt,
  };

  return {
    ...state,
    recruitingPosts: [post, ...(state.recruitingPosts ?? [])],
    notifications: [
      ...initialInvitations.map((invitation) => ({
        id: makeId("n"),
        title: "매치방 초대",
        body: invitation.joinMode === "team"
          ? `${post.title} B사이드 파티장 초대장이 도착했습니다. 수락하면 B사이드 참가가 확정됩니다.`
          : `${post.title} 초대장이 도착했습니다. 수락하면 B사이드 참가가 확정됩니다.`,
        tone: "match",
        targetUserId: invitation.targetUserId,
        recruitingPostId: post.id,
        invitationId: invitation.id,
        fromUserId: invitation.fromUserId,
      })),
      ...initialRefereeInvitations.map((invitation) => ({
        id: makeId("n"),
        title: "심판 초대",
        body: `${post.title} 심판 초대가 도착했습니다. 수락하면 심판으로 배정됩니다.`,
        tone: "match",
        targetUserId: invitation.targetUserId,
        recruitingPostId: post.id,
        invitationId: invitation.id,
        fromUserId: invitation.fromUserId,
      })),
      {
        id: makeId("n"),
        title: "매치 큐 등록",
        body: `${post.title} 방이 열렸습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function interestRecruitingPost(state, postId, application = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "매칭방 참여");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (isRoomScheduleChangePending(post)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications] };
  }
  const publicRoomDisciplineBlock = getPublicRoomDisciplineBlockedState(state, post);
  if (publicRoomDisciplineBlock) return publicRoomDisciplineBlock;
  if (isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  const user = state.users.find((item) => item.id === state.currentUserId);
  const teamOnly = isTeamOnlyRecruitingRoom(post);
  const refereeWanted = Boolean(post.refereeWanted || post.roomState?.refereeWanted || post.refereeId);
  if (application.joinMode === "referee") {
    if (post.visibility === "private") {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "심판 참여 제한",
            body: "비공개방 심판은 초대 수락으로만 배정됩니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    if (!refereeWanted) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "심판 참여 제한",
            body: "심판을 모집 중인 방만 심판으로 참여할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    if (post.refereeId) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "심판 참여 제한",
            body: "이미 배정된 심판이 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    if (!currentUserCanRefereeRecruitingRoom(state, post)) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "심판 참여 제한",
            body: "심판 권한이 있고 경기 참가자가 아닌 계정만 심판으로 참여할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId
          ? {
              ...item,
              refereeWanted: true,
              refereeId: state.currentUserId,
              roomState: {
                ...roomState,
                refereeWanted: true,
                invitations: roomState.invitations.filter((invitation) => (
                  invitation.role !== "referee"
                )),
              },
            }
          : item
      )),
      notifications: [
        {
          id: makeId("n"),
          title: "심판 참여",
          body: `${post.title} 심판으로 배정됐습니다.`,
          tone: "match",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  if (post.visibility === "private") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "비공개방 참여 제한",
          body: "비공개방은 초대 수락으로만 참여할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  const requestedJoinMode = application.joinMode === "team"
    ? "team"
    : application.joinMode === "player"
      ? "player"
      : application.teamId
        ? "team"
        : getRecruitingApplicantKind(post);
  if (teamOnly && requestedJoinMode === "player") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀전 참여 제한",
          body: "팀전 방은 팀으로만 참여할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  if (isIndividualOnlyRecruitingRoom(post) && requestedJoinMode === "team") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "1v1 참여 제한",
          body: "1v1 개인방은 개인 1명으로만 참여할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  const applicantKind = requestedJoinMode === "team" ? "team" : "player";
  const myTeams = state.teams.filter((team) => team.members.some((member) => member.userId === state.currentUserId));
  const team = applicantKind === "team"
    ? myTeams.find((item) => item.id === application.teamId) ?? myTeams[0]
    : null;

  if (applicantKind === "team" && !team) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "소속 팀 필요",
          body: "팀으로 들어가려면 내 팀이 필요합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const sideCapacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const side = MATCH_SIDES.includes(application.side) ? application.side : getRecruitingBestSide(post, state);
  const lobby = getRecruitingLobby(post, state);
  const occupiedSideTeamId = applicantKind === "team" ? getLobbyPrimaryTeamId(lobby, side) : null;
  const publicTeamJoin = post.visibility === "public" && teamOnly && applicantKind === "team";
  if (teamOnly && occupiedSideTeamId && occupiedSideTeamId !== team?.id) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "팀 참가 마감",
        body: `${SIDE_LABEL_TEXT[side]}에는 이미 다른 팀이 확정됐습니다.`,
        tone: "team",
        recruitingPostId: postId,
      }, ...state.notifications],
    };
  }
  const reserveRequested = publicTeamJoin ? false : Boolean(application.reserve);
  const sideState = lobby.sides[side];
  const teamSelectionCapacity = applicantKind === "team"
    ? teamOnly
      ? sideCapacity
      : reserveRequested
        ? Math.max(0, benchCapacity - (sideState?.reserveCandidates?.length ?? 0))
        : Math.max(0, (sideState?.capacity ?? sideCapacity) - (sideState?.filled ?? 0))
    : sideCapacity;
  const reserveSelectionCapacity = Math.max(0, benchCapacity - (sideState?.reserveCandidates?.length ?? 0));
  const teamEligibility = team ? getTeamEventEligibility(team, state.users, {
    capacity: sideCapacity,
    ranked: post.ranked,
    mmrLimitMode: post.mmrLimitMode ?? roomState.mmrLimitMode,
    mmrRangeMode: post.mmrRangeMode ?? roomState.mmrRangeMode,
    targetMmr: getRecruitingTargetMmr(post, state),
    allowedAgeGroups: post.allowedAgeGroups ?? post.rules?.allowedAgeGroups,
    requireCaptainEligible: true,
  }) : null;
  if (applicantKind === "team" && (teamEligibility?.captainId !== state.currentUserId || !teamEligibility?.allowed)) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "팀전 참가 제한",
        body: teamEligibility?.captainId !== state.currentUserId ? "팀장만 팀으로 참가할 수 있습니다." : teamEligibility?.reason,
        tone: "team",
      }, ...state.notifications],
    };
  }
  const selectedPlayerIds = applicantKind === "team"
    ? publicTeamJoin
      ? [state.currentUserId]
      : ensureTeamPartyLeader(team, getSelectedTeamPlayerIds(team, teamSelectionCapacity, application.playerIds), state.currentUserId, teamSelectionCapacity)
    : [];
  const selectedReservePlayerIds = applicantKind === "team" && !reserveRequested && !publicTeamJoin
    ? getSelectedReservePlayerIds(team, selectedPlayerIds, application.reservePlayerIds, reserveSelectionCapacity)
    : [];
  if (applicantKind === "team") {
    const eligiblePlayerIds = new Set(teamEligibility?.eligiblePlayerIds ?? []);
    if ([...selectedPlayerIds, ...selectedReservePlayerIds].some((playerId) => !eligiblePlayerIds.has(playerId))) {
      return {
        ...state,
        notifications: [{
          id: makeId("n"),
          title: "명단 조건 불일치",
          body: "연령·MMR 조건을 충족한 팀원만 출전·후보로 선택할 수 있습니다.",
          tone: "team",
        }, ...state.notifications],
      };
    }
  }
  const teamSummonPlayerIds = publicTeamJoin
    ? [...selectedPlayerIds, ...selectedReservePlayerIds].filter((playerId) => playerId && playerId !== state.currentUserId)
    : [];
  const candidateMmr = applicantKind === "team"
    ? getAveragePlayerMmr(state, selectedPlayerIds, team?.mmr ?? user?.ratings?.integrated ?? DEFAULT_RATING)
    : user?.ratings?.integrated ?? DEFAULT_RATING;
  const fit = getRecruitingFit(post, candidateMmr, state);
  const mmrLimitMode = normalizeRecruitingMmrLimitMode(post.mmrLimitMode ?? roomState.mmrLimitMode);
  if (mmrLimitMode === "block" && !fit.allowed) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "티어 구간 제한",
          body: `${post.title} 정규전은 ${fit.range.label} 구간만 대기할 수 있습니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  if (applicantKind === "team" && !selectedPlayerIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "참여 팀원 필요",
          body: teamOnly ? "팀으로만 참여 방은 팀 대표가 먼저 들어간 뒤 방 안에서 출전·후보 명단을 확정합니다." : "팀으로 대기하려면 실제 참여할 팀원을 1명 이상 선택해야 합니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  const partySize = applicantKind === "team" ? selectedPlayerIds.length : 1;
  const reserve = publicTeamJoin
    ? false
    : Boolean(application.reserve) || lobby.sides[side].filled + partySize > lobby.sides[side].capacity;
  const now = new Date().toISOString();
  const nextApplicant = applicantKind === "team"
    ? {
        kind: "team",
        joinMode: "team",
        teamId: team.id,
        playerId: state.currentUserId,
        side,
        status: "ready",
        reserve,
        position: application.position ?? null,
        playerIds: selectedPlayerIds,
        createdAt: now,
        updatedAt: now,
      }
    : {
        kind: "player",
        joinMode: "player",
        playerId: state.currentUserId,
        teamId: null,
        side,
        status: "ready",
        reserve,
        position: application.position ?? user?.position ?? null,
        createdAt: now,
        updatedAt: now,
      };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;
  const applicants = [...normalizeRecruitingApplicants(post.applicants ?? []), nextApplicant];
  const applicantKey = getRecruitingApplicantKey(nextApplicant);
  const nextPartyReserves = { ...roomState.partyReserves };
  if (applicantKind === "team" && selectedReservePlayerIds.length) {
    nextPartyReserves[applicantKey] = selectedReservePlayerIds;
  } else {
    delete nextPartyReserves[applicantKey];
  }
  const nextPartyLeaders = { ...(roomState.partyLeaders ?? {}) };
  if (applicantKind === "team") nextPartyLeaders[applicantKey] = state.currentUserId;
  const reservePinnedIds = applicantKind === "team" ? selectedPlayerIds : [state.currentUserId];
  const existingPlayerIds = new Set([
    post.playerId,
    ...lobby.entries.flatMap((entry) => [entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])]),
  ].filter(Boolean));
  const teamSummonTargets = teamSummonPlayerIds.filter((playerId) => !existingPlayerIds.has(playerId));
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers(
      { ...roomState, partyReserves: nextPartyReserves, partyLeaders: nextPartyLeaders },
      side,
      reservePinnedIds,
      reserve,
    ),
    side,
    selectedReservePlayerIds,
    true,
  );
  const nextPost = { ...post, applicants, roomState: nextRoomState };
  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (item.id === postId ? nextPost : item)),
    notifications: [
      ...teamSummonTargets.map((playerId) => ({
        id: makeId("n"),
        title: "팀원 소집",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} 팀원으로 등록되었습니다. 방에서 출전 선수와 후보 선수를 확인해 주세요.`,
        tone: "match",
        targetUserId: playerId,
        recruitingPostId: postId,
      })),
      ...state.notifications,
    ],
  });
}

function getLobbySideName(lobby, sideName) {
  const names = lobby.sides[sideName].entries
    .map((entry) => entry.team?.name ?? entry.user?.name)
    .filter(Boolean);
  if (!names.length) return sideName === "teamA" ? "A사이드" : "B사이드";
  return names.slice(0, 3).join(" + ");
}

function applyTeamOnlyRosterSummon(state, post, roomState, lobby, side, reserve, playerIds, teamId) {
  const team = (state.teams ?? []).find((item) => item.id === teamId);
  const entry = getLobbyTeamEntry(lobby, side, teamId);
  const leaderId = getRecruitingEntryLeaderId(entry, roomState, post.playerId);
  if (!team || !entry || leaderId !== state.currentUserId) {
    return {
      state,
      handled: true,
      ok: false,
      notification: {
        id: makeId("n"),
        title: "팀원 소집 권한 없음",
        body: "팀전 출전/후보 명단은 해당 사이드장이 정합니다.",
        tone: "orange",
        recruitingPostId: post.id,
      },
    };
  }

  const teamMemberIds = new Set((team.members ?? []).map((member) => member.userId));
  const occupiedIds = new Set(
    (lobby.entries ?? [])
      .flatMap((item) => [item.playerId, ...(item.players ?? []), ...(item.reserves ?? [])])
      .filter(Boolean),
  );
  const targetIds = uniquePlayerIds(playerIds)
    .filter((playerId) => teamMemberIds.has(playerId))
    .filter((playerId) => !occupiedIds.has(playerId));
  if (!targetIds.length) {
    return {
      state,
      handled: true,
      ok: false,
      notification: {
        id: makeId("n"),
        title: "소집 대상 없음",
        body: "이미 방에 있거나 같은 팀원이 아닙니다.",
        tone: "team",
        recruitingPostId: post.id,
      },
    };
  }

  const capacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return { state, handled: true, ok: false };

  const currentActiveIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const currentReserveIds = uniquePlayerIds(roomState.partyReserves?.[entry.id] ?? []);
  const openActiveCount = Math.max(0, capacity - currentActiveIds.length);
  const nextActiveAddIds = reserve ? [] : targetIds.slice(0, openActiveCount);
  const nextReserveAddIds = [
    ...(reserve ? targetIds : targetIds.slice(openActiveCount)),
  ].slice(0, Math.max(0, benchCapacity - currentReserveIds.length));
  const nextActiveIds = uniquePlayerIds([...currentActiveIds, ...nextActiveAddIds]).slice(0, capacity);
  const nextReserveIds = uniquePlayerIds([...currentReserveIds, ...nextReserveAddIds]).filter((playerId) => !nextActiveIds.includes(playerId));
  if (nextActiveIds.length === currentActiveIds.length && nextReserveIds.length === currentReserveIds.length) {
    return {
      state,
      handled: true,
      ok: false,
      notification: {
        id: makeId("n"),
        title: "소집 자리 없음",
        body: "출전/후보 슬롯이 모두 찼습니다.",
        tone: "orange",
        recruitingPostId: post.id,
      },
    };
  }

  const nextPartyReserves = { ...roomState.partyReserves, [entry.id]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[entry.id];
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers({ ...roomState, partyReserves: nextPartyReserves }, side, nextActiveAddIds, false),
    side,
    nextReserveAddIds,
    true,
  );
  const updatedAt = new Date().toISOString();
  const nextPost = entry.fixed
    ? { ...post, hostReady: getRecruitingHostEditReady(post), playerIds: nextActiveIds, roomState: nextRoomState }
    : {
        ...post,
        roomState: nextRoomState,
        applicants: applicants.map((applicant) => (
          getRecruitingApplicantKey(applicant) === entry.id
            ? { ...applicant, playerId: leaderId, reserve: false, status: getRecruitingSlotEditStatus(post), playerIds: nextActiveIds, updatedAt }
            : applicant
        )),
      };
  if (isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      state,
      handled: true,
      ok: false,
      notification: getRecruitingReserveLimitNotification(post.id, side),
    };
  }

  const addedCount = nextActiveAddIds.length + nextReserveAddIds.length;
  const summonedIds = [...nextActiveAddIds, ...nextReserveAddIds].filter((playerId) => playerId !== state.currentUserId);
  return {
    state: {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === post.id ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
      )),
      notifications: [
        ...summonedIds.map((playerId) => ({
          id: makeId("n"),
          title: "팀원 소집",
          body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${nextActiveAddIds.includes(playerId) ? "출전" : "후보"} 명단에 등록됐습니다.`,
          tone: "match",
          targetUserId: playerId,
          recruitingPostId: post.id,
          createdAt: updatedAt,
          updatedAt,
        })),
        {
          id: makeId("n"),
          title: "팀원 소집 완료",
          body: `${addedCount}명을 ${SIDE_LABEL_TEXT[side]} 명단에 등록했습니다.`,
          tone: "match",
          recruitingPostId: post.id,
        },
        ...state.notifications,
      ],
    },
    handled: true,
    ok: true,
  };
}

export function setRecruitingReady(state, postId, ready = true) {
  const disciplineBlock = getDisciplineBlockedState(state, "참가 확인 변경");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const updatedAt = new Date().toISOString();
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const currentApplicant = applicants.find((applicant) => (
    applicant.playerId === state.currentUserId || (applicant.playerIds ?? []).includes(state.currentUserId)
  ));
  const hostEntry = (lobby.entries ?? []).find((entry) => entry.id === "host");
  const hostPartyUser = !currentApplicant && (
    (hostEntry?.players ?? []).includes(state.currentUserId) ||
    (hostEntry?.reserves ?? []).includes(state.currentUserId) ||
    (post.hostJoinMode === "player" && post.playerId === state.currentUserId)
  );
  const activePlayerIds = new Set([...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers]);
  const reserveCandidate = [...lobby.sides.teamA.reserveCandidates, ...lobby.sides.teamB.reserveCandidates]
    .find((candidate) => candidate.playerId === state.currentUserId && !activePlayerIds.has(candidate.playerId));
  const nextReserveReady = { ...(roomState.reserveReady ?? {}) };
  if (reserveCandidate) {
    if (ready) nextReserveReady[state.currentUserId] = true;
    else delete nextReserveReady[state.currentUserId];
  }
  const nextRoomState = reserveCandidate
    ? { ...roomState, reserveReady: nextReserveReady }
    : roomState;

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => {
      if (item.id !== postId) return item;
      if (hostPartyUser) {
        return { ...item, hostReady: Boolean(ready), roomState: nextRoomState };
      }
      return cleanRecruitingRoomStatRecorders({
        ...item,
        roomState: nextRoomState,
        applicants: normalizeRecruitingApplicants(item.applicants ?? []).map((applicant) => (
          getRecruitingApplicantKey(applicant) === getRecruitingApplicantKey(currentApplicant)
            ? { ...applicant, status: ready ? "ready" : "waiting", updatedAt }
            : applicant
        )),
      }, state);
    }),
  });
}

const ROOM_SCHEDULE_PATCH_KEYS = new Set([
  "timingType",
  "scheduledDate",
  "scheduledTime",
  "courtId",
  "court",
]);

function withoutRoomSchedulePatch(patch = {}) {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => !ROOM_SCHEDULE_PATCH_KEYS.has(key)));
}

function getRoomScheduleTarget(room = {}, patch = {}) {
  const timingType = patch.timingType === "instant"
    ? "instant"
    : patch.timingType === "scheduled" ? "scheduled" : room.timingType === "instant" ? "instant" : "scheduled";
  const scheduledDate = timingType === "instant" ? "" : String(patch.scheduledDate ?? room.scheduledDate ?? "");
  const scheduledTime = timingType === "instant" ? "" : String(patch.scheduledTime ?? room.scheduledTime ?? "").slice(0, 5);
  return {
    timingType,
    scheduledDate,
    scheduledTime,
    scheduledAt: timingType === "instant" ? "즉시" : `${scheduledDate} ${scheduledTime}`.trim(),
    courtId: String(patch.courtId ?? getCourtId(room) ?? ""),
    court: String(patch.court ?? room.court ?? "미정").slice(0, 80),
  };
}

function getRoomChangeDeadlineAt(room = {}, scheduleTarget = null) {
  const currentStart = getMatchScheduledDate(room);
  const targetStart = scheduleTarget
    ? getMatchScheduledDate({ ...room, ...scheduleTarget })
    : null;
  const candidates = [currentStart, targetStart].filter(Boolean);
  if (!candidates.length) return "";
  const earliestStartMs = Math.min(...candidates.map((date) => date.getTime()));
  return new Date(earliestStartMs - 6 * 3_600_000).toISOString();
}

function hasRoomScheduleChange(room = {}, patch = {}) {
  if (![...ROOM_SCHEDULE_PATCH_KEYS].some((key) => patch[key] !== undefined)) return false;
  const current = getRoomScheduleTarget(room);
  const target = getRoomScheduleTarget(room, patch);
  return [...ROOM_SCHEDULE_PATCH_KEYS].some((key) => String(current[key] ?? "") !== String(target[key] ?? ""));
}

function hasNonScheduleRoomChange(room = {}, patch = {}) {
  return Object.entries(withoutRoomSchedulePatch(patch)).some(([key, value]) => {
    const currentValue = room[key] ?? room.rules?.[key] ?? room.roomState?.[key];
    return JSON.stringify(currentValue ?? null) !== JSON.stringify(value ?? null);
  });
}

function getRecruitingChangeRequiredIds(post = {}, state = {}) {
  return uniquePlayerIds([
    getRecruitingRoomOwnerId(post),
    ...getRecruitingRoomParticipantIds(post, state),
    post.refereeId,
  ]);
}

function getMatchChangeRequiredIds(match = {}) {
  return uniquePlayerIds([
    match.createdBy,
    match.refereeId,
    ...getMatchPlayerIds(match),
    ...getMatchReservePlayerIds(match, "teamA"),
    ...getMatchReservePlayerIds(match, "teamB"),
  ]);
}

function getPendingScheduleChangeNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "일정 변경 승인 대기",
    body: "현재 일정 변경안의 승인이 끝난 뒤 다시 수정할 수 있습니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

function getRoomEditLimitNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "방 수정 완료",
    body: "방 수정은 한 번만 가능합니다. 추가 변경이 필요하면 기존 방을 취소한 뒤 다시 만들어 주세요.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

function getRoomEditWindowNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "방 수정 가능 시간 종료",
    body: "방 수정은 경기 시작 12시간 전까지만 가능합니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

function getRoomCancelLockedNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "취소 가능 시간 종료",
    body: "경기 시작 2시간 전부터는 방을 취소할 수 없습니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

export function updateRecruitingRoomRules(state, postId, patch = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId)) return state;
  const editAvailability = getRoomEditAvailability(post);
  if (!editAvailability.allowed) {
    const notification = editAvailability.reason === "limit"
      ? getRoomEditLimitNotification({ postId })
      : getRoomEditWindowNotification({ postId });
    return { ...state, notifications: [notification, ...state.notifications] };
  }
  if (isRoomScheduleChangePending(post)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications] };
  }

  const requiredIds = getRecruitingChangeRequiredIds(post, state);
  const scheduleChanged = hasRoomScheduleChange(post, patch);
  const scheduleNeedsApproval = scheduleChanged && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const roomPatch = scheduleNeedsApproval ? withoutRoomSchedulePatch(patch) : patch;
  const generalRulesChanged = hasNonScheduleRoomChange(post, roomPatch);
  const ruleAcknowledgementNeeded = generalRulesChanged
    && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const scheduleTarget = getRoomScheduleTarget(post, patch);
  const changeDeadlineAt = getRoomChangeDeadlineAt(post, scheduleTarget);

  const currentCapacity = getRecruitingSideCapacity(post);
  const sideCapacity = Math.max(1, Math.min(5, Number(roomPatch.sideCapacity ?? currentCapacity)));
  const nextMode = `${sideCapacity}v${sideCapacity}`;
  if (!isSupportedMatchMode(nextMode)) return state;
  const benchCapacity = getRecruitingBenchCapacity({ ...post, benchCapacity: roomPatch.benchCapacity });
  const currentLobby = getRecruitingLobby(post, state);
  const pickupRoom = isPickupRecruitingRoom(post);
  const pickupParticipantIds = pickupRoom ? getRecruitingRoomParticipantIds(post, state) : [];
  const pickupParticipantCapacity = getPickupParticipantCapacity({ sideCapacity, benchCapacity });
  if (pickupRoom && pickupParticipantIds.length > pickupParticipantCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: `현재 참가자가 ${pickupParticipantIds.length}명이므로 전체 참가 정원을 ${pickupParticipantCapacity}명으로 줄일 수 없습니다.`,
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  if (!pickupRoom && (currentLobby.sides.teamA.projectedFilled > sideCapacity || currentLobby.sides.teamB.projectedFilled > sideCapacity)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: "현재 출전 인원이 새 정원보다 많습니다. 먼저 후보 명단으로 이동한 뒤 다시 변경해 주세요.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  if (!pickupRoom && (currentLobby.sides.teamA.reserveCandidates.length > benchCapacity || currentLobby.sides.teamB.reserveCandidates.length > benchCapacity)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, "teamA", benchCapacity), ...state.notifications],
    };
  }
  const nextMmrRangeMode = normalizeRecruitingMmrRangeMode(roomPatch.mmrRangeMode ?? post.mmrRangeMode ?? roomState.mmrRangeMode);
  const nextOperations = getMatchCreationPolicyPayload({
    ...post,
    ...(post.rules ?? {}),
    ...roomPatch,
    mode: nextMode,
  });
  const nextRules = {
    ...getMatchRulesPayload({ ...(post.rules ?? {}), ...roomPatch }, { mode: nextMode }),
    ballProvider: nextOperations.ballProvider,
    vestsProvided: nextOperations.vestsProvided,
  };
  const updatedAt = new Date().toISOString();
  const nextCourtName = roomPatch.court === undefined ? post.court : String(roomPatch.court || post.court || "미정").slice(0, 80);
  const nextCourt = getRegisteredCourts(state).find((court) => court.name === nextCourtName || court.id === roomPatch.courtId) ?? null;
  const nextCourtId = roomPatch.court === undefined ? getCourtId(post) : (nextCourt?.id ?? courtIdByName(nextCourtName));
  const pickupPlacements = pickupRoom
    ? getPickupCompatibilityPlacements(pickupParticipantIds.length, {
        sideCapacity,
        benchCapacity,
        hostSide: post.hostSide,
      })
    : [];
  const pickupPlacementByPlayerId = pickupRoom
    ? Object.fromEntries(pickupParticipantIds.map((playerId, index) => [playerId, pickupPlacements[index]]))
    : {};
  const nextApplicants = normalizeRecruitingApplicants(post.applicants ?? []).map((applicant) => {
    const placement = pickupPlacementByPlayerId[applicant.playerId];
    return placement ? { ...applicant, ...placement } : applicant;
  });
  const nextPinnedReservePlayers = pickupRoom
    ? MATCH_SIDES.reduce((result, sideName) => {
        const playerIds = nextApplicants
          .filter((applicant) => applicant.side === sideName && applicant.reserve)
          .map((applicant) => applicant.playerId)
          .filter(Boolean);
        if (playerIds.length) result[sideName] = playerIds;
        return result;
      }, {})
    : roomState.pinnedReservePlayers;
  const nextInvitations = pickupRoom
    ? (roomState.invitations ?? []).map((invitation) => (
        invitation.role === "referee"
          ? invitation
          : { ...invitation, joinMode: "player", teamId: "", reserve: false }
      ))
    : roomState.invitations;
  const nextPost = cleanRecruitingRoomStatRecorders({
    ...post,
    mode: nextMode,
    sideCapacity,
    benchCapacity,
    region: nextCourt?.region ?? post.region,
    courtId: nextCourtId,
    court: nextCourtName,
    timingType: scheduleNeedsApproval ? post.timingType : scheduleTarget.timingType,
    scheduledDate: scheduleNeedsApproval ? post.scheduledDate : scheduleTarget.scheduledDate,
    scheduledTime: scheduleNeedsApproval ? post.scheduledTime : scheduleTarget.scheduledTime,
    scheduledAt: scheduleNeedsApproval ? post.scheduledAt : scheduleTarget.scheduledAt,
    mmrRangeMode: nextMmrRangeMode,
    ratingScale: post.ranked === false ? 1 : getRecruitingRatingScale({ ...post, mmrRangeMode: nextMmrRangeMode }),
    rules: {
      ...(post.rules ?? {}),
      ...nextRules,
      sideCapacity,
      benchCapacity,
      onCourtCount: sideCapacity,
      starterCount: sideCapacity,
      teamCapacity: sideCapacity + benchCapacity,
      ...(pickupRoom ? {
        participantCapacity: pickupParticipantCapacity,
        waitingPlayerCapacity: benchCapacity * 2,
      } : {}),
      mmrRangeMode: nextMmrRangeMode,
      ratingScale: post.ranked === false ? 1 : getRecruitingRatingScale({ ...post, mmrRangeMode: nextMmrRangeMode }),
    },
    memo: roomPatch.memo === undefined ? post.memo : String(roomPatch.memo ?? "").slice(0, 500),
    stakes: roomPatch.stakes === undefined ? post.stakes : String(roomPatch.stakes ?? "").slice(0, 500),
    hostReady: true,
    applicants: nextApplicants,
    roomState: {
      ...roomState,
      ...(pickupRoom ? {
        hostReserve: false,
        partyLeaders: {},
        partySides: {},
        partyReserves: {},
        pinnedReservePlayers: nextPinnedReservePlayers,
        invitations: nextInvitations,
      } : {}),
      mmrRangeMode: nextMmrRangeMode,
      roomEditCount: 1,
      roomEditedAt: updatedAt,
      roomEditedBy: state.currentUserId,
      ruleRevision: generalRulesChanged ? Number(roomState.ruleRevision ?? 0) + 1 : Number(roomState.ruleRevision ?? 0),
      ruleChangedAt: generalRulesChanged ? updatedAt : roomState.ruleChangedAt,
      ...(generalRulesChanged ? {
        ruleAcknowledgementRequiredIds: requiredIds,
        ruleAcknowledgedIds: [state.currentUserId],
        ruleAcknowledgementDeadlineAt: changeDeadlineAt,
      } : {
        ruleAcknowledgementRequiredIds: roomState.ruleAcknowledgementRequiredIds ?? [],
        ruleAcknowledgedIds: roomState.ruleAcknowledgedIds ?? [],
        ruleAcknowledgementDeadlineAt: roomState.ruleAcknowledgementDeadlineAt,
      }),
      ...(scheduleNeedsApproval ? {
        scheduleProposal: {
          id: makeId("schedule"),
          status: "pending",
          proposedBy: state.currentUserId,
          proposedAt: updatedAt,
          consentDeadlineAt: changeDeadlineAt,
          ...scheduleTarget,
          requiredIds,
          approvedIds: [state.currentUserId],
        },
      } : {}),
    },
  }, state);
  const targetNotifications = requiredIds
    .filter((playerId) => playerId !== state.currentUserId)
    .flatMap((targetUserId) => [
      ...(ruleAcknowledgementNeeded ? [{
        id: makeId("n"),
        targetUserId,
        title: "방 정보 변경 확인",
        body: `${post.title}의 경기 규칙이 변경되었습니다. 방에서 변경 내용을 확인해 주세요.`,
        tone: "match",
        type: "recruiting_rules_changed",
        discordEvent: "match",
        recruitingPostId: postId,
        actionRequired: true,
      }] : []),
      ...(scheduleNeedsApproval ? [{
        id: makeId("n"),
        targetUserId,
        title: "일정 변경 승인 요청",
        body: `${post.title}의 일정 또는 구장 변경안이 도착했습니다. 기존 일정은 전원 승인 전까지 유지됩니다.`,
        tone: "match",
        type: "recruiting_schedule_change_requested",
        discordEvent: "match",
        recruitingPostId: postId,
        actionRequired: true,
      }] : []),
    ]);
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (item.id === postId ? nextPost : item)),
    notifications: [...targetNotifications, ...state.notifications],
  };
}

export function updateMatchRoomRules(state, matchId, patch = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt) return state;
  if (!currentUserCanOperateMatchPreparation(state, match)) return state;
  const editAvailability = getRoomEditAvailability(match);
  if (!editAvailability.allowed) {
    const notification = editAvailability.reason === "limit"
      ? getRoomEditLimitNotification({ matchId })
      : getRoomEditWindowNotification({ matchId });
    return { ...state, notifications: [notification, ...state.notifications] };
  }
  if (isRoomScheduleChangePending(match)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ matchId }), ...state.notifications] };
  }
  const requiredIds = getMatchChangeRequiredIds(match);
  const scheduleChanged = hasRoomScheduleChange(match, patch);
  const scheduleNeedsApproval = scheduleChanged && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const matchPatch = scheduleNeedsApproval ? withoutRoomSchedulePatch(patch) : patch;
  const generalRulesChanged = hasNonScheduleRoomChange(match, matchPatch);
  const ruleAcknowledgementNeeded = generalRulesChanged
    && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const scheduleTarget = getRoomScheduleTarget(match, patch);
  const changeDeadlineAt = getRoomChangeDeadlineAt(match, scheduleTarget);
  const sideCapacity = Math.max(1, Math.min(5, Number(matchPatch.sideCapacity ?? getRecruitingSideCapacity(match))));
  const nextMode = `${sideCapacity}v${sideCapacity}`;
  const isSoloRecord = match.rules?.recordType === RECORD_TYPES.personalRecord;
  if (isSoloRecord ? !isSupportedSoloRecordMode(nextMode) : !isSupportedMatchMode(nextMode)) return state;
  const benchCapacity = getRecruitingBenchCapacity({ ...match, benchCapacity: matchPatch.benchCapacity });
  const teamAActiveCount = uniquePlayerIds(match.teamA?.players ?? []).length;
  const teamBActiveCount = uniquePlayerIds(match.teamB?.players ?? []).length;
  if (teamAActiveCount > sideCapacity || teamBActiveCount > sideCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: "현재 출전 인원이 새 정원보다 많습니다. 먼저 미출석 인원을 후보 명단으로 이동하거나 방에서 내보내 주세요.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (getMatchReservePlayerIds(match, "teamA").length > benchCapacity || getMatchReservePlayerIds(match, "teamB").length > benchCapacity) return state;
  const convertToPlayerMatch = matchPatch.matchJoinMode === "player";
  const updatedAt = new Date().toISOString();
  const nextOperations = getMatchCreationPolicyPayload({
    ...match,
    ...(match.rules ?? {}),
    ...matchPatch,
    mode: nextMode,
  });
  const nextRules = {
    ...(match.rules ?? {}),
    ...getMatchRulesPayload({ ...(match.rules ?? {}), ...matchPatch }, { mode: nextMode }),
    ballProvider: nextOperations.ballProvider,
    vestsProvided: nextOperations.vestsProvided,
    sideCapacity,
    benchCapacity,
    roomEditCount: 1,
    roomEditedAt: updatedAt,
    roomEditedBy: state.currentUserId,
    ruleRevision: generalRulesChanged ? Number(match.rules?.ruleRevision ?? 0) + 1 : Number(match.rules?.ruleRevision ?? 0),
    ruleChangedAt: generalRulesChanged ? updatedAt : match.rules?.ruleChangedAt,
    ...(generalRulesChanged ? {
      ruleAcknowledgementRequiredIds: requiredIds,
      ruleAcknowledgedIds: [state.currentUserId],
      ruleAcknowledgementDeadlineAt: changeDeadlineAt,
    } : {
      ruleAcknowledgementRequiredIds: match.rules?.ruleAcknowledgementRequiredIds ?? [],
      ruleAcknowledgedIds: match.rules?.ruleAcknowledgedIds ?? [],
      ruleAcknowledgementDeadlineAt: match.rules?.ruleAcknowledgementDeadlineAt,
    }),
    ...(scheduleNeedsApproval ? {
      scheduleProposal: {
        id: makeId("schedule"),
        status: "pending",
        proposedBy: state.currentUserId,
        proposedAt: updatedAt,
        consentDeadlineAt: changeDeadlineAt,
        ...scheduleTarget,
        requiredIds,
        approvedIds: [state.currentUserId],
      },
    } : {}),
  };
  delete nextRules.startedAt;
  const nextCourtName = matchPatch.court === undefined ? match.court : String(matchPatch.court || match.court || "미정").slice(0, 80);
  const nextCourt = getRegisteredCourts(state).find((court) => court.name === nextCourtName || court.id === matchPatch.courtId) ?? null;
  const nextCourtId = matchPatch.court === undefined ? getCourtId(match) : (nextCourt?.id ?? courtIdByName(nextCourtName));
  if (nextCourt?.region) nextRules.region = nextCourt.region;
  const nextMatch = {
    ...match,
    mode: nextMode,
    status: "agreed",
    rules: nextRules,
    sideCapacity,
    benchCapacity,
    courtId: nextCourtId,
    court: nextCourtName,
    timingType: scheduleNeedsApproval ? match.timingType : scheduleTarget.timingType,
    scheduledDate: scheduleNeedsApproval ? match.scheduledDate : scheduleTarget.scheduledDate,
    scheduledTime: scheduleNeedsApproval ? match.scheduledTime : scheduleTarget.scheduledTime,
    scheduledAt: scheduleNeedsApproval ? match.scheduledAt : scheduleTarget.scheduledAt,
    memo: matchPatch.memo === undefined ? match.memo : String(matchPatch.memo ?? "").slice(0, 500),
    stakes: matchPatch.stakes === undefined ? match.stakes : String(matchPatch.stakes ?? "").slice(0, 500),
    teamA: {
      ...(match.teamA ?? {}),
      teamId: convertToPlayerMatch ? null : match.teamA?.teamId ?? null,
      playerTeams: convertToPlayerMatch ? {} : match.teamA?.playerTeams ?? {},
    },
    teamB: {
      ...(match.teamB ?? {}),
      teamId: convertToPlayerMatch ? null : match.teamB?.teamId ?? null,
      playerTeams: convertToPlayerMatch ? {} : match.teamB?.playerTeams ?? {},
    },
    parties: convertToPlayerMatch ? [] : match.parties ?? [],
    agreements: match.agreements ?? { teamA: [], teamB: [] },
    attendance: match.attendance ?? { teamA: [], teamB: [] },
    agreedAt: match.agreedAt ?? null,
    startedAt: null,
  };
  const targetNotifications = requiredIds
    .filter((playerId) => playerId !== state.currentUserId)
    .flatMap((targetUserId) => [
      ...(ruleAcknowledgementNeeded ? [{
        id: makeId("n"),
        targetUserId,
        title: "경기 정보 변경 확인",
        body: `${match.title}의 경기 규칙이 변경되었습니다. 방에서 변경 내용을 확인해 주세요.`,
        tone: "match",
        type: "match_rules_changed",
        discordEvent: "match",
        matchId,
        actionRequired: true,
      }] : []),
      ...(scheduleNeedsApproval ? [{
        id: makeId("n"),
        targetUserId,
        title: "일정 변경 승인 요청",
        body: `${match.title}의 일정 또는 구장 변경안이 도착했습니다. 기존 일정은 전원 승인 전까지 유지됩니다.`,
        tone: "match",
        type: "match_schedule_change_requested",
        discordEvent: "match",
        matchId,
        actionRequired: true,
      }] : []),
    ]);
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [...targetNotifications, ...state.notifications],
  };
}

export function acknowledgeRecruitingRoomRules(state, postId, revision = 0) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const acknowledgement = getRecruitingRuleAcknowledgement(post);
  if (acknowledgement.revision !== Number(revision)
    || !acknowledgement.requiredIds.includes(state.currentUserId)
    || acknowledgement.acknowledgedIds.includes(state.currentUserId)) return state;
  const nextAcknowledgedIds = uniquePlayerIds([...acknowledgement.acknowledgedIds, state.currentUserId]);
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => item.id === postId ? {
      ...item,
      roomState: {
        ...(item.roomState ?? {}),
        ruleAcknowledgedIds: nextAcknowledgedIds,
      },
    } : item),
  };
}

export function acknowledgeMatchRoomRules(state, matchId, revision = 0) {
  const match = state.matches.find((item) => item.id === matchId);
  const requiredIds = uniquePlayerIds(match?.rules?.ruleAcknowledgementRequiredIds ?? []);
  const acknowledgedIds = uniquePlayerIds(match?.rules?.ruleAcknowledgedIds ?? []);
  if (!match || Number(match.rules?.ruleRevision ?? 0) !== Number(revision)
    || !requiredIds.includes(state.currentUserId)
    || acknowledgedIds.includes(state.currentUserId)) return state;
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? {
      ...item,
      rules: {
        ...(item.rules ?? {}),
        ruleAcknowledgedIds: uniquePlayerIds([...acknowledgedIds, state.currentUserId]),
      },
    } : item),
  };
}

function resolveScheduleProposal({ room = {}, proposalId = "", actorId = "", decision = "approve" } = {}) {
  const progress = getRoomScheduleProposalProgress(room);
  const proposal = progress.proposal;
  if (!proposal || proposal.status !== "pending" || proposal.id !== proposalId
    || !progress.requiredIds.includes(actorId)) return null;
  if (progress.expired) {
    return {
      status: "expired",
      proposal: { ...proposal, status: "expired", expiredAt: new Date().toISOString() },
    };
  }
  if (decision === "reject") {
    return {
      status: "rejected",
      proposal: { ...proposal, status: "rejected", rejectedBy: actorId, rejectedAt: new Date().toISOString() },
    };
  }
  const approvedIds = uniquePlayerIds([...progress.approvedIds, actorId]);
  const complete = progress.requiredIds.every((playerId) => approvedIds.includes(playerId));
  return {
    status: complete ? "approved" : "pending",
    proposal: {
      ...proposal,
      approvedIds,
      status: complete ? "approved" : "pending",
      ...(complete ? { appliedAt: new Date().toISOString() } : {}),
    },
  };
}

export function respondRecruitingScheduleProposal(state, postId, proposalId, decision = "approve") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const resolution = resolveScheduleProposal({
    room: post,
    proposalId,
    actorId: state.currentUserId,
    decision,
  });
  if (!resolution) return state;
  const applied = resolution.status === "approved";
  const selectedCourt = applied
    ? getRegisteredCourts(state).find((court) => court.id === resolution.proposal.courtId) ?? null
    : null;
  const nextPost = {
    ...post,
    ...(applied ? {
      timingType: resolution.proposal.timingType,
      scheduledDate: resolution.proposal.scheduledDate,
      scheduledTime: resolution.proposal.scheduledTime,
      scheduledAt: resolution.proposal.scheduledAt,
      courtId: resolution.proposal.courtId,
      court: selectedCourt?.name ?? resolution.proposal.court,
      region: selectedCourt?.region ?? post.region,
    } : {}),
    roomState: {
      ...(post.roomState ?? {}),
      scheduleProposal: resolution.proposal,
    },
  };
  const final = resolution.status !== "pending";
  const title = resolution.status === "approved" ? "일정 변경 확정"
    : resolution.status === "rejected" ? "일정 변경 반려"
      : resolution.status === "expired" ? "일정 변경 기한 만료" : "일정 변경 승인";
  const body = resolution.status === "approved"
    ? `${post.title}의 새 일정과 구장이 확정되었습니다.`
    : resolution.status === "rejected"
      ? `${post.title}의 일정 변경안이 반려되어 기존 일정이 유지됩니다.`
      : resolution.status === "expired"
        ? `${post.title}의 일정 변경 동의 기한이 지나 기존 일정이 유지됩니다.`
      : `${post.title} 일정 변경안에 승인했습니다.`;
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => item.id === postId ? nextPost : item),
    notifications: [
      ...(final ? resolution.proposal.requiredIds.map((targetUserId) => ({
        id: makeId("n"),
        targetUserId,
        title,
        body,
        tone: "match",
        type: resolution.status === "approved"
          ? "recruiting_schedule_change_applied"
          : resolution.status === "expired"
            ? "recruiting_schedule_change_expired"
            : "recruiting_schedule_change_rejected",
        discordEvent: "match",
        recruitingPostId: postId,
      })) : []),
      ...state.notifications,
    ],
  };
}

export function respondMatchScheduleProposal(state, matchId, proposalId, decision = "approve") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const resolution = resolveScheduleProposal({
    room: match,
    proposalId,
    actorId: state.currentUserId,
    decision,
  });
  if (!resolution) return state;
  const applied = resolution.status === "approved";
  const selectedCourt = applied
    ? getRegisteredCourts(state).find((court) => court.id === resolution.proposal.courtId) ?? null
    : null;
  const nextMatch = {
    ...match,
    ...(applied ? {
      timingType: resolution.proposal.timingType,
      scheduledDate: resolution.proposal.scheduledDate,
      scheduledTime: resolution.proposal.scheduledTime,
      scheduledAt: resolution.proposal.scheduledAt,
      courtId: resolution.proposal.courtId,
      court: selectedCourt?.name ?? resolution.proposal.court,
    } : {}),
    rules: {
      ...(match.rules ?? {}),
      scheduleProposal: resolution.proposal,
      ...(applied && selectedCourt?.region ? { region: selectedCourt.region } : {}),
    },
  };
  const final = resolution.status !== "pending";
  const title = resolution.status === "approved" ? "일정 변경 확정"
    : resolution.status === "rejected" ? "일정 변경 반려"
      : resolution.status === "expired" ? "일정 변경 기한 만료" : "일정 변경 승인";
  const body = resolution.status === "approved"
    ? `${match.title}의 새 일정과 구장이 확정되었습니다.`
    : resolution.status === "rejected"
      ? `${match.title}의 일정 변경안이 반려되어 기존 일정이 유지됩니다.`
      : resolution.status === "expired"
        ? `${match.title}의 일정 변경 동의 기한이 지나 기존 일정이 유지됩니다.`
      : `${match.title} 일정 변경안에 승인했습니다.`;
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
    notifications: [
      ...(final ? resolution.proposal.requiredIds.map((targetUserId) => ({
        id: makeId("n"),
        targetUserId,
        title,
        body,
        tone: "match",
        type: resolution.status === "approved"
          ? "match_schedule_change_applied"
          : resolution.status === "expired"
            ? "match_schedule_change_expired"
            : "match_schedule_change_rejected",
        discordEvent: "match",
        matchId,
      })) : []),
      ...state.notifications,
    ],
  };
}

function canEditMatchPreparation(state, match) {
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt || match.startedAt) return false;
  return currentUserCanOperateMatchPreparation(state, match);
}

function swapMatchSideMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { teamA, teamB, ...rest } = value;
  return { ...rest, teamA: teamB, teamB: teamA };
}

function swapTournamentMatchSides(match = {}) {
  const nextTeamA = match.teamB ?? {};
  const nextTeamB = match.teamA ?? {};
  const titlePrefix = String(match.title ?? "").split("·")[0].trim();
  return {
    ...match,
    title: `${titlePrefix ? `${titlePrefix} · ` : ""}${nextTeamA.name ?? "A"} vs ${nextTeamB.name ?? "B"}`,
    teamA: nextTeamA,
    teamB: nextTeamB,
    reservePlayers: swapMatchSideMap(match.reservePlayers),
    playedPlayerIds: swapMatchSideMap(match.playedPlayerIds),
    promotedReserveIds: swapMatchSideMap(match.promotedReserveIds),
    attendance: swapMatchSideMap(match.attendance),
    agreements: swapMatchSideMap(match.agreements),
    approvals: swapMatchSideMap(match.approvals),
    statRecorders: swapMatchSideMap(match.statRecorders),
    parties: (match.parties ?? []).map((party) => ({
      ...party,
      side: party.side === "teamA" ? "teamB" : party.side === "teamB" ? "teamA" : party.side,
    })),
    rules: {
      ...(match.rules ?? {}),
      rosterReady: swapMatchSideMap(match.rules?.rosterReady),
      rosterReadyAt: swapMatchSideMap(match.rules?.rosterReadyAt),
      reservePlayers: swapMatchSideMap(match.rules?.reservePlayers),
      playedPlayerIds: swapMatchSideMap(match.rules?.playedPlayerIds),
      statRecorders: swapMatchSideMap(match.rules?.statRecorders),
    },
  };
}

function currentUserCanEditMatchRecordSideRoster(state, match, sideName) {
  const tournamentPregame = Boolean(
    match?.tournamentId &&
    match?.scheduledDate &&
    match?.scheduledTime &&
    !match?.startedAt &&
    !match?.endedAt
  );
  if ((!isMatchRecordMatch(match) && !tournamentPregame) || !MATCH_SIDES.includes(sideName)) return false;
  if (match.result || match.confirmedAt || match.cancelledAt || match.voidedAt) return false;
  const leaderId = tournamentPregame
    ? getTeamCaptainId(state.teams, match[sideName]?.teamId)
    : getMatchSideLeaderId(match, state.teams, sideName);
  return Boolean(leaderId && leaderId === state.currentUserId);
}

export function setMatchRecordParticipants(state, matchId, setup = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!isMatchRecordMatch(match) || match.createdBy !== state.currentUserId) return state;
  if (match.result || match.confirmedAt || match.cancelledAt || match.voidedAt) return state;

  const composition = match.rules?.recordComposition === "team" ? "team" : "individual";
  if (!["individual", "team"].includes(setup.composition)) return state;
  const requestedComposition = setup.composition;
  if (composition !== requestedComposition) return state;
  const sideCapacity = getRecruitingSideCapacity(match);
  const now = new Date().toISOString();
  let nextMatch = match;
  let targetIds = [];

  if (composition === "individual") {
    const knownUserIds = new Set((state.users ?? []).filter((user) => user?.id && !user.anonymous).map((user) => user.id));
    const teamAPlayerIds = uniquePlayerIds(setup.teamAPlayerIds).filter((playerId) => knownUserIds.has(playerId));
    const teamBPlayerIds = uniquePlayerIds(setup.teamBPlayerIds).filter((playerId) => knownUserIds.has(playerId));
    if (teamAPlayerIds.length !== sideCapacity || teamBPlayerIds.length !== sideCapacity) return state;
    if (!teamAPlayerIds.includes(state.currentUserId)) return state;
    if (teamAPlayerIds.some((playerId) => teamBPlayerIds.includes(playerId))) return state;
    targetIds = uniquePlayerIds([...teamAPlayerIds, ...teamBPlayerIds]);
    nextMatch = {
      ...match,
      teamA: { ...match.teamA, name: "A사이드", teamId: "", players: teamAPlayerIds, playerTeams: {} },
      teamB: { ...match.teamB, name: "B사이드", teamId: "", players: teamBPlayerIds, playerTeams: {} },
      playedPlayerIds: { teamA: teamAPlayerIds, teamB: teamBPlayerIds },
      reservePlayers: { teamA: [], teamB: [] },
      agreements: { teamA: teamAPlayerIds, teamB: teamBPlayerIds },
      approvals: { teamA: [], teamB: [] },
      statRecorders: {},
      rules: {
        ...(match.rules ?? {}),
        recordSetupReady: true,
        recordApprovalMode: { teamA: "all", teamB: "all" },
        recordApproverIds: { teamA: teamAPlayerIds, teamB: teamBPlayerIds },
        participantAcceptedIds: [],
        rosterReady: { teamA: true, teamB: true },
        playedPlayerIds: { teamA: teamAPlayerIds, teamB: teamBPlayerIds },
        reservePlayers: { teamA: [], teamB: [] },
        statRecorders: {},
      },
      updatedAt: now,
    };
  } else {
    const teamA = (state.teams ?? []).find((team) => team.id === setup.teamAId);
    const teamB = (state.teams ?? []).find((team) => team.id === setup.teamBId && team.id !== teamA?.id);
    if (!teamA || !teamB || !getTeamMemberIds(teamA).includes(state.currentUserId)) return state;
    const teamACaptainId = getTeamCaptainId(state.teams, teamA.id);
    const teamBCaptainId = getTeamCaptainId(state.teams, teamB.id);
    if (!teamACaptainId || !teamBCaptainId || teamACaptainId === teamBCaptainId) return state;
    targetIds = [teamACaptainId, teamBCaptainId];
    nextMatch = {
      ...match,
      teamA: { ...match.teamA, name: teamA.name, teamId: teamA.id, players: [teamACaptainId], playerTeams: { [teamACaptainId]: teamA.id } },
      teamB: { ...match.teamB, name: teamB.name, teamId: teamB.id, players: [teamBCaptainId], playerTeams: { [teamBCaptainId]: teamB.id } },
      playedPlayerIds: { teamA: [], teamB: [] },
      reservePlayers: { teamA: [], teamB: [] },
      agreements: { teamA: [teamACaptainId], teamB: [teamBCaptainId] },
      approvals: { teamA: [], teamB: [] },
      statRecorders: {},
      rules: {
        ...(match.rules ?? {}),
        recordSetupReady: false,
        recordApprovalMode: { teamA: "all", teamB: "all" },
        recordApproverIds: { teamA: [], teamB: [] },
        participantAcceptedIds: [],
        rosterReady: { teamA: false, teamB: false },
        playedPlayerIds: { teamA: [], teamB: [] },
        reservePlayers: { teamA: [], teamB: [] },
        statRecorders: {},
      },
      updatedAt: now,
    };
  }

  nextMatch = withEffectiveMatchStatRecorders(nextMatch);
  const notificationTitle = composition === "team" ? "팀 경기 기록 확인" : "경기 기록 확인 요청";
  const notificationBody = composition === "team"
    ? `${match.title} 기록방의 팀 명단을 확인해 주세요.`
    : `${match.title} 기록방에 참가자로 등록됐습니다. 기록 입력 후 최종 확인이 필요합니다.`;
  const notifications = targetIds
    .filter((playerId) => playerId && playerId !== state.currentUserId)
    .map((playerId) => ({
      id: makeId("n"),
      title: notificationTitle,
      body: notificationBody,
      tone: "match",
      type: "match_record_setup",
      actionRequired: true,
      homeAction: true,
      targetUserId: playerId,
      fromUserId: state.currentUserId,
      matchId,
      discordEvent: "match",
      webPath: `/app/recorder?match=${encodeURIComponent(matchId)}`,
      createdAt: now,
      updatedAt: now,
    }));

  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
    notifications: [...notifications, ...(state.notifications ?? [])],
  };
}

export function setMatchRecordTeamRoster(state, matchId, sideName, roster = {}) {
  const sourceMatch = state.matches.find((item) => item.id === matchId);
  if (!currentUserCanEditMatchRecordSideRoster(state, sourceMatch, sideName)) return state;
  const tournamentPregame = Boolean(sourceMatch.tournamentId && !sourceMatch.startedAt && !sourceMatch.endedAt);
  let match = sourceMatch;
  if (tournamentPregame && match.rules?.tournamentSideAssignmentLocked !== true) {
    const organizerId = match.rules?.tournamentOrganizerId || match.createdBy || "";
    const hostPlayerId = getTeamCaptainId(state.teams, match[sideName]?.teamId);
    if (!hostPlayerId) return state;
    if (sideName === "teamB") match = swapTournamentMatchSides(match);
    sideName = "teamA";
    match = {
      ...match,
      createdBy: hostPlayerId,
      rules: {
        ...(match.rules ?? {}),
        tournamentOrganizerId: organizerId,
        tournamentSideAssignmentLocked: true,
        tournamentHostSide: "teamA",
        tournamentHostTeamId: match.teamA?.teamId ?? "",
        tournamentHostPlayerId: hostPlayerId,
      },
    };
  }
  const side = match[sideName] ?? {};
  const team = state.teams.find((item) => item.id === side.teamId);
  if (!team) return state;

  const sideCapacity = getRecruitingSideCapacity(match);
  const benchCapacity = getRecruitingBenchCapacity(match);
  const eligibility = getTeamEventEligibility(team, state.users, {
    capacity: sideCapacity,
    ranked: match.ranked,
    mmrLimitMode: match.rules?.mmrLimitMode ?? match.mmrLimitMode,
    mmrRangeMode: match.rules?.mmrRangeMode,
    targetMmr: team.mmr,
    allowedAgeGroups: match.rules?.allowedAgeGroups,
  });
  const snapshotEligibleIds = match.rules?.teamRosterSnapshot?.teams?.[team.id]?.eligiblePlayerIds;
  const allowedIds = new Set(tournamentPregame
    ? (Array.isArray(snapshotEligibleIds) ? snapshotEligibleIds : eligibility.eligiblePlayerIds)
    : getTeamMemberIds(team));
  const otherSideName = sideName === "teamA" ? "teamB" : "teamA";
  const otherRosterIds = new Set([
    ...(match[otherSideName]?.players ?? []),
    ...getMatchReservePlayerIds(match, otherSideName),
  ]);
  const normalizeRosterIds = (ids = []) => uniquePlayerIds(ids)
    .filter((playerId) => allowedIds.has(playerId) && !otherRosterIds.has(playerId));
  const nextActiveIds = normalizeRosterIds(roster.playerIds).slice(0, sideCapacity);
  const nextReserveIds = normalizeRosterIds(roster.reservePlayerIds)
    .filter((playerId) => !nextActiveIds.includes(playerId))
    .slice(0, benchCapacity);
  const leaderId = tournamentPregame
    ? getTeamCaptainId(state.teams, team.id)
    : getMatchSideLeaderId(match, state.teams, sideName);
  const matchRecordRoom = isMatchRecordMatch(match);
  if ((tournamentPregame || matchRecordRoom) && nextActiveIds.length !== sideCapacity) return state;
  if (matchRecordRoom && nextReserveIds.length) return state;
  if (!tournamentPregame && leaderId && ![...nextActiveIds, ...nextReserveIds].includes(leaderId)) return state;

  const previousRosterIds = uniquePlayerIds([
    ...(match[sideName]?.players ?? []),
    ...getMatchReservePlayerIds(match, sideName),
  ]);
  const nextRosterIds = new Set([...nextActiveIds, ...nextReserveIds]);
  const tournamentHostPlayerId = tournamentPregame ? match.rules?.tournamentHostPlayerId ?? "" : "";
  const tournamentHostTeamId = tournamentPregame ? match.rules?.tournamentHostTeamId ?? "" : "";
  const nextPlayerTeams = Object.fromEntries(
    Object.entries(side.playerTeams ?? {}).filter(([playerId]) => nextRosterIds.has(playerId)),
  );
  nextRosterIds.forEach((playerId) => {
    nextPlayerTeams[playerId] = team.id;
  });
  const rosterSavedAt = new Date().toISOString();
  const nextReservePlayers = {
    ...(match.reservePlayers ?? {}),
    [sideName]: nextReserveIds,
  };
  let nextMatch = {
    ...match,
    [sideName]: {
      ...side,
      players: nextActiveIds,
      playerTeams: nextPlayerTeams,
    },
    reservePlayers: nextReservePlayers,
    rules: tournamentPregame ? {
      ...(match.rules ?? {}),
      rosterReady: {
        ...(match.rules?.rosterReady ?? {}),
        [sideName]: true,
      },
      rosterReadyAt: {
        ...(match.rules?.rosterReadyAt ?? {}),
        [sideName]: rosterSavedAt,
      },
      lineupDeadlineState: "pending",
      lineupDeadlineCheckedAt: null,
      tournamentHostRosterSelected: tournamentHostPlayerId && team.id === tournamentHostTeamId
        ? nextRosterIds.has(tournamentHostPlayerId)
        : match.rules?.tournamentHostRosterSelected === true,
    } : matchRecordRoom ? {
      ...(match.rules ?? {}),
      rosterReady: {
        ...(match.rules?.rosterReady ?? {}),
        [sideName]: true,
      },
      rosterReadyAt: {
        ...(match.rules?.rosterReadyAt ?? {}),
        [sideName]: rosterSavedAt,
      },
      recordSetupReady: Boolean(
        sideName === "teamA"
          ? match.rules?.rosterReady?.teamB === true
          : match.rules?.rosterReady?.teamA === true
      ),
      recordApprovalMode: { teamA: "all", teamB: "all" },
      recordApproverIds: {
        ...(match.rules?.recordApproverIds ?? {}),
        [sideName]: nextActiveIds,
      },
      participantAcceptedIds: [],
      playedPlayerIds: {
        ...(match.rules?.playedPlayerIds ?? match.playedPlayerIds ?? {}),
        [sideName]: nextActiveIds,
      },
      reservePlayers: nextReservePlayers,
    } : match.rules,
    playedPlayerIds: matchRecordRoom ? {
      ...(match.playedPlayerIds ?? {}),
      [sideName]: nextActiveIds,
    } : match.playedPlayerIds,
  };
  previousRosterIds
    .filter((playerId) => !nextRosterIds.has(playerId))
    .forEach((playerId) => {
      nextMatch = clearMatchPlayerDecision(nextMatch, playerId);
  });
  nextMatch = withEffectiveMatchStatRecorders(nextMatch);
  const resolvedNotifications = (state.notifications ?? []).map((notification) => (
    tournamentPregame &&
    notification.type === "tournament_match_schedule" &&
    notification.matchId === matchId &&
    notification.targetUserId === state.currentUserId
      ? { ...notification, readAt: rosterSavedAt, actionRequired: false, homeAction: false }
      : notification
  ));

  const recordAssignmentNotifications = matchRecordRoom
    ? nextActiveIds
      .filter((playerId) => !previousRosterIds.includes(playerId) && playerId !== state.currentUserId)
      .map((playerId) => ({
        id: makeId("n"),
        title: "팀 경기 기록 명단",
        body: `${match.title} ${SIDE_LABEL_TEXT[sideName] ?? "사이드"} 출전 명단에 등록됐습니다. 기록을 확인해 주세요.`,
        tone: "match",
        type: "match_record_roster",
        targetUserId: playerId,
        matchId,
        discordEvent: "match",
        webPath: `/app/recorder?match=${encodeURIComponent(matchId)}`,
        createdAt: rosterSavedAt,
      }))
    : [];

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: tournamentPregame ? [
      ...[...nextActiveIds, ...nextReserveIds].map((playerId) => ({
        id: makeId("n"),
        title: "대회 출전 명단",
        body: `${match.title} ${sideName === "teamA" ? "A" : "B"}사이드 명단에 배정됐습니다.`,
        tone: "match",
        type: "tournament_roster_assignment",
        discordEvent: "match",
        targetUserId: playerId,
        matchId,
        tournamentId: match.tournamentId,
        webPath: `/app/matches?match=${encodeURIComponent(matchId)}`,
        createdAt: rosterSavedAt,
      })),
      ...resolvedNotifications,
    ] : [...recordAssignmentNotifications, ...resolvedNotifications],
  };
}

function autoPromoteMatchReservesForCheckin(match = {}, excludedPlayerIds = []) {
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return match;
  const excludedIds = new Set(excludedPlayerIds);
  const sideCapacity = getRecruitingSideCapacity(match);
  let nextMatch = match;

  for (const sideName of MATCH_SIDES) {
    let activeIds = uniquePlayerIds(nextMatch[sideName]?.players ?? []);
    while (activeIds.length < sideCapacity) {
      const attendance = getMatchAttendance(nextMatch);
      const reserveId = getMatchReservePlayerIds(nextMatch, sideName).find((playerId) => (
        !excludedIds.has(playerId) && attendance[sideName].includes(playerId)
      ));
      if (!reserveId) break;

      const playerTeams = { ...(nextMatch[sideName]?.playerTeams ?? {}) };
      const teamId = getMatchPlayerTeamId(nextMatch, sideName, reserveId);
      if (teamId) playerTeams[reserveId] = teamId;
      activeIds = uniquePlayerIds([...activeIds, reserveId]);
      nextMatch = {
        ...nextMatch,
        [sideName]: {
          ...(nextMatch[sideName] ?? {}),
          players: activeIds,
          playerTeams,
        },
        reservePlayers: {
          ...(nextMatch.reservePlayers ?? {}),
          [sideName]: getMatchReservePlayerIds(nextMatch, sideName).filter((playerId) => playerId !== reserveId),
        },
        parties: updateMatchPartiesForPlayer(nextMatch, reserveId, sideName, false),
        promotedReserveIds: {
          ...(nextMatch.promotedReserveIds ?? {}),
          [sideName]: uniquePlayerIds([...(nextMatch.promotedReserveIds?.[sideName] ?? []), reserveId]),
        },
      };
    }
  }

  return withEffectiveMatchStatRecorders(nextMatch);
}

export function setMatchRoomPlayerPlacement(state, matchId, playerId, placement = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditMatchPreparation(state, match) || !playerId) return state;
  const currentPlacement = getMatchPlayerPlacement(match, playerId);
  if (!currentPlacement) return state;
  const targetSide = MATCH_SIDES.includes(placement.side) ? placement.side : currentPlacement.side;
  const targetReserve = Boolean(placement.reserve);
  const pickupRoom = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  const hostPlayerId = getMatchHostPlayerId(state, match);
  if (!pickupRoom && hostPlayerId && playerId === hostPlayerId && targetSide !== currentPlacement.side) return state;
  const sideCapacity = getRecruitingSideCapacity(match);
  const teamMatchLocked = Boolean(
    isMatchSideTeamParty(match, "teamA") ||
    isMatchSideTeamParty(match, "teamB") ||
    (match.parties ?? []).some((party) => isMatchPartyTeamParty(party))
  );
  if (teamMatchLocked && targetSide !== currentPlacement.side) return state;

  const baseTeamAPlayers = uniquePlayerIds(match.teamA?.players ?? []).filter((id) => id !== playerId);
  const baseTeamBPlayers = uniquePlayerIds(match.teamB?.players ?? []).filter((id) => id !== playerId);
  const nextReservePlayers = {
    teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
    teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
  };
  const nextTeamAPlayers = targetSide === "teamA" && !targetReserve ? uniquePlayerIds([...baseTeamAPlayers, playerId]) : baseTeamAPlayers;
  const nextTeamBPlayers = targetSide === "teamB" && !targetReserve ? uniquePlayerIds([...baseTeamBPlayers, playerId]) : baseTeamBPlayers;
  if (targetReserve) nextReservePlayers[targetSide] = uniquePlayerIds([...nextReservePlayers[targetSide], playerId]);
  if (nextTeamAPlayers.length > sideCapacity || nextTeamBPlayers.length > sideCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "출전 이동 불가",
          body: "해당 사이드 출전 슬롯이 가득 찼습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const movedMatch = {
    ...match,
    status: "agreed",
    teamA: { ...(match.teamA ?? {}), players: nextTeamAPlayers },
    teamB: { ...(match.teamB ?? {}), players: nextTeamBPlayers },
    reservePlayers: nextReservePlayers,
    parties: updateMatchPartiesForPlayer(match, playerId, targetSide, targetReserve),
    agreedAt: null,
    ...(pickupRoom ? {
      attendance: Object.fromEntries(MATCH_SIDES.map((sideName) => [
        sideName,
        uniquePlayerIds([
          ...(match.attendance?.[sideName] ?? []).filter((id) => id !== playerId),
          ...(sideName === targetSide && MATCH_SIDES.some((candidateSide) => (match.attendance?.[candidateSide] ?? []).includes(playerId)) ? [playerId] : []),
        ]),
      ])),
      agreements: Object.fromEntries(MATCH_SIDES.map((sideName) => [
        sideName,
        uniquePlayerIds([
          ...(match.agreements?.[sideName] ?? []).filter((id) => id !== playerId),
          ...(sideName === targetSide && MATCH_SIDES.some((candidateSide) => (match.agreements?.[candidateSide] ?? []).includes(playerId)) ? [playerId] : []),
        ]),
      ])),
      rules: {
        ...(match.rules ?? {}),
        sideAssignmentStatus: "draft",
        sideAssignmentConfirmedAt: null,
        sideAssignmentConfirmedBy: null,
      },
    } : {}),
  };
  const nextMatch = withEffectiveMatchStatRecorders(autoPromoteMatchReservesForCheckin(
    pickupRoom ? movedMatch : clearMatchPlayerDecision(movedMatch, playerId),
    targetReserve ? [playerId] : [],
  ));

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
  };
}

export function removeMatchRoomPlayer(state, matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditMatchPreparation(state, match) || !playerId || playerId === state.currentUserId) return state;
  const placement = getMatchPlayerPlacement(match, playerId);
  if (!placement) return state;

  const nextReservePlayers = {
    teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
    teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
  };
  const nextMatch = withEffectiveMatchStatRecorders(autoPromoteMatchReservesForCheckin(clearMatchPlayerDecision({
    ...match,
    status: "agreed",
    teamA: { ...(match.teamA ?? {}), players: uniquePlayerIds(match.teamA?.players ?? []).filter((id) => id !== playerId) },
    teamB: { ...(match.teamB ?? {}), players: uniquePlayerIds(match.teamB?.players ?? []).filter((id) => id !== playerId) },
    reservePlayers: nextReservePlayers,
    parties: updateMatchPartiesForPlayer(match, playerId, placement.side, placement.reserve, true),
    agreedAt: null,
  }, playerId)));

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "미출석 인원 강퇴",
        body: "경기준비방에서 미출석 인원을 정리했습니다.",
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function cancelRecruitingParticipation(state, postId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  const currentUserId = state.currentUserId;
  const removeUserFromRoomState = (roomState = {}, applicants = [], playerIds = []) => {
    const normalizedRoomState = normalizeRecruitingRoomState(roomState);
    const nextPartyReserves = Object.fromEntries(
      Object.entries(normalizedRoomState.partyReserves ?? {})
        .map(([key, ids]) => [key, ids.filter((playerId) => playerId !== currentUserId)])
        .filter(([, ids]) => ids.length),
    );
    const nextPinnedReservePlayers = Object.fromEntries(
      Object.entries(normalizedRoomState.pinnedReservePlayers ?? {})
        .map(([sideName, ids]) => [sideName, ids.filter((playerId) => playerId !== currentUserId)])
        .filter(([, ids]) => ids.length),
    );
    const nextReserveReady = { ...(normalizedRoomState.reserveReady ?? {}) };
    const nextSlotPositions = { ...(normalizedRoomState.slotPositions ?? {}) };
    const nextPartyLeaders = { ...(normalizedRoomState.partyLeaders ?? {}) };
    delete nextReserveReady[currentUserId];
    delete nextSlotPositions[currentUserId];
    Object.entries(nextPartyLeaders).forEach(([key, leaderId]) => {
      if (leaderId !== currentUserId) return;
      const applicant = applicants.find((item) => getRecruitingApplicantKey(item) === key);
      const nextLeaderId = key === "host"
        ? playerIds.find((playerId) => playerId !== currentUserId)
        : applicant?.playerId ?? applicant?.playerIds?.find((playerId) => playerId !== currentUserId) ?? "";
      if (nextLeaderId) nextPartyLeaders[key] = nextLeaderId;
      else delete nextPartyLeaders[key];
    });
    return {
      ...normalizedRoomState,
      partyReserves: nextPartyReserves,
      partyLeaders: nextPartyLeaders,
      pinnedReservePlayers: nextPinnedReservePlayers,
      reserveReady: nextReserveReady,
      slotPositions: nextSlotPositions,
      invitations: normalizedRoomState.invitations.filter((invitation) => !(
        invitation.status === "pending" && invitation.fromUserId === currentUserId
      )),
    };
  };

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => {
      if (item.id !== postId) return item;
      const applicants = normalizeRecruitingApplicants(item.applicants ?? [])
        .map((applicant) => {
          if (applicant.kind !== "team") return applicant.playerId === currentUserId ? null : applicant;
          const nextPlayerIds = (applicant.playerIds ?? []).filter((playerId) => playerId !== currentUserId);
          if (!nextPlayerIds.length) return null;
          return {
            ...applicant,
            playerIds: nextPlayerIds,
            playerId: applicant.playerId && applicant.playerId !== currentUserId ? applicant.playerId : nextPlayerIds[0],
          };
        })
        .filter(Boolean);
      const playerIds = Array.isArray(item.playerIds)
        ? item.playerIds.filter((playerId) => playerId !== currentUserId)
        : [];
      return cleanRecruitingRoomStatRecorders({
        ...item,
        playerIds,
        roomState: removeUserFromRoomState(item.roomState ?? {}, applicants, playerIds),
        applicants,
      }, state);
    }),
  };
}

export function sendRecruitingChat(state, postId, body = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "방 채팅");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  const text = String(body).trim();
  if (text.includes("\n") || text.includes("\r") || getUnsafeUserTextReason(text, { maxLength: 60 })) return state;
  if (!post || !text || !isRecruitingRoomMember(post, state.currentUserId, state)) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const message = {
    id: makeId("chat"),
    userId: state.currentUserId,
    body: text,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, roomState: { ...roomState, chatMessages: [...roomState.chatMessages, message] } }
        : item
    )),
  };
}

export function inviteRecruitingPlayers(state, postId, invite = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "매칭방 초대");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (!isRecruitingRoomParticipant(post, state.currentUserId, state)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "초대 권한 없음",
          body: "방에 참여한 사람만 빈 슬롯이나 후보를 초대할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const side = MATCH_SIDES.includes(invite.side) ? invite.side : "teamB";
  const reserve = Boolean(invite.reserve);
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const playerOnlyRoom = isIndividualOnlyRecruitingRoom(post);
  const teamOnly = isTeamOnlyRecruitingRoom({ ...post, roomState });
  const sideTeamId = getLobbyPrimaryTeamId(lobby, side);
  const requestedTargetIds = Array.from(new Set(invite.playerIds ?? [invite.playerId])).filter(Boolean);
  if (teamOnly) {
    if (!sideTeamId) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "초대 제한",
            body: "팀으로만 참여 방은 해당 사이드가 팀으로 점유된 뒤 같은 팀원만 초대할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    const sideTeam = state.teams.find((team) => team.id === sideTeamId);
    const sideTeamMemberIds = new Set((sideTeam?.members ?? []).map((member) => member.userId));
    const inviterInSideTeam = sideTeamMemberIds.has(state.currentUserId);
    const targetsInSideTeam = requestedTargetIds.every((playerId) => sideTeamMemberIds.has(playerId));
    const inviteTeamMatches = !invite.teamId || invite.teamId === sideTeamId;
    if (!inviterInSideTeam || !targetsInSideTeam || !inviteTeamMatches) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "초대 제한",
            body: "팀으로만 참여 방은 해당 사이드를 점유한 팀원만 같은 팀원을 초대할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    const rosterResult = applyTeamOnlyRosterSummon(state, post, roomState, lobby, side, reserve, requestedTargetIds, sideTeamId);
    if (rosterResult.handled) {
      return rosterResult.notification
        ? { ...rosterResult.state, notifications: [rosterResult.notification, ...(rosterResult.state.notifications ?? [])] }
        : rosterResult.state;
    }
  }
  const existingPlayerIds = new Set([
    post.playerId,
    ...lobby.entries.flatMap((entry) => [entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])]),
    ...roomState.invitations
      .filter((invitation) => invitation.status === "pending")
      .map((invitation) => invitation.targetUserId),
  ].filter(Boolean));
  const targetUserIds = requestedTargetIds
    .filter((playerId) => state.users.some((user) => user.id === playerId))
    .filter((playerId) => !existingPlayerIds.has(playerId));

  if (!targetUserIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "초대 대상 없음",
          body: "이미 방에 있거나 초대된 선수입니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const mmrLimitMode = normalizeRecruitingMmrLimitMode(post.mmrLimitMode ?? roomState.mmrLimitMode);
  if (mmrLimitMode === "block") {
    const outOfRangeUser = targetUserIds
      .map((playerId) => state.users.find((user) => user.id === playerId))
      .find((targetUser) => targetUser && !getRecruitingFit(post, targetUser.ratings?.integrated ?? DEFAULT_RATING, state).allowed);
    if (outOfRangeUser) {
      const fit = getRecruitingFit(post, outOfRangeUser.ratings?.integrated ?? DEFAULT_RATING, state);
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "티어 구간 제한",
            body: `${outOfRangeUser.name} 선수는 ${fit.range.label} 구간 밖이라 초대할 수 없습니다.`,
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
  }

  if (reserve) {
    const benchCapacity = getRecruitingBenchCapacity(post);
    const reserveCount = lobby.sides[side]?.reserveCandidates?.length ?? 0;
    const pendingReserveCount = getPendingReserveInvitationCount(roomState, side);
    if (reserveCount + pendingReserveCount + targetUserIds.length > benchCapacity) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side, benchCapacity), ...state.notifications],
      };
    }
  }

  const now = new Date().toISOString();
  const inviteJoinMode = playerOnlyRoom
    ? "player"
    : invite.joinMode === "player" ? "player" : (invite.joinMode === "team" || invite.teamId ? "team" : "");
  const newInvitations = targetUserIds.map((targetUserId) => ({
    id: makeId("inv"),
    role: "player",
    targetUserId,
    fromUserId: state.currentUserId,
    teamId: inviteJoinMode === "player" ? null : invite.teamId || inferSidePartyTeamIdForUser(post, state, side, targetUserId),
    joinMode: inviteJoinMode,
    side,
    reserve,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }));
  const invitations = [...roomState.invitations, ...newInvitations];

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? { ...item, roomState: { ...roomState, invitations } } : item
    )),
    notifications: [
      ...newInvitations.map((invitation) => ({
        id: makeId("n"),
        title: "매치방 초대",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "빈 슬롯"} 초대장이 도착했습니다.`,
        tone: "match",
        targetUserId: invitation.targetUserId,
        recruitingPostId: postId,
        invitationId: invitation.id,
        fromUserId: invitation.fromUserId,
      })),
      {
        id: makeId("n"),
        title: "초대장 발송",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "빈 슬롯"}에 ${targetUserIds.length}명 초대장을 보냈습니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  };
}

export function inviteRecruitingReferee(state, postId, refereeId) {
  const disciplineBlock = getDisciplineBlockedState(state, "심판 초대");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (!isRecruitingRoomParticipant(post, state.currentUserId, state)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 권한 없음",
          body: "방에 참여한 사람만 심판을 초대할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  if (post.refereeId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 제한",
          body: "이미 배정된 심판이 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const targetUser = state.users.find((user) => user.id === refereeId);
  const participantIds = new Set(getRecruitingRoomParticipantIds(post, state));
  const pendingRefereeInvite = roomState.invitations.some((invitation) => (
    invitation.role === "referee" &&
    invitation.targetUserId === refereeId &&
    invitation.status === "pending"
  ));
  const canInviteReferee = Boolean(
    targetUser &&
    !participantIds.has(refereeId) &&
    !pendingRefereeInvite &&
    isEligibleReferee(targetUser, post.refereeTrustMin ?? REFEREE_TRUST_MIN, state.settings?.refereeAppointments)
  );
  if (!canInviteReferee) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 대상 아님",
          body: "심판 자격이 있고 아직 방에 참여하지 않은 사람만 초대할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const now = new Date().toISOString();
  const invitation = {
    id: makeId("inv"),
    role: "referee",
    targetUserId: refereeId,
    fromUserId: state.currentUserId,
    teamId: null,
    side: "teamB",
    reserve: false,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? {
            ...item,
            refereeWanted: true,
            roomState: {
              ...roomState,
              refereeWanted: true,
              invitations: [...roomState.invitations, invitation],
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "심판 초대",
        body: `${post.title} 심판 초대가 도착했습니다. 수락하면 심판으로 배정됩니다.`,
        tone: "match",
        targetUserId: refereeId,
        recruitingPostId: postId,
        invitationId: invitation.id,
        fromUserId: invitation.fromUserId,
      },
      {
        id: makeId("n"),
        title: "심판 초대 발송",
        body: `${targetUser.name}에게 심판 초대를 보냈습니다.`,
        tone: "match",
        recruitingPostId: postId,
      },
      ...state.notifications,
    ],
  };
}

function makeRecruitingTeamNoticeNotifications({ post, team, side, acceptedBy, acceptedByName, now } = {}) {
  if (!post?.id || !team?.id) return [];
  const leaderName = acceptedByName || acceptedBy || "팀 대표";
  const memberIds = getTeamMemberIds(team).filter((userId) => userId && userId !== acceptedBy);
  return memberIds.map((targetUserId) => ({
    id: makeId("n"),
    title: "팀전 참여 알림",
    body: `${team.name} 팀이 ${post.title} ${SIDE_LABEL_TEXT[side]} 초대를 수락했습니다. 대표: ${leaderName}. 출전 명단은 방에서 확정됩니다.`,
    tone: "match",
    targetUserId,
    recruitingPostId: post.id,
    discordEvent: "match",
    createdAt: now,
    updatedAt: now,
  }));
}

function expirePendingPlayerInvitationsForFilledRoom(post, state, now) {
  const lobby = getRecruitingLobby(post, state);
  const occupiedCount = MATCH_SIDES.reduce((total, side) => (
    total
    + (lobby.sides[side]?.filled ?? 0)
    + (lobby.sides[side]?.reserveCandidates?.length ?? 0)
  ), 0);
  const capacity = MATCH_SIDES.reduce((total, side) => (
    total + (lobby.sides[side]?.capacity ?? getRecruitingSideCapacity(post)) + getRecruitingBenchCapacity(post)
  ), 0);
  const roomFilledNow = capacity > 0
    && occupiedCount >= capacity
    && !post.roomState?.playerCapacityFilledAt;
  if (!roomFilledNow) return { post, notifications: [] };

  const expiredInvitations = (post.roomState?.invitations ?? []).filter((candidate) => (
    candidate.role !== "referee" && candidate.status === "pending"
  ));
  const ownerId = getRecruitingRoomOwnerId(post);
  return {
    post: {
      ...post,
      roomState: {
        ...post.roomState,
        playerCapacityFilledAt: now,
        invitations: expirePendingPlayerInvitationsWhenFull(
          post.roomState?.invitations ?? [],
          { occupiedCount, capacity, now },
        ),
      },
    },
    notifications: [
      ...expiredInvitations.map((candidate) => ({
        id: makeId("n"),
        title: "초대 종료",
        body: `${post.title} 초대받은 방의 출전·후보 슬롯이 모두 찼습니다.`,
        tone: "orange",
        targetUserId: candidate.targetUserId,
        recruitingPostId: post.id,
        invitationId: candidate.id,
        createdAt: now,
        updatedAt: now,
      })),
      ...(ownerId ? [{
        id: makeId("n"),
        title: "방 정원 충족",
        body: `${post.title} 정원이 모두 찼습니다. 방을 확인하고 경기를 확정해 주세요.`,
        tone: "match",
        targetUserId: ownerId,
        recruitingPostId: post.id,
        createdAt: now,
        updatedAt: now,
      }] : []),
    ],
  };
}

export function acceptRecruitingInvitation(state, postId, invitationId) {
  const disciplineBlock = getDisciplineBlockedState(state, "초대 수락");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  if (isRoomScheduleChangePending(post)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications] };
  }
  const publicRoomDisciplineBlock = getPublicRoomDisciplineBlockedState(state, post);
  if (publicRoomDisciplineBlock) return publicRoomDisciplineBlock;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const invitation = roomState.invitations.find((item) => (
    item.id === invitationId &&
    item.targetUserId === state.currentUserId &&
    item.status === "pending"
  ));
  if (!invitation) return state;
  const invitationOwnerId = getRecruitingRoomOwnerId(post) || invitation.fromUserId || post.playerId || "";

  if (invitation.role === "referee") {
    const expireRefereeInvitation = (body) => ({
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId
          ? {
              ...item,
              roomState: {
                ...roomState,
                invitations: roomState.invitations.map((candidate) => (
                  candidate.id === invitationId ? { ...candidate, status: "expired", updatedAt: new Date().toISOString() } : candidate
                )),
              },
            }
          : item
      )),
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 만료",
          body,
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    });
    if (post.refereeId) return expireRefereeInvitation("이미 배정된 심판이 있습니다.");
    if (!currentUserCanRefereeRecruitingRoom(state, post)) {
      return expireRefereeInvitation("심판 권한이 있고 경기 참가자가 아닌 계정만 심판 초대를 수락할 수 있습니다.");
    }
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId
          ? {
              ...item,
              refereeWanted: true,
              refereeId: state.currentUserId,
              roomState: {
                ...roomState,
                refereeWanted: true,
                invitations: removeAcceptedRecruitingInvitations(roomState.invitations, invitation, state.currentUserId),
              },
            }
          : item
      )),
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 수락",
          body: `${post.title} 심판으로 배정됐습니다.`,
          tone: "match",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const user = state.users.find((item) => item.id === state.currentUserId);
  const invitationTeamId = isIndividualOnlyRecruitingRoom(post)
    ? ""
    : inferRecruitingInvitationTeamId(post, state, invitation);
  const invitedTeam = invitationTeamId
    ? state.teams.find((team) => team.id === invitationTeamId && team.members.some((member) => member.userId === state.currentUserId))
    : null;
  const candidateMmr = invitedTeam
    ? invitedTeam.mmr ?? user?.ratings?.integrated ?? DEFAULT_RATING
    : user?.ratings?.integrated ?? DEFAULT_RATING;
  const fit = getRecruitingFit(post, candidateMmr, state);
  const mmrLimitMode = normalizeRecruitingMmrLimitMode(post.mmrLimitMode ?? roomState.mmrLimitMode);
  const expireInvitation = (body) => ({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? {
            ...item,
            roomState: {
              ...roomState,
              invitations: roomState.invitations.map((candidate) => (
                candidate.id === invitationId ? { ...candidate, status: "expired", updatedAt: new Date().toISOString() } : candidate
              )),
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "초대 수락 실패",
        body,
        tone: "orange",
      },
      ...state.notifications,
    ],
  });

  if (mmrLimitMode === "block" && !fit.allowed) {
    return expireInvitation(`${post.title} 정규전은 ${fit.range.label} 구간만 대기할 수 있습니다.`);
  }

  const lobby = getRecruitingLobby(post, state);
  const side = MATCH_SIDES.includes(invitation.side) ? invitation.side : getRecruitingBestSide(post, state);
  const benchCapacity = getRecruitingBenchCapacity(post);
  let reserve = Boolean(invitation.reserve);
  const invitedTeamCapacity = getRecruitingSideCapacity(post);
  const invitedTeamKey = invitedTeam ? `team:${invitedTeam.id}` : "";
  const existingInvitedTeamApplicant = invitedTeam
    ? normalizeRecruitingApplicants(post.applicants ?? []).find((applicant) => getRecruitingApplicantKey(applicant) === invitedTeamKey)
    : null;
  const alreadyInInvitedTeamSlot = existingInvitedTeamApplicant
    ? getExplicitInvitationTeamPlayerIds(
      invitedTeam,
      invitedTeamCapacity,
      existingInvitedTeamApplicant.playerIds,
      existingInvitedTeamApplicant.playerId,
    ).includes(state.currentUserId)
    : false;
  const reserveFull = (lobby.sides[side]?.reserveCandidates?.length ?? 0) >= benchCapacity;
  const activeFull = lobby.sides[side].filled >= lobby.sides[side].capacity && !alreadyInInvitedTeamSlot;
  if (reserve && reserveFull) {
    return expireInvitation(`${SIDE_LABEL_TEXT[side]} 후보가 이미 ${benchCapacity}명입니다.`);
  }
  if (!reserve && activeFull) {
    if (reserveFull) return expireInvitation("출전 슬롯과 후보 슬롯이 모두 찼습니다.");
    reserve = true;
  }

  const now = new Date().toISOString();
  const makeOwnerAcceptNotifications = (body) => (
    invitationOwnerId && invitationOwnerId !== state.currentUserId
      ? [{
          id: makeId("n"),
          title: "초대 수락",
          body,
          tone: "match",
          targetUserId: invitationOwnerId,
          recruitingPostId: postId,
          invitationId,
          createdAt: now,
          updatedAt: now,
        }]
      : []
  );
  if (invitedTeam && !isIndividualOnlyRecruitingRoom(post)) {
    const capacity = invitedTeamCapacity;
    const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
    const teamKey = invitedTeamKey;
    const isHostParty = post.teamId === invitedTeam.id && post.hostJoinMode !== "player";
    const existingApplicant = existingInvitedTeamApplicant;
    const allowedEntryId = existingApplicant?.side === side ? teamKey : "";
    if (hasRecruitingTeamMemberOnOtherSide(post, state, invitedTeam.id, side, allowedEntryId)) {
      return withRecruitingPartySideConflictNotification(state, postId, side);
    }
    const currentPlayerIds = isHostParty
      ? getExplicitInvitationTeamPlayerIds(invitedTeam, capacity, post.playerIds, post.playerId)
      : existingApplicant
        ? getExplicitInvitationTeamPlayerIds(invitedTeam, capacity, existingApplicant.playerIds, existingApplicant.playerId)
          : [];
    const nextPlayerIds = Array.from(new Set([...currentPlayerIds, state.currentUserId])).slice(0, capacity);
    if (!reserve && !nextPlayerIds.includes(state.currentUserId)) {
      return expireInvitation("방이 꽉 찼습니다. 먼저 수락한 선수만 들어갑니다.");
    }

    const reserveKey = isHostParty ? "host" : teamKey;
    const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
    const nextReserveIds = reserve
      ? Array.from(new Set([...currentReserveIds, state.currentUserId]))
      : currentReserveIds.filter((playerId) => playerId !== state.currentUserId);
    const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
    if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
    const nextPartyLeaders = { ...(roomState.partyLeaders ?? {}) };
    if (post.visibility === "private" && post.hostJoinMode === "team" && side === "teamB" && !reserve) {
      nextPartyLeaders[reserveKey] = state.currentUserId;
    }
    const nextRoomState = {
      ...updatePinnedReservePlayers(
        { ...roomState, partyReserves: nextPartyReserves, partyLeaders: nextPartyLeaders },
        side,
        state.currentUserId,
        reserve,
      ),
      invitations: removeAcceptedRecruitingInvitations(roomState.invitations, invitation, state.currentUserId),
    };
    const nextApplicant = existingApplicant
      ? null
      : {
          kind: "team",
          joinMode: "team",
          teamId: invitedTeam.id,
          playerId: state.currentUserId,
          side,
          status: "ready",
          reserve: reserve && !nextPlayerIds.length,
          position: null,
          playerIds: reserve && !nextPlayerIds.length ? [state.currentUserId] : nextPlayerIds,
          createdAt: now,
          updatedAt: now,
        };
    const nextApplicants = isHostParty
      ? applicants
        : existingApplicant
          ? applicants
          .map((applicant) => (
            getRecruitingApplicantKey(applicant) === teamKey
              ? {
                  ...applicant,
                  side: applicant.side ?? side,
                  reserve: reserve ? applicant.reserve : false,
                  status: "ready",
                  playerIds: reserve ? currentPlayerIds : nextPlayerIds,
                  updatedAt: now,
                }
              : applicant
          ))
        : [
            ...applicants,
            nextApplicant,
          ];
    const nextPost = isHostParty
      ? {
          ...post,
          hostReady: true,
          playerIds: reserve ? currentPlayerIds : nextPlayerIds,
          roomState: nextRoomState,
          applicants: nextApplicants,
        }
      : { ...post, applicants: nextApplicants, roomState: nextRoomState };
    if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
      return expireInvitation(`${SIDE_LABEL_TEXT[side]} 후보가 이미 ${benchCapacity}명입니다.`);
    }
    if (!reserve) {
      const nextLobby = getRecruitingLobby(nextPost, state);
      if (nextLobby.sides[side].filled > nextLobby.sides[side].capacity) {
        return expireInvitation("방이 꽉 찼습니다. 먼저 수락한 선수만 들어갑니다.");
      }
    }

    const filledRoomResult = expirePendingPlayerInvitationsForFilledRoom(nextPost, state, now);
    return applyAutomaticRecruitingConfirmations({
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? cleanRecruitingRoomStatRecorders(filledRoomResult.post, state) : item
      )),
      notifications: [
        ...filledRoomResult.notifications,
        ...makeRecruitingTeamNoticeNotifications({
          post,
          team: invitedTeam,
          side,
          acceptedBy: state.currentUserId,
          acceptedByName: user?.name,
          now,
        }),
        ...makeOwnerAcceptNotifications(`${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"} 초대가 수락되었습니다.`),
        {
          id: makeId("n"),
          title: "초대 수락",
          body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"}으로 팀 파티 등록됐습니다.`,
          tone: "match",
        },
        ...state.notifications,
      ],
    });
  }

  const nextApplicant = {
    kind: "player",
    joinMode: "player",
    playerId: state.currentUserId,
    teamId: null,
    side,
    status: "ready",
    reserve,
    position: user?.position ?? null,
    createdAt: now,
    updatedAt: now,
  };
  if (hasRecruitingApplicant(post, nextApplicant)) return state;

  const filledRoomResult = expirePendingPlayerInvitationsForFilledRoom({
    ...post,
    applicants: [...normalizeRecruitingApplicants(post.applicants ?? []), nextApplicant],
    roomState: {
      ...updatePinnedReservePlayers(roomState, side, state.currentUserId, reserve),
      invitations: removeAcceptedRecruitingInvitations(roomState.invitations, invitation, state.currentUserId),
    },
  }, state, now);

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? filledRoomResult.post : item
    )),
    notifications: [
      ...filledRoomResult.notifications,
      ...makeOwnerAcceptNotifications(`${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"} 초대가 수락되었습니다.`),
      {
        id: makeId("n"),
        title: "초대 수락",
        body: `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "출전"}으로 대기 등록됐습니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  });
}

export function declineRecruitingInvitation(state, postId, invitationId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const invitation = roomState.invitations.find((item) => item.id === invitationId && item.targetUserId === state.currentUserId);
  if (!invitation) return state;

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, roomState: { ...roomState, invitations: roomState.invitations.filter((candidate) => candidate.id !== invitationId) } }
        : item
    )),
  };
}

function buildRecruitingTeamAbsorbPost(post, state, applicants, roomState, playerId, sourceTeamId, sourceEntryId = null, placement = {}, updatedAt) {
  if (!sourceTeamId || !playerId) return null;
  if (isIndividualOnlyRecruitingRoom(post)) return null;
  const side = MATCH_SIDES.includes(placement.side) ? placement.side : null;
  if (!side) return null;
  if (hasRecruitingTeamMemberOnOtherSide(post, state, sourceTeamId, side, sourceEntryId ?? "")) return null;
  const reserve = Boolean(placement.reserve);
  const team = (state.teams ?? []).find((item) => item.id === sourceTeamId && item.members.some((member) => member.userId === playerId));
  if (!team) return null;

  const capacity = getRecruitingSideCapacity(post);
  const teamKey = `team:${sourceTeamId}`;
  const hostPlayerInTeam = team.members.some((member) => member.userId === post.playerId);
  const isHostParty = post.teamId === sourceTeamId && post.hostJoinMode !== "player" && (post.hostSide ?? "teamA") === side;
  const canPromoteHostPlayerParty = post.hostJoinMode === "player" && hostPlayerInTeam && (post.hostSide ?? "teamA") === side;
  const targetApplicant = applicants.find((applicant) => getRecruitingApplicantKey(applicant) === teamKey && applicant.side === side);
  const canUseHostParty = sourceEntryId ? sourceEntryId === "host" && (isHostParty || canPromoteHostPlayerParty) : (isHostParty || canPromoteHostPlayerParty);
  const canUseTeamParty = Boolean(targetApplicant) && (!sourceEntryId || sourceEntryId === teamKey || targetApplicant.teamId === sourceTeamId);
  if (!canUseHostParty && !canUseTeamParty) return null;

  const currentPlayerIds = canUseHostParty
    ? canPromoteHostPlayerParty
      ? [post.playerId].filter(Boolean)
      : getSelectedTeamPlayerIds(team, capacity, post.playerIds)
    : getSelectedTeamPlayerIds(team, capacity, targetApplicant.playerIds);
  const nextPlayerIds = reserve
    ? currentPlayerIds.filter((id) => id !== playerId)
    : Array.from(new Set([...currentPlayerIds, playerId])).slice(0, capacity);
  if (!reserve && !nextPlayerIds.includes(playerId)) return null;

  const reserveKey = canUseHostParty ? "host" : teamKey;
  const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
  const nextReserveIds = reserve
    ? Array.from(new Set([...currentReserveIds, playerId]))
    : currentReserveIds.filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    side,
    playerId,
    reserve,
  );
  const nextApplicants = applicants
    .filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`)
    .map((applicant) => (
      !canUseHostParty && getRecruitingApplicantKey(applicant) === teamKey
        ? {
            ...applicant,
            reserve: reserve ? applicant.reserve : false,
            status: getRecruitingSlotEditStatus(post),
            playerIds: reserve ? currentPlayerIds : nextPlayerIds,
            updatedAt,
          }
        : applicant
    ));

  return canUseHostParty
    ? {
        ...post,
        teamId: sourceTeamId,
        hostJoinMode: "team",
        hostReady: getRecruitingHostEditReady(post),
        playerIds: reserve ? currentPlayerIds : nextPlayerIds,
        roomState: nextRoomState,
        applicants: nextApplicants,
      }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };
}

function getRecruitingPartySideConflictNotification(postId, sideName = "") {
  return {
    id: makeId("n"),
    title: "팀 파티 합류 불가",
    body: `같은 팀 파티는 한 사이드에서만 묶을 수 있습니다. ${SIDE_LABEL_TEXT[sideName] ?? "다른 사이드"}로 가려면 먼저 파티에서 나가야 합니다.`,
    tone: "orange",
    recruitingPostId: postId,
  };
}

function withRecruitingPartySideConflictNotification(state, postId, sideName = "") {
  return {
    ...state,
    notifications: [
      getRecruitingPartySideConflictNotification(postId, sideName),
      ...(state.notifications ?? []),
    ],
  };
}

export function setRecruitingApplicantPlacement(state, postId, playerId, placement = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "매칭방 배치");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = applicants.find((applicant) => getRecruitingApplicantKey(applicant) === `player:${playerId}`);
  const hostTarget = playerId === post.playerId;
  const hostSide = post.hostSide ?? "teamA";
  const target = targetApplicant ?? (hostTarget
    ? { side: hostSide, reserve: roomState.hostReserve }
    : null);
  if (!target) return state;
  const requesterControlsTarget = hostTarget
    ? post.playerId === state.currentUserId
    : target.playerId === state.currentUserId || (target.playerIds ?? []).includes(state.currentUserId);
  if (!requesterControlsTarget) return state;

  const explicitRequestedSide = MATCH_SIDES.includes(placement.side) ? placement.side : null;
  if (hostTarget && explicitRequestedSide && explicitRequestedSide !== hostSide) return state;
  const requestedSide = explicitRequestedSide ?? target.side;
  const side = hostTarget ? hostSide : requestedSide;
  const reserve = Boolean(placement.reserve);
  if (!hostTarget && isRecruitingTeamSideLocked(post) && side !== target.side) return state;
  const updatedAt = new Date().toISOString();
  const nextApplicants = hostTarget
    ? applicants
    : applicants.map((applicant) => (
      getRecruitingApplicantKey(applicant) === getRecruitingApplicantKey(targetApplicant)
        ? { ...applicant, side, reserve, status: getRecruitingSlotEditStatus(post), updatedAt }
        : applicant
    ));
  const nextRoomState = updatePinnedReservePlayers(roomState, side, playerId, reserve);
  const nextPost = hostTarget
    ? {
      ...post,
      hostSide: side,
      hostReady: getRecruitingHostEditReady(post),
      roomState: { ...nextRoomState, hostReserve: reserve },
      applicants: nextApplicants,
    }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };

  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  if (!reserve) {
    const lobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(lobby.sides[side].entries.flatMap((entry) => entry.players)).size;
    if (activePlayerCount > lobby.sides[side].capacity) return state;
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
  };
}

export function setRecruitingApplicantReserve(state, postId, playerId, reserve = true) {
  return setRecruitingApplicantPlacement(state, postId, playerId, { reserve });
}

export function setRecruitingSlotPosition(state, postId, playerId, position = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "포지션 변경");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !playerId || playerId !== state.currentUserId) return state;

  const lobby = getRecruitingLobby(post, state);
  const isRoomMember = (lobby.entries ?? []).some((entry) => isRecruitingEntryMember(entry, playerId));
  if (!isRoomMember) return state;

  const normalizedPosition = PLAYER_POSITIONS.includes(position) ? position : "";
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const nextSlotPositions = { ...(roomState.slotPositions ?? {}) };
  if (normalizedPosition) nextSlotPositions[playerId] = normalizedPosition;
  else delete nextSlotPositions[playerId];

  const nextRoomState = { ...roomState, slotPositions: nextSlotPositions };
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? { ...item, roomState: nextRoomState } : item
    )),
  };
}

export function joinRecruitingSideParty(state, postId, teamId, sideName = "", entryId = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "팀 파티 합류");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !teamId) return state;
  if (isRoomScheduleChangePending(post)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications] };
  }
  const publicRoomDisciplineBlock = getPublicRoomDisciplineBlockedState(state, post);
  if (publicRoomDisciplineBlock) return publicRoomDisciplineBlock;
  if (isIndividualOnlyRecruitingRoom(post)) return state;

  const team = state.teams.find((item) => item.id === teamId && item.members.some((member) => member.userId === state.currentUserId));
  if (!team) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const currentApplicant = applicants.find((applicant) => (
    applicant.kind === "player" &&
    applicant.playerId === state.currentUserId &&
    team.members.some((member) => member.userId === applicant.playerId)
  ));
  const lobby = getRecruitingLobby(post, state);
  const teamMemberIds = new Set((team.members ?? []).map((member) => member.userId));
  const requestedSide = MATCH_SIDES.includes(sideName) ? sideName : "";
  const joinableSide = requestedSide || MATCH_SIDES.find((candidateSide) => (
    (lobby.sides[candidateSide]?.entries ?? []).some((entry) => (
      entry.team?.id === teamId ||
      (entry.kind === "player" && teamMemberIds.has(entry.playerId))
    ))
  ));
  if (!currentApplicant && !joinableSide) return state;

  const side = joinableSide || currentApplicant.side;
  if (hasRecruitingTeamMemberOnOtherSide(post, state, teamId, side, entryId)) {
    return withRecruitingPartySideConflictNotification(state, postId, side);
  }
  const sideEntries = lobby.sides[side]?.entries ?? [];
  const targetEntry = entryId
    ? sideEntries.find((entry) => entry.id === entryId)
    : sideEntries.find((entry) => entry.fixed && entry.team?.id === teamId) ?? null;
  const targetEntryIsSameTeamPlayer = Boolean(
    (
      targetEntry?.kind === "player" &&
      targetEntry.playerId &&
      teamMemberIds.has(targetEntry.playerId)
    ) ||
    (targetEntry?.fixed && targetEntry.team?.id === teamId),
  );
  const partyEntries = sideEntries.filter((entry) => (
    entry.team?.id === teamId &&
    isRecruitingPartyEntry(entry)
  ));
  const partyEntry = partyEntries.find((entry) => entry.id === entryId) ?? partyEntries[0] ?? null;
  const updatedAt = new Date().toISOString();
  const capacity = getRecruitingSideCapacity(post);
  const sideProjectedFilled = lobby.sides[side]?.projectedFilled ?? 0;
  const currentUserReserve = currentApplicant
    ? Boolean(currentApplicant.reserve && sideProjectedFilled >= capacity)
    : sideProjectedFilled >= capacity;

  if (partyEntry) {
    if ((partyEntry.reserves ?? []).includes(state.currentUserId)) {
      return setRecruitingPartyPlayerReserve(state, postId, partyEntry.id, state.currentUserId, false);
    }
    const absorbedPost = buildRecruitingTeamAbsorbPost(
      post,
      state,
      applicants,
      roomState,
      state.currentUserId,
      teamId,
      partyEntry.id,
      { side, reserve: currentUserReserve },
      updatedAt,
    );
    if (!absorbedPost) return state;
    const nextLobby = getRecruitingLobby(absorbedPost, state);
    if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
    if (isRecruitingReserveLimitExceeded(absorbedPost, state, side)) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
      };
    }
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? cleanRecruitingRoomStatRecorders(absorbedPost, state) : item
      )),
    };
  }

  if (targetEntry?.fixed && targetEntryIsSameTeamPlayer) {
    const absorbedPost = buildRecruitingTeamAbsorbPost(
      post,
      state,
      applicants,
      roomState,
      state.currentUserId,
      teamId,
      targetEntry.id,
      { side, reserve: currentUserReserve },
      updatedAt,
    );
    if (!absorbedPost) return state;
    const nextLobby = getRecruitingLobby(absorbedPost, state);
    if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
    if (isRecruitingReserveLimitExceeded(absorbedPost, state, side)) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
      };
    }
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? cleanRecruitingRoomStatRecorders(absorbedPost, state) : item
      )),
    };
  }

  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const mergeApplicants = currentApplicant
    ? applicants
    : [
        ...applicants,
        {
          kind: "player",
          joinMode: "player",
          playerId: state.currentUserId,
          teamId: null,
          side,
          status: "ready",
          reserve: currentUserReserve,
          position: currentUser?.position ?? null,
          createdAt: updatedAt,
          updatedAt,
        },
      ];
  const sameTeamApplicants = mergeApplicants.filter((applicant) => (
    applicant.kind === "player" &&
    applicant.side === side &&
    team.members.some((member) => member.userId === applicant.playerId)
  ));
  if (sameTeamApplicants.length < 2) return state;

  const activePlayerIds = sameTeamApplicants
    .filter((applicant) => !applicant.reserve)
    .map((applicant) => applicant.playerId)
    .slice(0, capacity);
  if (!activePlayerIds.length) return state;

  const reservePlayerIds = sameTeamApplicants
    .filter((applicant) => applicant.reserve || !activePlayerIds.includes(applicant.playerId))
    .map((applicant) => applicant.playerId);
  const teamKey = `team:${teamId}`;
  const nextPartyReserves = { ...roomState.partyReserves, [teamKey]: Array.from(new Set(reservePlayerIds)) };
  if (!nextPartyReserves[teamKey].length) delete nextPartyReserves[teamKey];
  const sameTeamPlayerSet = new Set(sameTeamApplicants.map((applicant) => applicant.playerId));
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers({ ...roomState, partyReserves: nextPartyReserves }, side, activePlayerIds, false),
    side,
    reservePlayerIds,
    true,
  );
  const nextApplicant = {
    kind: "team",
    joinMode: "team",
    teamId,
    playerId: activePlayerIds[0],
    side,
    status: "ready",
    reserve: false,
    position: null,
    playerIds: activePlayerIds,
    createdAt: updatedAt,
    updatedAt,
  };
  const nextPost = {
    ...post,
    applicants: [
      ...mergeApplicants.filter((applicant) => !sameTeamPlayerSet.has(applicant.playerId)),
      nextApplicant,
    ],
    roomState: nextRoomState,
  };
  const nextLobby = getRecruitingLobby(nextPost, state);
  if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
  if (isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
  };
}

export function setRecruitingTeamPartyRoster(state, postId, entryId, roster = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "팀 파티 명단 조정");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId) return state;
  if (isIndividualOnlyRecruitingRoom(post)) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (entry?.kind !== "team" || !entry.team) return state;

  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  if (partyLeaderId !== state.currentUserId) return state;
  if (hasRecruitingTeamMemberOnOtherSide(post, state, entry.team.id, entry.side, entry.id)) {
    return withRecruitingPartySideConflictNotification(state, postId, entry.side);
  }

  const capacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const teamPlayerIds = new Set(getSelectableTeamPlayerIds(entry.team));
  const occupiedPlayerIds = new Set(
    (lobby.entries ?? [])
      .filter((item) => item.id !== entry.id)
      .flatMap((item) => [item.playerId, ...(item.players ?? []), ...(item.reserves ?? [])])
      .filter(Boolean),
  );
  const requestedActiveIds = uniquePlayerIds(roster.playerIds ?? [])
    .filter((playerId) => teamPlayerIds.has(playerId) && !occupiedPlayerIds.has(playerId));
  const activeWithLeader = partyLeaderId && teamPlayerIds.has(partyLeaderId) && !occupiedPlayerIds.has(partyLeaderId)
    ? [partyLeaderId, ...requestedActiveIds.filter((playerId) => playerId !== partyLeaderId)]
    : requestedActiveIds;
  const nextPlayerIds = activeWithLeader.slice(0, capacity);
  if (!nextPlayerIds.length) return state;

  const nextPlayerSet = new Set(nextPlayerIds);
  const nextReservePlayerIds = uniquePlayerIds(roster.reservePlayerIds ?? [])
    .filter((playerId) => teamPlayerIds.has(playerId) && !occupiedPlayerIds.has(playerId) && !nextPlayerSet.has(playerId))
    .slice(0, benchCapacity);
  const nextPartyReserves = { ...roomState.partyReserves, [entry.id]: nextReservePlayerIds };
  if (!nextReservePlayerIds.length) delete nextPartyReserves[entry.id];
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers({ ...roomState, partyReserves: nextPartyReserves }, entry.side, nextPlayerIds, false),
    entry.side,
    nextReservePlayerIds,
    true,
  );
  const updatedAt = new Date().toISOString();
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const nextPost = entry.fixed
    ? { ...post, hostReady: getRecruitingHostEditReady(post), playerIds: nextPlayerIds, roomState: nextRoomState }
    : {
        ...post,
        roomState: nextRoomState,
        applicants: applicants.map((applicant) => (
          getRecruitingApplicantKey(applicant) === entry.id
            ? {
                ...applicant,
                playerId: partyLeaderId,
                reserve: false,
                status: post.visibility === "private" && post.hostJoinMode === "team" && entry.side === "teamB"
                  ? "ready"
                  : getRecruitingSlotEditStatus(post),
                playerIds: nextPlayerIds,
                updatedAt,
              }
            : applicant
        )),
      };

  const nextLobby = getRecruitingLobby(nextPost, state);
  if (nextLobby.sides[entry.side].projectedFilled > nextLobby.sides[entry.side].capacity) return state;
  if (isRecruitingReserveLimitExceeded(nextPost, state, entry.side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, entry.side, benchCapacity), ...state.notifications],
    };
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
  };
}

export function setRecruitingPartyPlayerReserve(state, postId, entryId, playerId, reserve = true) {
  const disciplineBlock = getDisciplineBlockedState(state, "파티 예비 조정");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});

  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  if (partyLeaderId !== state.currentUserId && playerId !== state.currentUserId) return state;

  const capacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const currentReserveIds = uniquePlayerIds(roomState.partyReserves?.[entry.id] ?? []);
  if (!reserve && currentPlayerIds.includes(playerId)) return state;
  if (reserve && currentReserveIds.includes(playerId) && !currentPlayerIds.includes(playerId)) return state;
  const swapInPlayerId = reserve && currentReserveIds.length >= benchCapacity
    ? currentReserveIds.find((id) => id !== playerId)
    : "";
  const swapOutPlayerId = !reserve && currentPlayerIds.length >= capacity
    ? [...currentPlayerIds].reverse().find((id) => id !== playerId)
    : "";
  const nextPlayerIds = reserve
    ? uniquePlayerIds([...currentPlayerIds.filter((id) => id !== playerId), swapInPlayerId].filter(Boolean))
    : uniquePlayerIds([...currentPlayerIds.filter((id) => id !== swapOutPlayerId), playerId]);
  const partyBecomesReserve = reserve && !entry.fixed && currentPlayerIds.length === 1 && currentPlayerIds[0] === playerId && !swapInPlayerId;
  const fixedPartyBecomesReserve = reserve && entry.fixed && currentPlayerIds.length === 1 && currentPlayerIds[0] === playerId && !swapInPlayerId;
  if ((!partyBecomesReserve && !fixedPartyBecomesReserve && !nextPlayerIds.length) || nextPlayerIds.length > capacity) return state;

  const updatedAt = new Date().toISOString();
  const baseReserveIds = currentReserveIds.filter((id) => id !== playerId && id !== swapInPlayerId);
  const nextReserveIds = partyBecomesReserve
    ? currentReserveIds.filter((id) => id !== playerId)
    : reserve
      ? uniquePlayerIds([...baseReserveIds, playerId])
      : uniquePlayerIds([...baseReserveIds, swapOutPlayerId].filter(Boolean));
  if (nextReserveIds.length > benchCapacity) return state;
  const nextPartyReserves = { ...roomState.partyReserves, [entry.id]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[entry.id];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    entry.side,
    playerId,
    reserve,
  );
  const nextPost = entry.fixed
    ? { ...post, hostReady: getRecruitingHostEditReady(post), playerIds: nextPlayerIds, roomState: nextRoomState }
    : {
      ...post,
      roomState: nextRoomState,
      applicants: applicants.map((applicant) => (
        getRecruitingApplicantKey(applicant) === entry.id
          ? {
              ...applicant,
              reserve: partyBecomesReserve ? true : false,
              playerIds: partyBecomesReserve ? currentPlayerIds : nextPlayerIds,
              status: getRecruitingSlotEditStatus(post),
              updatedAt,
            }
          : applicant
      )),
    };

  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, entry.side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, entry.side), ...state.notifications],
    };
  }

  if (!reserve) {
    const nextLobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(nextLobby.sides[entry.side].entries.flatMap((item) => item.players)).size;
    if (activePlayerCount > nextLobby.sides[entry.side].capacity) return state;
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
  };
}

export function setRecruitingPartyPlayerPlacement(state, postId, entryId, playerId, placement = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "파티 배치");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});

  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  if (partyLeaderId !== state.currentUserId && playerId !== state.currentUserId) return state;

  const side = MATCH_SIDES.includes(placement.side) ? placement.side : entry.side;
  const reserve = Boolean(placement.reserve);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  if (side !== entry.side) return state;
  return setRecruitingPartyPlayerReserve(state, postId, entryId, playerId, reserve);
}

export function detachRecruitingPartyPlayer(state, postId, entryId, playerId, placement = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "파티 분리");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingPartyEntry(entry) || !entry?.team) return state;
  if (!isRecruitingEntryMember(entry, playerId)) return state;
  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  const canDetach = post.playerId === state.currentUserId || playerId === state.currentUserId || partyLeaderId === state.currentUserId;
  if (!canDetach) return state;

  const capacity = getRecruitingSideCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const reserveKey = entry.id;
  const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
  const wasActive = !entry.reserve && currentPlayerIds.includes(playerId);
  const wasReserve = Boolean(entry.reserve) || currentReserveIds.includes(playerId);
  if (!wasActive && !wasReserve) return state;
  const targetSide = MATCH_SIDES.includes(placement.side) ? placement.side : entry.side;
  const targetReserve = placement.reserve === undefined ? (!wasActive && wasReserve) : Boolean(placement.reserve);
  if (isRecruitingTeamSideLocked(post) && targetSide !== entry.side) return state;

  const nextPlayerIds = currentPlayerIds.filter((id) => id !== playerId);

  const nextReserveIds = currentReserveIds.filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    targetSide,
    playerId,
    targetReserve,
  );
  const updatedAt = new Date().toISOString();
  const movedUser = state.users.find((user) => user.id === playerId);
  const movedApplicant = {
    kind: "player",
    joinMode: "player",
    playerId,
    teamId: null,
    sourceTeamId: entry.team?.id ?? entry.teamId ?? null,
    sourceEntryId: entry.id,
    side: targetSide,
    status: getRecruitingSlotEditStatus(post),
    reserve: targetReserve,
    position: movedUser?.position ?? null,
    createdAt: updatedAt,
    updatedAt,
  };
  let nextApplicants = applicants
    .filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`)
    .map((applicant) => {
      if (getRecruitingApplicantKey(applicant) === entry.id || applicant.kind !== "team") return applicant;
      const remainingPlayerIds = uniquePlayerIds(applicant.playerIds ?? []).filter((id) => id !== playerId);
      if (!remainingPlayerIds.length) return null;
      if (remainingPlayerIds.length === (applicant.playerIds ?? []).length) return applicant;
      return {
        ...applicant,
        playerId: remainingPlayerIds.includes(applicant.playerId) ? applicant.playerId : remainingPlayerIds[0],
        playerIds: remainingPlayerIds,
        status: getRecruitingSlotEditStatus(post),
        updatedAt,
      };
    })
    .filter(Boolean);
  if (!entry.fixed) {
    nextApplicants = nextApplicants
      .map((applicant) => {
        if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
        return nextPlayerIds.length
          ? { ...applicant, playerId: nextPlayerIds[0] ?? applicant.playerId, playerIds: nextPlayerIds, status: getRecruitingSlotEditStatus(post), updatedAt }
          : null;
      })
      .filter(Boolean);
  }
  nextApplicants = [...nextApplicants, movedApplicant];

  const nextPost = entry.fixed
    ? { ...post, hostReady: getRecruitingHostEditReady(post), playerIds: nextPlayerIds, roomState: nextRoomState, applicants: nextApplicants }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };

  if (targetReserve && isRecruitingReserveLimitExceeded(nextPost, state, targetSide)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, targetSide), ...state.notifications],
    };
  }
  if (!targetReserve) {
    const nextLobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(nextLobby.sides[targetSide].entries.flatMap((item) => item.players)).size;
    if (activePlayerCount > nextLobby.sides[targetSide].capacity) return state;
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "파티에서 나감",
        body: `${entry.team.name} 파티에서 빠져 개인 참여로 전환되었습니다.`,
        tone: "team",
      },
      ...(state.notifications ?? []),
    ],
  };
}

export function removeRecruitingPartyPlayer(state, postId, entryId, playerId) {
  const disciplineBlock = getDisciplineBlockedState(state, "파티 인원 제거");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId) || !entryId || !playerId) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  if (entry.fixed && playerId === post.playerId) return state;

  const capacity = getRecruitingSideCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const nextPlayerIds = currentPlayerIds.filter((id) => id !== playerId);
  const reserveKey = entry.id;
  const nextReserveIds = (roomState.partyReserves?.[reserveKey] ?? []).filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  if (entry.fixed && !nextPlayerIds.length) return state;
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    entry.side,
    playerId,
    false,
  );

  const updatedAt = new Date().toISOString();
  let nextApplicants = applicants.filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`);
  if (!entry.fixed) {
    nextApplicants = nextApplicants
      .map((applicant) => {
        if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
        return nextPlayerIds.length
          ? { ...applicant, playerId: nextPlayerIds[0] ?? applicant.playerId, playerIds: nextPlayerIds, status: getRecruitingSlotEditStatus(post), updatedAt }
          : null;
      })
      .filter(Boolean);
  }

  const hostKickCount = roomState.kickLog.filter((item) => item.by === state.currentUserId).length + 1;
  const hostPenalty = hostKickCount >= 3 ? 1 : 0;
  const kickLog = [
    ...roomState.kickLog,
    { id: makeId("kick"), targetUserId: playerId, by: state.currentUserId, penalty: hostPenalty, createdAt: updatedAt },
  ];
  const nextPost = entry.fixed
    ? {
        ...post,
        hostReady: getRecruitingHostEditReady(post),
        playerIds: nextPlayerIds,
        roomState: { ...nextRoomState, kickLog },
        applicants: nextApplicants,
      }
    : {
        ...post,
        roomState: { ...nextRoomState, kickLog },
        applicants: nextApplicants,
      };

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -hostPenalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? cleanRecruitingRoomStatRecorders(nextPost, state) : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: hostPenalty ? "강퇴 남발 패널티" : "참가자 강퇴",
        body: hostPenalty
          ? "한 방에서 강퇴가 3회 이상 발생해 방장 신뢰도가 감소했습니다."
          : "선택한 팀원을 방에서 내보냈습니다.",
        tone: hostPenalty ? "orange" : "team",
      },
      ...state.notifications,
    ],
  };
}

export function setRecruitingStatRecorder(state, postId, sideName, playerId = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "기록자 지정");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId) || post.refereeId) return state;
  if (!MATCH_SIDES.includes(sideName)) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const currentRecorders = normalizeStatRecorders(roomState.statRecorders);
  const nextPlayerId = playerId && currentRecorders[sideName] !== playerId
    ? getValidRecruitingRecorder(post, state, sideName, playerId)
    : "";
  if (playerId && !nextPlayerId) return state;

  const nextRecorders = normalizeStatRecorders({
    ...currentRecorders,
    [sideName]: nextPlayerId,
  });
  const otherSideName = sideName === "teamA" ? "teamB" : "teamA";
  if (nextPlayerId && nextRecorders[otherSideName] === nextPlayerId) {
    nextRecorders[otherSideName] = "";
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, roomState: { ...roomState, statRecorders: nextRecorders } }
        : item
    )),
  };
}

export function kickRecruitingApplicant(state, postId, playerId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId) || playerId === state.currentUserId) return state;
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const target = applicants.find((applicant) => applicant.playerId === playerId);
  if (!target) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const targetSide = target.side ?? "teamB";
  const nextRoomState = updatePinnedReservePlayers(roomState, targetSide, playerId, false);
  const hostKickCount = roomState.kickLog.filter((item) => item.by === state.currentUserId).length + 1;
  const hostPenalty = hostKickCount >= 3 ? 1 : 0;
  const now = new Date().toISOString();
  const kickLog = [
    ...roomState.kickLog,
    { id: makeId("kick"), targetUserId: playerId, by: state.currentUserId, penalty: hostPenalty, createdAt: now },
  ];

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -hostPenalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? cleanRecruitingRoomStatRecorders({
            ...item,
            roomState: { ...nextRoomState, kickLog },
            applicants: applicants.filter((applicant) => applicant.playerId !== playerId),
          }, state)
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: hostPenalty ? "강퇴 남발 패널티" : "참가자 강퇴",
        body: hostPenalty
          ? "한 방에서 강퇴가 3회 이상 발생해 방장 신뢰도가 감소했습니다."
          : "참가자를 방에서 내보냈습니다.",
        tone: hostPenalty ? "orange" : "team",
      },
      ...state.notifications,
    ],
  };
}

function promoteRecruitingReservesForConfirmation(post, state, lobby) {
  const fillSlots = MATCH_SIDES.flatMap((sideName) => (
    [...(lobby.sides[sideName]?.fillSlots ?? []), ...(lobby.sides[sideName]?.reserveCandidates ?? [])]
      .filter((candidate, index, candidates) => (
        candidate.status === "ready" &&
        candidates.findIndex((item) => item.playerId === candidate.playerId) === index
      ))
      .slice(0, Math.max(0, (lobby.sides[sideName]?.capacity ?? 0) - (lobby.sides[sideName]?.filled ?? 0)))
      .map((candidate) => ({ ...candidate, side: sideName }))
  ));
  const promotedIdsBySide = {
    teamA: fillSlots.filter((candidate) => candidate.side === "teamA").map((candidate) => candidate.playerId),
    teamB: fillSlots.filter((candidate) => candidate.side === "teamB").map((candidate) => candidate.playerId),
  };
  if (!fillSlots.length) return { post, promotedIdsBySide };

  const capacity = getRecruitingSideCapacity(post);
  const updatedAt = new Date().toISOString();
  const byEntry = fillSlots.reduce((acc, candidate) => {
    if (!candidate.entryId || !candidate.playerId) return acc;
    const current = acc.get(candidate.entryId) ?? { side: candidate.side, playerIds: [] };
    current.playerIds = uniquePlayerIds([...current.playerIds, candidate.playerId]);
    acc.set(candidate.entryId, current);
    return acc;
  }, new Map());

  let nextPost = { ...post };
  let nextRoomState = normalizeRecruitingRoomState(post.roomState ?? {});
  let nextApplicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const nextPartyReserves = { ...(nextRoomState.partyReserves ?? {}) };
  const promotedPlayerIds = [];

  byEntry.forEach(({ playerIds }, entryId) => {
    const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
    if (!entry) return;
    const promotedIds = uniquePlayerIds(playerIds).filter((playerId) => (
      (entry.players ?? []).includes(playerId) || (entry.reserves ?? []).includes(playerId)
    ));
    if (!promotedIds.length) return;
    promotedPlayerIds.push(...promotedIds);

    const reserveKey = entry.fixed ? "host" : entry.id;
    const existingReserveIds = uniquePlayerIds(nextPartyReserves[reserveKey] ?? []);
    const entryWasReserve = Boolean(entry.reserve);
    const remainingReserveIds = entryWasReserve
      ? uniquePlayerIds(entry.players ?? []).filter((playerId) => !promotedIds.includes(playerId))
      : uniquePlayerIds([...(entry.reserves ?? []), ...existingReserveIds]).filter((playerId) => !promotedIds.includes(playerId));

    if (entry.fixed) {
      if (entry.kind === "team") {
        const activeIds = entryWasReserve
          ? promotedIds.slice(0, capacity)
          : uniquePlayerIds([...(nextPost.playerIds ?? []), ...promotedIds]).slice(0, capacity);
        nextPost = {
          ...nextPost,
          playerIds: activeIds,
          hostReady: true,
        };
        const reserveIds = uniquePlayerIds([...existingReserveIds, ...remainingReserveIds]).filter((playerId) => !activeIds.includes(playerId));
        if (reserveIds.length) nextPartyReserves[reserveKey] = reserveIds;
        else delete nextPartyReserves[reserveKey];
      } else {
        nextPost = { ...nextPost, hostReady: true };
      }
      if (entryWasReserve) nextRoomState = { ...nextRoomState, hostReserve: false };
      return;
    }

    nextApplicants = nextApplicants.map((applicant) => {
      if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
      if (applicant.kind === "team") {
        const activeIds = entryWasReserve
          ? promotedIds.slice(0, capacity)
          : uniquePlayerIds([...(applicant.playerIds ?? []), ...promotedIds]).slice(0, capacity);
        const reserveIds = uniquePlayerIds([...existingReserveIds, ...remainingReserveIds]).filter((playerId) => !activeIds.includes(playerId));
        if (reserveIds.length) nextPartyReserves[reserveKey] = reserveIds;
        else delete nextPartyReserves[reserveKey];
        return {
          ...applicant,
          reserve: false,
          status: "ready",
          playerId: activeIds[0] ?? applicant.playerId,
          playerIds: activeIds,
          updatedAt,
        };
      }
      return {
        ...applicant,
        reserve: false,
        status: "ready",
        updatedAt,
      };
    });
  });

  nextRoomState = updateManyPinnedReservePlayers(
    { ...nextRoomState, partyReserves: nextPartyReserves },
    "teamA",
    promotedPlayerIds,
    false,
  );
  nextRoomState = updateManyPinnedReservePlayers(nextRoomState, "teamB", promotedPlayerIds, false);

  return {
    post: {
      ...nextPost,
      roomState: nextRoomState,
      applicants: nextApplicants,
    },
    promotedIdsBySide,
  };
}

export function confirmRecruitingMatch(state, postId, options = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId)) return state;
  if (isRoomScheduleChangePending(post)) {
    return {
      ...state,
      notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications],
    };
  }
  const currentRequiredIds = getRecruitingChangeRequiredIds(post, state);
  const acknowledgement = getRecruitingRuleAcknowledgement(post);
  const remainingRuleAcknowledgements = acknowledgement.requiredIds
    .filter((playerId) => currentRequiredIds.includes(playerId))
    .filter((playerId) => !acknowledgement.acknowledgedIds.includes(playerId));
  if (remainingRuleAcknowledgements.length) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "변경 내용 확인 필요",
        body: "현재 참가자 전원이 최신 경기 규칙을 확인해야 매치를 확정할 수 있습니다.",
        tone: "orange",
        recruitingPostId: postId,
      }, ...state.notifications],
    };
  }
  const promotion = promoteRecruitingReservesForConfirmation(post, state, getRecruitingLobby(post, state));
  const promotedPost = promotion.post;
  const lobby = getRecruitingLobby(promotedPost, state);

  if (!lobby.canConfirm) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "매치 확정 불가",
          body: "양쪽 슬롯이 채워지고 필요한 수락이 끝나야 합니다.",
          tone: "match",
          matchId: null,
        },
        ...state.notifications,
      ],
    };
  }
  const timingStatus = getPublicRoomTimingStatus(promotedPost);
  if (!timingStatus.canConfirm) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "매치 확정 불가",
          body: timingStatus.detail,
          tone: "match",
          matchId: null,
        },
        ...state.notifications,
      ],
    };
  }

  const timingType = promotedPost.timingType === "instant" || promotedPost.roomState?.timingType === "instant" ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "즉시" : (promotedPost.scheduledDate && promotedPost.scheduledTime ? `${promotedPost.scheduledDate} ${promotedPost.scheduledTime}` : "일정 미정");
  const now = new Date().toISOString();
  const benchCapacity = getRecruitingBenchCapacity(promotedPost);
  const pickup = (promotedPost.formationMode ?? promotedPost.rules?.formationMode) === "pickup"
    || (promotedPost.matchIntent ?? promotedPost.rules?.matchIntent) === "pickup";
  const teamAPlayers = lobby.sides.teamA.projectedPlayers.slice(0, lobby.sides.teamA.capacity);
  const teamBPlayers = lobby.sides.teamB.projectedPlayers.slice(0, lobby.sides.teamB.capacity);
  const teamAReservePlayers = uniquePlayerIds(lobby.sides.teamA.reserveCandidates.map((candidate) => candidate.playerId))
    .filter((playerId) => !teamAPlayers.includes(playerId))
    .slice(0, benchCapacity);
  const teamBReservePlayers = uniquePlayerIds(lobby.sides.teamB.reserveCandidates.map((candidate) => candidate.playerId))
    .filter((playerId) => !teamBPlayers.includes(playerId))
    .slice(0, benchCapacity);
  const teamAPlayerTeams = pickup ? {} : getLobbySidePlayerTeamIds(lobby, "teamA");
  const teamBPlayerTeams = pickup ? {} : getLobbySidePlayerTeamIds(lobby, "teamB");
  const playerIds = [...teamAPlayers, ...teamBPlayers];
  const confirmedReserveIds = new Set([...teamAReservePlayers, ...teamBReservePlayers]);
  const refereeId = getTrustedRefereeId(state, promotedPost.refereeId, playerIds);
  const statRecorders = refereeId ? normalizeStatRecorders({}) : getRecruitingRoomStatRecorders(promotedPost, state);
  const promotedRoomState = normalizeRecruitingRoomState(promotedPost.roomState ?? {});
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(promotedPost.mmrRangeMode ?? promotedPost.roomState?.mmrRangeMode);
  const ranked = promotedPost.ranked !== false;
  const ratingScale = getRecruitingRatingScale({ ranked, mmrRangeMode });
  const defaultRules = getDefaultMatchRules(promotedPost.mode);
  const disputeMinutes = normalizeDisputeWindowMinutes(promotedPost.disputeMinutes);
  const match = {
    id: options.matchId || makeId("m"),
    title: promotedPost.title,
    mode: promotedPost.mode,
    courtId: promotedPost.courtId ?? getCourtId(promotedPost),
    court: promotedPost.court,
    scheduledDate: timingType === "instant" ? "" : (promotedPost.scheduledDate ?? ""),
    scheduledTime: timingType === "instant" ? "" : (promotedPost.scheduledTime ?? ""),
    scheduledAt,
    timingType,
    visibility: promotedPost.visibility ?? "public",
    status: "agreed",
    official: ranked && Boolean(promotedPost.official),
    preRegistered: true,
    refereeId,
    refereeTrustMin: REFEREE_TRUST_MIN,
    statRecorders,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes,
    rules: {
      ...defaultRules,
      ...(promotedPost.rules ?? {}),
      timingType,
      visibility: promotedPost.visibility ?? "public",
      region: promotedPost.region,
      mmrRangeMode,
      ratingScale,
      benchCapacity,
      slotPositions: promotedRoomState.slotPositions ?? {},
    },
    memo: promotedPost.memo,
    stakes: "매치 큐에서 확정된 경기입니다.",
    ranked,
    mmrRangeMode,
    ratingScale,
    objectionWindow: `${disputeMinutes}분`,
    evidence: [],
    teamA: {
      name: pickup ? SIDE_LABEL_TEXT.teamA : getLobbySideName(lobby, "teamA"),
      teamId: pickup ? null : getLobbyPrimaryTeamId(lobby, "teamA"),
      playerTeams: teamAPlayerTeams,
      players: teamAPlayers,
      score: 0,
    },
    teamB: {
      name: pickup ? SIDE_LABEL_TEXT.teamB : getLobbySideName(lobby, "teamB"),
      teamId: pickup ? null : getLobbyPrimaryTeamId(lobby, "teamB"),
      playerTeams: teamBPlayerTeams,
      players: teamBPlayers,
      score: 0,
    },
    parties: pickup ? [] : lobby.entries
      .filter((entry) => isRecruitingPartyEntry(entry))
      .map((entry) => ({
        kind: entry.kind,
        side: entry.side,
        teamId: getLobbyEntryTeamId(entry),
        playerId: entry.playerId,
        partyLeaderId: promotedRoomState.partyLeaders?.[entry.id] ?? (entry.fixed ? promotedPost.playerId : entry.playerId) ?? "",
        players: entry.reserve && entry.status !== "ready" ? [] : entry.players,
        reserves: (entry.reserves ?? []).filter((playerId) => confirmedReserveIds.has(playerId)),
        reserve: entry.reserve,
      }))
      .filter((entry) => entry.players.length || entry.reserves.length),
    reservePlayers: {
      teamA: teamAReservePlayers,
      teamB: teamBReservePlayers,
    },
    promotedReserveIds: {
      teamA: promotion.promotedIdsBySide.teamA,
      teamB: promotion.promotedIdsBySide.teamB,
    },
    agreements: { teamA: teamAPlayers, teamB: teamBPlayers },
    attendance: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    teamRatingResult: null,
    recruitingPostId: promotedPost.id,
    createdBy: getRecruitingRoomOwnerId(promotedPost) || promotedPost.playerId,
    agreedAt: now,
    createdAt: now,
  };

  return {
    ...state,
    matches: [match, ...state.matches],
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...promotedPost, status: "closed", confirmedAt: now, roomState: { ...normalizeRecruitingRoomState(promotedPost.roomState ?? {}), invitations: [] } }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "매치 확정",
        body: `${match.title} 경기방이 생성됐습니다.`,
        tone: "match",
        matchId: match.id,
      },
      ...state.notifications,
    ],
  };
}

export function closeRecruitingPost(state, postId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || !isRecruitingRoomOwner(post, state.currentUserId)) return state;
  const cancellationPolicy = getRoomCancellationPolicy(post);
  if (!cancellationPolicy.allowed) {
    return {
      ...state,
      notifications: [getRoomCancelLockedNotification({ postId }), ...state.notifications],
    };
  }
  const penalty = cancellationPolicy.penalty;
  const now = new Date().toISOString();
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const hostPenalties = penalty
    ? [
        ...roomState.hostPenalties,
        { id: makeId("penalty"), by: state.currentUserId, penalty, reason: "room_closed", createdAt: now },
      ]
    : roomState.hostPenalties;

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -penalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => (
      post.id === postId && isRecruitingRoomOwner(post, state.currentUserId)
        ? {
            ...post,
            status: "closed",
            roomState: {
              ...roomState,
              hostPenalties,
              invitations: [],
              cancelPenalty: penalty,
              cancelPenaltyWaived: cancellationPolicy.waived,
              cancelWaiverReason: cancellationPolicy.waiverReason,
              cancelledAt: now,
            },
          }
        : post
    )),
    notifications: penalty
      ? [
          {
            id: makeId("n"),
            title: "경기 취소 신뢰도 반영",
            body: `경기 시작 12시간 이내에 취소해 신뢰도 ${penalty}점이 감소했습니다.`,
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ]
      : state.notifications,
  };
}

export function markNotificationRead(state, notificationId) {
  const readAt = new Date().toISOString();
  return {
    ...state,
    notifications: state.notifications.map((notification) =>
      notification.id === notificationId ? { ...notification, readAt: notification.readAt ?? readAt } : notification,
    ),
  };
}

export function markAllNotificationsRead(state) {
  const readAt = new Date().toISOString();
  return {
    ...state,
    notifications: state.notifications.map((notification) => {
      const targetUserId = notification.targetUserId ?? notification.userId ?? "";
      if (notification.readAt || !isNotificationDue(notification) || (targetUserId && targetUserId !== state.currentUserId)) {
        return notification;
      }
      return { ...notification, readAt };
    }),
  };
}

export function deleteNotification(state, notificationId) {
  if (!notificationId) return state;
  return {
    ...state,
    notifications: state.notifications.filter((notification) => notification.id !== notificationId),
  };
}

export function updateProfile(state, patch, targetUserId = state.currentUserId) {
  const profileUserId = targetUserId || state.currentUserId;
  if (patch.discordConnection?.status === "linked" && findDiscordConnectionOwner(state.users, patch.discordConnection, profileUserId)) {
    return state;
  }
  const currentUser = state.users.find((user) => user.id === profileUserId);
  if (!currentUser) return state;
  const nextHandle = patch.handle ?? patch.hashtag;
  if (
    nextHandle &&
    (!currentUser.handleLockedAt || sameHashtag(nextHandle, getUserIdentityHashtag(currentUser))) &&
    state.users.some((user) => user.id !== profileUserId && sameHashtag(nextHandle, getUserIdentityHashtag(user)))
  ) {
    return state;
  }
  const profilePatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(profilePatch, "discordConnection")) {
    profilePatch.discordUserId = getDiscordConnectionUserId(profilePatch.discordConnection) || null;
  }
  const requestedHashtag = profilePatch.handle ?? profilePatch.hashtag;
  if ((currentUser.handleLockedAt || currentUser.hashtagLockedAt) && requestedHashtag && !sameHashtag(requestedHashtag, getUserIdentityHashtag(currentUser))) {
    delete profilePatch.handle;
    delete profilePatch.hashtag;
  }
  const currentBirthYearLocked = Boolean(currentUser.birthYearLockedAt && currentUser.birthYear);
  if (currentBirthYearLocked && profilePatch.birthYear && Number(profilePatch.birthYear) !== Number(currentUser.birthYear)) {
    delete profilePatch.birthYear;
  }
  if (profilePatch.handle || profilePatch.hashtag) {
    const hashtag = toHashtag(profilePatch.hashtag ?? profilePatch.handle, currentUser.id);
    profilePatch.handle = hashtag;
    profilePatch.hashtag = hashtag;
    profilePatch.handleLockedAt = currentUser.handleLockedAt ?? profilePatch.handleLockedAt ?? new Date().toISOString();
  }
  if (
    Object.prototype.hasOwnProperty.call(profilePatch, "regionSido") ||
    Object.prototype.hasOwnProperty.call(profilePatch, "regionDistrict") ||
    Object.prototype.hasOwnProperty.call(profilePatch, "region")
  ) {
    profilePatch.region = getProfileRegionSnapshot(
      profilePatch.regionSido ?? currentUser.regionSido,
      profilePatch.regionDistrict ?? currentUser.regionDistrict,
      profilePatch.region ?? currentUser.region,
    );
  }
  if (profilePatch.birthYear && !currentBirthYearLocked) {
    profilePatch.birthYearLockedAt = profilePatch.birthYearLockedAt ?? new Date().toISOString();
  }
  if (profilePatch.name && profilePatch.name !== currentUser.name) {
    if (!canChangeProfileName(currentUser)) delete profilePatch.name;
    else profilePatch.nameUpdatedAt = profilePatch.nameUpdatedAt ?? new Date().toISOString();
  }
  return {
    ...state,
    users: state.users.map((user) => (user.id === profileUserId ? { ...user, ...profilePatch } : user)),
  };
}

export function createTeam(state, teamDraft) {
  const disciplineBlock = getDisciplineBlockedState(state, "팀 생성");
  if (disciplineBlock) return disciplineBlock;
  const teamName = String(teamDraft.name ?? "").trim().replace(/\s+/g, " ");
  if (!teamName || teamName.length > MAX_TEAM_NAME_LENGTH) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀명 확인",
          body: `팀명은 ${MAX_TEAM_NAME_LENGTH}자 이하로 입력해야 합니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const captainId = state.currentUserId;
  const captainTeamCount = state.teams.filter((team) => team.members.some((member) => member.userId === captainId)).length;
  if (captainTeamCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 생성 제한",
          body: `가입할 수 있는 팀은 최대 ${MAX_TEAM_MEMBERSHIPS}개입니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const team = {
    id: makeId("t"),
    name: teamName,
    homeCourt: teamDraft.homeCourt,
    region: teamDraft.region,
    mmr: DEFAULT_RATING,
    wins: 0,
    losses: 0,
    accent: teamDraft.accent || "#58d2c0",
    members: [{ userId: captainId, role: "captain" }],
  };

  return {
    ...state,
    teams: [team, ...state.teams],
    notifications: [{ id: makeId("n"), title: "팀 생성", body: `${team.name} 팀이 등록됐습니다.`, tone: "team" }, ...state.notifications],
  };
}

export function deleteTeam(state, teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return state;

  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 삭제 권한 없음",
          body: "팀장만 팀을 삭제할 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  return {
    ...state,
    deletedTeamIds: Array.from(new Set([...(state.deletedTeamIds ?? []), teamId])),
    teams: state.teams.filter((item) => item.id !== teamId),
    settings: {
      ...state.settings,
      favoriteTeamIds: (state.settings?.favoriteTeamIds ?? []).filter((id) => id !== teamId),
    },
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => (
      post.teamId === teamId ? { ...post, teamId: null, status: "closed" } : post
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "팀 삭제",
        body: `${team.name} 팀을 삭제했습니다. 기존 경기 기록은 유지됩니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

function expirePendingTeamInvitations(teamInvitations = [], teamId, updatedAt) {
  return (teamInvitations ?? []).map((invitation) => (
    invitation.teamId === teamId && invitation.status === "pending"
      ? { ...invitation, status: "expired", updatedAt }
      : invitation
  ));
}

function getTeamInvitation(state, invitationId) {
  return (state.teamInvitations ?? []).find((invitation) => invitation.id === invitationId) ?? null;
}

export function inviteTeamMember(state, teamId, targetUserId, role = "regular") {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team || !targetUserId || team.members.some((member) => member.userId === targetUserId)) return state;
  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "팀 초대 권한 없음", body: "팀장만 팀원을 초대할 수 있습니다.", tone: "team" },
        ...state.notifications,
      ],
    };
  }
  if (team.members.length >= MAX_TEAM_MEMBERS) {
    return {
      ...state,
      teamInvitations: expirePendingTeamInvitations(state.teamInvitations, teamId, new Date().toISOString()),
      notifications: [
        { id: makeId("n"), title: "팀 초대 제한", body: `팀원은 최대 ${MAX_TEAM_MEMBERS}명까지 등록할 수 있습니다.`, tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const membershipCount = state.teams.filter((item) => item.members.some((member) => member.userId === targetUserId)).length;
  if (membershipCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "팀 초대 제한", body: `상대가 이미 팀 한도 ${MAX_TEAM_MEMBERSHIPS}/${MAX_TEAM_MEMBERSHIPS}에 도달했습니다.`, tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const existingPending = (state.teamInvitations ?? []).some((invitation) => (
    invitation.teamId === teamId &&
    invitation.targetUserId === targetUserId &&
    invitation.status === "pending"
  ));
  if (existingPending) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "팀 초대 대기 중", body: "이미 보낸 팀 초대가 대기 중입니다.", tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const now = new Date().toISOString();
  const safeRole = normalizeTeamInviteRole(role);
  const invitation = {
    id: makeId("ti"),
    teamId,
    fromUserId: state.currentUserId,
    targetUserId,
    role: safeRole,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    teamInvitations: [invitation, ...(state.teamInvitations ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "팀 초대",
        body: `${team.name} 팀 초대가 도착했습니다.`,
        tone: "team",
        type: "team_invite",
        teamId,
        teamInvitationId: invitation.id,
        targetUserId,
        fromUserId: state.currentUserId,
        createdAt: now,
        updatedAt: now,
      },
      ...state.notifications,
    ],
  };
}

export function acceptTeamInvitation(state, invitationId) {
  const invitation = getTeamInvitation(state, invitationId);
  if (!invitation || invitation.status !== "pending" || invitation.targetUserId !== state.currentUserId) return state;
  const team = state.teams.find((item) => item.id === invitation.teamId);
  if (!team || team.members.some((member) => member.userId === state.currentUserId)) return state;
  const now = new Date().toISOString();
  if (team.members.length >= MAX_TEAM_MEMBERS) {
    return {
      ...state,
      teamInvitations: expirePendingTeamInvitations(state.teamInvitations, team.id, now),
      notifications: [
        { id: makeId("n"), title: "팀 초대 만료", body: `${team.name} 팀 정원이 가득 찼습니다.`, tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const membershipCount = state.teams.filter((item) => item.members.some((member) => member.userId === state.currentUserId)).length;
  if (membershipCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      teamInvitations: (state.teamInvitations ?? []).map((item) => item.id === invitationId ? { ...item, status: "expired", updatedAt: now } : item),
      notifications: [
        { id: makeId("n"), title: "팀 가입 제한", body: `가입할 수 있는 팀은 최대 ${MAX_TEAM_MEMBERSHIPS}개입니다.`, tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const nextMemberCount = team.members.length + 1;
  const nextInvitations = (state.teamInvitations ?? []).map((item) => (
    item.id === invitationId ? { ...item, status: "accepted", updatedAt: now } : item
  ));
  return {
    ...state,
    teams: state.teams.map((item) => (
      item.id === team.id ? { ...item, members: [...item.members, { userId: state.currentUserId, role: normalizeTeamInviteRole(invitation.role) }] } : item
    )),
    teamInvitations: nextMemberCount >= MAX_TEAM_MEMBERS ? expirePendingTeamInvitations(nextInvitations, team.id, now) : nextInvitations,
    notifications: [
      { id: makeId("n"), title: "팀 가입 완료", body: `${team.name} 팀에 가입했습니다.`, tone: "team", teamId: team.id, createdAt: now, updatedAt: now },
      ...state.notifications,
    ],
  };
}

export function declineTeamInvitation(state, invitationId) {
  const invitation = getTeamInvitation(state, invitationId);
  if (!invitation || invitation.status !== "pending" || invitation.targetUserId !== state.currentUserId) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    teamInvitations: (state.teamInvitations ?? []).map((item) => item.id === invitationId ? { ...item, status: "declined", updatedAt: now } : item),
  };
}

export function cancelTeamInvitation(state, invitationId) {
  const invitation = getTeamInvitation(state, invitationId);
  if (!invitation || invitation.status !== "pending") return state;
  const team = state.teams.find((item) => item.id === invitation.teamId);
  const captain = team?.members.find((member) => member.role === "captain");
  if (invitation.fromUserId !== state.currentUserId && captain?.userId !== state.currentUserId) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    teamInvitations: (state.teamInvitations ?? []).map((item) => item.id === invitationId ? { ...item, status: "cancelled", updatedAt: now } : item),
  };
}

export function updateTeamMemberRole(state, teamId, userId, role) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return state;
  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 관리 권한 없음",
          body: "팀장만 팀원을 관리할 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  if (role === "captain" || userId === captain.userId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀장 변경 제한",
          body: "팀장 이전은 별도 기능이 생길 때까지 지원하지 않습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  return {
    ...state,
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team;
      return {
        ...team,
        members: team.members.map((member) => (
          member.userId === userId ? { ...member, role: normalizeTeamInviteRole(role) } : member
        )),
      };
    }),
  };
}

export function removeTeamMember(state, teamId, userId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return state;
  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 관리 권한 없음",
          body: "팀장만 팀원을 관리할 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  if (userId === captain.userId || team.members.length <= 1) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀장 제외 제한",
          body: "팀장은 팀 삭제 또는 별도 이전 기능으로만 변경할 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  return {
    ...state,
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team;
      return {
        ...team,
        members: team.members.filter((member) => member.userId !== userId),
      };
    }),
  };
}
