export function useDirectoryLoaders(context) {
  const {
    DIRECTORY_CACHE_TTL_MS,
    REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
    REMOTE_CLIENT_RECRUITING_LIMIT,
    authEmail,
    authUserId,
    directoryCacheRef,
    directoryPromiseRef,
    filterPendingRecruitingPosts,
    getDirectoryPageRequest,
    getRecruitingPaginationOffset,
    getRecruitingRegionRequest,
    getRecruitingStartFilterRequest,
    getStateRecruitingPostIds,
    isSupabaseConfigured,
    isSyntheticMatchRoomId,
    latestDirectoryRequestRef,
    latestRecruitingLoadMoreRequestRef,
    latestRecruitingRegionRequestRef,
    mergeRemoteDirectory,
    mergeRemoteRecruitingPage,
    normalizeDirectoryRankingSort,
    normalizeServerState,
    pendingMatchIdsRef,
    pendingRecruitingPostIdsRef,
    recentRecruitingMutationTimesRef,
    recruitingPagePromiseRef,
    recruitingPagination,
    recruitingPostPromiseRef,
    recruitingRegionPromiseRef,
    roomMutationVersionRef,
    runServerAction,
    setDirectoryStatus,
    setRecruitingPagination,
    setState,
    trackedPostServerAction,
    useCallback,
  } = context;

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
      const roomMutationVersion = roomMutationVersionRef.current;
      const roomMutationPending = pendingMatchIdsRef.current.size > 0 || pendingRecruitingPostIdsRef.current.size > 0;
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
        const preserveCurrentRoomState = roomMutationPending || roomMutationVersion !== roomMutationVersionRef.current;
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(rawRemoteState, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        if (latestRecruitingLoadMoreRequestRef.current !== requestKey) return false;
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, {
          forceRecruitingPostIds: preserveCurrentRoomState ? new Set() : new Set(getStateRecruitingPostIds(remoteState)),
        }));
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
  }, [authEmail, authUserId, recruitingPagination, setState, trackedPostServerAction]);

  const loadRecruitingRegion = useCallback(async ({ regionKey = "", regionScope = "local", limit = REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT, startFilter = "", includeFeedCounts = false } = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const pageLimit = Math.max(1, Math.min(REMOTE_CLIENT_RECRUITING_LIMIT, Number(limit) || REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT));
    const regionRequest = getRecruitingRegionRequest({ regionScope: regionScope === "all" ? "all" : regionScope === "region" && regionKey ? "region" : "local", regionKey });
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
      const roomMutationVersion = roomMutationVersionRef.current;
      const roomMutationPending = pendingMatchIdsRef.current.size > 0 || pendingRecruitingPostIdsRef.current.size > 0;
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
        const preserveCurrentRoomState = roomMutationPending || roomMutationVersion !== roomMutationVersionRef.current;
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(rawRemoteState, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        if (latestRecruitingRegionRequestRef.current !== promiseKey) return false;
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, {
          forceRecruitingPostIds: preserveCurrentRoomState ? new Set() : new Set(getStateRecruitingPostIds(remoteState)),
        }));
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
      const roomMutationVersion = roomMutationVersionRef.current;
      const roomMutationPending = pendingMatchIdsRef.current.size > 0 || pendingRecruitingPostIdsRef.current.size > 0;
      try {
        const result = await trackedPostServerAction(
          "/api/recruiting/list",
          { authUserId, authEmail, postId: safePostId, limit: 1, adminContext: false, includeFeedCounts: false },
          { allowWhenDisabled: true },
        );
        const preserveCurrentRoomState = roomMutationPending || roomMutationVersion !== roomMutationVersionRef.current;
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(result?.state ?? {}, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, {
          forceRecruitingPostIds: preserveCurrentRoomState ? new Set() : new Set([safePostId]),
        }));
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
    const rankingSort = normalizeDirectoryRankingSort(options.rankingSort);
    const cacheKey = [endpoint, kind, limit, offset, filter, region, profileId, teamId, includeTeamMemberProfiles, placementCompleteOnly, rankingSort].join(":");
    const requestPage = {
      kind,
      limit,
      offset,
      filter,
      region,
      profileId,
      teamId,
      includeTeamMemberProfiles,
      placementCompleteOnly,
      rankingSort,
    };
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
    setDirectoryStatus((prev) => ({ ...prev, loading: true, error: "", page: requestPage, cacheKey }));
    const promise = trackedPostServerAction(
      endpoint,
      endpoint === "/api/teams/detail"
        ? { authUserId, authEmail, teamId }
        : { authUserId, authEmail, scope: "directory", kind, limit, offset, filter, region, profileId, includeTeamMemberProfiles, placementCompleteOnly, rankingSort },
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
      setDirectoryStatus({ loading: false, loaded: false, error: error.message ?? "directory_load_failed", page: requestPage, cacheKey });
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
    loadMoreRecruiting,
    loadRecruitingPost,
    loadRecruitingRegion,
    submitCourtDetailReview,
  };
}
