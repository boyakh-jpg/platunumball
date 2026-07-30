export function buildProfileTeamActions(context) {
  const {
    authUserId,
    cacheCurrentProfileState,
    createTeam,
    currentUserId,
    deleteTeam,
    deleteTeamServer,
    ensureRemoteReady,
    ensureServerActionAvailable,
    getAffiliationNormalizedKey,
    getNewItems,
    getNewRefereeNotifications,
    getNewTeamNotifications,
    getServerActionErrorText,
    isSupabaseConfigured,
    mergeRemoteProfileState,
    normalizeAffiliationName,
    normalizeServerState,
    persistProfileServer,
    prepareTeamEmblemUpload,
    profileLocked,
    refreshCurrentProfile,
    rollbackIfServerFailed,
    rollbackServerMutation,
    runServerAction,
    serverProfileBound,
    setState,
    stateRef,
    submitRefereeRequest,
    syncRefereeServer,
    syncTeamServer,
    updateProfile,
  } = context;

  return ({
setProfileAffiliation: async ({ affiliationId = "", name = "" } = {}) => {
    const safeName = normalizeAffiliationName(name);
    if (!isSupabaseConfigured) {
      const now = new Date().toISOString();
      setState((prev) => {
        const currentProfile = (prev.users ?? []).find((user) => user.id === currentUserId);
        const existing = (prev.affiliations ?? []).find((item) => item.id === affiliationId)
          ?? (prev.affiliations ?? []).find((item) => item.type === "organization" && getAffiliationNormalizedKey(item.name) === getAffiliationNormalizedKey(safeName));
        const selected = safeName || existing
          ? existing ?? {
            id: `aff_local_${Date.now().toString(36)}`,
            type: "organization",
            name: safeName,
            memberCount: 0,
            score: 0,
            wins: 0,
            losses: 0,
            status: "active",
          }
          : null;
        if ((currentProfile?.affiliationId ?? null) === (selected?.id ?? null)) return prev;
        const hasSelected = selected && (prev.affiliations ?? []).some((item) => item.id === selected.id);
        const nextAffiliations = (prev.affiliations ?? []).map((item) => {
          if (item.id === currentProfile?.affiliationId) return { ...item, memberCount: Math.max(0, Number(item.memberCount ?? 0) - 1) };
          if (item.id === selected?.id) return { ...item, memberCount: Number(item.memberCount ?? 0) + 1 };
          return item;
        });
        if (selected && !hasSelected) nextAffiliations.push({ ...selected, memberCount: 1 });
        const selectedMemberCount = selected
          ? Number(nextAffiliations.find((item) => item.id === selected.id)?.memberCount ?? 0)
          : 0;
        return {
          ...prev,
          affiliations: nextAffiliations,
          users: (prev.users ?? []).map((user) => user.id === currentUserId ? {
            ...user,
            affiliationId: selected?.id ?? null,
            affiliationName: selected?.name ?? "",
            affiliationMemberCount: selectedMemberCount,
            affiliationUpdatedAt: now,
          } : user),
        };
      });
      return { ok: true };
    }
    const serverReady = await ensureServerActionAvailable("/api/profile/affiliation", "소속 저장");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("소속 저장")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/profile/affiliation", { affiliationId, name: safeName });
    if (result?.state) {
      const remoteState = normalizeServerState(result.state);
      setState((prev) => {
        const nextState = mergeRemoteProfileState(prev, remoteState ?? {});
        cacheCurrentProfileState(authUserId, nextState);
        return nextState;
      });
    }
    return result;
  },
  submitRefereeRequest: (draft) => {
    let createdRequest = null;
    let syncedNotifications = [];
    setState((prev) => {
      const existingIds = new Set((prev.settings?.refereeRequests ?? []).map((request) => request.id));
      const next = submitRefereeRequest({ ...prev, currentUserId }, draft);
      createdRequest = (next.settings?.refereeRequests ?? []).find((request) => !existingIds.has(request.id)) ?? null;
      syncedNotifications = createdRequest ? getNewRefereeNotifications(prev, next) : [];
      return next;
    });
    if (createdRequest) syncRefereeServer("submitRequest", { request: createdRequest, notifications: syncedNotifications });
  },
  updateProfile: (patch, targetUserId = currentUserId) => {
    const safeTargetUserId = serverProfileBound ? currentUserId : targetUserId;
    const safePatch = profileLocked ? { ...patch, authUserId } : patch;
    const rollbackState = stateRef.current;
    const optimisticState = updateProfile({ ...rollbackState, currentUserId }, safePatch, safeTargetUserId);
    const nextProfile = optimisticState.users.find((user) => user.id === safeTargetUserId) ?? null;
    setState((prev) => updateProfile({ ...prev, currentUserId }, safePatch, safeTargetUserId));
    if (!serverProfileBound) return Promise.resolve({ ok: true });
    if (!nextProfile) return Promise.resolve({ ok: false, error: "profile_not_ready" });
    return persistProfileServer(nextProfile).then(async (result) => {
      if (result?.state) {
        const remoteState = normalizeServerState(result.state);
        setState((prev) => {
          const nextState = mergeRemoteProfileState(prev, remoteState ?? {});
          cacheCurrentProfileState(authUserId, nextState);
          return nextState;
        });
      } else if (result && result.ok !== false) {
        await refreshCurrentProfile();
      }
      return result;
    }).catch((error) => {
      rollbackServerMutation(rollbackState, "프로필 저장", {
        profileId: safeTargetUserId,
        error: getServerActionErrorText(error),
        statusCode: error.statusCode ?? null,
        details: error.details ?? null,
      });
      throw error;
    });
  },
  createTeam: async (draft) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/sync-team", "팀 생성");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("팀 생성")) return { ok: false, error: "remote_not_ready" };
    let rollbackState = null;
    let createdTeam = null;
    let syncedNotifications = [];
    let localBlockNotification = null;
    setState((prev) => {
      rollbackState = prev;
      const existingIds = new Set((prev.teams ?? []).map((team) => team.id));
      const next = createTeam({ ...prev, currentUserId }, draft);
      createdTeam = (next.teams ?? []).find((team) => !existingIds.has(team.id)) ?? null;
      syncedNotifications = createdTeam ? getNewTeamNotifications(prev, next) : [];
      localBlockNotification = createdTeam ? null : getNewItems(prev.notifications ?? [], next.notifications ?? [])[0] ?? null;
      return next;
    });
    if (!createdTeam) return {
      ok: false,
      error: "local_reducer_blocked",
      message: localBlockNotification
        ? `${localBlockNotification.title}: ${localBlockNotification.body}`
        : "팀 생성 조건을 통과하지 못했습니다.",
    };
    const result = await rollbackIfServerFailed(
      syncTeamServer(createdTeam, syncedNotifications),
      rollbackState,
      "팀 생성",
      { teamId: createdTeam.id },
    );
    return result?.ok === false ? result : createdTeam.id;
  },
  loadProfileIconAchievements: async () => {
    const serverReady = await ensureServerActionAvailable("/api/profile/achievements", "프로필 아이콘 업적 불러오기");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("프로필 아이콘 업적 불러오기")) return { ok: false, error: "remote_not_ready" };
    return runServerAction("/api/profile/achievements", {});
  },
  saveProfileIconSettings: async (settings) => {
    const serverReady = await ensureServerActionAvailable("/api/profile/emblem", "프로필 아이콘 설정 저장");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("프로필 아이콘 설정 저장")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/profile/emblem", { action: "settings", ...settings });
    if (result?.ok !== false && result?.profileId) {
      setState((prev) => ({
        ...prev,
        users: (prev.users ?? []).map((user) => user.id === result.profileId ? {
          ...user,
          avatarSource: result.avatarSource ?? settings.avatarSource ?? user.avatarSource,
          avatarIconKey: result.avatarIconKey ?? user.avatarIconKey,
          avatarColor: result.avatarColor ?? settings.avatarColor ?? user.avatarColor,
          avatarBackgroundEnabled: result.avatarBackgroundEnabled ?? settings.avatarBackgroundEnabled ?? user.avatarBackgroundEnabled ?? true,
          avatarBorderEnabled: result.avatarBorderEnabled ?? settings.avatarBorderEnabled ?? user.avatarBorderEnabled ?? false,
          avatarBorderColor: result.avatarBorderColor ?? settings.avatarBorderColor ?? user.avatarBorderColor ?? user.avatarColor,
          avatarUpdatedAt: result.avatarUpdatedAt ?? new Date().toISOString(),
        } : user),
      }));
    }
    return result;
  },
  updateProfileEmblemStyle: async (style) => {
    const serverReady = await ensureServerActionAvailable("/api/profile/emblem", "프로필 아이콘 설정 저장");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("프로필 아이콘 설정 저장")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/profile/emblem", { action: "style", ...style });
    if (result?.ok !== false && result?.profileId) {
      setState((prev) => ({
        ...prev,
        users: (prev.users ?? []).map((user) => user.id === result.profileId ? {
          ...user,
          avatarColor: result.avatarColor ?? user.avatarColor,
          avatarBorderEnabled: result.avatarBorderEnabled ?? user.avatarBorderEnabled ?? false,
          avatarBorderColor: result.avatarBorderColor ?? user.avatarBorderColor ?? user.avatarColor,
        } : user),
      }));
    }
    return result;
  },
  setProfileEmblemSource: async (avatarSource) => {
    const serverReady = await ensureServerActionAvailable("/api/profile/emblem", "프로필 아이콘 변경");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("프로필 아이콘 변경")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/profile/emblem", { action: "source", avatarSource });
    if (result?.ok !== false && result?.profileId) {
      setState((prev) => ({
        ...prev,
        users: (prev.users ?? []).map((user) => user.id === result.profileId ? {
          ...user,
          avatarSource: result.avatarSource ?? avatarSource,
          avatarUpdatedAt: result.avatarUpdatedAt ?? new Date().toISOString(),
        } : user),
      }));
    }
    return result;
  },
  selectProfileIcon: async (avatarIconKey) => {
    const serverReady = await ensureServerActionAvailable("/api/profile/emblem", "프로필 아이콘 변경");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("프로필 아이콘 변경")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/profile/emblem", { action: "icon", avatarIconKey });
    if (result?.ok !== false && result?.profileId) {
      setState((prev) => ({
        ...prev,
        users: (prev.users ?? []).map((user) => user.id === result.profileId ? {
          ...user,
          avatarSource: result.avatarSource ?? "icon",
          avatarIconKey: result.avatarIconKey ?? avatarIconKey,
          avatarUpdatedAt: result.avatarUpdatedAt ?? new Date().toISOString(),
        } : user),
      }));
    }
    return result;
  },
  loadTeamEmblemStatus: async (teamId) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/emblem", "팀 엠블럼 상태 확인", { quiet: true });
    if (serverReady !== true || !ensureRemoteReady("팀 엠블럼 상태 확인")) return serverReady;
    const result = await runServerAction("/api/teams/emblem", { action: "status", teamId });
    if (result?.ok !== false && result?.teamId === teamId) {
      setState((prev) => ({
        ...prev,
        teams: (prev.teams ?? []).map((team) => team.id === teamId ? {
          ...team,
          emblemCanRestore: result.emblemCanRestore === true,
        } : team),
      }));
    }
    return result;
  },
  uploadTeamEmblem: async (teamId, file, crop = {}) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/emblem", "팀 엠블럼 저장");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("팀 엠블럼 저장")) return { ok: false, error: "remote_not_ready" };
    const prepared = await prepareTeamEmblemUpload(file, crop);
    const result = await runServerAction("/api/teams/emblem", {
      action: "upload",
      teamId,
      imageBase64: prepared.imageBase64,
    });
    if (result?.ok !== false && result?.teamId === teamId) {
      setState((prev) => ({
        ...prev,
        teams: (prev.teams ?? []).map((team) => team.id === teamId ? {
          ...team,
          emblemKey: result.emblemKey ?? null,
          emblemSource: result.emblemSource ?? "upload",
          emblemUpdatedAt: result.emblemUpdatedAt ?? new Date().toISOString(),
          emblemUploadedAt: result.emblemUploadedAt ?? team.emblemUploadedAt ?? null,
          emblemUploadCount: Number(result.emblemUploadCount ?? team.emblemUploadCount ?? 0),
          emblemViolationCount: Number(result.emblemViolationCount ?? team.emblemViolationCount ?? 0),
          emblemUploadBlockedUntil: result.emblemUploadBlockedUntil ?? team.emblemUploadBlockedUntil ?? null,
          emblemCanRestore: result.emblemCanRestore === true,
        } : team),
      }));
    }
    return { ...result, sourceByteSize: prepared.sourceByteSize, byteSize: result?.byteSize ?? prepared.byteSize };
  },
  restoreTeamEmblem: async (teamId) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/emblem", "이전 팀 엠블럼 복원");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("이전 팀 엠블럼 복원")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/teams/emblem", { action: "restore", teamId });
    if (result?.ok !== false && result?.teamId === teamId) {
      setState((prev) => ({
        ...prev,
        teams: (prev.teams ?? []).map((team) => team.id === teamId ? {
          ...team,
          emblemKey: result.emblemKey ?? null,
          emblemSource: result.emblemSource ?? "upload",
          emblemUpdatedAt: result.emblemUpdatedAt ?? new Date().toISOString(),
          emblemUploadedAt: result.emblemUploadedAt ?? team.emblemUploadedAt ?? null,
          emblemUploadCount: Number(result.emblemUploadCount ?? team.emblemUploadCount ?? 0),
          emblemViolationCount: Number(result.emblemViolationCount ?? team.emblemViolationCount ?? 0),
          emblemUploadBlockedUntil: result.emblemUploadBlockedUntil ?? team.emblemUploadBlockedUntil ?? null,
          emblemCanRestore: result.emblemCanRestore === true,
        } : team),
      }));
    }
    return result;
  },
  setTeamEmblemSource: async (teamId, emblemSource) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/emblem", "팀 엠블럼 변경");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("팀 엠블럼 변경")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/teams/emblem", { action: "source", teamId, emblemSource });
    if (result?.ok !== false && result?.teamId === teamId) {
      setState((prev) => ({
        ...prev,
        teams: (prev.teams ?? []).map((team) => team.id === teamId ? {
          ...team,
          emblemKey: result.emblemKey ?? team.emblemKey ?? null,
          emblemSource: result.emblemSource ?? emblemSource,
          emblemUpdatedAt: result.emblemUpdatedAt ?? new Date().toISOString(),
          emblemViolationCount: Number(result.emblemViolationCount ?? team.emblemViolationCount ?? 0),
          emblemUploadBlockedUntil: result.emblemUploadBlockedUntil ?? team.emblemUploadBlockedUntil ?? null,
          emblemCanRestore: false,
        } : team),
      }));
    }
    return result;
  },
  updateTeamEmblemStyle: async (teamId, style) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/emblem", "팀 엠블럼 디자인 저장");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("팀 엠블럼 디자인 저장")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/teams/emblem", { action: "style", teamId, ...style });
    if (result?.ok !== false && result?.teamId === teamId) {
      setState((prev) => ({
        ...prev,
        teams: (prev.teams ?? []).map((team) => team.id === teamId ? {
          ...team,
          emblemColor: result.emblemColor ?? team.emblemColor ?? team.accent,
          emblemBorderEnabled: result.emblemBorderEnabled ?? team.emblemBorderEnabled ?? true,
          emblemBorderColor: result.emblemBorderColor ?? team.emblemBorderColor ?? team.accent,
          emblemTextMode: result.emblemTextMode ?? team.emblemTextMode ?? "initial",
          emblemAbbreviation: Object.prototype.hasOwnProperty.call(result, "emblemAbbreviation")
            ? (result.emblemAbbreviation ?? "")
            : (team.emblemAbbreviation ?? ""),
          emblemFont: result.emblemFont ?? team.emblemFont ?? "sport",
          emblemUpdatedAt: result.emblemUpdatedAt ?? new Date().toISOString(),
        } : team),
      }));
    }
    return result;
  },
  removeTeamEmblem: async (teamId) => {
    const serverReady = await ensureServerActionAvailable("/api/teams/emblem", "팀 엠블럼 삭제");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("팀 엠블럼 삭제")) return { ok: false, error: "remote_not_ready" };
    const result = await runServerAction("/api/teams/emblem", { action: "remove", teamId });
    if (result?.ok !== false && result?.teamId === teamId) {
      setState((prev) => ({
        ...prev,
        teams: (prev.teams ?? []).map((team) => team.id === teamId ? {
          ...team,
          emblemKey: null,
          emblemSource: result.emblemSource ?? "initial",
          emblemUpdatedAt: result.emblemUpdatedAt ?? new Date().toISOString(),
          emblemUploadedAt: result.emblemUploadedAt ?? team.emblemUploadedAt ?? null,
          emblemUploadCount: Number(result.emblemUploadCount ?? team.emblemUploadCount ?? 0),
          emblemViolationCount: Number(result.emblemViolationCount ?? team.emblemViolationCount ?? 0),
          emblemUploadBlockedUntil: result.emblemUploadBlockedUntil ?? team.emblemUploadBlockedUntil ?? null,
        } : team),
      }));
    }
    return result;
  },
  deleteTeam: (teamId) => {
    let rollbackState = null;
    let deleted = false;
    let syncedNotifications = [];
    setState((prev) => {
      rollbackState = prev;
      const hadTeam = (prev.teams ?? []).some((team) => team.id === teamId);
      const next = deleteTeam({ ...prev, currentUserId }, teamId);
      deleted = hadTeam && !(next.teams ?? []).some((team) => team.id === teamId);
      syncedNotifications = deleted ? getNewTeamNotifications(prev, next) : [];
      return next;
    });
    if (deleted) rollbackIfServerFailed(deleteTeamServer(teamId, syncedNotifications), rollbackState, "팀 삭제", { teamId });
  }
  });
}
