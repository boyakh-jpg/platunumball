import { ADMIN_DEFAULT_PAGE_LIMIT } from "../../lib/queryPolicy.js";
import { DEFAULT_ADMIN_QUEUE_MODE } from "../../lib/queryPolicy.js";
import { DEFAULT_ADMIN_SECTION } from "../../lib/queryPolicy.js";
import { DEFAULT_RATING_POLICY } from "../../lib/ratingPolicy.js";
import { DIRECTORY_DEFAULT_PAGE_LIMIT } from "../../lib/queryPolicy.js";
import { EMPTY_RECORD_ARCHIVE } from "./recordArchive.js";
import { MATCH_OPERATION_ONLY_ACTIONS } from "./serverOperations.js";
import { RECRUITING_OPERATION_ONLY_ACTIONS } from "./serverOperations.js";
import { ROOM_CHAT_HISTORY_LIMIT } from "../../lib/roomChat.js";
import { ROOM_CHAT_MESSAGE_COLUMNS } from "../../lib/roomChat.js";
import { ROOM_CHAT_POLL_BATCH_LIMIT } from "../../lib/roomChat.js";
import { ROOM_CHAT_POLL_INTERVAL_MS } from "../../lib/roomChat.js";
import { acceptRecruitingInvitation } from "../../data/repository.js";
import { acceptTeamInvitation } from "../../data/repository.js";
import { acknowledgeMatchRoomRules } from "../../data/repository.js";
import { acknowledgeRecruitingRoomRules } from "../../data/repository.js";
import { activateTournamentSanction } from "../../data/repository.js";
import { agreeMatch } from "../../data/repository.js";
import { approveCourtRequest } from "../../data/repository.js";
import { approveMatch } from "../../data/repository.js";
import { approveTournamentReferee } from "../../data/repository.js";
import { approveTournamentTeam } from "../../data/repository.js";
import { assignTournamentMatchReferee } from "../../data/repository.js";
import { blockUser } from "../../data/repository.js";
import { cacheCurrentProfileState } from "./bootstrap.js";
import { cancelMatch } from "../../data/repository.js";
import { cancelRecruitingParticipation } from "../../data/repository.js";
import { cancelTeamInvitation } from "../../data/repository.js";
import { checkInMatchPlayer } from "../../data/repository.js";
import { cloneRatingPolicy } from "../../lib/ratingPolicy.js";
import { closeRecruitingPost } from "../../data/repository.js";
import { commitAdminAppointmentAction } from "../../data/repository.js";
import { commitAdminReviewAction } from "../../data/repository.js";
import { confirmMatchRefereeAbsence } from "../../data/repository.js";
import { confirmPickupSideAssignment } from "../../data/repository.js";
import { createInitialMatchListStore } from "./remoteMerge.js";
import { createMatch } from "../../data/repository.js";
import { createRecruitingPost } from "../../data/repository.js";
import { createTeam } from "../../data/repository.js";
import { createTournament } from "../../data/repository.js";
import { declineRecruitingInvitation } from "../../data/repository.js";
import { declineTeamInvitation } from "../../data/repository.js";
import { declineTournamentReferee } from "../../data/repository.js";
import { deleteNotification } from "../../data/repository.js";
import { deleteSoloRecord } from "../../data/repository.js";
import { deleteTeam } from "../../data/repository.js";
import { detachRecruitingPartyPlayer } from "../../data/repository.js";
import { disputeMatch } from "../../data/repository.js";
import { endMatch } from "../../data/repository.js";
import { finalizeMatchByAuthority } from "../../data/repository.js";
import { finishRefereeExamAttempt } from "../../data/repository.js";
import { forfeitTournamentMatch } from "../../data/repository.js";
import { generatePickupSideAssignment } from "../../data/repository.js";
import { getActionActorDebug } from "./serverOperations.js";
import { getAffiliationNormalizedKey } from "../../lib/affiliations.js";
import { getNewItems } from "./serverOperations.js";
import { getRecruitingChatLastSeq } from "./remoteMerge.js";
import { getServerActionErrorText } from "./serverOperations.js";
import { getServerOperation } from "./serverOperations.js";
import { incrementMatchScore } from "../../data/repository.js";
import { interestRecruitingPost } from "../../data/repository.js";
import { inviteRecruitingPlayers } from "../../data/repository.js";
import { inviteRecruitingReferee } from "../../data/repository.js";
import { inviteTeamMember } from "../../data/repository.js";
import { inviteTournamentReferee } from "../../data/repository.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { isSyntheticMatchRoomId } from "../../lib/recruiting.js";
import { joinRecruitingSideParty } from "../../data/repository.js";
import { kickRecruitingApplicant } from "../../data/repository.js";
import { makeClientNotificationId } from "./serverOperations.js";
import { markAllNotificationsRead } from "../../data/repository.js";
import { markNotificationRead } from "../../data/repository.js";
import { mergeCourtApprovalResult } from "./remoteMerge.js";
import { mergeRecruitingChatMessageBatch } from "./remoteMerge.js";
import { mergeRemoteProfileState } from "./remoteMerge.js";
import { normalizeAffiliationName } from "../../lib/affiliations.js";
import { normalizeServerState } from "./stateNormalization.js";
import { prepareTeamEmblemUpload } from "../../lib/teamEmblem.js";
import { rejectTournamentRegion } from "../../data/repository.js";
import { removeMatchRoomPlayer } from "../../data/repository.js";
import { removeRecruitingPartyPlayer } from "../../data/repository.js";
import { removeTeamMember } from "../../data/repository.js";
import { reportCourt } from "../../data/repository.js";
import { reportCourtRequest } from "../../data/repository.js";
import { reportCourtReview } from "../../data/repository.js";
import { reportMatch } from "../../data/repository.js";
import { reportPlayer } from "../../data/repository.js";
import { reportTeamEmblem } from "../../data/repository.js";
import { requestMatchRefereeAbsence } from "../../data/repository.js";
import { resetState } from "../../data/repository.js";
import { resolveMatchDispute } from "../../data/repository.js";
import { respondMatchScheduleProposal } from "../../data/repository.js";
import { respondRecruitingScheduleProposal } from "../../data/repository.js";
import { sendRecruitingChat } from "../../data/repository.js";
import { setMatchRecordParticipants } from "../../data/repository.js";
import { setMatchRecordTeamRoster } from "../../data/repository.js";
import { setMatchRoomPlayerPlacement } from "../../data/repository.js";
import { setRecruitingApplicantPlacement } from "../../data/repository.js";
import { setRecruitingApplicantReserve } from "../../data/repository.js";
import { setRecruitingPartyPlayerPlacement } from "../../data/repository.js";
import { setRecruitingPartyPlayerReserve } from "../../data/repository.js";
import { setRecruitingRoomTeam } from "../../data/repository.js";
import { setRecruitingSlotPosition } from "../../data/repository.js";
import { setRecruitingTeamPartyRoster } from "../../data/repository.js";
import { startMatch } from "../../data/repository.js";
import { startRefereeExamAttempt } from "../../data/repository.js";
import { submitCourtRequest } from "../../data/repository.js";
import { submitCourtReview } from "../../data/repository.js";
import { submitMatchResult } from "../../data/repository.js";
import { submitMatchThumbs } from "../../data/repository.js";
import { submitRefereeRequest } from "../../data/repository.js";
import { substituteMatchPlayer } from "../../data/repository.js";
import { supabase } from "../../lib/supabase.js";
import { swapPickupMatchPlayers } from "../../data/repository.js";
import { toggleFavoriteCourt } from "../../data/repository.js";
import { toggleFavoritePlayer } from "../../data/repository.js";
import { toggleFavoriteReferee } from "../../data/repository.js";
import { toggleFavoriteTeam } from "../../data/repository.js";
import { toggleMatchStar } from "../../data/repository.js";
import { unblockUser } from "../../data/repository.js";
import { updateMatchRoomRules } from "../../data/repository.js";
import { updatePrivacySettings } from "../../data/repository.js";
import { updateProfile } from "../../data/repository.js";
import { updateRecruitingRoomRules } from "../../data/repository.js";
import { updateSettings } from "../../data/repository.js";
import { updateTeamMemberRole } from "../../data/repository.js";
import { updateTournamentMatchSchedule } from "../../data/repository.js";
import { voidMatch } from "../../data/repository.js";
import { writeProfileBindings } from "../../lib/storage.js";
import { buildLoaderActions } from "./actions/loaderActions.js";
import { buildMatchActions } from "./actions/matchActions.js";
import { buildProfileTeamActions } from "./actions/profileTeamActions.js";
import { buildRecruitingActions } from "./actions/recruitingActions.js";
import { buildSettingsActions } from "./actions/settingsActions.js";
import { buildTeamMembershipActions } from "./actions/teamMembershipActions.js";

export function createAppActions({
  adminStatusRef,
  applyFavoriteToggle,
  authEmail,
  authUserId,
  blockedSettingsCommittedIdsRef,
  blockedSettingsPendingCountRef,
  blockedSettingsSyncRef,
  currentUserId,
  deleteTeamServer,
  directoryStatusRef,
  ensureRemoteReady,
  ensureServerActionAvailable,
  loadAdminContext,
  loadAdminSection,
  loadCourtDetail,
  loadDirectory,
  loadMatchDetail,
  loadMatchRecruitingSchedule,
  loadMatchTeamSchedule,
  loadMoreMatches,
  loadMoreRecruiting,
  loadNotifications,
  loadPlayMatches,
  loadProfileRecords,
  loadPublicProfileRecords,
  loadRecruitingPost,
  loadRecruitingRegion,
  loadReportableMatches,
  loadTeamRecords,
  markNotificationReadServer,
  persistProfileServer,
  profileKey,
  profileLocked,
  profileRecordArchiveRef,
  profileRecordsLoaded,
  publicProfileRecordArchivesRef,
  publicProfileRecordsPromiseRef,
  refreshAdminState,
  refreshCurrentProfile,
  runServerAction,
  serverProfileBound,
  setAdminState,
  setMatchLists,
  setProfileBindings,
  setProfileRecordArchive,
  setProfileRecordsLoaded,
  setPublicProfileRecordArchives,
  setState,
  setTeamRecordArchives,
  settingsAuthUserIdRef,
  stateRef,
  submitCourtDetailReview,
  submitReportServer,
  syncMatchServer,
  syncRecruitingPostServer,
  syncRefereeServer,
  syncSettingsServer,
  syncTeamInvitationServer,
  syncTeamServer,
  syncTournamentServer,
  teamRecordArchivesRef,
  themeCommittedValueRef,
  themeMutationVersionRef,
}) {
  const getNewRecruitingNotifications = (prev, next, postId) => {
    const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
    return (next.notifications ?? []).filter((notification) => (
      !beforeIds.has(notification.id) &&
      (notification.recruitingPostId === postId || notification.invitationId)
    ));
  };
  const getNewMatchNotifications = (prev, next, matchId) => {
    const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
    return (next.notifications ?? []).filter((notification) => !beforeIds.has(notification.id) && notification.matchId === matchId);
  };
  const getNewReportNotifications = (prev, next, report) => {
    const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
    return (next.notifications ?? []).filter((notification) => (
      !beforeIds.has(notification.id) &&
      (notification.matchId === report?.targetId || notification.type === "report" || !notification.targetUserId)
    ));
  };
  const getNewTeamNotifications = (prev, next) => {
    const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
    return (next.notifications ?? []).filter((notification) => (
      !beforeIds.has(notification.id) &&
      (notification.tone === "team" || notification.type === "team" || !notification.targetUserId)
    ));
  };
  const getNewTournamentNotifications = (prev, next) => {
    const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
    return (next.notifications ?? []).filter((notification) => (
      !beforeIds.has(notification.id) &&
      !notification.matchId &&
      (notification.type === "tournament" || notification.tone === "match" || !notification.targetUserId)
    ));
  };
  const getNewRefereeNotifications = (prev, next) => {
    const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
    return (next.notifications ?? []).filter((notification) => (
      !beforeIds.has(notification.id) &&
      (notification.type === "referee" || notification.tone === "team" || !notification.targetUserId)
    ));
  };
  const upsertRefereeExamAttempt = (attempt) => {
    if (!attempt?.id) return;
    setState((prev) => {
      const attempts = prev.settings?.refereeExamAttempts ?? [];
      return {
        ...prev,
        settings: {
          ...(prev.settings ?? {}),
          refereeExamAttempts: [attempt, ...attempts.filter((item) => item.id !== attempt.id)],
        },
      };
    });
  };
  const rollbackServerMutation = (snapshot, label, payload = {}) => {
    if (!snapshot) return;
    setState({
      ...snapshot,
      notifications: [
        {
          id: makeClientNotificationId("n"),
          title: "저장하지 못했습니다",
          body: "변경 내용을 저장하지 못해 화면을 이전 상태로 되돌렸습니다. 잠시 후 다시 시도해 주세요.",
          tone: "orange",
          createdAt: new Date().toISOString(),
          payload,
        },
        ...(snapshot.notifications ?? []),
      ],
    });
  };
  const rollbackIfServerFailed = (promise, snapshot, label, payload = {}) => {
    return Promise.resolve(promise).then((result) => {
      if (!result || result.ok === false) {
        rollbackServerMutation(snapshot, label, {
          ...payload,
          error: result?.error ?? payload.error,
          statusCode: result?.statusCode ?? payload.statusCode,
          details: result?.details ?? payload.details,
        });
        return result || false;
      }
      return result;
    });
  };
  const submitNameReport = async (type, targetId, reason, targetName = "") => {
    if (!targetId) return { ok: false, error: "missing_report_target" };
    const report = {
      id: makeClientNotificationId("r"),
      type,
      targetId,
      by: currentUserId,
      reportedUserIds: [],
      reason: String(reason || "부적절한 이름").trim().slice(0, 500),
      targetName,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    if (!isSupabaseConfigured) {
      setState((prev) => ({ ...prev, reports: [report, ...(prev.reports ?? [])] }));
      return { ok: true, reportId: report.id };
    }
    const serverReady = await ensureServerActionAvailable("/api/reports/submit", "이름 신고");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("이름 신고")) return { ok: false, error: "remote_not_ready" };
    const result = await submitReportServer(report, []);
    if (result?.ok !== false && !result?.duplicate) {
      setState((prev) => ({
        ...prev,
        reports: (prev.reports ?? []).some((item) => item.id === report.id) ? prev.reports : [report, ...(prev.reports ?? [])],
      }));
    }
    return result;
  };
  const applyBlockedUserMutation = (userId, shouldBlock) => {
    if (!userId) return Promise.resolve(false);
    if (!isSupabaseConfigured) {
      setState((prev) => (shouldBlock
        ? blockUser({ ...prev, currentUserId }, userId)
        : unblockUser({ ...prev, currentUserId }, userId)));
      return Promise.resolve(true);
    }
    const runMutation = async () => {
      const blockedUserIds = blockedSettingsCommittedIdsRef.current;
      const nextBlockedUserIds = shouldBlock
        ? Array.from(new Set([...blockedUserIds, userId]))
        : blockedUserIds.filter((blockedUserId) => blockedUserId !== userId);
      const result = await syncSettingsServer({ blockedUserIds: nextBlockedUserIds });
      if (!result || result.ok === false) return result || false;
      blockedSettingsCommittedIdsRef.current = nextBlockedUserIds;
      setState((prev) => (shouldBlock
        ? blockUser({ ...prev, currentUserId }, userId)
        : unblockUser({ ...prev, currentUserId }, userId)));
      return result;
    };
    blockedSettingsPendingCountRef.current += 1;
    const queuedMutation = blockedSettingsSyncRef.current
      .catch(() => false)
      .then(runMutation)
      .finally(() => {
        blockedSettingsPendingCountRef.current = Math.max(0, blockedSettingsPendingCountRef.current - 1);
      });
    blockedSettingsSyncRef.current = queuedMutation;
    return queuedMutation;
  };
  const applyRecruitingPostMutation = async (postId, reducer, meta = {}) => {
    const operation = getServerOperation({ ...meta, postId });
    const optimisticBeforeServerCheck = meta.optimisticBeforeServerCheck === true;
    let rollbackState = null;
    let syncedPost = null;
    let syncedNotifications = [];
    const directServerOperation = isSupabaseConfigured && operation && RECRUITING_OPERATION_ONLY_ACTIONS.has(operation.action);
    const applyLocalMutation = () => setState((prev) => {
      rollbackState = prev;
      const beforePost = (prev.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
      const next = reducer(prev);
      const nextPost = (next.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
      syncedPost = nextPost && nextPost !== beforePost ? nextPost : null;
      syncedNotifications = syncedPost ? getNewRecruitingNotifications(prev, next, postId) : [];
      return !syncedPost && operation && isSupabaseConfigured ? prev : next;
    });
    if (optimisticBeforeServerCheck && !directServerOperation) applyLocalMutation();
    const serverReady = await ensureServerActionAvailable("/api/recruiting/sync-post", "방 변경", { quiet: optimisticBeforeServerCheck });
    if (serverReady !== true) {
      if (optimisticBeforeServerCheck) rollbackServerMutation(rollbackState, "방 변경", { action: meta.action, postId, error: serverReady?.error });
      return serverReady;
    }
    if (!ensureRemoteReady("방 변경")) {
      if (optimisticBeforeServerCheck) rollbackServerMutation(rollbackState, "방 변경", { action: meta.action, postId, error: "remote_not_ready" });
      return;
    }
    if (directServerOperation) {
      return syncRecruitingPostServer(null, [], { ...meta, postId });
    }
    if (!optimisticBeforeServerCheck) applyLocalMutation();
    if (operation?.action === "sendRecruitingChat" || RECRUITING_OPERATION_ONLY_ACTIONS.has(operation?.action)) return rollbackIfServerFailed(syncRecruitingPostServer(null, [], { ...meta, postId }), rollbackState, "방 변경", { action: meta.action, postId });
    if (syncedPost) return rollbackIfServerFailed(syncRecruitingPostServer(syncedPost, syncedNotifications, { ...meta, postId }), rollbackState, "방 변경", { action: meta.action, postId });
    if (operation) return rollbackIfServerFailed(syncRecruitingPostServer(null, [], { ...meta, postId }), rollbackState, "방 변경", { action: meta.action, postId });
    return true;
  };
  const applyMatchMutation = async (matchId, reducer, meta = {}) => {
    const serverReady = await ensureServerActionAvailable("/api/matches/sync-match", "경기 변경");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("경기 변경")) return;
    const operation = getServerOperation({ ...meta, matchId });
    if (isSupabaseConfigured && operation && MATCH_OPERATION_ONLY_ACTIONS.has(operation.action)) {
      const currentMatch = (stateRef.current.matches ?? []).find((match) => match.id === matchId) ?? null;
      return syncMatchServer(null, [], {
        ...meta,
        matchId,
        baseUpdatedAt: currentMatch?.updatedAt ?? currentMatch?.createdAt ?? null,
      });
    }
    let rollbackState = null;
    let baseUpdatedAt = null;
    let syncedMatch = null;
    let syncedNotifications = [];
    setState((prev) => {
      rollbackState = prev;
      const beforeMatch = (prev.matches ?? []).find((match) => match.id === matchId) ?? null;
      baseUpdatedAt = beforeMatch?.updatedAt ?? beforeMatch?.createdAt ?? null;
      const next = reducer(prev);
      const nextMatch = (next.matches ?? []).find((match) => match.id === matchId) ?? null;
      syncedMatch = nextMatch && nextMatch !== beforeMatch ? nextMatch : null;
      syncedNotifications = syncedMatch ? getNewMatchNotifications(prev, next, matchId) : [];
      return !syncedMatch && operation && isSupabaseConfigured ? prev : next;
    });
    const syncMeta = { ...meta, matchId, baseUpdatedAt };
    if (operation && MATCH_OPERATION_ONLY_ACTIONS.has(operation.action)) {
      return rollbackIfServerFailed(syncMatchServer(null, [], syncMeta), rollbackState, "경기 변경", { action: meta.action, matchId });
    }
    if (syncedMatch) return rollbackIfServerFailed(syncMatchServer(syncedMatch, syncedNotifications, syncMeta), rollbackState, "경기 변경", { action: meta.action, matchId });
    if (operation) return rollbackIfServerFailed(syncMatchServer(null, [], syncMeta), rollbackState, "경기 변경", { action: meta.action, matchId });
    return true;
  };
  const applyTeamMutation = async (teamId, reducer) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/sync-team", "팀 변경");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("팀 변경")) return;
    let rollbackState = null;
    let syncedTeam = null;
    let syncedNotifications = [];
    setState((prev) => {
      rollbackState = prev;
      const beforeTeam = (prev.teams ?? []).find((team) => team.id === teamId) ?? null;
      const next = reducer(prev);
      const nextTeam = (next.teams ?? []).find((team) => team.id === teamId) ?? null;
      syncedTeam = nextTeam && nextTeam !== beforeTeam ? nextTeam : null;
      syncedNotifications = syncedTeam ? getNewTeamNotifications(prev, next) : [];
      return next;
    });
    if (syncedTeam) rollbackIfServerFailed(syncTeamServer(syncedTeam, syncedNotifications), rollbackState, "팀 변경", { teamId });
  };
  const applyTeamInvitationMutation = async (label, reducer, action, payloadFactory) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/sync-team", label);
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady(label)) return;
    let rollbackState = null;
    let nextStateSnapshot = null;
    setState((prev) => {
      rollbackState = prev;
      const next = reducer(prev);
      nextStateSnapshot = next;
      return next;
    });
    const payload = payloadFactory?.(rollbackState, nextStateSnapshot) ?? {};
    return rollbackIfServerFailed(syncTeamInvitationServer(action, payload), rollbackState, label, { action, ...payload });
  };
  const refreshRecruitingRelations = (result = {}, fallbackPostId = "") => {
    const refreshPostId = result?.post?.id ?? result?.postId ?? fallbackPostId;
    if (!refreshPostId) return Promise.resolve(true);
    return loadRecruitingPost(refreshPostId);
  };

  const actionContext = {
    ADMIN_DEFAULT_PAGE_LIMIT,
    DEFAULT_ADMIN_QUEUE_MODE,
    DEFAULT_ADMIN_SECTION,
    DEFAULT_RATING_POLICY,
    DIRECTORY_DEFAULT_PAGE_LIMIT,
    EMPTY_RECORD_ARCHIVE,
    ROOM_CHAT_HISTORY_LIMIT,
    ROOM_CHAT_MESSAGE_COLUMNS,
    ROOM_CHAT_POLL_BATCH_LIMIT,
    ROOM_CHAT_POLL_INTERVAL_MS,
    acceptRecruitingInvitation,
    acceptTeamInvitation,
    acknowledgeMatchRoomRules,
    acknowledgeRecruitingRoomRules,
    activateTournamentSanction,
    adminStatusRef,
    agreeMatch,
    applyBlockedUserMutation,
    applyFavoriteToggle,
    applyMatchMutation,
    applyRecruitingPostMutation,
    applyTeamInvitationMutation,
    applyTeamMutation,
    approveCourtRequest,
    approveMatch,
    approveTournamentReferee,
    approveTournamentTeam,
    assignTournamentMatchReferee,
    authEmail,
    authUserId,
    cacheCurrentProfileState,
    cancelMatch,
    cancelRecruitingParticipation,
    cancelTeamInvitation,
    checkInMatchPlayer,
    cloneRatingPolicy,
    closeRecruitingPost,
    commitAdminAppointmentAction,
    commitAdminReviewAction,
    confirmMatchRefereeAbsence,
    confirmPickupSideAssignment,
    createInitialMatchListStore,
    createMatch,
    createRecruitingPost,
    createTeam,
    createTournament,
    currentUserId,
    declineRecruitingInvitation,
    declineTeamInvitation,
    declineTournamentReferee,
    deleteNotification,
    deleteSoloRecord,
    deleteTeam,
    deleteTeamServer,
    detachRecruitingPartyPlayer,
    directoryStatusRef,
    disputeMatch,
    endMatch,
    ensureRemoteReady,
    ensureServerActionAvailable,
    finalizeMatchByAuthority,
    finishRefereeExamAttempt,
    forfeitTournamentMatch,
    generatePickupSideAssignment,
    getActionActorDebug,
    getAffiliationNormalizedKey,
    getNewItems,
    getNewMatchNotifications,
    getNewRecruitingNotifications,
    getNewRefereeNotifications,
    getNewReportNotifications,
    getNewTeamNotifications,
    getNewTournamentNotifications,
    getRecruitingChatLastSeq,
    getServerActionErrorText,
    incrementMatchScore,
    interestRecruitingPost,
    inviteRecruitingPlayers,
    inviteRecruitingReferee,
    inviteTeamMember,
    inviteTournamentReferee,
    isSupabaseConfigured,
    isSyntheticMatchRoomId,
    joinRecruitingSideParty,
    kickRecruitingApplicant,
    loadAdminContext,
    loadAdminSection,
    loadCourtDetail,
    loadDirectory,
    loadMatchDetail,
    loadMatchRecruitingSchedule,
    loadMatchTeamSchedule,
    loadMoreMatches,
    loadMoreRecruiting,
    loadNotifications,
    loadPlayMatches,
    loadProfileRecords,
    loadPublicProfileRecords,
    loadRecruitingPost,
    loadRecruitingRegion,
    loadReportableMatches,
    loadTeamRecords,
    markAllNotificationsRead,
    markNotificationRead,
    markNotificationReadServer,
    mergeCourtApprovalResult,
    mergeRecruitingChatMessageBatch,
    mergeRemoteProfileState,
    normalizeAffiliationName,
    normalizeServerState,
    persistProfileServer,
    prepareTeamEmblemUpload,
    profileKey,
    profileLocked,
    profileRecordArchiveRef,
    profileRecordsLoaded,
    publicProfileRecordArchivesRef,
    publicProfileRecordsPromiseRef,
    refreshAdminState,
    refreshCurrentProfile,
    refreshRecruitingRelations,
    rejectTournamentRegion,
    removeMatchRoomPlayer,
    removeRecruitingPartyPlayer,
    removeTeamMember,
    reportCourt,
    reportCourtRequest,
    reportCourtReview,
    reportMatch,
    reportPlayer,
    reportTeamEmblem,
    requestMatchRefereeAbsence,
    resetState,
    resolveMatchDispute,
    respondMatchScheduleProposal,
    respondRecruitingScheduleProposal,
    rollbackIfServerFailed,
    rollbackServerMutation,
    runServerAction,
    sendRecruitingChat,
    serverProfileBound,
    setAdminState,
    setMatchLists,
    setMatchRecordParticipants,
    setMatchRecordTeamRoster,
    setMatchRoomPlayerPlacement,
    setProfileBindings,
    setProfileRecordArchive,
    setProfileRecordsLoaded,
    setPublicProfileRecordArchives,
    setRecruitingApplicantPlacement,
    setRecruitingApplicantReserve,
    setRecruitingPartyPlayerPlacement,
    setRecruitingPartyPlayerReserve,
    setRecruitingRoomTeam,
    setRecruitingSlotPosition,
    setRecruitingTeamPartyRoster,
    setState,
    setTeamRecordArchives,
    settingsAuthUserIdRef,
    startMatch,
    startRefereeExamAttempt,
    stateRef,
    submitCourtDetailReview,
    submitCourtRequest,
    submitCourtReview,
    submitMatchResult,
    submitMatchThumbs,
    submitNameReport,
    submitRefereeRequest,
    submitReportServer,
    substituteMatchPlayer,
    supabase,
    swapPickupMatchPlayers,
    syncMatchServer,
    syncRecruitingPostServer,
    syncRefereeServer,
    syncSettingsServer,
    syncTeamServer,
    syncTournamentServer,
    teamRecordArchivesRef,
    themeCommittedValueRef,
    themeMutationVersionRef,
    toggleFavoriteCourt,
    toggleFavoritePlayer,
    toggleFavoriteReferee,
    toggleFavoriteTeam,
    toggleMatchStar,
    updateMatchRoomRules,
    updatePrivacySettings,
    updateProfile,
    updateRecruitingRoomRules,
    updateSettings,
    updateTeamMemberRole,
    updateTournamentMatchSchedule,
    upsertRefereeExamAttempt,
    voidMatch,
    writeProfileBindings,
  };

  return ({
    ...buildLoaderActions(actionContext),
    ...buildMatchActions(actionContext),
    ...buildSettingsActions(actionContext),
    ...buildProfileTeamActions(actionContext),
    ...buildRecruitingActions(actionContext),
    ...buildTeamMembershipActions(actionContext),
  });
}
