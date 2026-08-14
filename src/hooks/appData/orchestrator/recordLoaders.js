export function useRecordLoaders(context) {
  const {
    EMPTY_RECORD_ARCHIVE,
    REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT,
    REMOTE_CLIENT_RECORD_MATCH_LIMIT,
    authEmail,
    authGenerationRef,
    authUserId,
    currentUserId,
    isSupabaseConfigured,
    mergeRecordArchiveRows,
    mergeRecordPage,
    mergeRemoteMatchPage,
    normalizeRecordArchiveOffset,
    normalizeServerState,
    profileRecordArchiveRef,
    profileRecordsLoaded,
    profileRecordsPromiseRef,
    publicProfileRecordArchivesRef,
    publicProfileRecordsPromiseRef,
    setProfileRecordArchive,
    setProfileRecordsLoaded,
    setPublicProfileRecordArchives,
    setState,
    setTeamRecordArchives,
    teamRecordArchivesRef,
    teamRecordsPromiseRef,
    trackedPostServerAction,
    useCallback,
  } = context;

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
    if (!isSupabaseConfigured || !safeProfileId) return false;
    if (authUserId && safeProfileId === currentUserId) return loadProfileRecords(options);
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
          authUserId ? "/api/records/list" : "/api/records/public-list",
          { authUserId, authEmail, scope: "profile", profileId: safeProfileId, detailLimit: REMOTE_CLIENT_RECORD_MATCH_LIMIT, archiveLimit: REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT, includeDetail: true, includeArchive: true },
          { allowWhenDisabled: true, allowAnonymous: !authUserId },
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
    if (!isSupabaseConfigured || !safeTeamId) return false;
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
          authUserId ? "/api/records/list" : "/api/records/public-list",
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
          { allowWhenDisabled: true, allowAnonymous: !authUserId },
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

  return { loadProfileRecords, loadPublicProfileRecords, loadTeamRecords };
}
