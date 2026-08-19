export function markRecruitingMutationPending(pendingCounts, pendingIds, postId) {
  if (!postId) return 0;
  const nextCount = (pendingCounts.get(postId) ?? 0) + 1;
  pendingCounts.set(postId, nextCount);
  pendingIds.add(postId);
  return nextCount;
}

export function clearRecruitingMutationPending(pendingCounts, pendingIds, postId) {
  if (!postId) return 0;
  const pendingCount = pendingCounts.get(postId) ?? 0;
  if (pendingCount > 1) {
    pendingCounts.set(postId, pendingCount - 1);
    return pendingCount - 1;
  }
  pendingCounts.delete(postId);
  pendingIds.delete(postId);
  return 0;
}

export function useAppDataServerActions(context) {
  const {
    MATCH_LIST_SCOPES,
    authEmail,
    authGenerationRef,
    authUserId,
    beginTrackedMutation,
    cacheCurrentProfileState,
    createProfileShell,
    currentUserId,
    deletedNotificationIdsRef,
    endTrackedMutation,
    filterBlockedIncomingNotifications,
    getServerActionAvailability,
    getServerActionErrorText,
    getServerOperation,
    isSupabaseConfigured,
    loadProfileState,
    makeClientNotificationId,
    mergeCourtSearchCourts,
    mergeMatchThumbsResult,
    mergeNotificationRefresh,
    mergeRecruitingChatMessage,
    mergeRemoteProfileState,
    mergeRemoteTournamentState,
    mergeServerRoomResult,
    normalizeServerState,
    pendingMatchIdsRef,
    pendingMatchMutationCountsRef,
    pendingRecruitingMutationCountsRef,
    pendingRecruitingPostIdsRef,
    profileLocked,
    profileRefreshPromiseRef,
    recentMatchMutationTimesRef,
    recentRecruitingMutationTimesRef,
    remoteReadyRef,
    roomMutationVersionRef,
    setMatchLists,
    setState,
    settingsAuthUserIdRef,
    settingsSyncQueueRef,
    state,
    stateRef,
    trackedPostServerAction,
    updateMatchListScope,
    updateSettings,
    userMutationTrackerRef,
    useCallback,
    useMemo,
    useRef,
  } = context;

  const pendingFavoriteMutationsRef = useRef(new Map());

const currentUser = useMemo(() => {
    const boundUser = state.users.find((user) => user.id === currentUserId);
    if (boundUser) return boundUser;
    const ownedUser = authUserId ? state.users.find((user) => user.authUserId === authUserId) : null;
    if (ownedUser) return ownedUser;
    if (profileLocked || authUserId) return createProfileShell(authUserId, authEmail);
    return state.users[0] ?? createProfileShell("", authEmail);
  }, [authEmail, authUserId, currentUserId, profileLocked, state.users]);
  const pushLocalWarning = useCallback((title, body, payload = {}) => {
    setState((prev) => ({
      ...prev,
      notifications: [
        {
          id: makeClientNotificationId("n"),
          title,
          body,
          tone: "orange",
          createdAt: new Date().toISOString(),
          ...payload,
        },
        ...(prev.notifications ?? []),
      ],
    }));
  }, [setState]);
  const ensureRemoteReady = useCallback((label = "저장") => {
    if (!isSupabaseConfigured || remoteReadyRef.current) return true;
    pushLocalWarning("정보를 불러오는 중", "정보를 모두 불러온 뒤 다시 시도해 주세요.");
    return false;
  }, [pushLocalWarning]);
  const ensureServerActionAvailable = useCallback(async (path, label = "저장", options = {}) => {
    if (!isSupabaseConfigured) return true;
    const availability = await getServerActionAvailability(path);
    if (availability.ok) return true;
    const errorCode = availability.error || "server_action_unavailable";
    console.warn(`Server action unavailable before optimistic update: ${path}`, {
      reason: errorCode,
      path,
    });
    if (options.quiet !== true) {
      pushLocalWarning("요청을 완료하지 못했습니다", `${label} 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.`, {
        payload: { path, error: errorCode },
      });
    }
    return { ok: false, error: errorCode, path };
  }, [pushLocalWarning]);
  const runServerAction = useCallback((path, payload, options = {}) => {
    return trackedPostServerAction(path, payload, options).then((result) => {
      if (!result) throw new Error("server_action_unavailable");
      return result;
    }).catch((error) => {
      const errorCode = getServerActionErrorText(error);
      if (errorCode === "stale_auth_request") {
        return { ok: false, error: errorCode, stale: true, path };
      }
      if (options.quietError !== errorCode) {
        console.warn(`Server action skipped: ${path}`, {
          reason: errorCode,
          statusCode: error.statusCode ?? null,
          details: error.details ?? null,
        });
        pushLocalWarning("저장하지 못했습니다", "변경 내용을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", {
          payload: { path, error: errorCode, statusCode: error.statusCode ?? null, details: error.details ?? null },
        });
      }
      return { ok: false, error: errorCode, statusCode: error.statusCode ?? null, path, details: error.details ?? null };
    });
  }, [pushLocalWarning, trackedPostServerAction]);
  const persistProfileServer = useCallback((profile) => {
    const tracker = userMutationTrackerRef.current;
    beginTrackedMutation(tracker, "profile");
    const promise = trackedPostServerAction("/api/profile/upsert", { profile }, { allowWhenDisabled: true }).then((result) => {
      if (!result) throw new Error("profile_server_action_unavailable");
      return result;
    }).finally(() => endTrackedMutation(tracker, "profile"));
    promise.catch((error) => {
      console.warn("Profile server action failed.", error.message);
    });
    return promise;
  }, [trackedPostServerAction]);
  const syncRecruitingPostServer = useCallback((post, notifications = [], meta = {}) => {
    const operation = getServerOperation(meta);
    if (!post?.id && !operation) return Promise.resolve(false);
    const pendingPostId = post?.id ?? operation?.postId ?? meta.postId ?? "";
    const mutationStartedAt = Date.now();
    const requestGeneration = authGenerationRef.current;
    if (pendingPostId) {
      roomMutationVersionRef.current += 1;
      markRecruitingMutationPending(
        pendingRecruitingMutationCountsRef.current,
        pendingRecruitingPostIdsRef.current,
        pendingPostId,
      );
      recentRecruitingMutationTimesRef.current.set(pendingPostId, mutationStartedAt);
    }
    const clearPendingRecruitingPost = () => {
      if (requestGeneration !== authGenerationRef.current) return;
      if (!pendingPostId) return;
      clearRecruitingMutationPending(
        pendingRecruitingMutationCountsRef.current,
        pendingRecruitingPostIdsRef.current,
        pendingPostId,
      );
      if (recentRecruitingMutationTimesRef.current.get(pendingPostId) === mutationStartedAt) {
        recentRecruitingMutationTimesRef.current.delete(pendingPostId);
      }
    };
    const payload = operation ? { operation } : { post, notifications, ...meta };
    return runServerAction("/api/recruiting/sync-post", payload).then(async (result) => {
      if (result?.invitationExpired) {
        pushLocalWarning(
          result?.reason === "recruiting_reserve_full" ? "후보 자리가 마감됐습니다" : "방이 마감됐습니다",
          result?.message || "먼저 수락한 선수만 참가합니다.",
          {
            recruitingPostId: result?.postId || pendingPostId,
            invitationId: operation?.invitationId,
            payload: { reason: result?.reason || result?.error || "recruiting_invitation_expired" },
          },
        );
      }
      if (result?.message && operation?.action === "sendRecruitingChat" && (result?.postId || pendingPostId)) {
        setState((prev) => mergeRecruitingChatMessage(prev, result.postId ?? pendingPostId, result.message));
      }
      if (result?.post || result?.createdMatch) {
        setState((prev) => mergeServerRoomResult(prev, result));
        const changedPostId = result?.post?.id;
        const changedMatchId = result?.createdMatch?.id;
        if (changedPostId || changedMatchId) {
          setMatchLists((prev) => {
            const scope = prev[MATCH_LIST_SCOPES.PERSONAL];
            return updateMatchListScope(prev, MATCH_LIST_SCOPES.PERSONAL, {
              ids: changedMatchId && !scope.ids.includes(changedMatchId)
                ? [...scope.ids, changedMatchId]
                : scope.ids,
              recruitingPostIds: changedPostId && !scope.recruitingPostIds.includes(changedPostId)
                ? [...scope.recruitingPostIds, changedPostId]
                : scope.recruitingPostIds,
            });
          });
        }
      }
      if (result && result.ok !== false && typeof meta.onSuccess === "function") {
        try {
          await meta.onSuccess(result);
        } catch (error) {
          console.warn("Recruiting post refresh hook failed.", error.message);
        }
      }
      return result;
    }).finally(() => {
      clearPendingRecruitingPost();
    });
  }, [pushLocalWarning, runServerAction, setState]);
  const syncMatchServer = useCallback((match, notifications = [], meta = {}) => {
    const operation = getServerOperation(meta);
    if (!match?.id && !operation) return Promise.resolve(false);
    const pendingMatchId = match?.id ?? operation?.matchId ?? meta.matchId ?? "";
    const mutationStartedAt = Date.now();
    const requestGeneration = authGenerationRef.current;
    if (pendingMatchId) {
      roomMutationVersionRef.current += 1;
      pendingMatchMutationCountsRef.current.set(
        pendingMatchId,
        (pendingMatchMutationCountsRef.current.get(pendingMatchId) ?? 0) + 1,
      );
      pendingMatchIdsRef.current.add(pendingMatchId);
      recentMatchMutationTimesRef.current.set(pendingMatchId, mutationStartedAt);
    }
    const clearPendingMatch = () => {
      if (requestGeneration !== authGenerationRef.current) return;
      if (!pendingMatchId) return;
      const pendingCount = pendingMatchMutationCountsRef.current.get(pendingMatchId) ?? 0;
      if (pendingCount > 1) {
        pendingMatchMutationCountsRef.current.set(pendingMatchId, pendingCount - 1);
      } else {
        pendingMatchMutationCountsRef.current.delete(pendingMatchId);
        pendingMatchIdsRef.current.delete(pendingMatchId);
      }
      if (recentMatchMutationTimesRef.current.get(pendingMatchId) === mutationStartedAt) {
        recentMatchMutationTimesRef.current.delete(pendingMatchId);
      }
    };
    const payload = operation ? { operation } : { match, notifications, ...meta };
    return runServerAction("/api/matches/sync-match", payload).then((result) => {
      if (result?.match) {
        setState((prev) => mergeServerRoomResult(prev, result, {
          preserveMatchAttendance: operation?.action === "checkInMatchPlayer",
        }));
      } else if (result?.ok !== false && operation?.action === "submitMatchThumbs") {
        setState((prev) => mergeMatchThumbsResult(prev, result, operation));
      }
      return result;
    }).finally(() => {
      clearPendingMatch();
    });
  }, [runServerAction, setState]);
  const submitReportServer = useCallback((report, notifications = []) => {
    if (!report?.id) return Promise.resolve({ ok: false, error: "missing_report_id" });
    return runServerAction("/api/reports/submit", { report, notifications });
  }, [runServerAction]);
  const syncTeamServer = useCallback((team, notifications = []) => {
    if (!team?.id) return Promise.resolve(false);
    return runServerAction("/api/teams/sync-team", { team, notifications });
  }, [runServerAction]);
  const deleteTeamServer = useCallback((deletedTeamId, notifications = []) => {
    if (!deletedTeamId) return Promise.resolve(false);
    return runServerAction("/api/teams/sync-team", { deletedTeamId, notifications });
  }, [runServerAction]);
  const syncTeamInvitationServer = useCallback((teamInviteAction, payload = {}) => {
    if (!teamInviteAction) return Promise.resolve(false);
    return runServerAction("/api/teams/sync-team", { teamInviteAction, ...payload }).then((result) => {
      if (result?.state) {
        const remoteState = normalizeServerState(result.state);
        setState((prev) => mergeRemoteProfileState(prev, remoteState ?? {}));
      }
      return result;
    });
  }, [runServerAction, setState]);
  const syncTournamentServer = useCallback((tournament, notifications = [], meta = {}) => {
    const operation = getServerOperation(meta);
    if (!tournament?.id && !operation) return Promise.resolve(false);
    const payload = operation ? { operation } : { tournament, notifications, ...meta };
    return runServerAction("/api/tournaments/sync-tournament", payload).then((result) => {
      if (result?.state) {
        const remoteState = normalizeServerState(result.state);
        setState((prev) => mergeRemoteTournamentState(prev, remoteState ?? {}));
      } else if (result?.tournament || result?.createdMatches?.length) {
        setState((prev) => mergeRemoteTournamentState(prev, {
          tournaments: result.tournament ? [result.tournament] : [],
          matches: result.createdMatches ?? [],
        }));
      }
      return result;
    });
  }, [runServerAction, setState]);
  const syncRefereeServer = useCallback((action, payload = {}) => {
    if (!action) return Promise.resolve(null);
    return runServerAction("/api/referee/sync", { action, ...payload });
  }, [runServerAction]);
  const syncFavoriteServer = useCallback((targetType, targetId, active) => {
    if (!targetType || !targetId) return Promise.resolve({ ok: false, error: "invalid_favorite_target" });
    return runServerAction("/api/favorites/sync", { targetType, targetId, active });
  }, [runServerAction]);
  const applyFavoriteToggle = useCallback((targetType, targetId, settingsKey, toggleAction, targetSnapshot = null) => {
    const safeTargetId = String(targetId ?? "").trim();
    if (!safeTargetId) return Promise.resolve({ ok: false, error: "invalid_favorite_target" });
    const mutationKey = `${targetType}:${safeTargetId}`;
    const pendingMutation = pendingFavoriteMutationsRef.current.get(mutationKey);
    if (pendingMutation) return pendingMutation;
    const tracker = userMutationTrackerRef.current;
    beginTrackedMutation(tracker, "favorites");
    const active = !(stateRef.current.settings?.[settingsKey] ?? []).includes(safeTargetId);
    const applyOptimisticToggle = (current) => {
      let hydrated = current;
      if (active && targetSnapshot?.id === safeTargetId) {
        if (targetType === "court") {
          hydrated = {
            ...current,
            settings: {
              ...current.settings,
              approvedCourts: mergeCourtSearchCourts(current.settings?.approvedCourts ?? [], [targetSnapshot]),
            },
          };
        } else {
          hydrated = mergeRemoteProfileState(current, targetType === "team"
            ? { teams: [targetSnapshot] }
            : { users: [targetSnapshot] });
        }
      }
      return toggleAction(hydrated, safeTargetId);
    };
    stateRef.current = applyOptimisticToggle(stateRef.current);
    setState((prev) => applyOptimisticToggle(prev));
    const rollbackOptimisticToggle = () => {
      setState((prev) => {
        const stillOptimistic = (prev.settings?.[settingsKey] ?? []).includes(safeTargetId) === active;
        const next = stillOptimistic ? toggleAction(prev, safeTargetId) : prev;
        stateRef.current = next;
        return next;
      });
    };
    const mutation = syncFavoriteServer(targetType, safeTargetId, active)
      .then((result) => {
        if (result?.ok !== false) return result;
        rollbackOptimisticToggle();
        return result;
      })
      .catch((error) => {
        rollbackOptimisticToggle();
        return { ok: false, error: error?.message ?? "favorite_sync_failed" };
      })
      .finally(() => {
        endTrackedMutation(tracker, "favorites");
        if (pendingFavoriteMutationsRef.current.get(mutationKey) === mutation) {
          pendingFavoriteMutationsRef.current.delete(mutationKey);
        }
      });
    pendingFavoriteMutationsRef.current.set(mutationKey, mutation);
    return mutation;
  }, [mergeCourtSearchCourts, mergeRemoteProfileState, setState, syncFavoriteServer]);
  const markNotificationReadServer = useCallback((payload = {}) => {
    const tracker = userMutationTrackerRef.current;
    beginTrackedMutation(tracker, "notifications");
    const request = isSupabaseConfigured
      ? runServerAction("/api/notifications/read", payload)
      : Promise.resolve({ ok: true, local: true });
    return request.finally(() => endTrackedMutation(tracker, "notifications"));
  }, [runServerAction]);
  const deleteNotificationServer = useCallback((payload = {}) => {
    const tracker = userMutationTrackerRef.current;
    beginTrackedMutation(tracker, "notifications");
    const request = isSupabaseConfigured
      ? runServerAction("/api/notifications/delete", payload)
      : Promise.resolve({ ok: true, local: true });
    return request.then((result) => {
      if (result?.ok !== false && payload.notificationId) deletedNotificationIdsRef.current.add(String(payload.notificationId));
      return result;
    }).finally(() => endTrackedMutation(tracker, "notifications"));
  }, [runServerAction]);
  const loadNotifications = useCallback((options = {}) => {
    if (!isSupabaseConfigured) return Promise.resolve(stateRef.current.notifications ?? []);
    const tracker = userMutationTrackerRef.current;
    const mutationVersion = tracker.notifications?.version ?? 0;
    const append = options.append === true;
    return runServerAction("/api/notifications/list", {
      limit: 20,
      cursor: options.cursor ?? (append ? stateRef.current.notificationNextCursor : null),
    }).then((result) => {
      if (!result || result.ok === false || !Array.isArray(result.notifications)) return false;
      setState((prev) => ({
        ...prev,
        notifications: mergeNotificationRefresh(
          prev.notifications,
          filterBlockedIncomingNotifications(result.notifications, prev),
          {
            append,
            deletedIds: deletedNotificationIdsRef.current,
            preserveLocalChanges: userMutationTrackerRef.current !== tracker
              || Boolean(tracker.notifications?.pending)
              || (tracker.notifications?.version ?? 0) !== mutationVersion,
          },
        ),
        notificationNextCursor: result.nextCursor ?? null,
        notificationHasMore: result.hasMore === true,
        notificationUnreadCount: Number.isFinite(result.unreadCount) ? result.unreadCount : prev.notificationUnreadCount,
      }));
      return result.notifications;
    });
  }, [runServerAction, setState]);
  const syncSettingsServer = useCallback((settingsPatch = {}, options = {}) => {
    const tracker = userMutationTrackerRef.current;
    beginTrackedMutation(tracker, "settings");
    const requestedAuthUserId = authUserId;
    const requestedCurrentUserId = currentUserId;
    const shouldApply = typeof options.shouldApply === "function" ? options.shouldApply : () => true;
    const request = settingsSyncQueueRef.current.catch(() => null).then(async () => {
      if (settingsAuthUserIdRef.current !== requestedAuthUserId) return { ok: false, stale: true };
      const result = await runServerAction("/api/settings/sync", { settings: settingsPatch });
      if (settingsAuthUserIdRef.current !== requestedAuthUserId) return { ...result, ok: false, stale: true };
      if (result?.settings && settingsAuthUserIdRef.current === requestedAuthUserId && shouldApply()) {
        setState((prev) => {
          if (settingsAuthUserIdRef.current !== requestedAuthUserId) return prev;
          const nextState = updateSettings({ ...prev, currentUserId: requestedCurrentUserId }, result.settings);
          cacheCurrentProfileState(requestedAuthUserId, nextState);
          return nextState;
        });
      }
      return result;
    });
    settingsSyncQueueRef.current = request.catch(() => null);
    return request.finally(() => endTrackedMutation(tracker, "settings"));
  }, [authUserId, currentUserId, runServerAction, setState]);

  const refreshCurrentProfile = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (profileRefreshPromiseRef.current) return profileRefreshPromiseRef.current;
    const promise = (async () => {
      try {
        const remoteState = await loadProfileState(authUserId, authEmail);
        setState((prev) => {
          const nextState = mergeRemoteProfileState(prev, remoteState ?? {});
          cacheCurrentProfileState(authUserId, nextState);
          return nextState;
        });
        return true;
      } catch (error) {
        console.warn("Profile refresh failed.", error.message);
        return false;
      }
    })().finally(() => {
      profileRefreshPromiseRef.current = null;
    });
    profileRefreshPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, setState]);

  return {
    applyFavoriteToggle,
    currentUser,
    deleteTeamServer,
    deleteNotificationServer,
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
  };
}
