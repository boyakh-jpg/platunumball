export function buildLoaderActions(context) {
  const {
    ADMIN_DEFAULT_PAGE_LIMIT,
    DEFAULT_ADMIN_QUEUE_MODE,
    DEFAULT_ADMIN_SECTION,
    DEFAULT_RATING_POLICY,
    DIRECTORY_DEFAULT_PAGE_LIMIT,
    adminStatusRef,
    cloneRatingPolicy,
    directoryStatusRef,
    ensureRemoteReady,
    ensureServerActionAvailable,
    isSupabaseConfigured,
    loadAdminContext,
    loadAdminSection,
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
    profileRecordsLoaded,
    refreshCurrentProfile,
    runServerAction,
    setAdminState,
    setState,
    submitCourtDetailReview,
  } = context;

  return ({
loadMatchDetail,
    loadCourtDetail,
    loadMatchRecruitingSchedule,
    loadMatchTeamSchedule,
    refreshCurrentProfile,
    loadDirectory,
    loadMoreDirectory: () => {
      const current = directoryStatusRef.current;
      const nextOffset = current.page?.nextOffset;
      if (current.loading || nextOffset === null || nextOffset === undefined) return Promise.resolve(false);
      return loadDirectory({
        kind: current.page?.kind ?? "all",
        limit: current.page?.limit ?? DIRECTORY_DEFAULT_PAGE_LIMIT,
        offset: nextOffset,
        filter: current.page?.filter ?? "",
        region: current.page?.region ?? "",
        profileId: current.page?.profileId ?? "",
        includeTeamMemberProfiles: current.page?.includeTeamMemberProfiles === true,
        placementCompleteOnly: current.page?.placementCompleteOnly === true,
      });
    },
    loadAdminContext,
    loadAdminSection,
    loadMoreAdminSection: () => {
      const current = adminStatusRef.current;
      const nextOffset = current.page?.nextOffset;
      if (current.loading || nextOffset === null || nextOffset === undefined) return Promise.resolve(false);
      return loadAdminSection({
        section: current.section || DEFAULT_ADMIN_SECTION,
        queueMode: current.queueMode || DEFAULT_ADMIN_QUEUE_MODE,
        limit: current.page?.limit ?? ADMIN_DEFAULT_PAGE_LIMIT,
        offset: nextOffset,
        filter: current.page?.filter ?? "",
      });
    },
    loadAdminUserOperations: async (options = {}) => {
      if (!isSupabaseConfigured) return { ok: true, summary: {}, rows: [], page: { total: 0, hasMore: false, nextOffset: null } };
      if (!ensureRemoteReady("사용자 운영 통계")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/user-operations", "사용자 운영 통계");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/user-operations", { operation: "load", ...options });
    },
    loadAdminCourtDatabase: async (options = {}) => {
      if (!isSupabaseConfigured) return { ok: true, rows: [], page: { page: 1, pageSize: 100, total: 0, pageCount: 1 } };
      if (!ensureRemoteReady("구장 DB")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "구장 DB");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/courts", { operation: "list", ...options });
    },
    loadAdminCourtProximity: async (draft = {}) => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("30m 근접 구장 검사")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "30m 근접 구장 검사");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/courts", { operation: "proximity", ...draft });
    },
    loadAdminCourtDuplicateGroups: async () => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("중복 구장 목록")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "중복 구장 목록");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/courts", { operation: "duplicateGroups" });
    },
    verifyAdminCourtCount: async (draft = {}) => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("실제 코트 수 검증")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "실제 코트 수 검증");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/courts", { operation: "verifyCount", ...draft });
    },
    loadAdminCourtNameHistory: async (options = {}) => {
      if (!isSupabaseConfigured) return { ok: true, rows: [], page: { page: 1, pageSize: 100, total: 0, pageCount: 1 } };
      if (!ensureRemoteReady("구장 수정 이력")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "구장 수정 이력");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/courts", { operation: "history", ...options });
    },
    saveAdminCourtBatch: async (draft = {}) => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("구장 일괄 저장")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "구장 일괄 저장");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/courts", { operation: "updateBatch", ...draft });
    },
    normalizeAdminCourtAddressNames: async () => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("주소 기반 구장명 정리")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "주소 기반 구장명 정리");
      if (serverReady !== true) return serverReady;
      let updatedCount = 0;
      let result = null;
      let batchCount = 0;
      do {
        result = await runServerAction("/api/admin/courts", { operation: "normalizeAddressNames" });
        if (!result || result.ok === false) return result;
        updatedCount += Number(result.updatedCount ?? 0);
        batchCount += 1;
        if (batchCount >= 500 && Number(result.remainingCount ?? 0) > 0) return { ok: false, error: "court_address_normalization_incomplete" };
      } while (Number(result.remainingCount ?? 0) > 0);
      return { ...result, updatedCount };
    },
    reviewAdminCourt: async (draft = {}) => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("구장 원터치 검수")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "구장 원터치 검수");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/courts", { operation: "review", ...draft });
    },
    renameAdminCourt: async (draft = {}) => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("구장 이름 변경")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/courts", "구장 이름 변경");
      if (serverReady !== true) return serverReady;
      const result = await runServerAction("/api/admin/courts", { operation: "rename", ...draft });
      if (!result || result.ok === false || !result.court?.id) return result;
      const mergeRenamedCourt = (prev) => ({
        ...prev,
        settings: {
          ...(prev.settings ?? {}),
          approvedCourts: (prev.settings?.approvedCourts ?? []).map((court) => (
            court.id === result.court.id ? { ...court, ...result.court } : court
          )),
        },
      });
      setState(mergeRenamedCourt);
      setAdminState((prev) => (prev ? mergeRenamedCourt(prev) : prev));
      return result;
    },
    commitAdminUserOperation: async (draft = {}) => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("사용자 운영 조치")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/user-operations", "사용자 운영 조치");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/user-operations", { operation: "commit", ...draft });
    },
    loadRatingPolicy: async () => {
      if (!isSupabaseConfigured) {
        return { ok: true, policy: cloneRatingPolicy(DEFAULT_RATING_POLICY), defaults: cloneRatingPolicy(DEFAULT_RATING_POLICY), version: 1, history: [] };
      }
      if (!ensureRemoteReady("MMR·신뢰도 정책")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/rating-policy", "MMR·신뢰도 정책");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/rating-policy", { action: "load" });
    },
    updateRatingPolicy: async (draft) => {
      if (!isSupabaseConfigured) return { ok: false, error: "remote_required" };
      if (!ensureRemoteReady("MMR·신뢰도 정책 저장")) return { ok: false, error: "remote_not_ready" };
      const serverReady = await ensureServerActionAvailable("/api/admin/rating-policy", "MMR·신뢰도 정책 저장");
      if (serverReady !== true) return serverReady;
      return runServerAction("/api/admin/rating-policy", { action: "update", ...draft });
    },
    loadMoreMatches,
    loadMoreRecruiting,
    loadRecruitingRegion,
    loadRecruitingPost,
    loadPlayMatches,
    loadReportableMatches,
    loadProfileRecords,
    loadPublicProfileRecords,
    loadTeamRecords,
    submitCourtDetailReview,
    profileRecordsLoaded
  });
}
