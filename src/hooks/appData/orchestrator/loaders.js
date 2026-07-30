export function useAppDataLoaders(context) {
  const {
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
  } = context;

const loadMoreMatches = useCallback(async (options = {}) => {
    const force = options?.force === true;
    if (!isSupabaseConfigured || !authUserId || matchPagination.loading || (!force && matchPagination.exhausted)) return false;
    if (matchPagePromiseRef.current) return matchPagePromiseRef.current;
    const cursor = force ? "" : matchPagination.cursor || getMatchPaginationCursor(state.matches);
    if (!force && !cursor && (state.matches?.length ?? 0) > 0) {
      setMatchPagination((prev) => ({ ...prev, loading: false, exhausted: true, error: "", cursor: "" }));
      return false;
    }
    const pageLimit = cursor ? REMOTE_CLIENT_MATCH_LIMIT : REMOTE_CLIENT_INITIAL_MATCH_LIMIT;
    setMatchPagination((prev) => ({ ...prev, loading: true, error: "" }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: pageLimit,
            ...(cursor ? { cursor } : {}),
            listOnly: true,
            activeOnly: true,
            scheduleOnly: true,
            includeRecentCompleted: false,
            includeClosedNotices: false,
            includeRecruitingSchedule: false,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const rawRemoteState = result?.state ?? {};
        const rawMatchCount = rawRemoteState.matches?.length ?? 0;
        const pageHasExhausted = typeof result?.page?.exhausted === "boolean";
        const remoteState = normalizeServerState(filterPendingMatches(rawRemoteState, pendingMatchIdsRef.current, recentMatchMutationTimesRef.current));
        const nextMatches = remoteState.matches ?? [];
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        setMatchPagination((prev) => ({
          ...prev,
          loading: false,
          exhausted: pageHasExhausted ? result.page.exhausted : rawMatchCount < pageLimit,
          error: "",
          cursor: result?.page?.cursor ?? cursor,
        }));
        return nextMatches.length;
      } catch (error) {
        console.warn("More match load failed.", error.message);
        setMatchPagination((prev) => ({ ...prev, loading: false, exhausted: false, error: error.message ?? "match_page_load_failed", cursor }));
        return false;
      }
    })().finally(() => {
      if (matchPagePromiseRef.current === promise) matchPagePromiseRef.current = null;
    });
    matchPagePromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, matchPagination.cursor, matchPagination.exhausted, matchPagination.loading, setState, state.matches, trackedPostServerAction]);

  const loadMatchRecruitingSchedule = useCallback(async (options = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (matchRecruitingSchedulePromiseRef.current) return matchRecruitingSchedulePromiseRef.current;
    const promise = (async () => {
      setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.PERSONAL, {
        status: MATCH_LIST_STATUSES.LOADING,
        error: "",
      }));
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_MATCH_LIMIT,
            listOnly: true,
            activeOnly: true,
            scheduleOnly: true,
            includeRecentCompleted: false,
            includeClosedNotices: true,
            includeCancelledSchedule: true,
            includeRecruitingSchedule: true,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(result?.state ?? {}, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        setState((prev) => mergeRemoteMatchPage(prev, remoteState, { forceRecruitingPostIds: new Set(getStateRecruitingPostIds(remoteState)) }));
        setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.PERSONAL, {
          ids: getStateMatchIds(remoteState),
          recruitingPostIds: getStateRecruitingPostIds(remoteState),
          status: MATCH_LIST_STATUSES.READY,
          error: "",
        }));
        setMatchPagination((prev) => ({
          ...prev,
          error: "",
          cursor: prev.cursor || result?.page?.cursor || getMatchPaginationCursor(remoteState.matches ?? []),
        }));
        return remoteState.recruitingPosts?.length ?? 0;
      } catch (error) {
        console.warn("Match recruiting schedule load failed.", error.message);
        setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.PERSONAL, {
          status: MATCH_LIST_STATUSES.ERROR,
          error: error.message ?? "match_recruiting_schedule_load_failed",
        }));
        return false;
      }
    })().finally(() => {
      if (matchRecruitingSchedulePromiseRef.current === promise) matchRecruitingSchedulePromiseRef.current = null;
    });
    matchRecruitingSchedulePromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadMatchTeamSchedule = useCallback(async (options = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (matchTeamSchedulePromiseRef.current) return matchTeamSchedulePromiseRef.current;
    const promise = (async () => {
      setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.TEAM, {
        status: MATCH_LIST_STATUSES.LOADING,
        error: "",
      }));
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_MATCH_LIMIT,
            listOnly: true,
            activeOnly: true,
            scheduleOnly: true,
            includeRecentCompleted: false,
            includeClosedNotices: false,
            includeRecruitingSchedule: false,
            includeTeamSchedule: true,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(result?.state ?? {});
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        const teamMatchIds = (remoteState.matches ?? [])
          .filter((match) => match.__feedRelations?.includes("team"))
          .map((match) => match.id);
        setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.TEAM, {
          ids: teamMatchIds,
          status: MATCH_LIST_STATUSES.READY,
          error: "",
        }));
        setMatchPagination((prev) => ({
          ...prev,
          error: "",
          cursor: prev.cursor || result?.page?.cursor || getMatchPaginationCursor(remoteState.matches ?? []),
        }));
        return teamMatchIds.length;
      } catch (error) {
        console.warn("Match team schedule load failed.", error.message);
        setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.TEAM, {
          status: MATCH_LIST_STATUSES.ERROR,
          error: error.message ?? "match_team_schedule_load_failed",
        }));
        return false;
      }
    })().finally(() => {
      if (matchTeamSchedulePromiseRef.current === promise) matchTeamSchedulePromiseRef.current = null;
    });
    matchTeamSchedulePromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadMatchDetail = useCallback(async (matchId) => {
    if (!isSupabaseConfigured || !authUserId || !matchId) return false;
    const safeMatchId = String(matchId);
    const currentPromise = matchDetailPromiseRef.current.get(safeMatchId);
    if (currentPromise) return currentPromise;
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/matches/detail",
          {
            authUserId,
            authEmail,
            matchId: safeMatchId,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(result?.state ?? {});
        const nextMatches = remoteState.matches ?? [];
        setState((prev) => mergeRemoteMatchPage(prev, remoteState, { forceMatchIds: new Set([safeMatchId]) }));
        return nextMatches.length;
      } catch (error) {
        console.warn("Match detail load failed.", error.message);
        return false;
      }
    })().finally(() => {
      if (matchDetailPromiseRef.current.get(safeMatchId) === promise) matchDetailPromiseRef.current.delete(safeMatchId);
    });
    matchDetailPromiseRef.current.set(safeMatchId, promise);
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadPlayMatches = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (playMatchesPromiseRef.current) return playMatchesPromiseRef.current;
    const promise = (async () => {
      setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.PLAY, {
        status: MATCH_LIST_STATUSES.LOADING,
        error: "",
      }));
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_MATCH_LIMIT,
            listOnly: false,
            playOnly: true,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(filterPendingMatches(result?.state ?? {}, pendingMatchIdsRef.current, recentMatchMutationTimesRef.current));
        const nextMatches = remoteState.matches ?? [];
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.PLAY, {
          ids: getStateMatchIds(remoteState),
          status: MATCH_LIST_STATUSES.READY,
          error: "",
        }));
        return nextMatches.length;
      } catch (error) {
        console.warn("Play match load failed.", error.message);
        setMatchLists((prev) => updateMatchListScope(prev, MATCH_LIST_SCOPES.PLAY, {
          status: MATCH_LIST_STATUSES.ERROR,
          error: error.message ?? "play_match_load_failed",
        }));
        return false;
      }
    })().finally(() => {
      if (playMatchesPromiseRef.current === promise) playMatchesPromiseRef.current = null;
    });
    playMatchesPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadReportableMatches = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (reportableMatchesPromiseRef.current) return reportableMatchesPromiseRef.current;
    const completedSince = new Date(Date.now() - REPORT_MATCH_WINDOW_MS).toISOString();
    const promise = (async () => {
      try {
        const [activeResult, completedResult] = await Promise.all([
          trackedPostServerAction(
            "/api/matches/list",
            {
              authUserId,
              authEmail,
              limit: REMOTE_CLIENT_MATCH_LIMIT,
              listOnly: false,
              activeOnly: true,
              includeRecentCompleted: false,
              includeClosedNotices: false,
              adminContext: false,
            },
            { allowWhenDisabled: true },
          ),
          trackedPostServerAction(
            "/api/matches/list",
            {
              authUserId,
              authEmail,
              limit: REMOTE_CLIENT_MATCH_LIMIT,
              listOnly: false,
              completedOnly: true,
              completedSince,
              includeRecruitingSchedule: false,
              adminContext: false,
            },
            { allowWhenDisabled: true },
          ),
        ]);
        const activeState = normalizeServerState(activeResult?.state ?? {});
        const completedState = normalizeServerState(completedResult?.state ?? {});
        setState((prev) => mergeRemoteMatchPage(mergeRemoteMatchPage(prev, activeState), completedState));
        return true;
      } catch (error) {
        console.warn("Reportable match load failed.", error.message);
        return false;
      }
    })().finally(() => {
      if (reportableMatchesPromiseRef.current === promise) reportableMatchesPromiseRef.current = null;
    });
    reportableMatchesPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadProfileRecords = useCallback(async (options = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const requestGeneration = authGenerationRef.current;
    const isRequestCurrent = () => requestGeneration === authGenerationRef.current;
    const force = options?.force === true;
    const loadMoreArchive = options?.loadMore === true || options?.loadMoreArchive === true;
    const loadMoreDetail = options?.loadMoreDetail === true;
    const pagedLoad = loadMoreArchive || loadMoreDetail;
    if (profileRecordsLoaded && !force && !pagedLoad) return true;
    if (profileRecordsPromiseRef.current) return profileRecordsPromiseRef.current;
    const currentArchive = profileRecordArchiveRef.current;
    const archiveOffset = loadMoreArchive
      ? normalizeRecordArchiveOffset(options.archiveOffset ?? currentArchive.page?.archiveNextOffset)
      : 0;
    const detailOffset = loadMoreDetail
      ? normalizeRecordArchiveOffset(options.detailOffset ?? currentArchive.page?.detailNextOffset)
      : 0;
    setProfileRecordArchive((current) => ({ ...current, loading: true, error: "" }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/records/list",
          {
            authUserId,
            authEmail,
            scope: "profile",
            detailLimit: REMOTE_CLIENT_RECORD_MATCH_LIMIT,
            detailOffset,
            archiveLimit: REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT,
            archiveOffset,
            includeDetail: !loadMoreArchive,
            includeArchive: !loadMoreDetail,
          },
          { allowWhenDisabled: true },
        );
        if (!isRequestCurrent()) return false;
        const remoteState = normalizeServerState(result?.state ?? {});
        const nextMatches = remoteState.matches ?? [];
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        const nextArchive = {
          personalSummary: result?.personalSummary ?? profileRecordArchiveRef.current.personalSummary,
          rows: result?.page?.archiveIncluded === true
            ? mergeRecordArchiveRows(
              profileRecordArchiveRef.current.rows,
              result?.archiveRecords ?? [],
              !loadMoreArchive && !loadMoreDetail,
            )
            : profileRecordArchiveRef.current.rows,
          page: mergeRecordPage(profileRecordArchiveRef.current.page, result?.page),
          windows: result?.windows ?? EMPTY_RECORD_ARCHIVE.windows,
          loaded: true,
          loading: false,
          error: "",
        };
        profileRecordArchiveRef.current = nextArchive;
        setProfileRecordArchive(nextArchive);
        setProfileRecordsLoaded(true);
        return nextMatches.length;
      } catch (error) {
        if (!isRequestCurrent() || error?.code === "stale_auth_request") return false;
        console.warn("Profile records load failed.", error.message);
        setProfileRecordArchive((current) => ({ ...current, loading: false, error: error.message ?? "record_list_failed" }));
        return false;
      }
    })().finally(() => {
      if (profileRecordsPromiseRef.current === promise) profileRecordsPromiseRef.current = null;
    });
    profileRecordsPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, profileRecordsLoaded, setState, trackedPostServerAction]);

  const loadPublicProfileRecords = useCallback(async (profileId, options = {}) => {
    const safeProfileId = String(profileId ?? "").trim();
    if (!isSupabaseConfigured || !authUserId || !safeProfileId) return false;
    if (safeProfileId === currentUserId) return loadProfileRecords(options);
    const requestGeneration = authGenerationRef.current;
    const isRequestCurrent = () => requestGeneration === authGenerationRef.current;
    const currentArchive = publicProfileRecordArchivesRef.current[safeProfileId] ?? EMPTY_RECORD_ARCHIVE;
    if (currentArchive.loaded && options.force !== true) return true;
    if (publicProfileRecordsPromiseRef.current.has(safeProfileId)) return publicProfileRecordsPromiseRef.current.get(safeProfileId);
    setPublicProfileRecordArchives((current) => ({
      ...current,
      [safeProfileId]: { ...(current[safeProfileId] ?? EMPTY_RECORD_ARCHIVE), loading: true, error: "" },
    }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/records/list",
          { authUserId, authEmail, scope: "profile", profileId: safeProfileId, detailLimit: REMOTE_CLIENT_RECORD_MATCH_LIMIT, archiveLimit: REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT, includeDetail: true, includeArchive: true },
          { allowWhenDisabled: true },
        );
        if (!isRequestCurrent()) return false;
        const remoteState = normalizeServerState(result?.state ?? {});
        setState((prev) => {
          const merged = mergeRemoteMatchPage(prev, remoteState);
          return {
            ...merged,
            users: (merged.users ?? []).map((user) => user.id === safeProfileId
              ? { ...user, personalRecordSummary: result?.personalSummary ?? null }
              : user),
          };
        });
        const nextArchive = {
          personalSummary: result?.personalSummary ?? null,
          rows: result?.archiveRecords ?? [],
          page: result?.page ?? EMPTY_RECORD_ARCHIVE.page,
          windows: result?.windows ?? EMPTY_RECORD_ARCHIVE.windows,
          loaded: true,
          loading: false,
          error: "",
        };
        publicProfileRecordArchivesRef.current = { ...publicProfileRecordArchivesRef.current, [safeProfileId]: nextArchive };
        setPublicProfileRecordArchives((current) => ({ ...current, [safeProfileId]: nextArchive }));
        return remoteState.matches?.length ?? 0;
      } catch (error) {
        if (!isRequestCurrent() || error?.code === "stale_auth_request") return false;
        console.warn("Public profile records load failed.", error.message);
        setPublicProfileRecordArchives((current) => ({
          ...current,
          [safeProfileId]: { ...(current[safeProfileId] ?? EMPTY_RECORD_ARCHIVE), loading: false, error: error.message ?? "record_list_failed" },
        }));
        return false;
      }
    })().finally(() => {
      if (publicProfileRecordsPromiseRef.current.get(safeProfileId) === promise) publicProfileRecordsPromiseRef.current.delete(safeProfileId);
    });
    publicProfileRecordsPromiseRef.current.set(safeProfileId, promise);
    return promise;
  }, [authEmail, authUserId, currentUserId, loadProfileRecords, setState, trackedPostServerAction]);

  const loadTeamRecords = useCallback(async (teamId, options = {}) => {
    const safeTeamId = String(teamId ?? "").trim();
    if (!isSupabaseConfigured || !authUserId || !safeTeamId) return false;
    const requestGeneration = authGenerationRef.current;
    const isRequestCurrent = () => requestGeneration === authGenerationRef.current;
    const currentArchive = teamRecordArchivesRef.current[safeTeamId] ?? EMPTY_RECORD_ARCHIVE;
    const force = options?.force === true;
    const loadMoreArchive = options?.loadMore === true || options?.loadMoreArchive === true;
    const loadMoreDetail = options?.loadMoreDetail === true;
    const pagedLoad = loadMoreArchive || loadMoreDetail;
    if (currentArchive.loaded && !force && !pagedLoad) return true;
    if (teamRecordsPromiseRef.current.has(safeTeamId)) return teamRecordsPromiseRef.current.get(safeTeamId);
    const archiveOffset = loadMoreArchive
      ? normalizeRecordArchiveOffset(options.archiveOffset ?? currentArchive.page?.archiveNextOffset)
      : 0;
    const detailOffset = loadMoreDetail
      ? normalizeRecordArchiveOffset(options.detailOffset ?? currentArchive.page?.detailNextOffset)
      : 0;
    setTeamRecordArchives((current) => ({
      ...current,
      [safeTeamId]: { ...(current[safeTeamId] ?? EMPTY_RECORD_ARCHIVE), loading: true, error: "" },
    }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/records/list",
          {
            authUserId,
            authEmail,
            scope: "team",
            teamId: safeTeamId,
            detailLimit: REMOTE_CLIENT_RECORD_MATCH_LIMIT,
            detailOffset,
            archiveLimit: REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT,
            archiveOffset,
            includeDetail: !loadMoreArchive,
            includeArchive: !loadMoreDetail,
          },
          { allowWhenDisabled: true },
        );
        if (!isRequestCurrent()) return false;
        const remoteState = normalizeServerState(result?.state ?? {});
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        const latestArchive = teamRecordArchivesRef.current[safeTeamId] ?? EMPTY_RECORD_ARCHIVE;
        const nextArchive = {
          rows: result?.page?.archiveIncluded === true
            ? mergeRecordArchiveRows(latestArchive.rows, result?.archiveRecords ?? [], !loadMoreArchive && !loadMoreDetail)
            : latestArchive.rows,
          page: mergeRecordPage(latestArchive.page, result?.page),
          windows: result?.windows ?? EMPTY_RECORD_ARCHIVE.windows,
          loaded: true,
          loading: false,
          error: "",
        };
        teamRecordArchivesRef.current = { ...teamRecordArchivesRef.current, [safeTeamId]: nextArchive };
        setTeamRecordArchives((current) => ({ ...current, [safeTeamId]: nextArchive }));
        return remoteState.matches?.length ?? 0;
      } catch (error) {
        if (!isRequestCurrent() || error?.code === "stale_auth_request") return false;
        console.warn("Team records load failed.", error.message);
        setTeamRecordArchives((current) => ({
          ...current,
          [safeTeamId]: {
            ...(current[safeTeamId] ?? EMPTY_RECORD_ARCHIVE),
            loading: false,
            error: error.message ?? "record_list_failed",
          },
        }));
        return false;
      }
    })().finally(() => {
      if (teamRecordsPromiseRef.current.get(safeTeamId) === promise) {
        teamRecordsPromiseRef.current.delete(safeTeamId);
      }
    });
    teamRecordsPromiseRef.current.set(safeTeamId, promise);
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadMoreRecruiting = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId || recruitingPagination.loading || recruitingPagination.exhausted) return false;
    if (recruitingPagePromiseRef.current) return recruitingPagePromiseRef.current;
    const offset = getRecruitingPaginationOffset(recruitingPagination, recruitingPagination.offset ?? 0);
    const regionRequest = getRecruitingRegionRequest(recruitingPagination);
    const startFilterRequest = getRecruitingStartFilterRequest(recruitingPagination);
    const requestKey = `${regionRequest.regionScope}:${regionRequest.regionKey}:${startFilterRequest.startFilter}:${offset}`;
    latestRecruitingLoadMoreRequestRef.current = requestKey;
    setRecruitingPagination((prev) => ({ ...prev, loading: true, error: "", loadMoreError: "" }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/recruiting/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_RECRUITING_LIMIT,
            offset,
            regionScope: regionRequest.regionScope,
            ...(regionRequest.regionKey ? { regionKey: regionRequest.regionKey } : {}),
            ...startFilterRequest,
            listOnly: true,
            adminContext: false,
            includeFeedCounts: false,
            preferFreshRows: true,
          },
          { allowWhenDisabled: true },
        );
        const rawRemoteState = result?.state ?? {};
        const rawPostCount = rawRemoteState.recruitingPosts?.length ?? 0;
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(rawRemoteState, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        if (latestRecruitingLoadMoreRequestRef.current !== requestKey) return false;
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, { forceRecruitingPostIds: new Set(getStateRecruitingPostIds(remoteState)) }));
        const pageHasExhausted = typeof result?.page?.exhausted === "boolean";
        setRecruitingPagination({
          loading: false,
          exhausted: pageHasExhausted ? result.page.exhausted : rawPostCount < REMOTE_CLIENT_RECRUITING_LIMIT,
          error: "",
          loadMoreError: "",
          cursor: result?.page?.cursor ?? String(offset + rawPostCount),
          offset: getRecruitingPaginationOffset(result?.page, offset + rawPostCount),
          ...regionRequest,
          ...startFilterRequest,
          feedCounts: result?.page?.feedCounts ?? recruitingPagination.feedCounts ?? null,
        });
        return nextPosts.length;
      } catch (error) {
        console.warn("More recruiting load failed.", error.message);
        if (latestRecruitingLoadMoreRequestRef.current !== requestKey) return false;
        setRecruitingPagination((prev) => ({ ...prev, loading: false, exhausted: false, error: "", loadMoreError: error.message ?? "recruiting_page_load_failed" }));
        return false;
      }
    })().finally(() => {
      if (recruitingPagePromiseRef.current === promise) recruitingPagePromiseRef.current = null;
    });
    recruitingPagePromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, recruitingPagination, setState, state.recruitingPosts, trackedPostServerAction]);

  const loadRecruitingRegion = useCallback(async ({ regionKey = "", regionScope = "local", limit = REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT, startFilter = "", includeFeedCounts = false } = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const pageLimit = Math.max(1, Math.min(REMOTE_CLIENT_RECRUITING_LIMIT, Number(limit) || REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT));
    const regionRequest = getRecruitingRegionRequest({ regionScope: regionScope === "region" && regionKey ? "region" : "local", regionKey });
    const startFilterRequest = getRecruitingStartFilterRequest({ startFilter });
    const shouldIncludeFeedCounts = includeFeedCounts === true;
    const promiseKey = `${regionRequest.regionScope}:${regionRequest.regionKey}:${startFilterRequest.startFilter}:${pageLimit}:${shouldIncludeFeedCounts ? "counts" : "plain"}`;
    latestRecruitingRegionRequestRef.current = promiseKey;
    latestRecruitingLoadMoreRequestRef.current = "";
    const currentPromise = recruitingRegionPromiseRef.current.get(promiseKey);
    if (currentPromise) {
      setRecruitingPagination((prev) => ({ ...prev, ...regionRequest, ...startFilterRequest, loading: true, exhausted: false, error: "", loadMoreError: "", cursor: "", offset: 0 }));
      return currentPromise;
    }
    setRecruitingPagination((prev) => ({ ...prev, ...regionRequest, ...startFilterRequest, loading: true, exhausted: false, error: "", loadMoreError: "", cursor: "", offset: 0 }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/recruiting/list",
          {
            authUserId,
            authEmail,
            limit: pageLimit,
            offset: 0,
            regionScope: regionRequest.regionScope,
            ...(regionRequest.regionKey ? { regionKey: regionRequest.regionKey } : {}),
            ...startFilterRequest,
            listOnly: true,
            adminContext: false,
            includeFeedCounts: shouldIncludeFeedCounts,
            preferFreshRows: true,
          },
          { allowWhenDisabled: true },
        );
        const rawRemoteState = result?.state ?? {};
        const rawPostCount = rawRemoteState.recruitingPosts?.length ?? 0;
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(rawRemoteState, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        if (latestRecruitingRegionRequestRef.current !== promiseKey) return false;
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, { forceRecruitingPostIds: new Set(getStateRecruitingPostIds(remoteState)) }));
        const pageHasExhausted = typeof result?.page?.exhausted === "boolean";
        setRecruitingPagination({
          loading: false,
          exhausted: pageHasExhausted ? result.page.exhausted : rawPostCount < pageLimit,
          error: "",
          loadMoreError: "",
          cursor: result?.page?.cursor ?? String(rawPostCount),
          offset: getRecruitingPaginationOffset(result?.page, rawPostCount),
          ...regionRequest,
          ...startFilterRequest,
          feedCounts: shouldIncludeFeedCounts ? (result?.page?.feedCounts ?? recruitingPagination.feedCounts ?? null) : (recruitingPagination.feedCounts ?? null),
        });
        return nextPosts.length;
      } catch (error) {
        console.warn("Recruiting region load failed.", error.message);
        if (latestRecruitingRegionRequestRef.current !== promiseKey) return false;
        setRecruitingPagination((prev) => ({ ...prev, ...regionRequest, ...startFilterRequest, loading: false, exhausted: false, error: error.message ?? "recruiting_region_load_failed", loadMoreError: "", cursor: "", offset: 0 }));
        return false;
      }
    })().finally(() => {
      if (recruitingRegionPromiseRef.current.get(promiseKey) === promise) recruitingRegionPromiseRef.current.delete(promiseKey);
    });
    recruitingRegionPromiseRef.current.set(promiseKey, promise);
    return promise;
  }, [authEmail, authUserId, recruitingPagination.feedCounts, setState, trackedPostServerAction]);

  const loadRecruitingPost = useCallback(async (postId) => {
    if (!isSupabaseConfigured || !authUserId || !postId) return false;
    const safePostId = String(postId).trim();
    if (!safePostId || isSyntheticMatchRoomId(safePostId)) return false;
    const currentPromise = recruitingPostPromiseRef.current.get(safePostId);
    if (currentPromise) return currentPromise;
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/recruiting/list",
          {
            authUserId,
            authEmail,
            postId: safePostId,
            limit: 1,
            adminContext: false,
            includeFeedCounts: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(result?.state ?? {}, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, { forceRecruitingPostIds: new Set([safePostId]) }));
        setRecruitingPagination((prev) => ({
          ...prev,
          feedCounts: result?.page?.feedCounts ?? prev.feedCounts ?? null,
        }));
        return nextPosts.length;
      } catch (error) {
        console.warn("Recruiting post load failed.", error.message);
        return false;
      }
    })().finally(() => {
      if (recruitingPostPromiseRef.current.get(safePostId) === promise) recruitingPostPromiseRef.current.delete(safePostId);
    });
    recruitingPostPromiseRef.current.set(safePostId, promise);
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadDirectory = useCallback(async (forceOrOptions = false) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const options = forceOrOptions && typeof forceOrOptions === "object" ? forceOrOptions : {};
    const force = forceOrOptions === true || options.force === true;
    const pathname = typeof window !== "undefined" ? window.location.pathname.replace(/\/$/, "") : "";
    const teamDetailMatch = pathname.match(/^\/app\/teams\/([^/]+)$/);
    const requestedTeamId = String(options.teamId ?? "").trim();
    const endpoint = teamDetailMatch || requestedTeamId ? "/api/teams/detail" : "/api/directory/load";
    const playerDetailMatch = pathname.match(/^\/app\/players\/([^/]+)$/);
    const kind = options.kind ?? (playerDetailMatch ? "players" : pathname === "/app/teams" ? "teams" : "self");
    const { limit, offset } = getDirectoryPageRequest(options, { kind });
    const filter = String(options.filter ?? options.query ?? "").trim();
    const region = String(options.region ?? "").trim();
    const profileId = String(options.profileId ?? (playerDetailMatch ? decodeURIComponent(playerDetailMatch[1]) : "")).trim();
    const teamId = requestedTeamId || (teamDetailMatch ? decodeURIComponent(teamDetailMatch[1]) : "");
    const includeTeamMemberProfiles = options.includeTeamMemberProfiles === true;
    const placementCompleteOnly = options.placementCompleteOnly === true;
    const cacheKey = [endpoint, kind, limit, offset, filter, region, profileId, teamId, includeTeamMemberProfiles, placementCompleteOnly].join(":");
    latestDirectoryRequestRef.current = cacheKey;
    const cached = directoryCacheRef.current.get(cacheKey);
    if (!force && cached?.expiresAt > Date.now()) {
      const remoteState = cached.result?.state ?? {};
      setState((prev) => mergeRemoteDirectory(prev, remoteState, {
        includeDirectorySettings: kind === "self" || kind === "all",
        includeFavoriteSettings: kind !== "affiliations",
        append: offset > 0,
      }));
      setDirectoryStatus({ loading: false, loaded: true, error: "", page: cached.result?.page ?? null, cacheKey });
      return true;
    }
    if (directoryPromiseRef.current.has(cacheKey)) return directoryPromiseRef.current.get(cacheKey);
    if (force) directoryCacheRef.current.delete(cacheKey);
    setDirectoryStatus((prev) => ({ ...prev, loading: true, error: "", cacheKey }));
    const promise = trackedPostServerAction(
      endpoint,
      endpoint === "/api/teams/detail"
        ? { authUserId, authEmail, teamId }
        : { authUserId, authEmail, scope: "directory", kind, limit, offset, filter, region, profileId, includeTeamMemberProfiles, placementCompleteOnly },
      { allowWhenDisabled: true },
    ).then((result) => {
      const remoteState = result?.state ?? {};
      setState((prev) => mergeRemoteDirectory(prev, remoteState, {
        includeDirectorySettings: kind === "self" || kind === "all",
        includeFavoriteSettings: kind !== "affiliations",
        append: offset > 0,
      }));
      directoryCacheRef.current.set(cacheKey, { expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS, result });
      if (latestDirectoryRequestRef.current !== cacheKey) return true;
      setDirectoryStatus({ loading: false, loaded: true, error: "", page: result?.page ?? null, cacheKey });
      return true;
    }).catch((error) => {
      if (latestDirectoryRequestRef.current !== cacheKey) return false;
      console.warn("Directory load failed.", error.message);
      setDirectoryStatus({ loading: false, loaded: false, error: error.message ?? "directory_load_failed", page: null, cacheKey });
      return false;
    }).finally(() => {
      directoryPromiseRef.current.delete(cacheKey);
    });
    directoryPromiseRef.current.set(cacheKey, promise);
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadCourtDetail = useCallback(async (courtId) => {
    if (!isSupabaseConfigured || !authUserId || !courtId) {
      const error = new Error("court_detail_unavailable");
      error.code = "court_detail_unavailable";
      throw error;
    }
    return trackedPostServerAction(
      "/api/courts/detail",
      { courtId: String(courtId), authUserId, authEmail },
      { allowWhenDisabled: true },
    );
  }, [authEmail, authUserId, trackedPostServerAction]);

  const submitCourtDetailReview = useCallback((matchId, draft = {}) => {
    if (!isSupabaseConfigured || !matchId) return Promise.resolve({ ok: false, error: "remote_not_configured" });
    return runServerAction("/api/courts/submit-review", {
      review: {
        matchId: String(matchId),
        rating: Number(draft.rating),
        surfaceRating: draft.surfaceRating ?? null,
        rimRating: draft.rimRating ?? null,
        lightingRating: draft.lightingRating ?? null,
        crowdRating: draft.crowdRating ?? null,
        locationAccuracy: draft.locationAccuracy ?? null,
        fitModes: Array.isArray(draft.fitModes) ? draft.fitModes : [],
        tags: Array.isArray(draft.tags) ? draft.tags : [],
        memo: String(draft.memo ?? "").trim().slice(0, 240),
      },
    });
  }, [runServerAction]);

  return {
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
  };
}
