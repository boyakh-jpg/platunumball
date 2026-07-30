import { ADMIN_DEFAULT_PAGE_LIMIT } from "../../lib/queryPolicy.js";
import { DEFAULT_ADMIN_QUEUE_MODE } from "../../lib/queryPolicy.js";
import { DEFAULT_ADMIN_SECTION } from "../../lib/queryPolicy.js";
import { DEFAULT_RATING } from "../../lib/constants.js";
import { DIRECTORY_CACHE_TTL_MS } from "../../lib/queryPolicy.js";
import { MATCH_LIST_SCOPES } from "../../lib/matchUtils.js";
import { MATCH_LIST_STATUSES } from "../../lib/matchUtils.js";
import { REMOTE_CLIENT_INITIAL_MATCH_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_MATCH_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_RECORD_MATCH_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../lib/constants.js";
import { REPORT_MATCH_WINDOW_MS } from "../../lib/constants.js";
import { clearDemoStorage } from "../../lib/storage.js";
import { createMatchListStore } from "../../lib/matchUtils.js";
import { createProfileShell } from "../../data/repository.js";
import { getDirectoryPageRequest } from "../../lib/queryPolicy.js";
import { getMatchEntityMap } from "../../lib/matchUtils.js";
import { getServerActionAvailability } from "../../lib/serverActions.js";
import { hasDemoInitialState } from "../../data/repository.js";
import { hasModeRating } from "../../lib/rating.js";
import { isPlacementComplete } from "../../lib/rating.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { isSyntheticMatchRoomId } from "../../lib/recruiting.js";
import { loadState } from "../../data/repository.js";
import { normalizeAdminQueueMode } from "../../lib/queryPolicy.js";
import { normalizeAdminSection } from "../../lib/queryPolicy.js";
import { postServerAction } from "../../lib/serverActions.js";
import { readProfileBindings } from "../../lib/storage.js";
import { runAutomaticStateMaintenance } from "../../data/repository.js";
import { saveState } from "../../data/repository.js";
import { subscribeRemoteState } from "../../data/repository.js";
import { syncNotificationDeliveries } from "../../data/repository.js";
import { updateMatchListScope } from "../../lib/matchUtils.js";
import { updateProfile } from "../../data/repository.js";
import { updateSettings } from "../../data/repository.js";
import { useCallback } from "react";
import { useEffect } from "react";
import { useMemo } from "react";
import { useRef } from "react";
import { useState } from "react";
import { writeProfileBindings } from "../../lib/storage.js";
import { cacheCurrentProfileState } from "./bootstrap.js";
import { ensureLocalDemoInitialState } from "./bootstrap.js";
import { getCachedBootstrapState } from "./bootstrap.js";
import { getHomeRouteLoadKey } from "./bootstrap.js";
import { getInitialStateLoadOptions } from "./bootstrap.js";
import { loadBackendStateWithHomeRetry } from "./bootstrap.js";
import { loadProfileState } from "./bootstrap.js";
import { EMPTY_ADMIN_CONTEXT } from "./metadata.js";
import { getBoundAuthProfileId } from "./metadata.js";
import { getRemoteMeta } from "./metadata.js";
import { normalizeAdminContext } from "./metadata.js";
import { preserveLocalDiscordState } from "./metadata.js";
import { withServerAdminContext } from "./metadata.js";
import { EMPTY_RECORD_ARCHIVE } from "./recordArchive.js";
import { LOCAL_MAINTENANCE_INTERVAL_MS } from "./recordArchive.js";
import { mergeRecordArchiveRows } from "./recordArchive.js";
import { mergeRecordPage } from "./recordArchive.js";
import { normalizeRecordArchiveOffset } from "./recordArchive.js";
import { createInitialMatchListStore } from "./remoteMerge.js";
import { filterBlockedIncomingNotifications } from "./remoteMerge.js";
import { filterPendingMatches } from "./remoteMerge.js";
import { filterPendingRecruitingPosts } from "./remoteMerge.js";
import { getBlockedUserIdsFromState } from "./remoteMerge.js";
import { getMatchPaginationCursor } from "./remoteMerge.js";
import { getRecruitingPaginationCursor } from "./remoteMerge.js";
import { getRecruitingPaginationOffset } from "./remoteMerge.js";
import { getRecruitingRegionRequest } from "./remoteMerge.js";
import { getRecruitingStartFilterRequest } from "./remoteMerge.js";
import { getStateMatchIds } from "./remoteMerge.js";
import { getStateRecruitingPostIds } from "./remoteMerge.js";
import { mergeMatchThumbsResult } from "./remoteMerge.js";
import { mergeRecruitingChatMessage } from "./remoteMerge.js";
import { mergeRemoteAdminState } from "./remoteMerge.js";
import { mergeRemoteDirectory } from "./remoteMerge.js";
import { mergeRemoteHomeState } from "./remoteMerge.js";
import { mergeRemoteMatchPage } from "./remoteMerge.js";
import { mergeRemoteProfileState } from "./remoteMerge.js";
import { mergeRemoteRecruitingPage } from "./remoteMerge.js";
import { mergeRemoteTournamentState } from "./remoteMerge.js";
import { mergeServerRoomResult } from "./remoteMerge.js";
import { getServerActionErrorText } from "./serverOperations.js";
import { getServerOperation } from "./serverOperations.js";
import { isPersistentAuthUserId } from "./serverOperations.js";
import { makeClientNotificationId } from "./serverOperations.js";
import { sortByRating } from "./serverOperations.js";
import { normalizeServerState } from "./stateNormalization.js";
import { createAppActions } from "./actions.js";
import { useAppDataAdmin } from "./orchestrator/admin.js";
import { useAppDataLoaders } from "./orchestrator/loaders.js";
import { useAppDataRuntime } from "./orchestrator/runtime.js";
import { useAppDataServerActions } from "./orchestrator/serverActions.js";

export function useAppData(authUser = null, appLocation = null) {
  const {
    adminCacheRef,
    adminContext,
    adminContextLoadedAuthRef,
    adminContextPromiseRef,
    adminContextRef,
    adminPromiseRef,
    adminState,
    adminStatus,
    adminStatusRef,
    authEmail,
    authGenerationRef,
    authUserId,
    blockedSettingsCommittedIdsRef,
    blockedSettingsPendingCountRef,
    blockedSettingsSyncRef,
    currentUserId,
    directoryCacheRef,
    directoryPromiseRef,
    directoryStatus,
    directoryStatusRef,
    latestAdminRequestRef,
    latestDirectoryRequestRef,
    latestRecruitingLoadMoreRequestRef,
    latestRecruitingRegionRequestRef,
    matchDetailPromiseRef,
    matchLists,
    matchPagePromiseRef,
    matchPagination,
    matchRecruitingSchedulePromiseRef,
    matchTeamSchedulePromiseRef,
    pendingMatchIdsRef,
    pendingMatchMutationCountsRef,
    pendingRecruitingPostIdsRef,
    playMatchesPromiseRef,
    profileBindings,
    profileKey,
    profileLocked,
    profileRecordArchive,
    profileRecordArchiveRef,
    profileRecordsLoaded,
    profileRecordsPromiseRef,
    profileRefreshPromiseRef,
    publicProfileRecordArchives,
    publicProfileRecordArchivesRef,
    publicProfileRecordsPromiseRef,
    recentMatchMutationTimesRef,
    recentRecruitingMutationTimesRef,
    recruitingPagePromiseRef,
    recruitingPagination,
    recruitingPostPromiseRef,
    recruitingRegionPromiseRef,
    remoteReady,
    remoteReadyRef,
    reportableMatchesPromiseRef,
    serverActionPendingCount,
    serverProfileBound,
    setAdminContext,
    setAdminState,
    setAdminStatus,
    setDirectoryStatus,
    setMatchLists,
    setMatchPagination,
    setProfileBindings,
    setProfileRecordArchive,
    setProfileRecordsLoaded,
    setPublicProfileRecordArchives,
    setRecruitingPagination,
    setServerActionPendingCount,
    setState,
    setTeamRecordArchives,
    settingsAuthUserIdRef,
    settingsSyncQueueRef,
    state,
    stateRef,
    syncedDiscordDeliveryIdsRef,
    teamRecordArchives,
    teamRecordArchivesRef,
    teamRecordsPromiseRef,
    themeCommittedValueRef,
    themeMutationVersionRef,
  } = useAppDataRuntime({
    DEFAULT_ADMIN_QUEUE_MODE,
    EMPTY_ADMIN_CONTEXT,
    EMPTY_RECORD_ARCHIVE,
    LOCAL_MAINTENANCE_INTERVAL_MS,
    MATCH_LIST_SCOPES,
    MATCH_LIST_STATUSES,
    REMOTE_CLIENT_MATCH_LIMIT,
    REMOTE_CLIENT_RECRUITING_LIMIT,
    appLocation,
    authUser,
    cacheCurrentProfileState,
    clearDemoStorage,
    createInitialMatchListStore,
    createMatchListStore,
    createProfileShell,
    ensureLocalDemoInitialState,
    getBlockedUserIdsFromState,
    getBoundAuthProfileId,
    getCachedBootstrapState,
    getHomeRouteLoadKey,
    getInitialStateLoadOptions,
    getMatchPaginationCursor,
    getRecruitingPaginationCursor,
    getRecruitingPaginationOffset,
    getRecruitingRegionRequest,
    getRecruitingStartFilterRequest,
    getRemoteMeta,
    getStateMatchIds,
    getStateRecruitingPostIds,
    hasDemoInitialState,
    isPersistentAuthUserId,
    isSupabaseConfigured,
    loadBackendStateWithHomeRetry,
    loadProfileState,
    loadState,
    mergeRemoteHomeState,
    preserveLocalDiscordState,
    readProfileBindings,
    runAutomaticStateMaintenance,
    saveState,
    subscribeRemoteState,
    syncNotificationDeliveries,
    updateMatchListScope,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    withServerAdminContext,
  });

  const {
    loadAdminContext,
    loadAdminSection,
    refreshAdminState,
    trackedPostServerAction,
  } = useAppDataAdmin({
    ADMIN_DEFAULT_PAGE_LIMIT,
    DEFAULT_ADMIN_QUEUE_MODE,
    DEFAULT_ADMIN_SECTION,
    DIRECTORY_CACHE_TTL_MS,
    EMPTY_ADMIN_CONTEXT,
    adminCacheRef,
    adminContextLoadedAuthRef,
    adminContextPromiseRef,
    adminContextRef,
    adminPromiseRef,
    adminStatusRef,
    authEmail,
    authGenerationRef,
    authUserId,
    currentUserId,
    getDirectoryPageRequest,
    isSupabaseConfigured,
    latestAdminRequestRef,
    mergeRemoteAdminState,
    normalizeAdminContext,
    normalizeAdminQueueMode,
    normalizeAdminSection,
    normalizeServerState,
    postServerAction,
    profileBindings,
    profileKey,
    profileLocked,
    setAdminContext,
    setAdminState,
    setAdminStatus,
    setProfileBindings,
    setServerActionPendingCount,
    setState,
    updateProfile,
    useCallback,
    useEffect,
    withServerAdminContext,
    writeProfileBindings,
  });

  const {
    applyFavoriteToggle,
    currentUser,
    deleteTeamServer,
    ensureRemoteReady,
    ensureServerActionAvailable,
    loadNotifications,
    markNotificationReadServer,
    persistProfileServer,
    refreshCurrentProfile,
    runServerAction,
    submitReportServer,
    syncMatchServer,
    syncRecruitingPostServer,
    syncRefereeServer,
    syncSettingsServer,
    syncTeamInvitationServer,
    syncTeamServer,
    syncTournamentServer,
  } = useAppDataServerActions({
    MATCH_LIST_SCOPES,
    authEmail,
    authGenerationRef,
    authUserId,
    cacheCurrentProfileState,
    createProfileShell,
    currentUserId,
    filterBlockedIncomingNotifications,
    getServerActionAvailability,
    getServerActionErrorText,
    getServerOperation,
    isSupabaseConfigured,
    loadProfileState,
    makeClientNotificationId,
    mergeMatchThumbsResult,
    mergeRecruitingChatMessage,
    mergeRemoteProfileState,
    mergeRemoteTournamentState,
    mergeServerRoomResult,
    normalizeServerState,
    pendingMatchIdsRef,
    pendingMatchMutationCountsRef,
    pendingRecruitingPostIdsRef,
    profileLocked,
    profileRefreshPromiseRef,
    recentMatchMutationTimesRef,
    recentRecruitingMutationTimesRef,
    remoteReadyRef,
    setMatchLists,
    setState,
    settingsAuthUserIdRef,
    settingsSyncQueueRef,
    state,
    stateRef,
    trackedPostServerAction,
    updateMatchListScope,
    updateSettings,
    useCallback,
    useMemo,
  });

  const {
    loadCourtDetail,
    loadDirectory,
    loadMatchDetail,
    loadMatchRecruitingSchedule,
    loadMatchTeamSchedule,
    loadMoreMatches,
    loadMoreRecruiting,
    loadPlayMatches,
    loadProfileRecords,
    loadPublicProfileRecords,
    loadRecruitingPost,
    loadRecruitingRegion,
    loadReportableMatches,
    loadTeamRecords,
    submitCourtDetailReview,
  } = useAppDataLoaders({
    DIRECTORY_CACHE_TTL_MS,
    EMPTY_RECORD_ARCHIVE,
    MATCH_LIST_SCOPES,
    MATCH_LIST_STATUSES,
    REMOTE_CLIENT_INITIAL_MATCH_LIMIT,
    REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
    REMOTE_CLIENT_MATCH_LIMIT,
    REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT,
    REMOTE_CLIENT_RECORD_MATCH_LIMIT,
    REMOTE_CLIENT_RECRUITING_LIMIT,
    REPORT_MATCH_WINDOW_MS,
    authEmail,
    authGenerationRef,
    authUserId,
    currentUserId,
    directoryCacheRef,
    directoryPromiseRef,
    filterPendingMatches,
    filterPendingRecruitingPosts,
    getDirectoryPageRequest,
    getMatchPaginationCursor,
    getRecruitingPaginationOffset,
    getRecruitingRegionRequest,
    getRecruitingStartFilterRequest,
    getStateMatchIds,
    getStateRecruitingPostIds,
    isSupabaseConfigured,
    isSyntheticMatchRoomId,
    latestDirectoryRequestRef,
    latestRecruitingLoadMoreRequestRef,
    latestRecruitingRegionRequestRef,
    matchDetailPromiseRef,
    matchPagePromiseRef,
    matchPagination,
    matchRecruitingSchedulePromiseRef,
    matchTeamSchedulePromiseRef,
    mergeRecordArchiveRows,
    mergeRecordPage,
    mergeRemoteDirectory,
    mergeRemoteMatchPage,
    mergeRemoteRecruitingPage,
    normalizeRecordArchiveOffset,
    normalizeServerState,
    pendingMatchIdsRef,
    pendingRecruitingPostIdsRef,
    playMatchesPromiseRef,
    profileRecordArchiveRef,
    profileRecordsLoaded,
    profileRecordsPromiseRef,
    publicProfileRecordArchivesRef,
    publicProfileRecordsPromiseRef,
    recentMatchMutationTimesRef,
    recentRecruitingMutationTimesRef,
    recruitingPagePromiseRef,
    recruitingPagination,
    recruitingPostPromiseRef,
    recruitingRegionPromiseRef,
    reportableMatchesPromiseRef,
    runServerAction,
    setDirectoryStatus,
    setMatchLists,
    setMatchPagination,
    setProfileRecordArchive,
    setProfileRecordsLoaded,
    setPublicProfileRecordArchives,
    setRecruitingPagination,
    setState,
    setTeamRecordArchives,
    state,
    teamRecordArchivesRef,
    teamRecordsPromiseRef,
    trackedPostServerAction,
    updateMatchListScope,
    useCallback,
  });

useEffect(() => {
    if (!isSupabaseConfigured || !remoteReadyRef.current || !currentUserId) return;
    const deliveries = (state.discordNotificationDeliveries ?? [])
      .filter((delivery) => delivery?.id && delivery.status === "queued")
      .filter((delivery) => delivery.targetUserId === currentUserId)
      .filter((delivery) => !syncedDiscordDeliveryIdsRef.current.has(delivery.id));
    if (!deliveries.length) return;

    deliveries.forEach((delivery) => syncedDiscordDeliveryIdsRef.current.add(delivery.id));
    postServerAction("/api/discord/sync-deliveries", { deliveries }, { allowWhenDisabled: true }).catch((error) => {
      deliveries.forEach((delivery) => syncedDiscordDeliveryIdsRef.current.delete(delivery.id));
      console.warn("Discord delivery sync failed.", error.message);
    });
  }, [currentUserId, state.discordNotificationDeliveries]);

  const rankings = useMemo(
    () => ({
      players: sortByRating(state.users.filter((user) => isPlacementComplete(user.ratings)), (user) => user.ratings?.integrated ?? DEFAULT_RATING),
      mode: (mode) => sortByRating(
        state.users.filter((user) => isPlacementComplete(user.ratings) && hasModeRating(user.ratings, mode)),
        (user) => user.ratings?.modes?.[mode] ?? DEFAULT_RATING,
      ),
      teams: sortByRating(state.teams, (team) => team.mmr),
      affiliations: sortByRating(state.affiliations.filter((affiliation) => affiliation.type !== "club"), (affiliation) => affiliation.score),
    }),
    [state.affiliations, state.teams, state.users],
  );

  const actions = useMemo(
    () => createAppActions({
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
    }),
    [applyFavoriteToggle, authEmail, authUserId, currentUserId, deleteTeamServer, ensureRemoteReady, ensureServerActionAvailable, loadAdminContext, loadAdminSection, loadCourtDetail, loadDirectory, loadMatchDetail, loadMatchRecruitingSchedule, loadMatchTeamSchedule, loadMoreMatches, loadMoreRecruiting, loadNotifications, loadRecruitingRegion, loadRecruitingPost, loadPlayMatches, loadReportableMatches, loadProfileRecords, loadPublicProfileRecords, loadTeamRecords, profileRecordsLoaded, markNotificationReadServer, persistProfileServer, profileKey, profileLocked, refreshAdminState, refreshCurrentProfile, runServerAction, serverProfileBound, submitCourtDetailReview, submitReportServer, syncMatchServer, syncRecruitingPostServer, syncRefereeServer, syncSettingsServer, syncTeamInvitationServer, syncTeamServer, syncTournamentServer],
  );

  const safeCurrentUserId = currentUserId ?? currentUser?.id ?? "";
  const safeCurrentUser = currentUser
    ? { ...currentUser, representativeTeamId: state.settings?.representativeTeamId ?? currentUser.representativeTeamId ?? "" }
    : createProfileShell(authUserId ?? safeCurrentUserId, authEmail);
  const matchEntities = useMemo(() => getMatchEntityMap(state.matches), [state.matches]);
  return {
    state: { ...state, currentUserId: safeCurrentUserId || safeCurrentUser.id },
    matchEntities,
    matchLists,
    currentUser: safeCurrentUser,
    currentUserId: safeCurrentUserId || safeCurrentUser.id,
    profileBound: true,
    profileLocked,
    remoteReady,
    serverBusy: serverActionPendingCount > 0,
    adminContext,
    adminState,
    adminStatus,
    matchPagination,
    recruitingPagination,
    directoryStatus,
    recordArchives: {
      profile: profileRecordArchive,
      publicProfiles: publicProfileRecordArchives,
      teams: teamRecordArchives,
    },
    rankings,
    actions,
  };

}
