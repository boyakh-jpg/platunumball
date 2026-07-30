export function useAppDataRuntime(context) {
  const {
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
  } = context;

const authUserId = typeof authUser === "string" ? authUser : authUser?.id ?? null;
  const authEmail = typeof authUser === "object" ? authUser?.email ?? authUser?.user_metadata?.email ?? "" : "";
  const [state, setRawState] = useState(() => syncNotificationDeliveries(getCachedBootstrapState(authUserId, authEmail)));
  const setState = useCallback((updater) => {
    setRawState((prev) => syncNotificationDeliveries(typeof updater === "function" ? updater(prev) : updater));
  }, []);
  const [profileBindings, setProfileBindings] = useState(() => readProfileBindings());
  const [adminContext, setAdminContext] = useState(EMPTY_ADMIN_CONTEXT);
  const [matchPagination, setMatchPagination] = useState({ loading: false, exhausted: !isSupabaseConfigured, error: "", cursor: "" });
  const [matchLists, setMatchLists] = useState(() => createInitialMatchListStore(state));
  const [recruitingPagination, setRecruitingPagination] = useState({ loading: false, exhausted: !isSupabaseConfigured, error: "", loadMoreError: "", cursor: "", offset: 0, regionScope: "local", regionKey: "", startFilter: "all", timingType: "", scheduledDate: "", feedCounts: null });
  const [directoryStatus, setDirectoryStatus] = useState({ loading: false, loaded: !isSupabaseConfigured, error: "", page: null, cacheKey: "" });
  const [adminState, setAdminState] = useState(null);
  const [adminStatus, setAdminStatus] = useState({ loading: false, loaded: false, error: "", section: "", queueMode: DEFAULT_ADMIN_QUEUE_MODE, page: null, counts: {} });
  const [profileRecordsLoaded, setProfileRecordsLoaded] = useState(false);
  const [profileRecordArchive, setProfileRecordArchive] = useState(EMPTY_RECORD_ARCHIVE);
  const [publicProfileRecordArchives, setPublicProfileRecordArchives] = useState({});
  const [teamRecordArchives, setTeamRecordArchives] = useState({});
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured);
  const [serverActionPendingCount, setServerActionPendingCount] = useState(0);
  const homeRouteLoadKey = useMemo(() => getHomeRouteLoadKey(appLocation), [appLocation?.pathname]);
  const stateRef = useRef(state);
  const adminContextRef = useRef(EMPTY_ADMIN_CONTEXT);
  const remoteReadyRef = useRef(!isSupabaseConfigured);
  const directoryStatusRef = useRef(directoryStatus);
  const directoryPromiseRef = useRef(new Map());
  const directoryCacheRef = useRef(new Map());
  const latestDirectoryRequestRef = useRef("");
  const adminStatusRef = useRef(adminStatus);
  const adminPromiseRef = useRef(new Map());
  const adminCacheRef = useRef(new Map());
  const latestAdminRequestRef = useRef("");
  const adminContextPromiseRef = useRef(null);
  const adminContextLoadedAuthRef = useRef("");
  const profileRefreshPromiseRef = useRef(null);
  const matchDetailPromiseRef = useRef(new Map());
  const matchPagePromiseRef = useRef(null);
  const matchRecruitingSchedulePromiseRef = useRef(null);
  const matchTeamSchedulePromiseRef = useRef(null);
  const settingsAuthUserIdRef = useRef(authUserId);
  const settingsSyncQueueRef = useRef(Promise.resolve(null));
  const themeMutationVersionRef = useRef(0);
  const themeCommittedValueRef = useRef(state.settings?.theme ?? "dark");
  const blockedSettingsSyncRef = useRef(Promise.resolve(true));
  const blockedSettingsCommittedIdsRef = useRef(getBlockedUserIdsFromState(state));
  const blockedSettingsPendingCountRef = useRef(0);
  const recruitingPagePromiseRef = useRef(null);
  const playMatchesPromiseRef = useRef(null);
  const reportableMatchesPromiseRef = useRef(null);
  const profileRecordsPromiseRef = useRef(null);
  const profileRecordArchiveRef = useRef(EMPTY_RECORD_ARCHIVE);
  const publicProfileRecordsPromiseRef = useRef(new Map());
  const publicProfileRecordArchivesRef = useRef({});
  const teamRecordArchivesRef = useRef({});
  const teamRecordsPromiseRef = useRef(new Map());
  const recruitingRegionPromiseRef = useRef(new Map());
  const latestRecruitingRegionRequestRef = useRef("");
  const latestRecruitingLoadMoreRequestRef = useRef("");
  const homeRouteLoadKeyRef = useRef("");
  const recruitingPostPromiseRef = useRef(new Map());
  const pendingRecruitingPostIdsRef = useRef(new Set());
  const recentRecruitingMutationTimesRef = useRef(new Map());
  const pendingMatchIdsRef = useRef(new Set());
  const pendingMatchMutationCountsRef = useRef(new Map());
  const recentMatchMutationTimesRef = useRef(new Map());
  const syncedDiscordDeliveryIdsRef = useRef(new Set());
  const authIdentityRef = useRef(authUserId);
  const authGenerationRef = useRef(0);
  if (authIdentityRef.current !== authUserId) {
    authIdentityRef.current = authUserId;
    authGenerationRef.current += 1;
  }
  const profileKey = authUserId ?? "local-demo";
  const profileLocked = isPersistentAuthUserId(authUserId);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    directoryStatusRef.current = directoryStatus;
  }, [directoryStatus]);
  useEffect(() => {
    adminStatusRef.current = adminStatus;
  }, [adminStatus]);
  useEffect(() => {
    profileRecordArchiveRef.current = profileRecordArchive;
  }, [profileRecordArchive]);
  useEffect(() => {
    teamRecordArchivesRef.current = teamRecordArchives;
  }, [teamRecordArchives]);
  useEffect(() => {
    settingsAuthUserIdRef.current = authUserId;
    settingsSyncQueueRef.current = Promise.resolve(null);
    themeMutationVersionRef.current += 1;
    themeCommittedValueRef.current = null;
  }, [authUserId]);
  const serverProfileBound = profileLocked;
  const effectiveProfileBindings = isSupabaseConfigured ? {} : profileBindings;
  const currentUserId = getBoundAuthProfileId(state, authUserId, effectiveProfileBindings, profileKey);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId) return;
    setState((prev) => {
      if (prev.users.some((user) => user.authUserId === authUserId)) return prev;
      const shellUser = createProfileShell(authUserId, authEmail);
      return { ...prev, currentUserId: shellUser.id, users: [shellUser, ...prev.users] };
    });
  }, [authEmail, authUserId, setState]);

  useEffect(() => {
    if (!isSupabaseConfigured && hasDemoInitialState()) saveState(state);
    return undefined;
  }, [state]);

  useEffect(() => {
    if (isSupabaseConfigured) clearDemoStorage();
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured || hasDemoInitialState()) return undefined;
    let mounted = true;
    ensureLocalDemoInitialState()
      .then(() => {
        if (!mounted) return;
        setState(loadState({ includeDemo: true, authUserId, email: authEmail }));
      })
      .catch((error) => console.warn("Local demo state load failed.", error.message));
    return () => {
      mounted = false;
    };
  }, [authEmail, authUserId, setState]);

  useEffect(() => {
    if (isSupabaseConfigured) return undefined;
    setState((prev) => runAutomaticStateMaintenance(prev));
    const interval = window.setInterval(() => {
      setState((prev) => runAutomaticStateMaintenance(prev));
    }, LOCAL_MAINTENANCE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId || !remoteReady) return;
    cacheCurrentProfileState(authUserId, state);
  }, [authUserId, remoteReady, state.currentUserId, state.settings, state.users]);

  useEffect(() => {
    if (blockedSettingsPendingCountRef.current > 0) return;
    blockedSettingsCommittedIdsRef.current = getBlockedUserIdsFromState(state);
  }, [state.settings?.blockedUserIds]);

  useEffect(() => {
    blockedSettingsSyncRef.current = Promise.resolve(true);
    blockedSettingsCommittedIdsRef.current = getBlockedUserIdsFromState(stateRef.current);
    blockedSettingsPendingCountRef.current = 0;
    if (!isSupabaseConfigured || !authUserId) {
      remoteReadyRef.current = !isSupabaseConfigured;
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
      recentRecruitingMutationTimesRef.current = new Map();
      pendingMatchIdsRef.current = new Set();
      pendingMatchMutationCountsRef.current = new Map();
      recentMatchMutationTimesRef.current = new Map();
      syncedDiscordDeliveryIdsRef.current = new Set();
      setRemoteReady(!isSupabaseConfigured);
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
  }, [authEmail, authUserId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId || !remoteReady || homeRouteLoadKey !== "homeLoad") return undefined;
    if (homeRouteLoadKeyRef.current === homeRouteLoadKey) return undefined;
    let mounted = true;
    homeRouteLoadKeyRef.current = homeRouteLoadKey;
    setMatchPagination((prev) => ({ ...prev, loading: true, error: "" }));
    const homeLoadOptions = {
      endpoint: "homeLoad",
      matchLimit: REMOTE_CLIENT_MATCH_LIMIT,
      recruitingLimit: REMOTE_CLIENT_RECRUITING_LIMIT,
      tournamentLimit: 0,
    };
    loadBackendStateWithHomeRetry(authUserId, authEmail, homeLoadOptions)
      .then((remoteState) => {
        if (!mounted) return;
        const remoteMeta = getRemoteMeta(remoteState);
        const maintainedState = isSupabaseConfigured ? remoteState : runAutomaticStateMaintenance(remoteState);
        if (maintainedState) {
          cacheCurrentProfileState(authUserId, maintainedState);
          setState((prev) => withServerAdminContext(mergeRemoteHomeState(prev, preserveLocalDiscordState(prev, maintainedState)), adminContextRef.current));
        }
        setMatchPagination((prev) => ({
          ...prev,
          loading: false,
          exhausted: remoteMeta.matchPage?.exhausted ?? prev.exhausted,
          error: remoteMeta.matchPage?.error ?? "",
          cursor: remoteMeta.matchPage?.cursor ?? prev.cursor,
        }));
        if (remoteMeta.matchPage?.recruitingScheduleChecked) {
          setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.PERSONAL, {
            ids: getStateMatchIds(maintainedState),
            recruitingPostIds: getStateRecruitingPostIds(maintainedState),
            status: MATCH_LIST_STATUSES.READY,
            error: "",
          }));
        }
        setRecruitingPagination((prev) => ({
          ...prev,
          exhausted: remoteMeta.recruitingPage?.exhausted ?? prev.exhausted,
          error: remoteMeta.recruitingPage?.error ?? "",
          cursor: remoteMeta.recruitingPage?.cursor ?? prev.cursor,
          offset: getRecruitingPaginationOffset(remoteMeta.recruitingPage, prev.offset),
          feedCounts: remoteMeta.recruitingPage?.feedCounts ?? prev.feedCounts,
        }));
      })
      .catch((error) => {
        console.warn("Home route load failed.", error.message);
        homeRouteLoadKeyRef.current = "";
        if (mounted) {
          setMatchPagination((prev) => ({ ...prev, loading: false, error: error.message ?? "home_route_load_failed" }));
          setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.PERSONAL, {
            status: MATCH_LIST_STATUSES.ERROR,
            error: error.message ?? "home_route_load_failed",
          }));
        }
      });
    return () => {
      mounted = false;
      if (homeRouteLoadKeyRef.current === homeRouteLoadKey) homeRouteLoadKeyRef.current = "";
      setMatchPagination((prev) => (prev.loading ? { ...prev, loading: false } : prev));
    };
  }, [authEmail, authUserId, homeRouteLoadKey, remoteReady, setState]);

  useEffect(() => {
    adminContextRef.current = EMPTY_ADMIN_CONTEXT;
    setAdminContext(EMPTY_ADMIN_CONTEXT);
    setState((prev) => withServerAdminContext(prev, EMPTY_ADMIN_CONTEXT));
  }, [authUserId, setState]);

  return {
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
  };
}
