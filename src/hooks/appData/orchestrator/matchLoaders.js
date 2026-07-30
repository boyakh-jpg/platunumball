export function useMatchLoaders(context) {
  const {
    MATCH_LIST_SCOPES,
    MATCH_LIST_STATUSES,
    REMOTE_CLIENT_INITIAL_MATCH_LIMIT,
    REMOTE_CLIENT_MATCH_LIMIT,
    REPORT_MATCH_WINDOW_MS,
    authEmail,
    authUserId,
    filterPendingMatches,
    filterPendingRecruitingPosts,
    getMatchPaginationCursor,
    getStateMatchIds,
    getStateRecruitingPostIds,
    isSupabaseConfigured,
    matchDetailPromiseRef,
    matchPagePromiseRef,
    matchPagination,
    matchRecruitingSchedulePromiseRef,
    matchTeamSchedulePromiseRef,
    mergeRemoteMatchPage,
    normalizeServerState,
    pendingMatchIdsRef,
    pendingRecruitingPostIdsRef,
    playMatchesPromiseRef,
    recentMatchMutationTimesRef,
    recentRecruitingMutationTimesRef,
    reportableMatchesPromiseRef,
    setMatchLists,
    setMatchPagination,
    setState,
    state,
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
          { authUserId, authEmail, matchId: safeMatchId },
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
          { authUserId, authEmail, limit: REMOTE_CLIENT_MATCH_LIMIT, listOnly: false, playOnly: true, adminContext: false },
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
            { authUserId, authEmail, limit: REMOTE_CLIENT_MATCH_LIMIT, listOnly: false, activeOnly: true, includeRecentCompleted: false, includeClosedNotices: false, adminContext: false },
            { allowWhenDisabled: true },
          ),
          trackedPostServerAction(
            "/api/matches/list",
            { authUserId, authEmail, limit: REMOTE_CLIENT_MATCH_LIMIT, listOnly: false, completedOnly: true, completedSince, includeRecruitingSchedule: false, adminContext: false },
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

  return {
    loadMatchDetail,
    loadMatchRecruitingSchedule,
    loadMatchTeamSchedule,
    loadMoreMatches,
    loadPlayMatches,
    loadReportableMatches,
  };
}
