export function useAppDataRuntimeHydration(context, runtime) {
  const {
    DEFAULT_ADMIN_QUEUE_MODE,
    EMPTY_RECORD_ARCHIVE,
    MATCH_LIST_SCOPES,
    MATCH_LIST_STATUSES,
    appLocation,
    authEmail,
    authUserId,
    cacheCurrentProfileState,
    createInitialMatchListStore,
    createMatchListStore,
    demoPreview,
    getBlockedUserIdsFromState,
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
    isSupabaseConfigured,
    loadBackendStateWithHomeRetry,
    loadProfileState,
    preserveLocalDiscordState,
    runAutomaticStateMaintenance,
    subscribeRemoteState,
    updateMatchListScope,
    useEffect,
    withServerAdminContext,
  } = context;
  const {
    adminCacheRef,
    adminContextLoadedAuthRef,
    adminContextPromiseRef,
    adminContextRef,
    adminPromiseRef,
    blockedSettingsCommittedIdsRef,
    blockedSettingsPendingCountRef,
    blockedSettingsSyncRef,
    directoryCacheRef,
    directoryPromiseRef,
    homeRouteLoadKeyRef,
    latestAdminRequestRef,
    latestDirectoryRequestRef,
    latestRecruitingLoadMoreRequestRef,
    latestRecruitingRegionRequestRef,
    matchDetailPromiseRef,
    matchPagePromiseRef,
    matchRecruitingSchedulePromiseRef,
    matchTeamSchedulePromiseRef,
    operationsMatchesPromiseRef,
    pendingMatchIdsRef,
    pendingMatchMutationCountsRef,
    pendingRecruitingMutationCountsRef,
    pendingRecruitingPostIdsRef,
    playMatchesPromiseRef,
    profileRecordArchiveRef,
    profileRecordsPromiseRef,
    profileRefreshPromiseRef,
    publicProfileRecordArchivesRef,
    publicProfileRecordsPromiseRef,
    recentMatchMutationTimesRef,
    recentRecruitingMutationTimesRef,
    recruitingPagePromiseRef,
    recruitingPostPromiseRef,
    recruitingRegionPromiseRef,
    remoteReadyRef,
    reportableMatchesPromiseRef,
    setAdminState,
    setAdminStatus,
    setDirectoryStatus,
    setMatchLists,
    setMatchPagination,
    setProfileRecordArchive,
    setProfileRecordsLoaded,
    setPublicProfileRecordArchives,
    setRecruitingPagination,
    setRemoteReady,
    setState,
    setTeamRecordArchives,
    stateRef,
    syncedDiscordDeliveryIdsRef,
    teamRecordArchivesRef,
    teamRecordsPromiseRef,
  } = runtime;

  useEffect(() => {
    blockedSettingsSyncRef.current = Promise.resolve(true);
    blockedSettingsCommittedIdsRef.current = getBlockedUserIdsFromState(stateRef.current);
    blockedSettingsPendingCountRef.current = 0;
    if (demoPreview || !isSupabaseConfigured || !authUserId) {
      remoteReadyRef.current = demoPreview || !isSupabaseConfigured;
      directoryPromiseRef.current = new Map();
      directoryCacheRef.current = new Map();
      latestDirectoryRequestRef.current = "";
      adminPromiseRef.current = new Map();
      adminCacheRef.current = new Map();
      latestAdminRequestRef.current = "";
      adminContextPromiseRef.current = null;
      adminContextLoadedAuthRef.current = "";
      profileRefreshPromiseRef.current = null;
      matchDetailPromiseRef.current = new Map();
      matchPagePromiseRef.current = null;
      matchRecruitingSchedulePromiseRef.current = null;
      matchTeamSchedulePromiseRef.current = null;
      operationsMatchesPromiseRef.current = null;
      recruitingPagePromiseRef.current = null;
      playMatchesPromiseRef.current = null;
      reportableMatchesPromiseRef.current = null;
      profileRecordsPromiseRef.current = null;
      profileRecordArchiveRef.current = EMPTY_RECORD_ARCHIVE;
      publicProfileRecordsPromiseRef.current = new Map();
      publicProfileRecordArchivesRef.current = {};
      teamRecordArchivesRef.current = {};
      teamRecordsPromiseRef.current = new Map();
      recruitingRegionPromiseRef.current = new Map();
      latestRecruitingRegionRequestRef.current = "";
      latestRecruitingLoadMoreRequestRef.current = "";
      homeRouteLoadKeyRef.current = "";
      recruitingPostPromiseRef.current = new Map();
      pendingRecruitingPostIdsRef.current = new Set();
      pendingRecruitingMutationCountsRef.current = new Map();
      recentRecruitingMutationTimesRef.current = new Map();
      pendingMatchIdsRef.current = new Set();
      pendingMatchMutationCountsRef.current = new Map();
      recentMatchMutationTimesRef.current = new Map();
      syncedDiscordDeliveryIdsRef.current = new Set();
      setRemoteReady(demoPreview || !isSupabaseConfigured);
      setMatchPagination({ loading: false, exhausted: true, error: "", cursor: "" });
      setMatchLists(createInitialMatchListStore(stateRef.current));
      setRecruitingPagination({ loading: false, exhausted: true, error: "", loadMoreError: "", cursor: "", offset: 0, regionScope: "local", regionKey: "", startFilter: "all", timingType: "", scheduledDate: "", feedCounts: null });
      setDirectoryStatus({ loading: false, loaded: true, error: "", page: null, cacheKey: "" });
      setAdminState(null);
      setAdminStatus({ loading: false, loaded: false, error: "", section: "", queueMode: DEFAULT_ADMIN_QUEUE_MODE, page: null, counts: {} });
      setProfileRecordsLoaded(false);
      setProfileRecordArchive(EMPTY_RECORD_ARCHIVE);
      setPublicProfileRecordArchives({});
      setTeamRecordArchives({});
      return undefined;
    }

    let mounted = true;
    remoteReadyRef.current = false;
    setRemoteReady(false);
    directoryPromiseRef.current = new Map();
    directoryCacheRef.current = new Map();
    latestDirectoryRequestRef.current = "";
    adminPromiseRef.current = new Map();
    adminCacheRef.current = new Map();
    latestAdminRequestRef.current = "";
    adminContextPromiseRef.current = null;
    adminContextLoadedAuthRef.current = "";
    profileRefreshPromiseRef.current = null;
    matchDetailPromiseRef.current = new Map();
    matchPagePromiseRef.current = null;
    matchRecruitingSchedulePromiseRef.current = null;
    matchTeamSchedulePromiseRef.current = null;
    operationsMatchesPromiseRef.current = null;
    recruitingPagePromiseRef.current = null;
    playMatchesPromiseRef.current = null;
    reportableMatchesPromiseRef.current = null;
    profileRecordsPromiseRef.current = null;
    profileRecordArchiveRef.current = EMPTY_RECORD_ARCHIVE;
    publicProfileRecordsPromiseRef.current = new Map();
    publicProfileRecordArchivesRef.current = {};
    teamRecordArchivesRef.current = {};
    teamRecordsPromiseRef.current = new Map();
    recruitingRegionPromiseRef.current = new Map();
    latestRecruitingRegionRequestRef.current = "";
    latestRecruitingLoadMoreRequestRef.current = "";
    homeRouteLoadKeyRef.current = "";
    recruitingPostPromiseRef.current = new Map();
    pendingRecruitingPostIdsRef.current = new Set();
    pendingRecruitingMutationCountsRef.current = new Map();
    recentRecruitingMutationTimesRef.current = new Map();
    pendingMatchIdsRef.current = new Set();
    pendingMatchMutationCountsRef.current = new Map();
    recentMatchMutationTimesRef.current = new Map();
    syncedDiscordDeliveryIdsRef.current = new Set();
    setState(getCachedBootstrapState(authUserId, authEmail));
    setDirectoryStatus({ loading: false, loaded: false, error: "", page: null, cacheKey: "" });
    setAdminState(null);
    setAdminStatus({ loading: false, loaded: false, error: "", section: "", queueMode: DEFAULT_ADMIN_QUEUE_MODE, page: null, counts: {} });
    setProfileRecordsLoaded(false);
    setProfileRecordArchive(EMPTY_RECORD_ARCHIVE);
    setPublicProfileRecordArchives({});
    setTeamRecordArchives({});
    const initialLoadOptions = getInitialStateLoadOptions(appLocation);
    homeRouteLoadKeyRef.current = initialLoadOptions.endpoint === "homeLoad" ? "homeLoad" : getHomeRouteLoadKey(appLocation);
    const initialLoad = initialLoadOptions.profileOnly
      ? loadProfileState(authUserId, authEmail, {
        thin: true,
        includeFavorites: initialLoadOptions.includeFavorites === true,
        includeTeamInvitations: initialLoadOptions.includeTeamInvitations === true,
        includeMatchSummary: initialLoadOptions.includeMatchSummary !== false,
      })
      : loadBackendStateWithHomeRetry(authUserId, authEmail, initialLoadOptions);
    initialLoad
      .then((remoteState) => {
        if (!mounted) return;
        if (remoteState) {
          const remoteMeta = getRemoteMeta(remoteState);
          const maintainedState = isSupabaseConfigured ? remoteState : runAutomaticStateMaintenance(remoteState);
          const initialMatchLimit = Number(initialLoadOptions.matchLimit ?? 0);
          const initialRecruitingLimit = Number(initialLoadOptions.recruitingLimit ?? 0);
          const matchPageHasExhausted = typeof remoteMeta.matchPage?.exhausted === "boolean";
          const recruitingPageHasExhausted = typeof remoteMeta.recruitingPage?.exhausted === "boolean";
          const recruitingScheduleChecked = Boolean(remoteMeta.matchPage?.recruitingScheduleChecked);
          cacheCurrentProfileState(authUserId, maintainedState);
          setState((prev) => withServerAdminContext(preserveLocalDiscordState(prev, maintainedState), adminContextRef.current));
          setMatchPagination({
            loading: false,
            exhausted: initialMatchLimit <= 0 || (matchPageHasExhausted ? remoteMeta.matchPage.exhausted : (maintainedState.matches?.length ?? 0) < initialMatchLimit),
            error: remoteMeta.matchPage?.error ?? "",
            cursor: remoteMeta.matchPage?.cursor ?? getMatchPaginationCursor(maintainedState.matches),
          });
          setMatchLists(createMatchListStore({
            [MATCH_LIST_SCOPES.PERSONAL]: recruitingScheduleChecked ? {
              ids: getStateMatchIds(maintainedState),
              recruitingPostIds: getStateRecruitingPostIds(maintainedState),
              status: MATCH_LIST_STATUSES.READY,
            } : undefined,
            [MATCH_LIST_SCOPES.PLAY]: remoteMeta.playMatchListReady === true ? {
              ids: getStateMatchIds(maintainedState),
              status: MATCH_LIST_STATUSES.READY,
            } : undefined,
          }));
          setRecruitingPagination({
            loading: false,
            exhausted: initialRecruitingLimit <= 0 || (recruitingPageHasExhausted ? remoteMeta.recruitingPage.exhausted : (maintainedState.recruitingPosts?.length ?? 0) < initialRecruitingLimit),
            error: remoteMeta.recruitingPage?.error ?? "",
            loadMoreError: "",
            cursor: remoteMeta.recruitingPage?.cursor ?? getRecruitingPaginationCursor(maintainedState.recruitingPosts),
            offset: getRecruitingPaginationOffset(remoteMeta.recruitingPage, maintainedState.recruitingPosts?.length ?? 0),
            ...getRecruitingRegionRequest(remoteMeta.recruitingPage),
            ...getRecruitingStartFilterRequest(remoteMeta.recruitingPage),
            feedCounts: remoteMeta.recruitingPage?.feedCounts ?? null,
          });
          if (remoteMeta.directoryLoaded) {
            setDirectoryStatus({ loading: false, loaded: true, error: "", page: remoteMeta.directoryPage ?? null, cacheKey: "initial" });
          }
          setProfileRecordsLoaded(remoteMeta.profileRecordsLoaded === true);
          if (remoteMeta.profileRecordArchive) {
            profileRecordArchiveRef.current = remoteMeta.profileRecordArchive;
            setProfileRecordArchive(remoteMeta.profileRecordArchive);
          }
        }
        remoteReadyRef.current = true;
        setRemoteReady(true);
      })
      .catch((error) => {
        if (!mounted) return;
        console.warn("Supabase hydration failed. Remote state remains empty.", error.message);
        remoteReadyRef.current = true;
        setMatchPagination({ loading: false, exhausted: true, error: error.message ?? "state_load_failed", cursor: "" });
        const failedScope = initialLoadOptions.endpoint === "playMatches"
          ? MATCH_LIST_SCOPES.PLAY
          : ["matchesList", "homeLoad"].includes(initialLoadOptions.endpoint)
            ? MATCH_LIST_SCOPES.PERSONAL
            : "";
        setMatchLists(failedScope
          ? updateMatchListScope(createMatchListStore(), failedScope, {
            status: MATCH_LIST_STATUSES.ERROR,
            error: error.message ?? "state_load_failed",
          })
          : createMatchListStore());
        setRecruitingPagination({ loading: false, exhausted: true, error: error.message ?? "state_load_failed", loadMoreError: "", cursor: "", offset: 0, regionScope: "local", regionKey: "", startFilter: "all", timingType: "", scheduledDate: "", feedCounts: null });
        if (mounted) setRemoteReady(true);
      });

    const unsubscribe = subscribeRemoteState((remoteState) => {
      const maintainedState = isSupabaseConfigured ? remoteState : runAutomaticStateMaintenance(remoteState);
      setState((prev) => withServerAdminContext(preserveLocalDiscordState(prev, maintainedState), adminContextRef.current));
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [authEmail, authUserId, demoPreview]);
}
