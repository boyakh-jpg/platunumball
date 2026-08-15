import { RECRUITING_ROOM_DEPENDENCIES } from "./RecruitingRoomDependencies.js";
import { useRecruitingRoomModalInteractions } from "./useRecruitingRoomModalInteractions.js";
import { useRecruitingRoomParticipationActions } from "./useRecruitingRoomParticipationActions.js";
import { useRecruitingRoomManagementActions } from "./useRecruitingRoomManagementActions.js";

export function getCurrentUserTeams(teams = [], currentUserId = "") {
  return (teams ?? []).filter((team) => (
    (team?.members ?? []).some((member) => member?.userId === currentUserId)
  ));
}

export function useRecruitingRoomController({
  app,
  post,
  onClose,
  onOpenMatch = null,
  sourceMatch = null,
  entryPoint = "",
  attendanceScanState = null,
  onInvitationAccepted = null,
  onJoined = null,
  skipInitialDetailLoad = false,
  contextPanel = null,
  clockClient = undefined,
  onRemake = null,
  readOnly = false,
}) {
  const {
    BRAND_NAME, CHAT_MESSAGE_MAX_LENGTH, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS, CHAT_REPEAT_BLOCK_MS, CHAT_SEND_COOLDOWN_MS, DIRECTORY_PICKER_PAGE_LIMIT,
    MATCH_DISPUTE_REASON_OPTIONS, PLAYER_STAT_FIELDS, UNSAFE_INPUT_MESSAGE, buildMatchDisputeRequest, copyTextToClipboard, getDefaultJoinDraft, getJoinActiveCapacity,
    getJoinReserveCapacity, getLinkedPersonalRecordDisplayUser, getMatchManualFinalizationStatus, getMatchResultRevision, getMatchRoomPhase, getMatchRuleInputValidation, getPartyOptionKey, getPickupOpenSlotPlacements,
    getRecruitingBenchCapacity, getRecruitingDisplayTitle, getRecruitingLobby, getRecruitingPostTerminalState, getRecruitingSideCapacity, getRegisteredCourts, getRoomEditDraft,
    getRoomEditSaveError, getRoomScheduleLabel, getRoomShareUrl, getUnsafeUserTextReason, isCurrentUserRoomParticipant, isIndividualOnlyRecruitingRoom, isMatchRoomChatLocked,
    isPaidRecruitingCourt, isPersonalRecordMatch, isPickupRecruitingRoom, isSyntheticMatchRoomId, isTeamOnlyRoom, useCallback, useEffect,
    useMemo, useNavigate, useRef, useState,
  } = RECRUITING_ROOM_DEPENDENCIES;

  const navigate = useNavigate();
  const selectedPost = post;
  const loadDirectory = app.actions.loadDirectory;
  const loadDirectoryRef = useRef(loadDirectory);
  loadDirectoryRef.current = loadDirectory;
  const remoteDirectoryEnabled = app.capabilities?.remoteDirectory !== false;
  const roomShareEnabled = app.capabilities?.roomShare !== false;
  const shouldLoadTeamDirectory = !sourceMatch && isTeamOnlyRoom(selectedPost);
  const sourceMatchTeamIds = useMemo(
    () => [...new Set([sourceMatch?.teamA?.teamId, sourceMatch?.teamB?.teamId].filter(Boolean))],
    [sourceMatch?.teamA?.teamId, sourceMatch?.teamB?.teamId],
  );
  const sourceMatchLinkedProfileIds = useMemo(
    () => [...new Set(Object.values(sourceMatch?.anonymousPlayers ?? {})
      .map((player) => player?.linkedProfileId)
      .filter(Boolean))],
    [sourceMatch?.anonymousPlayers],
  );
  const myTeams = useMemo(
    () => getCurrentUserTeams(app.state.teams, app.currentUser.id),
    [app.currentUser.id, app.state.teams],
  );
  useEffect(() => {
    if (!shouldLoadTeamDirectory) return;
    loadDirectoryRef.current?.({ kind: "teams", limit: DIRECTORY_PICKER_PAGE_LIMIT, offset: 0, includeTeamMemberProfiles: true });
  }, [shouldLoadTeamDirectory]);
  useEffect(() => {
    sourceMatchTeamIds.forEach((teamId) => {
      void loadDirectoryRef.current?.({ force: true, kind: "teams", teamId, includeTeamMemberProfiles: true });

    });
  }, [sourceMatchTeamIds]);
  useEffect(() => {
    sourceMatchLinkedProfileIds.forEach((profileId) => {
      void loadDirectoryRef.current?.({ kind: "players", profileId });
    });
  }, [sourceMatchLinkedProfileIds]);

  const roomDataState = useMemo(() => ({
    ...app.state,
    users: Object.values(Object.fromEntries([
      ...(selectedPost.publicParticipants ?? []),
      ...app.state.users,
    ].map((user) => [user.id, user]))),
    teams: Object.values(Object.fromEntries([
      ...(selectedPost.publicTeams ?? []),
      ...app.state.teams,
    ].map((team) => [team.id, team]))),
  }), [app.state, selectedPost.publicParticipants, selectedPost.publicTeams]);
  const userById = useMemo(
    () => {
      const profileById = Object.fromEntries(roomDataState.users.map((user) => [user.id, user]));
      const anonymousEntries = Object.values(sourceMatch?.anonymousPlayers ?? {}).map((user) => [
        user.id,
        getLinkedPersonalRecordDisplayUser(user, profileById),
      ]);
      return {
        ...profileById,
        ...Object.fromEntries(anonymousEntries),
      };
    },
    [roomDataState.users, sourceMatch?.anonymousPlayers],
  );
  const teamById = useMemo(() => Object.fromEntries(roomDataState.teams.map((team) => [team.id, team])), [roomDataState.teams]);
  const currentUserIsAdmin = Number(app.adminContext?.level ?? 0) >= 30;
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const courtById = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.id, court])), [registeredCourts]);
  const courtByName = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.name, court])), [registeredCourts]);
  const getRoomCourt = (roomPost) => courtById[roomPost?.courtId] ?? courtByName[roomPost?.court] ?? null;
  const requiresPaidCourtNotice = (roomPost) => isPaidRecruitingCourt(roomPost, getRoomCourt(roomPost));
  const [joinDraftByPost, setJoinDraftByPost] = useState({});
  const [joiningPartyKey, setJoiningPartyKey] = useState("");
  const [roomTeamQuery, setRoomTeamQuery] = useState("");
  const [roomTeamSavingSide, setRoomTeamSavingSide] = useState("");
  const [roomTeamFeedback, setRoomTeamFeedback] = useState("");
  const [paidCourtJoinPrompt, setPaidCourtJoinPrompt] = useState(null);
  const [chatDraftByPost, setChatDraftByPost] = useState({});
  const [chatErrorByPost, setChatErrorByPost] = useState({});
  const [chatCooldownUntilByPost, setChatCooldownUntilByPost] = useState({});
  const [chatSendingPostId, setChatSendingPostId] = useState("");
  const [chatAreaVisible, setChatAreaVisible] = useState(false);
  const [roomDetailReadyKey, setRoomDetailReadyKey] = useState("");
  const [inviteDraft, setInviteDraft] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const [slotActionDraft, setSlotActionDraft] = useState(null);
  const [slotActionPending, setSlotActionPending] = useState(false);
  const [sourceMatchActionPending, setSourceMatchActionPending] = useState("");
  const [sourceMatchDraftScore, setSourceMatchDraftScore] = useState(null);
  const [sourceDisputeDraft, setSourceDisputeDraft] = useState({
    matchId: "",
    resultKey: "",
    reason: MATCH_DISPUTE_REASON_OPTIONS[0],
    customReason: "",
    requestedScoreA: "",
    requestedScoreB: "",
    requestedStats: {},
  });
  const [roomEditDraftByPost, setRoomEditDraftByPost] = useState({});
  const [roomEditStatusByPost, setRoomEditStatusByPost] = useState({});
  const [refereeInviteQueryByPost, setRefereeInviteQueryByPost] = useState({});
  const [pendingRosterOpen, setPendingRosterOpen] = useState(null);
  const [confirmingMatchId, setConfirmingMatchId] = useState("");
  const [joiningPostId, setJoiningPostId] = useState("");
  const [roomShareStatus, setRoomShareStatus] = useState("");
  const [soloRecordDeleteTarget, setSoloRecordDeleteTarget] = useState(null);
  const [attendanceStartStatus, setAttendanceStartStatus] = useState(null);
  const [finalizeMatchTarget, setFinalizeMatchTarget] = useState(null);
  const [finalizeMatchPending, setFinalizeMatchPending] = useState(false);
  const [, setFinalizationTick] = useState(0);
  const [roomCancellationTarget, setRoomCancellationTarget] = useState(null);
  const [roomCancellationPending, setRoomCancellationPending] = useState(false);
  const [roomHelpOpen, setRoomHelpOpen] = useState(false);
  const [sourceMatchReviewRefreshing, setSourceMatchReviewRefreshing] = useState(false);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [sheetDragSettling, setSheetDragSettling] = useState(false);
  const slotActionPendingRef = useRef(false);
  const sourceMatchActionPendingRef = useRef("");
  const refreshSourceMatchReview = async () => {
    if (!sourceMatch?.id || sourceMatchReviewRefreshing) return;
    setSourceMatchReviewRefreshing(true);
    try {
      await app.actions.loadMatchDetail?.(sourceMatch.id);
    } finally {
      setSourceMatchReviewRefreshing(false);
    }
  };
  const confirmSourceMatchFinalization = async (options = {}) => {
    if (!finalizeMatchTarget?.matchId || finalizeMatchPending) return;
    setFinalizeMatchPending(true);
    try {
      const result = await app.actions.finalizeMatch?.(finalizeMatchTarget.matchId, options);
      if (result && result.ok !== false) {
        const finalizedMatchId = finalizeMatchTarget.matchId;
        setFinalizeMatchTarget(null);
        await Promise.all([
          app.actions.loadMatchDetail?.(finalizedMatchId),
          app.actions.loadProfileRecords?.({ force: true }),
        ]);
      } else {
        showRoomShareStatus("기록을 완료하지 못했습니다. 다시 시도해 주세요.");
      }
    } catch {
      showRoomShareStatus("기록을 완료하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setFinalizeMatchPending(false);
    }
  };
  const requestSourceMatchFinalization = (matchId, authorityLabel) => {
    setFinalizeMatchTarget({ matchId, authorityLabel });
  };
  const roomPostId = selectedPost?.id ?? "";
  const roomPostIsSynthetic = isSyntheticMatchRoomId(roomPostId);
  const roomDetailRequestKey = `${roomPostId}:${app.currentUser.id}`;
  const modalPostNeedsDetail = Boolean(selectedPost?.listCardOnly && !sourceMatch);
  const sourceMatchNeedsRoomDetail = Boolean(
    sourceMatch?.recruitingPostId &&
    roomPostId === sourceMatch.recruitingPostId &&
    !app.state.recruitingPosts?.some((item) => item.id === roomPostId && !item.listCardOnly),
  );
  const roomChatLobby = useMemo(() => getRecruitingLobby(selectedPost, roomDataState), [roomDataState, selectedPost]);
  const canPollRoomChat = isCurrentUserRoomParticipant(selectedPost, roomChatLobby, app.currentUser.id);
  const roomShareUrl = useMemo(() => getRoomShareUrl(roomPostId), [roomPostId]);
  const roomChatLocked = sourceMatch
    ? isMatchRoomChatLocked(sourceMatch)
    : Boolean(selectedPost?.confirmedAt || getRecruitingPostTerminalState(selectedPost));
  const modalPostDetailLoadRef = useRef("");
  const sourceMatchDetailLoadRef = useRef("");
  const pollRecruitingChatRef = useRef(app.actions.pollRecruitingChat);
  const loadMatchDetailRef = useRef(app.actions.loadMatchDetail);
  const chatSendLogRef = useRef({});
  const roomShareStatusTimerRef = useRef(0);

  useEffect(() => {
    setRoomTeamQuery("");
    setRoomTeamSavingSide("");
    setRoomTeamFeedback("");
  }, [selectedPost.id]);
  const lobbyModalRef = useRef(null);
  const sheetDragRef = useRef(null);
  const sheetDragTimerRef = useRef(0);

  useEffect(() => {
    if (!roomPostId) {
      modalPostDetailLoadRef.current = "";
      setRoomDetailReadyKey("");
      return;
    }
    if (roomPostIsSynthetic) {
      modalPostDetailLoadRef.current = roomDetailRequestKey;
      setRoomDetailReadyKey((current) => current === roomDetailRequestKey ? current : roomDetailRequestKey);
      return;
    }
    if (!app.remoteReady || !app.currentUser.id) return;
    const refreshKey = roomDetailRequestKey;
    if (!sourceMatchNeedsRoomDetail && (sourceMatch || (skipInitialDetailLoad && !modalPostNeedsDetail))) {
      modalPostDetailLoadRef.current = refreshKey;
      setRoomDetailReadyKey((current) => current === refreshKey ? current : refreshKey);
      return;
    }
    if (modalPostDetailLoadRef.current === refreshKey) return;
    modalPostDetailLoadRef.current = refreshKey;
    Promise.resolve(app.actions.loadRecruitingPost?.(roomPostId)).then((count) => {
      if (count && modalPostDetailLoadRef.current === refreshKey) {
        setRoomDetailReadyKey((current) => current === refreshKey ? current : refreshKey);
      }
    }).catch(() => undefined);
  }, [app.actions.loadRecruitingPost, app.currentUser.id, app.remoteReady, modalPostNeedsDetail, roomDetailRequestKey, roomPostId, roomPostIsSynthetic, skipInitialDetailLoad, sourceMatch, sourceMatchNeedsRoomDetail]);

  useEffect(() => {
    pollRecruitingChatRef.current = app.actions.pollRecruitingChat;
  }, [app.actions.pollRecruitingChat]);

  useEffect(() => {
    loadMatchDetailRef.current = app.actions.loadMatchDetail;
  }, [app.actions.loadMatchDetail]);

  useEffect(() => {
    if (!sourceMatch?.id) {
      sourceMatchDetailLoadRef.current = "";
      return;
    }
    if (!app.remoteReady || !app.currentUser.id) return;
    const refreshKey = `${sourceMatch.id}:${app.currentUser.id}`;
    if (sourceMatchDetailLoadRef.current === refreshKey) return;
    sourceMatchDetailLoadRef.current = refreshKey;
    Promise.resolve(loadMatchDetailRef.current?.(sourceMatch.id)).then((count) => {
      if (!count && sourceMatchDetailLoadRef.current === refreshKey) {
        sourceMatchDetailLoadRef.current = "";
      }
    }).catch(() => {
      if (sourceMatchDetailLoadRef.current === refreshKey) {
        sourceMatchDetailLoadRef.current = "";
      }
    });
  }, [app.currentUser.id, app.remoteReady, sourceMatch?.id]);

  useEffect(() => {
    if (!sourceMatch?.id || getMatchRoomPhase(sourceMatch).phase !== "checkin") return undefined;
    let refreshing = false;
    const refreshAttendance = async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        await loadMatchDetailRef.current?.(sourceMatch.id);
      } finally {
        refreshing = false;
      }
    };
    const pollId = window.setInterval(refreshAttendance, 3000);
    return () => window.clearInterval(pollId);
  }, [sourceMatch?.id, sourceMatch?.startedAt, sourceMatch?.endedAt, sourceMatch?.status]);

  useEffect(() => {
    if (!sourceMatch?.id || !sourceMatch.endedAt || sourceMatch.confirmedAt) return undefined;
    let refreshing = false;
    const refreshReview = async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        await loadMatchDetailRef.current?.(sourceMatch.id);
      } finally {
        refreshing = false;
      }
    };
    const pollId = window.setInterval(refreshReview, 5000);
    return () => window.clearInterval(pollId);
  }, [sourceMatch?.id, sourceMatch?.endedAt, sourceMatch?.confirmedAt, sourceMatch?.status]);

  useEffect(() => {
    if (!sourceMatch?.id) return;
    const scoreA = sourceMatch.result?.scoreA ?? sourceMatch.teamA?.score ?? 0;
    const scoreB = sourceMatch.result?.scoreB ?? sourceMatch.teamB?.score ?? 0;
    const resultKey = `${sourceMatch.result?.updatedAt ?? sourceMatch.result?.submittedAt ?? ""}:${scoreA}:${scoreB}`;
    setSourceDisputeDraft((current) => (
      current.matchId === sourceMatch.id && current.resultKey === resultKey
        ? current
        : {
          matchId: sourceMatch.id,
          resultKey,
          reason: MATCH_DISPUTE_REASON_OPTIONS[0],
          customReason: "",
          requestedScoreA: String(scoreA),
          requestedScoreB: String(scoreB),
          requestedStats: Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [
            id,
            String(sourceMatch.result?.playerStats?.[app.currentUser.id]?.[id] ?? 0),
          ])),
        }
    ));
  }, [app.currentUser.id, sourceMatch?.id, sourceMatch?.result?.scoreA, sourceMatch?.result?.scoreB, sourceMatch?.result?.updatedAt, sourceMatch?.teamA?.score, sourceMatch?.teamB?.score]);

  const sourceFinalizationStatus = sourceMatch ? getMatchManualFinalizationStatus(sourceMatch, Date.now(), app.currentUser.id) : null;
  useEffect(() => {
    if (!sourceFinalizationStatus || sourceFinalizationStatus.timeReady || sourceFinalizationStatus.remainingMs <= 0) return undefined;
    const timerId = window.setTimeout(
      () => setFinalizationTick((current) => current + 1),
      sourceFinalizationStatus.remainingMs + 50,
    );
    return () => window.clearTimeout(timerId);
  }, [sourceFinalizationStatus?.timeReady, sourceFinalizationStatus?.remainingMs]);

  useEffect(() => {
    if (
      !roomPostId ||
      roomPostIsSynthetic ||
      roomDetailReadyKey !== roomDetailRequestKey ||
      !app.remoteReady ||
      !app.currentUser.id ||
      !canPollRoomChat ||
      !chatAreaVisible ||
      roomChatLocked
    ) return undefined;
    return pollRecruitingChatRef.current?.(roomPostId);
  }, [app.currentUser.id, app.remoteReady, canPollRoomChat, chatAreaVisible, roomChatLocked, roomDetailReadyKey, roomDetailRequestKey, roomPostId, roomPostIsSynthetic]);

  useEffect(() => () => {
    window.clearTimeout(roomShareStatusTimerRef.current);
    window.clearTimeout(sheetDragTimerRef.current);
  }, []);

  const {
    getRoomEditDraftByPost, openRoomEdit, closeRoomEdit, updateRoomEditDraft, saveRoomEdit,
    updateInviteDraft, toggleInvitePlayer, sendInvites,
  } = useRecruitingRoomManagementActions({
    roomEditDraftByPost, setRoomEditDraftByPost, getRoomEditDraft, sourceMatch, setRoomEditStatusByPost,
    getMatchRuleInputValidation, app, getRoomEditSaveError, setInviteError, setInviteDraft,
    inviteDraft, isIndividualOnlyRecruitingRoom,
  });
  const {
    showRoomShareStatus, copyRoomShareUrl, shareRoom, closeModal, closeFromBackdrop,
    deleteSourceSoloRecord, confirmDeleteSourceSoloRecord, resetSheetDrag, getSheetDismissDistance, isSheetDragInteractiveTarget,
    canDismissBySheetDrag, startSheetDrag, moveSheetDrag, finishSheetDrag, cancelSheetDrag,
    sheetDragProgress, sheetBackdropOpacity, sheetModalOpacity, sourceDisputePending, sourceDisputeStatus, submitSourceDispute,
  } = useRecruitingRoomModalInteractions({
    useCallback, setRoomShareStatus, roomShareStatusTimerRef, copyTextToClipboard, roomShareUrl,
    getRecruitingDisplayTitle, selectedPost, BRAND_NAME, getRoomScheduleLabel, setInviteDraft,
    setSlotActionDraft, setSoloRecordDeleteTarget, setPaidCourtJoinPrompt, onClose, isPersonalRecordMatch,
    app, soloRecordDeleteTarget, sheetDragTimerRef, setSheetDragSettling, setSheetDragOffset,
    inviteDraft, slotActionDraft, pendingRosterOpen, getRoomEditDraftByPost, lobbyModalRef,
    sheetDragRef, sheetDragOffset, sourceMatch, sourceDisputeDraft, getMatchResultRevision,
    buildMatchDisputeRequest, PLAYER_STAT_FIELDS, refreshSourceMatchReview,
  });
  const runRoomSlotAction = async (action, { close = true } = {}) => {
    if (slotActionPendingRef.current) return false;
    slotActionPendingRef.current = true;
    setSlotActionPending(true);
    try {
      const result = await action();
      if (result === false || result?.ok === false) throw new Error("room_slot_action_failed");
      if (close) {
        setInviteDraft(null);
        setSlotActionDraft(null);
      }
      return result;
    } catch {
      showRoomShareStatus("슬롯을 변경하지 못했습니다. 다시 시도해 주세요.");
      return false;
    } finally {
      slotActionPendingRef.current = false;
      setSlotActionPending(false);
    }
  };
  const runSourceMatchAction = async (actionKey, action) => {
    if (sourceMatchActionPendingRef.current) return false;
    sourceMatchActionPendingRef.current = actionKey;
    setSourceMatchActionPending(actionKey);
    try {
      const result = await action();
      if (result === false || result?.ok === false) throw new Error("source_match_action_failed");
      return result;
    } catch {
      showRoomShareStatus("경기 작업을 처리하지 못했습니다. 다시 시도해 주세요.");
      return false;
    } finally {
      sourceMatchActionPendingRef.current = "";
      setSourceMatchActionPending("");
    }
  };
  const {
    getRefereeInviteQuery, updateRefereeInviteQuery, getJoinDraft, updateJoinDraft, submitJoin,
    joinSideParty, getChatDraft, updateChatDraft, setChatError, clearChatCooldown,
    handleChatVisibleChange, submitChat, getCommandAnchor, openInviteSlot, openSelfSlotAction,
    shouldOpenRosterAfterAccept, acceptRoomInvitation, confirmPaidCourtJoin,
  } = useRecruitingRoomParticipationActions({
    refereeInviteQueryByPost, setRefereeInviteQueryByPost, getDefaultJoinDraft, myTeams, app,
    joinDraftByPost, isIndividualOnlyRecruitingRoom, isTeamOnlyRoom, setJoinDraftByPost, joiningPostId,
    requiresPaidCourtNotice, setPaidCourtJoinPrompt, getRecruitingLobby, isPickupRecruitingRoom, getPickupOpenSlotPlacements,
    getRecruitingSideCapacity, getRecruitingBenchCapacity, getJoinActiveCapacity, getJoinReserveCapacity, setJoiningPostId,
    onJoined, getPartyOptionKey, joiningPartyKey, setJoiningPartyKey, chatDraftByPost,
    setChatDraftByPost, setChatErrorByPost, setChatCooldownUntilByPost, useCallback, setChatAreaVisible,
    roomChatLocked, CHAT_MESSAGE_MAX_LENGTH, getUnsafeUserTextReason, UNSAFE_INPUT_MESSAGE, chatSendingPostId,
    chatCooldownUntilByPost, chatSendLogRef, CHAT_RATE_WINDOW_MS, CHAT_REPEAT_BLOCK_MS, CHAT_RATE_LIMIT,
    setChatSendingPostId, CHAT_SEND_COOLDOWN_MS, setSlotActionDraft, loadDirectory, DIRECTORY_PICKER_PAGE_LIMIT,
    setInviteError, setInviteDraft, setPendingRosterOpen, onInvitationAccepted, paidCourtJoinPrompt,
  });
  useEffect(() => {
    if (!pendingRosterOpen || !selectedPost || selectedPost.id !== pendingRosterOpen.postId) return;
    const roomState = selectedPost.roomState ?? {};
    const lobby = getRecruitingLobby(selectedPost, app.state);
    const targetEntry = (lobby.entries ?? []).find((entry) => (
      entry.kind === "team" &&
      entry.side === pendingRosterOpen.sideName &&
      (entry.team?.id === pendingRosterOpen.teamId || entry.teamId === pendingRosterOpen.teamId) &&
      (
        entry.playerId === app.currentUser.id ||
        entry.players?.includes(app.currentUser.id) ||
        entry.reserves?.includes(app.currentUser.id) ||
        roomState.partyLeaders?.[entry.id] === app.currentUser.id
      )
    ));
    if (!targetEntry) return;
    const partyLeaderId = roomState.partyLeaders?.[targetEntry.id] ?? (targetEntry.fixed ? selectedPost.playerId : targetEntry.playerId) ?? "";
    if (partyLeaderId !== app.currentUser.id) {
      setPendingRosterOpen(null);
      return;
    }
    setInviteDraft(null);
    setSlotActionDraft({
      postId: selectedPost.id,
      sideName: targetEntry.side,
      reserve: false,
      playerId: app.currentUser.id,
      entryId: targetEntry.id,
      anchor: null,
    });
    setPendingRosterOpen(null);
  }, [app.currentUser.id, app.state, pendingRosterOpen, selectedPost]);
  const confirmQueueRoom = async (roomPost) => {
    if (!roomPost?.id || confirmingMatchId === roomPost.id) return;
    if (roomPost.status === "closed" || roomPost.confirmedAt) return;
    setConfirmingMatchId(roomPost.id);
    try {
      const matchId = await app.actions.confirmRecruitingMatch(roomPost.id);
      if (!matchId) {
        showRoomShareStatus("경기를 확정하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      closeModal();
      onOpenMatch?.(matchId);
    } catch {
      showRoomShareStatus("경기를 확정하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setConfirmingMatchId((current) => (current === roomPost.id ? "" : current));
    }
  };
  if (!selectedPost) return null;

  return {
    ...RECRUITING_ROOM_DEPENDENCIES,
    acceptRoomInvitation, app, attendanceScanState, attendanceStartStatus, cancelSheetDrag, chatCooldownUntilByPost, chatErrorByPost,
    chatSendingPostId, clockClient, closeFromBackdrop, closeModal, closeRoomEdit, confirmDeleteSourceSoloRecord, confirmPaidCourtJoin,
    confirmQueueRoom, confirmSourceMatchFinalization, confirmingMatchId, contextPanel, copyRoomShareUrl, courtByName, currentUserIsAdmin,
    deleteSourceSoloRecord, entryPoint, finalizeMatchPending, finalizeMatchTarget, finishSheetDrag, getChatDraft, getJoinDraft,
    getRefereeInviteQuery, getRoomEditDraftByPost, handleChatVisibleChange, inviteDraft, inviteError, joinSideParty, joiningPartyKey,
    joiningPostId, lobbyModalRef, moveSheetDrag, myTeams, navigate, onRemake, openInviteSlot,
    openRoomEdit, openSelfSlotAction, paidCourtJoinPrompt, refreshSourceMatchReview, registeredCourts, remoteDirectoryEnabled, requestSourceMatchFinalization,
    readOnly, requiresPaidCourtNotice, roomCancellationPending, roomCancellationTarget, roomHelpOpen, roomChatLocked, roomDataState, roomEditStatusByPost, roomShareEnabled, roomShareStatus,
    roomTeamFeedback, roomTeamQuery, roomTeamSavingSide, runRoomSlotAction, runSourceMatchAction, saveRoomEdit, selectedPost, sendInvites, setAttendanceStartStatus,
    setFinalizeMatchTarget, setInviteDraft, setPaidCourtJoinPrompt, setRoomCancellationPending, setRoomCancellationTarget, setRoomHelpOpen, setRoomTeamFeedback, setRoomTeamQuery,
    setRoomTeamSavingSide, setSlotActionDraft, setSoloRecordDeleteTarget, setSourceDisputeDraft, setSourceMatchDraftScore, shareRoom, sheetBackdropOpacity, sheetDragOffset,
    sheetDragSettling, sheetModalOpacity, slotActionDraft, slotActionPending, soloRecordDeleteTarget, sourceDisputeDraft, sourceDisputePending, sourceDisputeStatus,
    sourceMatch, sourceMatchActionPending, sourceMatchDraftScore, sourceMatchReviewRefreshing,
    startSheetDrag, submitChat, submitJoin, submitSourceDispute, teamById, toggleInvitePlayer, updateChatDraft,
    updateInviteDraft, updateJoinDraft, updateRefereeInviteQuery, updateRoomEditDraft, userById,
  };
}
