export function buildSettingsActions(context) {
  const {
    applyBlockedUserMutation,
    applyFavoriteToggle,
    approveCourtRequest,
    authUserId,
    commitAdminAppointmentAction,
    commitAdminReviewAction,
    currentUserId,
    deleteNotification,
    ensureRemoteReady,
    ensureServerActionAvailable,
    finishRefereeExamAttempt,
    getNewReportNotifications,
    isSupabaseConfigured,
    loadNotifications,
    markAllNotificationsRead,
    markNotificationRead,
    markNotificationReadServer,
    mergeCourtApprovalResult,
    refreshAdminState,
    reportCourt,
    reportCourtRequest,
    reportCourtReview,
    reportMatch,
    reportPlayer,
    reportTeamEmblem,
    rollbackIfServerFailed,
    runServerAction,
    setAdminState,
    setState,
    settingsAuthUserIdRef,
    startRefereeExamAttempt,
    stateRef,
    submitCourtRequest,
    submitCourtReview,
    submitNameReport,
    submitReportServer,
    syncRefereeServer,
    syncSettingsServer,
    themeCommittedValueRef,
    themeMutationVersionRef,
    toggleFavoriteCourt,
    toggleFavoritePlayer,
    toggleFavoriteReferee,
    toggleFavoriteTeam,
    updatePrivacySettings,
    updateSettings,
    upsertRefereeExamAttempt,
  } = context;

  const persistCreatedReport = async (createdReport, syncedNotifications) => {
    if (!isSupabaseConfigured) return { ok: true, reportId: createdReport.id };
    const result = await submitReportServer(createdReport, syncedNotifications);
    if (!result || result.ok === false || result.duplicate === true) {
      setState((current) => ({
        ...current,
        reports: (current.reports ?? []).filter((report) => report.id !== createdReport.id),
        notifications: (current.notifications ?? []).filter(
          (notification) => !syncedNotifications.some((item) => item.id === notification.id),
        ),
      }));
    }
    return result;
  };

  const restoreNotificationsAfterReadFailure = async (previousNotifications) => {
    let reloaded = false;
    try {
      reloaded = await loadNotifications();
    } catch {
      reloaded = false;
    }
    if (!Array.isArray(reloaded)) {
      setState((current) => ({ ...current, notifications: previousNotifications }));
    }
  };

  return ({
updateSettings: (patch) => {
    if (!isSupabaseConfigured) {
      setState((prev) => updateSettings({ ...prev, currentUserId }, patch));
      return Promise.resolve(true);
    }
    let rollbackState = null;
    setState((prev) => {
      rollbackState = prev;
      return updateSettings({ ...prev, currentUserId }, patch);
    });
    return rollbackIfServerFailed(syncSettingsServer(patch), rollbackState, "설정 저장", { patch });
  },
  updatePrivacySettings: (patch) => {
    let nextPrivacy = null;
    let rollbackState = null;
    setState((prev) => {
      rollbackState = prev;
      const next = updatePrivacySettings({ ...prev, currentUserId }, patch);
      nextPrivacy = next.settings?.privacy ?? null;
      return next;
    });
    if (!isSupabaseConfigured) return Promise.resolve(true);
    return nextPrivacy
      ? rollbackIfServerFailed(syncSettingsServer({ privacy: nextPrivacy }), rollbackState, "설정 저장", { privacy: nextPrivacy })
      : Promise.resolve(true);
  },
  saveTheme: (theme) => {
    const nextTheme = theme === "light" ? "light" : "dark";
    if (!isSupabaseConfigured) {
      setState((prev) => updateSettings({ ...prev, currentUserId }, { theme: nextTheme }));
      return Promise.resolve(true);
    }
    if (!ensureRemoteReady("밝기 저장")) return Promise.resolve(false);
    const requestAuthUserId = authUserId;
    const requestVersion = themeMutationVersionRef.current + 1;
    themeMutationVersionRef.current = requestVersion;
    if (!themeCommittedValueRef.current) themeCommittedValueRef.current = stateRef.current.settings?.theme ?? "dark";
    const isCurrentRequest = () => (
      settingsAuthUserIdRef.current === requestAuthUserId && themeMutationVersionRef.current === requestVersion
    );
    setState((prev) => {
      return updateSettings({ ...prev, currentUserId }, { theme: nextTheme });
    });
    return syncSettingsServer({ theme: nextTheme }, { shouldApply: isCurrentRequest }).then((result) => {
      if (result?.stale) return false;
      if (result && result.ok !== false) {
        themeCommittedValueRef.current = nextTheme;
        return true;
      }
      if (!isCurrentRequest()) return false;
      const committedTheme = themeCommittedValueRef.current ?? "dark";
      setState((prev) => updateSettings({ ...prev, currentUserId }, { theme: committedTheme }));
      return false;
    });
  },
  blockUser: (user) => applyBlockedUserMutation(user, true),
  unblockUser: (userId) => applyBlockedUserMutation(userId, false),
  reportMatch: async (matchId, reason, reportedUserIds) => {
    const previousState = stateRef.current;
    const existingIds = new Set((previousState.reports ?? []).map((report) => report.id));
    const nextState = reportMatch({ ...previousState, currentUserId }, matchId, reason, reportedUserIds);
    const createdReport = (nextState.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
    if (!createdReport) return { ok: false, error: "match_report_unavailable" };
    const syncedNotifications = getNewReportNotifications(previousState, nextState, createdReport);
    setState(nextState);
    return persistCreatedReport(createdReport, syncedNotifications);
  },
  reportPlayer: async (playerId, matchId, reason) => {
    const previousState = stateRef.current;
    const existingIds = new Set((previousState.reports ?? []).map((report) => report.id));
    const nextState = reportPlayer({ ...previousState, currentUserId }, playerId, matchId, reason);
    const createdReport = (nextState.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
    if (!createdReport) return { ok: false, error: "player_report_unavailable" };
    const syncedNotifications = getNewReportNotifications(previousState, nextState, createdReport);
    setState(nextState);
    return persistCreatedReport(createdReport, syncedNotifications);
  },
  reportCourtRequest: async (requestId, reason) => {
    if (!isSupabaseConfigured) {
      setState((prev) => reportCourtRequest({ ...prev, currentUserId }, requestId, reason));
      return { ok: true };
    }
    const result = await runServerAction("/api/court-requests/report", { requestId, reason });
    if (!result || result.ok === false || result.duplicate === true) return result;
    setState((prev) => reportCourtRequest(
      { ...prev, currentUserId },
      requestId,
      reason,
      { reportId: result.reportId },
    ));
    return result;
  },
  reportCourt: async (courtId, reason, courtCorrection = null, courtSnapshot = null) => {
    const previousState = stateRef.current;
    let createdReport = null;
    let syncedNotifications = [];
    const normalizedCourtCorrection = courtCorrection ?? {
      field: "other",
      proposedValue: String(reason || "구장 정보 확인 필요").trim(),
      evidenceUrl: "",
    };
    const existingIds = new Set((previousState.reports ?? []).map((report) => report.id));
    let next = reportCourt({ ...previousState, currentUserId }, courtId, reason, courtSnapshot);
    createdReport = (next.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
    if (createdReport) {
      createdReport = { ...createdReport, courtCorrection: normalizedCourtCorrection };
      next = {
        ...next,
        reports: (next.reports ?? []).map((report) => report.id === createdReport.id ? createdReport : report),
      };
    }
    syncedNotifications = createdReport ? getNewReportNotifications(previousState, next, createdReport) : [];
    if (!createdReport) return { ok: false, error: "court_report_unavailable" };
    setState(next);
    return persistCreatedReport(createdReport, syncedNotifications);
  },
  reportCourtReview: async (reviewId, reason) => {
    const previousState = stateRef.current;
    const existingIds = new Set((previousState.reports ?? []).map((report) => report.id));
    const next = reportCourtReview({ ...previousState, currentUserId }, reviewId, reason);
    const createdReport = (next.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
    const syncedNotifications = createdReport ? getNewReportNotifications(previousState, next, createdReport) : [];
    if (!createdReport) return { ok: false, error: "court_review_report_unavailable" };
    setState(next);
    return persistCreatedReport(createdReport, syncedNotifications);
  },
  reportTeamEmblem: async (teamId, reason, teamSnapshot = null) => {
    const serverReady = await ensureServerActionAvailable("/api/reports/submit", "팀 엠블럼 신고");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("팀 엠블럼 신고")) return { ok: false, error: "remote_not_ready" };
    let createdReport = null;
    let syncedNotifications = [];
    setState((prev) => {
      const existingIds = new Set((prev.reports ?? []).map((report) => report.id));
      const next = reportTeamEmblem({ ...prev, currentUserId }, teamId, reason, teamSnapshot);
      createdReport = (next.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
      syncedNotifications = createdReport ? getNewReportNotifications(prev, next, createdReport) : [];
      return next;
    });
    if (!createdReport) return { ok: false, error: "team_emblem_report_unavailable" };
    return persistCreatedReport(createdReport, syncedNotifications);
  },
  reportTeamName: (teamId, reason, teamName = "") => submitNameReport("team_name", teamId, reason, teamName),
  reportAffiliationName: (affiliationId, reason, affiliationName = "") => submitNameReport("affiliation_name", affiliationId, reason, affiliationName),
  commitAdminReviewAction: async (draft) => {
    if (!isSupabaseConfigured) {
      setState((prev) => commitAdminReviewAction({ ...prev, currentUserId }, draft));
      return true;
    }
    if (!ensureRemoteReady("관리자 조치")) return false;
    const serverReady = await ensureServerActionAvailable("/api/admin/review-action", "관리자 조치");
    if (serverReady !== true) return serverReady;
    const result = await runServerAction("/api/admin/review-action", draft);
    if (!result || result.ok === false) {
      if (result?.error === "report_already_processed") {
        await refreshAdminState();
      }
      return result;
    }
    await refreshAdminState();
    return result;
  },
  commitAdminAppointmentAction: async (draft) => {
    if (!isSupabaseConfigured) {
      setState((prev) => commitAdminAppointmentAction({ ...prev, currentUserId }, draft));
      return true;
    }
    if (!ensureRemoteReady("관리자 임명")) return false;
    const serverReady = await ensureServerActionAvailable("/api/admin/appointment-action", "관리자 임명");
    if (serverReady !== true) return serverReady;
    const result = await runServerAction("/api/admin/appointment-action", draft);
    if (!result || result.ok === false) return result;
    await refreshAdminState();
    return result;
  },
  approveCourtRequest: async (requestId, approval = {}) => {
    if (!isSupabaseConfigured) {
      setState((prev) => approveCourtRequest({ ...prev, currentUserId }, requestId, approval));
      return true;
    }
    if (!ensureRemoteReady("구장 승인")) return false;
    const serverReady = await ensureServerActionAvailable("/api/court-requests/approve", "구장 승인");
    if (serverReady !== true) return serverReady;
    const result = await runServerAction("/api/court-requests/approve", { requestId, approval });
    if (!result || result.ok === false) return result;
    setState((prev) => mergeCourtApprovalResult(prev, requestId, result, currentUserId));
    setAdminState((prev) => (prev ? mergeCourtApprovalResult(prev, requestId, result, currentUserId) : prev));
    await refreshAdminState();
    return result;
  },
  markNotificationRead: async (notificationId) => {
    const previousNotifications = stateRef.current.notifications ?? [];
    setState((prev) => markNotificationRead(prev, notificationId));
    try {
      const result = await markNotificationReadServer({ notificationId });
      if (!result || result.ok === false) await restoreNotificationsAfterReadFailure(previousNotifications);
      return result;
    } catch (error) {
      await restoreNotificationsAfterReadFailure(previousNotifications);
      return { ok: false, error: error?.message ?? "notification_read_failed" };
    }
  },
  markAllNotificationsRead: async () => {
    const previousNotifications = stateRef.current.notifications ?? [];
    setState((prev) => markAllNotificationsRead(prev));
    try {
      const result = await markNotificationReadServer({ all: true });
      if (!result || result.ok === false) await restoreNotificationsAfterReadFailure(previousNotifications);
      return result;
    } catch (error) {
      await restoreNotificationsAfterReadFailure(previousNotifications);
      return { ok: false, error: error?.message ?? "notification_read_failed" };
    }
  },
  loadNotifications,
  deleteNotification: async (notificationId) => {
    const safeNotificationId = String(notificationId ?? "").trim();
    if (!safeNotificationId) return false;
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("알림 삭제")) return false;
      const serverReady = await ensureServerActionAvailable("/api/notifications/delete", "알림 삭제");
      if (serverReady !== true) return serverReady;
      const result = await runServerAction("/api/notifications/delete", { notificationId: safeNotificationId });
      if (!result || result.ok === false) return result;
    }
    setState((prev) => deleteNotification(prev, safeNotificationId));
    return true;
  },
  toggleFavoritePlayer: (userId, targetSnapshot) => applyFavoriteToggle("player", userId, "favoritePlayerIds", toggleFavoritePlayer, targetSnapshot),
  toggleFavoriteTeam: (teamId, targetSnapshot) => applyFavoriteToggle("team", teamId, "favoriteTeamIds", toggleFavoriteTeam, targetSnapshot),
  toggleFavoriteCourt: (courtId, targetSnapshot) => applyFavoriteToggle("court", courtId, "favoriteCourtIds", toggleFavoriteCourt, targetSnapshot),
  toggleFavoriteReferee: (userId, targetSnapshot) => applyFavoriteToggle("referee", userId, "favoriteRefereeIds", toggleFavoriteReferee, targetSnapshot),
  submitCourtRequest: (draft, photos = []) => {
    if (!ensureRemoteReady("구장 등록요청")) return Promise.resolve(null);
    let createdRequest = null;
    let rollbackState = null;
    setState((prev) => {
      rollbackState = prev;
      const existingIds = new Set((prev.settings?.courtRequests ?? []).map((request) => request.id));
      const next = submitCourtRequest({ ...prev, currentUserId }, draft);
      createdRequest = (next.settings?.courtRequests ?? []).find((request) => !existingIds.has(request.id)) ?? null;
      return next;
    });
    if (!createdRequest) return Promise.resolve(null);
    if (!isSupabaseConfigured) return Promise.resolve({ ok: true, requestId: createdRequest.id, status: "pending", autoApproved: false });
    return rollbackIfServerFailed(
      runServerAction("/api/court-requests/submit", { request: { ...createdRequest, fieldLocation: draft.fieldLocation }, photos }),
      rollbackState,
      "구장 등록요청",
      { requestId: createdRequest.id },
    ).then((result) => {
      if (!result || result.ok === false) return result;
      if (result.autoApproved) setState((prev) => mergeCourtApprovalResult(prev, createdRequest.id, result, "system:court-ai"));
      return { ...result, requestId: result.requestId ?? createdRequest.id };
    });
  },
  loadCourtRequestEvidence: (requestId) => {
    if (!isSupabaseConfigured || !ensureRemoteReady("구장 검증자료")) return Promise.resolve(null);
    return runServerAction("/api/court-requests/evidence", { requestId });
  },
  submitCourtReview: (matchId, draft) => {
    let submittedReview = null;
    let rollbackState = null;
    setState((prev) => {
      rollbackState = prev;
      const next = submitCourtReview({ ...prev, currentUserId }, matchId, draft);
      submittedReview = (next.settings?.courtReviews ?? []).find((review) => review.matchId === matchId && review.reviewerId === currentUserId) ?? null;
      return next;
    });
    if (!submittedReview) return Promise.resolve(null);
    if (!isSupabaseConfigured) return Promise.resolve(submittedReview);
    return rollbackIfServerFailed(
      runServerAction("/api/courts/submit-review", { review: submittedReview }),
      rollbackState,
      "구장 리뷰",
      { matchId, reviewId: submittedReview.id },
    ).then((result) => (result && result.ok !== false ? submittedReview : null));
  },
  startRefereeExamAttempt: (draft) => {
    if (isSupabaseConfigured) {
      return syncRefereeServer("startExam", { attempt: draft }).then((result) => {
        if (result?.ok === false || !result?.attempt) return null;
        upsertRefereeExamAttempt(result.attempt);
        return result.attempt;
      });
    }
    let createdAttempt = null;
    setState((prev) => {
      const existingIds = new Set((prev.settings?.refereeExamAttempts ?? []).map((attempt) => attempt.id));
      const next = startRefereeExamAttempt({ ...prev, currentUserId }, draft);
      createdAttempt = (next.settings?.refereeExamAttempts ?? []).find((attempt) => !existingIds.has(attempt.id)) ?? null;
      return next;
    });
    return Promise.resolve(createdAttempt);
  },
  finishRefereeExamAttempt: (attemptId, result) => {
    if (isSupabaseConfigured) {
      return syncRefereeServer("finishExam", { attempt: { id: attemptId, answers: result?.answers ?? result } }).then((serverResult) => {
        if (serverResult?.ok === false || !serverResult?.attempt) return null;
        upsertRefereeExamAttempt(serverResult.attempt);
        return serverResult.result ?? serverResult.attempt.result ?? null;
      });
    }
    let syncedAttempt = null;
    setState((prev) => {
      const beforeAttempt = (prev.settings?.refereeExamAttempts ?? []).find((attempt) => attempt.id === attemptId);
      const next = finishRefereeExamAttempt({ ...prev, currentUserId }, attemptId, result);
      const nextAttempt = (next.settings?.refereeExamAttempts ?? []).find((attempt) => attempt.id === attemptId) ?? null;
      syncedAttempt = beforeAttempt && nextAttempt !== beforeAttempt ? nextAttempt : null;
      return next;
    });
    return Promise.resolve(syncedAttempt?.result ?? result ?? null);
  }
  });
}
