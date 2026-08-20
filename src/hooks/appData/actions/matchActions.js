export function buildMatchActions(context) {
  const {
    EMPTY_RECORD_ARCHIVE,
    activateTournamentSanction,
    agreeMatch,
    applyMatchMutation,
    approveMatch,
    approveTournamentReferee,
    approveTournamentTeam,
    assignTournamentMatchReferee,
    cancelMatch,
    checkInMatchPlayer,
    confirmMatchRefereeAbsence,
    confirmPickupSideAssignment,
    captureServerMutation,
    createMatch,
    createTournament,
    currentUserId,
    declineTournamentReferee,
    deleteSoloRecord,
    disputeMatch,
    endMatch,
    ensureRemoteReady,
    ensureServerActionAvailable,
    finalizeMatchByAuthority,
    acknowledgeMatchNoDispute,
    forfeitTournamentMatch,
    generatePickupSideAssignment,
    getActionActorDebug,
    getNewItems,
    getNewTournamentNotifications,
    incrementMatchScore,
    inviteTournamentReferee,
    isSupabaseConfigured,
    profileKey,
    profileLocked,
    profileRecordArchiveRef,
    publicProfileRecordArchivesRef,
    publicProfileRecordsPromiseRef,
    rejectTournamentRegion,
    requestMatchRefereeAbsence,
    resolveMatchDispute,
    rollbackIfServerFailed,
    setProfileBindings,
    setProfileRecordArchive,
    setProfileRecordsLoaded,
    setPublicProfileRecordArchives,
    setState,
    stateRef,
    setTeamRecordArchives,
    startMatch,
    submitMatchResult,
    submitMatchThumbs,
    substituteMatchPlayer,
    syncMatchServer,
    syncTournamentServer,
    teamRecordArchivesRef,
    toggleMatchStar,
    updateTournamentMatchSchedule,
    voidMatch,
    writeProfileBindings,
  } = context;

  return ({
switchUser: (userId) => {
    if (profileLocked) return false;
    setProfileBindings((current) => {
      const next = { ...current, [profileKey]: userId };
      writeProfileBindings(next);
      return next;
    });
    setProfileRecordsLoaded(false);
    profileRecordArchiveRef.current = EMPTY_RECORD_ARCHIVE;
    publicProfileRecordsPromiseRef.current = new Map();
    publicProfileRecordArchivesRef.current = {};
    teamRecordArchivesRef.current = {};
    setProfileRecordArchive(EMPTY_RECORD_ARCHIVE);
    setPublicProfileRecordArchives({});
    setTeamRecordArchives({});
    setState((prev) => ({ ...prev, currentUserId: userId }));
    return true;
  },
  createMatch: async (draft) => {
    const serverReady = await ensureServerActionAvailable("/api/matches/sync-match", "경기 생성");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("경기 생성")) return null;
    if (isSupabaseConfigured) {
      return syncMatchServer(null, [], { action: "createMatch", draft }).then((result) => {
        if (!result || result?.ok === false) return result;
        return result?.matchId ?? result?.match?.id ?? null;
      });
    }
    const previousState = stateRef.current;
    const existingIds = new Set((previousState.matches ?? []).map((match) => match.id));
    const next = createMatch({ ...previousState, currentUserId }, draft);
    const createdMatch = (next.matches ?? []).find((match) => !existingIds.has(match.id)) ?? null;
    stateRef.current = next;
    setState(next);
    if (!createdMatch) {
      const localBlockNotification = getNewItems(previousState.notifications ?? [], next.notifications ?? [])[0] ?? null;
      return Promise.resolve({
        ok: false,
        error: "local_reducer_blocked",
        details: getActionActorDebug(previousState, currentUserId),
        message: localBlockNotification ? `${localBlockNotification.title}: ${localBlockNotification.body}` : "경기 생성 조건을 통과하지 못했습니다.",
      });
    }
    return createdMatch.id;
  },
  createTournament: async (draft) => {
    const serverReady = await ensureServerActionAvailable("/api/tournaments/sync-tournament", "토너먼트 생성");
    if (serverReady !== true) return serverReady;
    if (!ensureRemoteReady("토너먼트 생성")) return Promise.resolve(null);
    if (isSupabaseConfigured) {
      return syncTournamentServer(null, [], {
        operation: {
          action: "createTournament",
          draft,
        },
      }).then((result) => (result?.ok === false ? result : result?.tournamentId ?? result?.tournament?.id ?? null));
    }
    let rollbackState = null;
    let createdId = null;
    let createdTournament = null;
    let createdMatches = [];
    let syncedNotifications = [];
    let localBlockNotification = null;
    let localBlockDebug = {};
    setState((prev) => {
      const existingIds = new Set((prev.tournaments ?? []).map((tournament) => tournament.id));
      const existingMatchIds = new Set((prev.matches ?? []).map((match) => match.id));
      const next = createTournament({ ...prev, currentUserId }, draft);
      rollbackState = captureServerMutation(prev, next);
      createdTournament = (next.tournaments ?? []).find((tournament) => !existingIds.has(tournament.id)) ?? null;
      createdId = createdTournament?.id ?? null;
      createdMatches = (next.matches ?? []).filter((match) => !existingMatchIds.has(match.id));
      syncedNotifications = createdTournament ? getNewTournamentNotifications(prev, next) : [];
      localBlockNotification = createdTournament ? null : getNewItems(prev.notifications ?? [], next.notifications ?? [])[0] ?? null;
      localBlockDebug = createdTournament ? {} : getActionActorDebug(prev, currentUserId);
      return next;
    });
    if (!createdTournament) return Promise.resolve({
      ok: false,
      error: "local_reducer_blocked",
      details: localBlockDebug,
      message: localBlockNotification ? `${localBlockNotification.title}: ${localBlockNotification.body}` : "대회 생성 조건을 통과하지 못했습니다.",
    });
    const preferredMatchIds = createdMatches.map((match) => match.id);
    return rollbackIfServerFailed(syncTournamentServer(createdTournament, syncedNotifications, {
      action: "create",
      operation: {
        action: "createTournament",
        draft: { ...draft, id: createdTournament.id, preferredMatchIds },
        preferredTournamentId: createdTournament.id,
        preferredMatchIds,
      },
    }), rollbackState, "토너먼트 생성", { action: "createTournament", tournamentId: createdTournament.id })
      .then((result) => (result?.ok === false ? result : createdId));
  },
  loadTournament: (tournamentId) => {
    if (!tournamentId || !ensureRemoteReady("대회 조회")) return Promise.resolve(0);
    return syncTournamentServer(null, [], {
      operation: {
        action: "loadTournament",
        tournamentId,
      },
    }).then((result) => {
      if (result?.ok === false) {
        if (result.error === "tournament_not_found" || Number(result.statusCode) === 404) return 0;
        const error = new Error(result.error || "tournament_load_failed");
        error.code = result.error || "tournament_load_failed";
        error.statusCode = result.statusCode ?? null;
        error.details = result.details ?? null;
        throw error;
      }
      return result?.state?.tournaments?.some((item) => item?.id === tournamentId) ? 1 : 0;
    });
  },
  approveTournamentTeam: (tournamentId, teamId) => {
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("토너먼트 팀 승인")) return Promise.resolve(null);
      return syncTournamentServer(null, [], {
        operation: {
          action: "approveTournamentTeam",
          tournamentId,
          teamId,
        },
      });
    }
    let rollbackState = null;
    let syncedTournament = null;
    let createdMatches = [];
    let syncedNotifications = [];
    setState((prev) => {
      const existingMatchIds = new Set((prev.matches ?? []).map((match) => match.id));
      const next = approveTournamentTeam({ ...prev, currentUserId }, tournamentId, teamId);
      rollbackState = captureServerMutation(prev, next);
      syncedTournament = (next.tournaments ?? []).find((tournament) => tournament.id === tournamentId) ?? null;
      createdMatches = (next.matches ?? []).filter((match) => !existingMatchIds.has(match.id));
      syncedNotifications = syncedTournament ? getNewTournamentNotifications(prev, next) : [];
      return next;
    });
    if (syncedTournament) {
      const preferredMatchIds = createdMatches.map((match) => match.id);
      return rollbackIfServerFailed(syncTournamentServer(syncedTournament, syncedNotifications, {
        action: "approveTeam",
        teamId,
        operation: {
          action: "approveTournamentTeam",
          tournamentId,
          teamId,
          preferredMatchIds,
        },
      }), rollbackState, "토너먼트 팀 승인", { action: "approveTournamentTeam", tournamentId, teamId });
    }
    return Promise.resolve(false);
  },
  approveTournamentReferee: (tournamentId) => {
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("대회 심판 승인")) return Promise.resolve(null);
      return syncTournamentServer(null, [], {
        operation: { action: "approveTournamentReferee", tournamentId },
      });
    }
    setState((prev) => approveTournamentReferee({ ...prev, currentUserId }, tournamentId));
    return Promise.resolve({ ok: true, tournamentId });
  },
  declineTournamentReferee: (tournamentId) => {
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("대회 심판 거절")) return Promise.resolve(null);
      return syncTournamentServer(null, [], {
        operation: { action: "declineTournamentReferee", tournamentId },
      });
    }
    setState((prev) => declineTournamentReferee({ ...prev, currentUserId }, tournamentId));
    return Promise.resolve({ ok: true, tournamentId });
  },
  inviteTournamentReferee: (tournamentId, refereeId) => {
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("대회 심판 초대")) return Promise.resolve(null);
      return syncTournamentServer(null, [], {
        operation: { action: "inviteTournamentReferee", tournamentId, refereeId },
      });
    }
    setState((prev) => inviteTournamentReferee({ ...prev, currentUserId }, tournamentId, refereeId));
    return Promise.resolve({ ok: true, tournamentId, refereeId });
  },
  approveTournamentRegion: (tournamentId, note = "") => {
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("대회 지역 승인")) return Promise.resolve(null);
      return syncTournamentServer(null, [], {
        operation: { action: "approveTournamentRegion", tournamentId, note },
      });
    }
    setState((prev) => activateTournamentSanction({ ...prev, currentUserId }, tournamentId, "approved", currentUserId));
    return Promise.resolve({ ok: true, tournamentId });
  },
  rejectTournamentRegion: (tournamentId, note = "") => {
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("대회 지역 비승인")) return Promise.resolve(null);
      return syncTournamentServer(null, [], {
        operation: { action: "rejectTournamentRegion", tournamentId, note },
      });
    }
    setState((prev) => rejectTournamentRegion({ ...prev, currentUserId }, tournamentId, note));
    return Promise.resolve({ ok: true, tournamentId });
  },
  startCommunityTournament: (tournamentId) => {
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("지역 비승인 대회 개최")) return Promise.resolve(null);
      return syncTournamentServer(null, [], {
        operation: { action: "startCommunityTournament", tournamentId },
      });
    }
    setState((prev) => activateTournamentSanction({ ...prev, currentUserId }, tournamentId, "community"));
    return Promise.resolve({ ok: true, tournamentId });
  },
  assignTournamentMatchReferee: (tournamentId, matchId, refereeId) => {
    if (isSupabaseConfigured) {
      if (!ensureRemoteReady("대회 경기 심판 배정")) return Promise.resolve(null);
      return syncTournamentServer(null, [], {
        operation: { action: "assignTournamentMatchReferee", tournamentId, matchId, refereeId },
      });
    }
    setState((prev) => assignTournamentMatchReferee({ ...prev, currentUserId }, tournamentId, matchId, refereeId));
    return Promise.resolve({ ok: true, tournamentId, matchId, refereeId });
  },
  updateTournamentMatchSchedule: (tournamentId, matchId, schedule) => {
    return applyMatchMutation(matchId, (prev) => updateTournamentMatchSchedule({ ...prev, currentUserId }, tournamentId, matchId, schedule), { action: "updateTournamentMatchSchedule", tournamentId, schedule });
  },
  forfeitTournamentMatch: (tournamentId, matchId, losingSide, reason = "팀 불참") => {
    return applyMatchMutation(matchId, (prev) => forfeitTournamentMatch({ ...prev, currentUserId }, tournamentId, matchId, losingSide, reason), { action: "forfeitTournamentMatch", tournamentId, losingSide, reason });
  },
  agreeMatch: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => agreeMatch({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "agreeMatch", sideName, playerId }),
  submitMatchResult: (matchId, result) => applyMatchMutation(matchId, (prev) => submitMatchResult({ ...prev, currentUserId }, matchId, result), { action: "submitMatchResult", result }),
  incrementMatchScore: (matchId, deltaA, deltaB, revisions = {}) => applyMatchMutation(matchId, (prev) => incrementMatchScore({ ...prev, currentUserId }, matchId, deltaA, deltaB, revisions), { action: "incrementMatchScore", deltaA, deltaB, ...revisions }),
  finalizeMatch: (matchId, options = {}) => applyMatchMutation(
    matchId,
    (prev) => finalizeMatchByAuthority({ ...prev, currentUserId }, matchId, options),
    { action: "finalizeMatch", disputesAcknowledged: options.disputesAcknowledged === true },
  ),
  acknowledgeMatchNoDispute: (matchId) => applyMatchMutation(
    matchId,
    (prev) => acknowledgeMatchNoDispute({ ...prev, currentUserId }, matchId),
    { action: "acknowledgeMatchNoDispute" },
  ),
  substituteMatchPlayer: (matchId, sideName, activePlayerId, reservePlayerId, reason = "operator") => {
    return applyMatchMutation(matchId, (prev) => substituteMatchPlayer({ ...prev, currentUserId }, matchId, sideName, activePlayerId, reservePlayerId, reason), { action: "substituteMatchPlayer", sideName, activePlayerId, reservePlayerId, reason });
  },
  approveMatch: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => approveMatch({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "approveMatch", sideName, playerId }),
  checkInMatchPlayer: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => checkInMatchPlayer({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "checkInMatchPlayer", sideName, playerId }),
  confirmPickupSideAssignment: (matchId, rotation) => applyMatchMutation(matchId, (prev) => confirmPickupSideAssignment({ ...prev, currentUserId }, matchId, rotation), { action: "confirmPickupSideAssignment", ...rotation }),
  generatePickupSideAssignment: (matchId, assignmentMode) => applyMatchMutation(matchId, (prev) => generatePickupSideAssignment({ ...prev, currentUserId }, matchId, assignmentMode), { action: "generatePickupSideAssignment", assignmentMode }),
  requestMatchRefereeAbsence: (matchId) => applyMatchMutation(matchId, (prev) => requestMatchRefereeAbsence({ ...prev, currentUserId }, matchId), { action: "requestMatchRefereeAbsence" }),
  confirmMatchRefereeAbsence: (matchId) => applyMatchMutation(matchId, (prev) => confirmMatchRefereeAbsence({ ...prev, currentUserId }, matchId), { action: "confirmMatchRefereeAbsence" }),
  toggleMatchStar: (matchId, targetUserId) => applyMatchMutation(matchId, (prev) => toggleMatchStar({ ...prev, currentUserId }, matchId, targetUserId), { action: "toggleMatchStar", targetUserId }),
  submitMatchThumbs: (matchId, targetUserIds) => applyMatchMutation(matchId, (prev) => submitMatchThumbs({ ...prev, currentUserId }, matchId, targetUserIds), { action: "submitMatchThumbs", targetUserIds }),
  disputeMatch: (matchId, reason) => applyMatchMutation(matchId, (prev) => disputeMatch({ ...prev, currentUserId }, matchId, reason), { action: "disputeMatch", reason }),
  cancelMatch: (matchId, reason = "") => applyMatchMutation(
    matchId,
    (prev) => cancelMatch({ ...prev, currentUserId }, matchId, reason),
    { action: "cancelMatch", reason },
  ),
  deleteSoloRecord: (matchId) => applyMatchMutation(matchId, (prev) => deleteSoloRecord({ ...prev, currentUserId }, matchId), { action: "deleteSoloRecord" }),
  voidMatch: (matchId, reason) => applyMatchMutation(matchId, (prev) => voidMatch({ ...prev, currentUserId }, matchId, reason), { action: "voidMatch", reason }),
  resolveMatchDispute: (matchId, disputeId, decision, resolutionReason) => applyMatchMutation(
    matchId,
    (prev) => resolveMatchDispute({ ...prev, currentUserId }, matchId, disputeId, decision, resolutionReason),
    { action: "resolveMatchDispute", disputeId, decision, resolutionReason },
  ),
  startMatch: (matchId) => applyMatchMutation(matchId, (prev) => startMatch({ ...prev, currentUserId }, matchId), { action: "startMatch" }),
  endMatch: (matchId) => applyMatchMutation(matchId, (prev) => endMatch({ ...prev, currentUserId }, matchId), { action: "endMatch" })
  });
}
