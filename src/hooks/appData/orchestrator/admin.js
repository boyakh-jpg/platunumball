export function useAppDataAdmin(context) {
  const {
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
  } = context;

const trackedPostServerAction = useCallback((path, payload = {}, options = {}) => {
    const requestGeneration = authGenerationRef.current;
    const showBlockingLoader = options.blocking === true;
    const actionOptions = { ...options };
    delete actionOptions.blocking;
    if (showBlockingLoader) setServerActionPendingCount((count) => count + 1);
    return postServerAction(path, payload, actionOptions).then((result) => {
      if (requestGeneration !== authGenerationRef.current) {
        const error = new Error("stale_auth_request");
        error.code = "stale_auth_request";
        throw error;
      }
      return result;
    }).finally(() => {
      if (showBlockingLoader) setServerActionPendingCount((count) => Math.max(0, count - 1));
    });
  }, []);

  const loadAdminContext = useCallback(async (force = false) => {
    if (!isSupabaseConfigured || !authUserId) {
      adminContextRef.current = EMPTY_ADMIN_CONTEXT;
      setAdminContext(EMPTY_ADMIN_CONTEXT);
      setState((prev) => withServerAdminContext(prev, EMPTY_ADMIN_CONTEXT));
      return EMPTY_ADMIN_CONTEXT;
    }
    if (!force && adminContextLoadedAuthRef.current === authUserId) return adminContextRef.current;
    if (adminContextPromiseRef.current) return adminContextPromiseRef.current;
    const promise = (async () => {
      try {
      const result = await trackedPostServerAction("/api/admin/context", {}, { allowWhenDisabled: true });
      const context = normalizeAdminContext(result);
      adminContextRef.current = context;
      adminContextLoadedAuthRef.current = authUserId;
      setAdminContext(context);
      setState((prev) => withServerAdminContext(prev, context));
      return context;
      } catch (error) {
        console.warn("Admin context failed.", error.message);
        adminContextRef.current = EMPTY_ADMIN_CONTEXT;
        setAdminContext(EMPTY_ADMIN_CONTEXT);
        setState((prev) => withServerAdminContext(prev, EMPTY_ADMIN_CONTEXT));
        return EMPTY_ADMIN_CONTEXT;
      }
    })().finally(() => {
      if (adminContextPromiseRef.current === promise) adminContextPromiseRef.current = null;
    });
    adminContextPromiseRef.current = promise;
    return promise;
  }, [authUserId, setState, trackedPostServerAction]);

  const loadAdminSection = useCallback(async (options = {}) => {
    const section = normalizeAdminSection(options.section);
    const queueMode = normalizeAdminQueueMode(options.queueMode);
    const { limit, offset } = getDirectoryPageRequest(options, { admin: true });
    const filter = String(options.filter ?? options.query ?? "").trim();
    const force = options.force === true;
    const cacheKey = `${authUserId || ""}:${section}:${queueMode}:${limit}:${offset}:${filter}`;
    latestAdminRequestRef.current = cacheKey;
    if (!isSupabaseConfigured || !authUserId) {
      setAdminStatus((prev) => ({ ...prev, loading: false, loaded: true, error: "", section, queueMode }));
      return true;
    }

    const cached = adminCacheRef.current.get(cacheKey);
    if (!force && cached?.expiresAt > Date.now()) {
      const result = cached.result;
      const remoteState = normalizeServerState(result?.state ?? {});
      const context = normalizeAdminContext(result?.adminContext ?? {});
      adminContextRef.current = context;
      adminContextLoadedAuthRef.current = authUserId;
      setAdminContext(context);
      setAdminState((prev) => withServerAdminContext(mergeRemoteAdminState(prev, remoteState, { section, append: offset > 0 }), context));
      setState((prev) => withServerAdminContext(prev, context));
      setAdminStatus((prev) => ({
        loading: false,
        loaded: true,
        error: "",
        section,
        queueMode,
        page: result?.page ?? null,
        counts: queueMode === "pending"
          ? { ...prev.counts, ...(result?.page?.counts ?? {}) }
          : prev.counts,
      }));
      return true;
    }
    if (adminPromiseRef.current.has(cacheKey)) return adminPromiseRef.current.get(cacheKey);
    if (force) adminCacheRef.current.delete(cacheKey);
    setAdminStatus((prev) => ({ ...prev, loading: true, error: "", section, queueMode }));
    const promise = trackedPostServerAction(
      "/api/directory/load",
      { authUserId, authEmail, scope: "admin", section, queueMode, limit, offset, filter },
      { allowWhenDisabled: true },
    ).then((result) => {
      if (!result?.state) {
        if (latestAdminRequestRef.current === cacheKey) {
          setAdminStatus((prev) => ({ ...prev, loading: false, loaded: true, error: "admin_section_state_missing", section, queueMode }));
        }
        return false;
      }
      adminCacheRef.current.set(cacheKey, { expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS, result });
      if (latestAdminRequestRef.current !== cacheKey) return true;
      const remoteState = normalizeServerState(result.state);
      const context = normalizeAdminContext(result.adminContext ?? {});
      adminContextRef.current = context;
      adminContextLoadedAuthRef.current = authUserId;
      setAdminContext(context);
      setAdminState((prev) => withServerAdminContext(mergeRemoteAdminState(prev, remoteState, { section, append: offset > 0 }), context));
      setState((prev) => withServerAdminContext(prev, context));
      setAdminStatus((prev) => ({
        loading: false,
        loaded: true,
        error: "",
        section,
        queueMode,
        page: result.page ?? null,
        counts: queueMode === "pending"
          ? { ...prev.counts, ...(result.page?.counts ?? {}) }
          : prev.counts,
      }));
      return true;
    }).catch((error) => {
      if (latestAdminRequestRef.current !== cacheKey) return false;
      console.warn("Admin section load failed.", error.message);
      setAdminStatus((prev) => ({ ...prev, loading: false, loaded: true, error: error.message ?? "admin_section_load_failed", section, queueMode }));
      return false;
    }).finally(() => {
      adminPromiseRef.current.delete(cacheKey);
    });
    adminPromiseRef.current.set(cacheKey, promise);
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const refreshAdminState = useCallback(async () => {
    const current = adminStatusRef.current;
    adminCacheRef.current = new Map();
    return loadAdminSection({
      section: current.section || DEFAULT_ADMIN_SECTION,
      queueMode: current.queueMode || DEFAULT_ADMIN_QUEUE_MODE,
      limit: current.page?.limit ?? ADMIN_DEFAULT_PAGE_LIMIT,
      offset: 0,
      filter: current.page?.filter ?? "",
      force: true,
    });
  }, [loadAdminSection]);

  useEffect(() => {
    if (!profileLocked || !authUserId || !currentUserId || isSupabaseConfigured) return;
    if (profileBindings[profileKey] !== currentUserId) {
      setProfileBindings((current) => {
        const next = { ...current, [profileKey]: currentUserId };
        writeProfileBindings(next);
        return next;
      });
    }
    setState((prev) => {
      const profile = prev.users.find((user) => user.id === currentUserId);
      if (!profile || profile.authUserId === authUserId || (profile.authUserId && profile.authUserId !== authUserId)) return prev;
      return updateProfile({ ...prev, currentUserId }, { authUserId }, currentUserId);
    });
  }, [authUserId, currentUserId, profileKey, profileLocked, profileBindings]);

  return {
    loadAdminContext,
    loadAdminSection,
    refreshAdminState,
    trackedPostServerAction,
  };
}
