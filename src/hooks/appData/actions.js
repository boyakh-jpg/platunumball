import { APP_ACTION_DEPENDENCIES } from "./actions/dependencies.js";
import { buildLoaderActions } from "./actions/loaderActions.js";
import { buildMatchActions } from "./actions/matchActions.js";
import { buildProfileTeamActions } from "./actions/profileTeamActions.js";
import { buildRecruitingActions } from "./actions/recruitingActions.js";
import { buildSettingsActions } from "./actions/settingsActions.js";
import { buildTeamMembershipActions } from "./actions/teamMembershipActions.js";

const {
  MATCH_OPERATION_ONLY_ACTIONS,
  RECRUITING_OPERATION_ONLY_ACTIONS,
  blockUser,
  getServerOperation,
  isSupabaseConfigured,
  makeClientNotificationId,
  unblockUser,
} = APP_ACTION_DEPENDENCIES;

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
    ...APP_ACTION_DEPENDENCIES,
    adminStatusRef,
    applyBlockedUserMutation,
    applyFavoriteToggle,
    applyMatchMutation,
    applyRecruitingPostMutation,
    applyTeamInvitationMutation,
    applyTeamMutation,
    authEmail,
    authUserId,
    currentUserId,
    deleteTeamServer,
    directoryStatusRef,
    ensureRemoteReady,
    ensureServerActionAvailable,
    getNewMatchNotifications,
    getNewRecruitingNotifications,
    getNewRefereeNotifications,
    getNewReportNotifications,
    getNewTeamNotifications,
    getNewTournamentNotifications,
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
    refreshRecruitingRelations,
    rollbackIfServerFailed,
    rollbackServerMutation,
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
    submitNameReport,
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
    upsertRefereeExamAttempt,
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
