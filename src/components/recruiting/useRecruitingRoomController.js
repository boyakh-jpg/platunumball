import { RECRUITING_ROOM_DEPENDENCIES } from "./RecruitingRoomDependencies.js";

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
}) {
  const {
    BRAND_NAME, CHAT_MESSAGE_MAX_LENGTH, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS, CHAT_REPEAT_BLOCK_MS, CHAT_SEND_COOLDOWN_MS, DIRECTORY_PICKER_PAGE_LIMIT,
    MATCH_DISPUTE_REASON_OPTIONS, PLAYER_STAT_FIELDS, UNSAFE_INPUT_MESSAGE, buildMatchDisputeRequest, copyTextToClipboard, getDefaultJoinDraft, getJoinActiveCapacity,
    getJoinReserveCapacity, getLinkedPersonalRecordDisplayUser, getMatchResultRevision, getMatchRoomPhase, getMatchRuleInputValidation, getPartyOptionKey, getPickupOpenSlotPlacements,
    getRecruitingBenchCapacity, getRecruitingDisplayTitle, getRecruitingLobby, getRecruitingPostTerminalState, getRecruitingSideCapacity, getRegisteredCourts, getRoomEditDraft,
    getRoomEditSaveError, getRoomScheduleLabel, getRoomShareUrl, getUnsafeUserTextReason, isCurrentUserRoomParticipant, isIndividualOnlyRecruitingRoom, isMatchRoomChatLocked,
    isPaidRecruitingCourt, isPersonalRecordMatch, isPickupRecruitingRoom, isSyntheticMatchRoomId, isTeamOnlyRoom, useCallback, useEffect,
    useMemo, useNavigate, useRef, useState,
  } = RECRUITING_ROOM_DEPENDENCIES;

  const navigate = useNavigate();
  const selectedPost = post;
  const loadDirectory = app.actions.loadDirectory;
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
    () => app.state.teams.filter((team) => team.members.some((member) => member.userId === app.currentUser.id)),
    [app.currentUser.id, app.state.teams],
  );
  useEffect(() => {
    if (!shouldLoadTeamDirectory) return;
    loadDirectory?.({ kind: "teams", limit: DIRECTORY_PICKER_PAGE_LIMIT, offset: 0, includeTeamMemberProfiles: true });
  }, [loadDirectory, shouldLoadTeamDirectory]);
  useEffect(() => {
    sourceMatchTeamIds.forEach((teamId) => {
      void loadDirectory?.({ kind: "teams", teamId, includeTeamMemberProfiles: true });

    });
  }, [loadDirectory, sourceMatchTeamIds]);
  useEffect(() => {
    sourceMatchLinkedProfileIds.forEach((profileId) => {
      void loadDirectory?.({ kind: "players", profileId });
    });
  }, [loadDirectory, sourceMatchLinkedProfileIds]);

  const userById = useMemo(
    () => {
      const profileById = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
      const anonymousEntries = Object.values(sourceMatch?.anonymousPlayers ?? {}).map((user) => [
        user.id,
        getLinkedPersonalRecordDisplayUser(user, profileById),
      ]);
      return {
        ...profileById,
        ...Object.fromEntries(anonymousEntries),
      };
    },
    [app.state.users, sourceMatch?.anonymousPlayers],
  );
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
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
  const [roomCancellationTarget, setRoomCancellationTarget] = useState(null);
  const [roomCancellationPending, setRoomCancellationPending] = useState(false);
  const [sourceMatchReviewRefreshing, setSourceMatchReviewRefreshing] = useState(false);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [sheetDragSettling, setSheetDragSettling] = useState(false);
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
      if (result?.ok !== false) {
        const finalizedMatchId = finalizeMatchTarget.matchId;
        setFinalizeMatchTarget(null);
        await app.actions.loadMatchDetail?.(finalizedMatchId);
      }
    } finally {
      setFinalizeMatchPending(false);
    }
  };
  const requestSourceMatchFinalization = (matchId, openDisputeCount, authorityLabel) => {
    setFinalizeMatchTarget({ matchId, openDisputeCount, authorityLabel });
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
  const roomChatLobby = useMemo(() => getRecruitingLobby(selectedPost, app.state), [app.state, selectedPost]);
  const canPollRoomChat = isCurrentUserRoomParticipant(selectedPost, roomChatLobby, app.currentUser.id);
  const roomShareUrl = useMemo(() => getRoomShareUrl(roomPostId), [roomPostId]);
  const roomChatLocked = sourceMatch
    ? isMatchRoomChatLocked(sourceMatch)
    : Boolean(selectedPost?.confirmedAt || getRecruitingPostTerminalState(selectedPost));
  const modalPostDetailLoadRef = useRef("");
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
    if (!sourceMatch?.id) return;
    const resultKey = sourceMatch.result?.updatedAt ?? sourceMatch.result?.submittedAt ?? "";
    setSourceDisputeDraft((current) => (
      current.matchId === sourceMatch.id && current.resultKey === resultKey
        ? current
        : {
          matchId: sourceMatch.id,
          resultKey,
          reason: MATCH_DISPUTE_REASON_OPTIONS[0],
          customReason: "",
          requestedScoreA: String(sourceMatch.result?.scoreA ?? sourceMatch.teamA?.score ?? 0),
          requestedScoreB: String(sourceMatch.result?.scoreB ?? sourceMatch.teamB?.score ?? 0),
          requestedStats: Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [
            id,
            String(sourceMatch.result?.playerStats?.[app.currentUser.id]?.[id] ?? 0),
          ])),
        }
    ));
  }, [app.currentUser.id, sourceMatch?.id, sourceMatch?.result?.updatedAt]);

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

  const showRoomShareStatus = useCallback((message) => {
    setRoomShareStatus(message);
    window.clearTimeout(roomShareStatusTimerRef.current);
    roomShareStatusTimerRef.current = window.setTimeout(() => setRoomShareStatus(""), 1600);
  }, []);

  const copyRoomShareUrl = useCallback(async () => {
    try {
      const copied = await copyTextToClipboard(roomShareUrl);
      showRoomShareStatus(copied ? "URL을 복사했습니다." : "URL을 복사하지 못했습니다.");
    } catch {
      showRoomShareStatus("URL을 복사하지 못했습니다.");
    }
  }, [roomShareUrl, showRoomShareStatus]);

  const shareRoom = useCallback(async () => {
    const title = getRecruitingDisplayTitle(selectedPost, `${BRAND_NAME} 매치방`);
    const text = [title, selectedPost?.court, selectedPost ? getRoomScheduleLabel(selectedPost) : ""].filter(Boolean).join(" · ");
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: roomShareUrl });
        showRoomShareStatus("공유 화면을 열었습니다.");
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyRoomShareUrl();
  }, [copyRoomShareUrl, roomShareUrl, selectedPost, showRoomShareStatus]);

  const closeModal = () => {
    setInviteDraft(null);
    setSlotActionDraft(null);
    setSoloRecordDeleteTarget(null);
    setPaidCourtJoinPrompt(null);
    onClose?.();
  };
  const closeFromBackdrop = () => closeModal();
  const deleteSourceSoloRecord = (match) => {
    if (!match?.id || !isPersonalRecordMatch(match) || match.createdBy !== app.currentUser.id) return;
    setSoloRecordDeleteTarget(match);
  };
  const confirmDeleteSourceSoloRecord = () => {
    const matchId = soloRecordDeleteTarget?.id;
    if (!matchId) return;
    setSoloRecordDeleteTarget(null);
    const request = app.actions.deleteSoloRecord?.(matchId);
    if (request?.then) request.finally(closeModal);
    else closeModal();
  };
  const resetSheetDrag = () => {
    window.clearTimeout(sheetDragTimerRef.current);
    setSheetDragSettling(true);
    setSheetDragOffset(0);
    sheetDragTimerRef.current = window.setTimeout(() => setSheetDragSettling(false), 160);
  };
  const getSheetDismissDistance = () => {
    const viewportHeight = Math.max(1, window.innerHeight || 1);
    return Math.min(260, Math.max(160, viewportHeight * 0.4));
  };
  const isSheetDragInteractiveTarget = (target) => Boolean(target?.closest?.(
    "button:not(.arena-lobby-drag-handle), a, input, textarea, select, [contenteditable='true'], .arena-slot-command-popover",
  ));
  const canDismissBySheetDrag = () => {
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    const editing = Boolean(activeElement?.matches?.("input, textarea, select, [contenteditable='true']"));
    return !editing
      && !inviteDraft
      && !slotActionDraft
      && !pendingRosterOpen
      && !getRoomEditDraftByPost(selectedPost)
      && Number(lobbyModalRef.current?.scrollTop ?? 0) <= 2;
  };
  const startSheetDrag = (event) => {
    if (event.pointerType !== "touch" || !canDismissBySheetDrag()) return;
    if (isSheetDragInteractiveTarget(event.target)) return;
    window.clearTimeout(sheetDragTimerRef.current);
    setSheetDragSettling(false);
    setSheetDragOffset(0);
    sheetDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      active: false,
    };
  };
  const moveSheetDrag = (event) => {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - drag.startY;
    if (deltaY < -12) {
      sheetDragRef.current = null;
      return;
    }
    if (!drag.active) {
      if (deltaY <= 8) return;
      drag.active = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    setSheetDragOffset(Math.max(0, Math.min(deltaY, window.innerHeight || deltaY)));
  };
  const finishSheetDrag = (event) => {
    const drag = sheetDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sheetDragRef.current = null;
    if (!drag.active) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const deltaY = event.clientY - drag.startY;
    if (canDismissBySheetDrag() && deltaY >= getSheetDismissDistance()) {
      setSheetDragSettling(true);
      setSheetDragOffset(window.innerHeight || 720);
      sheetDragTimerRef.current = window.setTimeout(closeModal, 150);
      return;
    }
    resetSheetDrag();
  };
  const cancelSheetDrag = () => {
    const wasActive = Boolean(sheetDragRef.current?.active);
    sheetDragRef.current = null;
    if (wasActive) resetSheetDrag();
  };
  const sheetDragProgress = sheetDragOffset ? Math.min(1, sheetDragOffset / getSheetDismissDistance()) : 0;
  const sheetBackdropOpacity = 0.82 - (sheetDragProgress * 0.34);
  const sheetModalOpacity = 1 - (sheetDragProgress * 0.34);
  const submitSourceDispute = (event) => {
    event.preventDefault();
    if (!sourceMatch?.id) return;
    if (!sourceMatch.refereeId) {
      app.actions.disputeMatch(sourceMatch.id, {
        kind: "team_scores",
        requestedScoreA: Number(sourceDisputeDraft.requestedScoreA),
        requestedScoreB: Number(sourceDisputeDraft.requestedScoreB),
        baseRevision: getMatchResultRevision(sourceMatch),
        reason: sourceDisputeDraft.customReason.trim() || sourceDisputeDraft.reason,

      });
      return;
    }
    app.actions.disputeMatch(sourceMatch.id, buildMatchDisputeRequest({
      match: sourceMatch,
      playerId: app.currentUser.id,
      requestedStats: Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [
        id,
        Number(sourceDisputeDraft.requestedStats?.[id]),
      ])),
      reason: sourceDisputeDraft.reason,
      customReason: sourceDisputeDraft.customReason,
    }));
  };
  const getRefereeInviteQuery = (roomPost) => refereeInviteQueryByPost[roomPost.id] ?? "";
  const updateRefereeInviteQuery = (roomPost, query) => {
    setRefereeInviteQueryByPost((current) => ({ ...current, [roomPost.id]: query }));
  };
  const getJoinDraft = (roomPost) => {
    const baseDraft = getDefaultJoinDraft(roomPost, myTeams, app.currentUser, app.state);
    const storedDraft = joinDraftByPost[roomPost.id];
    if (!storedDraft) return baseDraft;
    if (isIndividualOnlyRecruitingRoom(roomPost) && storedDraft.joinMode === "team") {
      return {
        ...baseDraft,
        ...storedDraft,
        joinMode: "player",
        teamId: "",
        playerIds: [],
        reservePlayerIds: [],
      };
    }
    if (!isTeamOnlyRoom(roomPost) || storedDraft.joinMode === "team" || storedDraft.joinMode === "referee") return storedDraft;
    return {
      ...baseDraft,
      ...storedDraft,
      joinMode: "team",
      teamId: storedDraft.teamId || baseDraft.teamId,
      playerIds: storedDraft.playerIds?.length ? storedDraft.playerIds : baseDraft.playerIds,
      reservePlayerIds: storedDraft.reservePlayerIds ?? baseDraft.reservePlayerIds,
    };
  };
  const updateJoinDraft = (roomPost, patch) => {
    setJoinDraftByPost((current) => ({
      ...current,
      [roomPost.id]: { ...getJoinDraft(roomPost), ...patch },
    }));
  };
  const submitJoin = async (roomPost, { paidCourtConfirmed = false } = {}) => {
    if (!roomPost?.id || joiningPostId === roomPost.id) return false;
    const joinDraft = getJoinDraft(roomPost);
    if (joinDraft.joinMode !== "referee" && !paidCourtConfirmed && requiresPaidCourtNotice(roomPost)) {
      setPaidCourtJoinPrompt({ action: "join", roomPost });
      return false;
    }
    const lobby = getRecruitingLobby(roomPost, app.state);
    const pickupPlacement = isPickupRecruitingRoom(roomPost)
      ? getPickupOpenSlotPlacements(lobby, {
          sideCapacity: getRecruitingSideCapacity(roomPost),
          benchCapacity: getRecruitingBenchCapacity(roomPost),
        })[0]
      : null;
    if (isPickupRecruitingRoom(roomPost) && !pickupPlacement) return false;
    const normalizedJoinDraft = pickupPlacement
      ? {
          ...joinDraft,
          joinMode: "player",
          teamId: "",
          playerIds: [],
          reservePlayerIds: [],
          side: pickupPlacement.side,
          reserve: pickupPlacement.reserve,
        }
      : joinDraft;
    const shouldReserve = !pickupPlacement && normalizedJoinDraft.joinMode !== "referee" &&
      !isTeamOnlyRoom(roomPost) &&
      !normalizedJoinDraft.reserve &&
      getJoinActiveCapacity(roomPost, lobby, normalizedJoinDraft.side, false) <= 0 &&
      getJoinReserveCapacity(roomPost, lobby, normalizedJoinDraft.side) > 0;
    const application = shouldReserve ? { ...normalizedJoinDraft, reserve: true } : normalizedJoinDraft;
    setJoiningPostId(roomPost.id);
    try {
      const result = await app.actions.interestRecruitingPost(roomPost.id, application);
      if (result && result.ok !== false) onJoined?.(roomPost.id, result);
      return result;
    } finally {
      setJoiningPostId((current) => (current === roomPost.id ? "" : current));
    }
  };
  const joinSideParty = async (roomPost, option, { paidCourtConfirmed = false } = {}) => {
    const partyKey = `${roomPost.id}:${getPartyOptionKey(option)}`;
    if (joiningPartyKey) return false;
    if (!paidCourtConfirmed && requiresPaidCourtNotice(roomPost)) {
      setPaidCourtJoinPrompt({ action: "party", roomPost, option });
      return false;
    }
    setJoiningPartyKey(partyKey);
    try {
      const result = await app.actions.joinRecruitingSideParty(roomPost.id, option.team.id, option.sideName, option.entry?.id);
      if (result && result.ok !== false) onJoined?.(roomPost.id, result);
      return result;
    } finally {
      setJoiningPartyKey((current) => current === partyKey ? "" : current);
    }
  };
  const getChatDraft = (roomPost) => chatDraftByPost[roomPost.id] ?? '';
  const updateChatDraft = (roomPost, value) => {
    setChatDraftByPost((current) => ({ ...current, [roomPost.id]: value }));
    setChatErrorByPost((current) => current[roomPost.id] ? { ...current, [roomPost.id]: "" } : current);
  };
  const setChatError = (postId, message) => {
    setChatErrorByPost((current) => ({ ...current, [postId]: message }));
  };
  const clearChatCooldown = (postId, until) => {
    window.setTimeout(() => {
      setChatCooldownUntilByPost((current) => (
        current[postId] === until ? { ...current, [postId]: 0 } : current
      ));
    }, Math.max(0, until - Date.now()));
  };
  const handleChatVisibleChange = useCallback((visible) => {
    setChatAreaVisible(visible);
  }, []);
  const submitChat = async (event, roomPost) => {
    event.preventDefault();
    if (!roomPost?.id || roomChatLocked) return;
    const postId = roomPost.id;
    const body = getChatDraft(roomPost).trim();
    if (!body) return;
    if (body.includes("\n") || body.includes("\r")) {
      setChatError(postId, "한 줄로 입력해 주세요.");
      return;
    }
    if (body.length > CHAT_MESSAGE_MAX_LENGTH) {
      setChatError(postId, "60자 이내로 입력해 주세요.");
      return;
    }
    if (getUnsafeUserTextReason(body, { maxLength: CHAT_MESSAGE_MAX_LENGTH })) {
      setChatError(postId, UNSAFE_INPUT_MESSAGE);
      return;
    }
    const now = Date.now();
    if (chatSendingPostId === postId || Number(chatCooldownUntilByPost[postId] ?? 0) > now) {
      setChatError(postId, "잠시 후 다시 입력해 주세요.");
      return;
    }
    const recentLog = (chatSendLogRef.current[postId] ?? []).filter((item) => now - item.at < CHAT_RATE_WINDOW_MS);
    if (recentLog.some((item) => item.body === body && now - item.at < CHAT_REPEAT_BLOCK_MS)) {
      setChatError(postId, "잠시 후 다시 입력해 주세요.");
      return;
    }
    if (recentLog.length >= CHAT_RATE_LIMIT) {
      setChatError(postId, "잠시 후 다시 입력해 주세요.");
      return;
    }
    setChatSendingPostId(postId);
    updateChatDraft(roomPost, "");
    try {
      const result = await app.actions.sendRecruitingChat(roomPost.id, body);
      if (result?.ok === false) throw new Error(result.error || "chat_send_failed");
      chatSendLogRef.current[postId] = [...recentLog, { body, at: now }];
      const cooldownUntil = Date.now() + CHAT_SEND_COOLDOWN_MS;
      setChatCooldownUntilByPost((current) => ({ ...current, [postId]: cooldownUntil }));
      clearChatCooldown(postId, cooldownUntil);
    } catch (error) {
      setChatError(postId, "잠시 후 다시 입력해 주세요.");
    } finally {
      setChatSendingPostId((current) => (current === postId ? "" : current));
    }
  };
  const getCommandAnchor = (event) => {
    const target = event?.currentTarget;
    if (!target?.getBoundingClientRect || typeof window === 'undefined') return null;
    const rect = target.getBoundingClientRect();
    const width = Math.min(560, Math.max(520, window.innerWidth - 24));
    const halfWidth = width / 2;
    const x = Math.min(
      Math.max(rect.left + rect.width / 2, 12 + halfWidth),
      window.innerWidth - 12 - halfWidth,
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement = spaceBelow >= 300 || spaceBelow >= spaceAbove ? 'bottom' : 'top';
    const y = placement === 'bottom' ? rect.bottom + 8 : rect.top - 8;
    return {
      x,
      y: Math.min(Math.max(y, 12), window.innerHeight - 12),
      width,
      placement,
    };
  };
  const openInviteSlot = (roomPost, sideName, reserve = false, slotKey = '', event = null) => {
    setSlotActionDraft(null);
    loadDirectory?.({ kind: "players", limit: DIRECTORY_PICKER_PAGE_LIMIT, offset: 0 });
    setInviteError("");
    setInviteDraft({ postId: roomPost.id, sideName, reserve, slotKey, query: '', selectedPlayerIds: [], anchor: getCommandAnchor(event) });
  };
  const openSelfSlotAction = (roomPost, sideName, reserve = false, playerId = '', entryId = '', event = null) => {
    setInviteError("");
    setInviteDraft(null);
    setSlotActionDraft({ postId: roomPost.id, sideName, reserve, playerId, entryId, anchor: getCommandAnchor(event) });
  };
  const shouldOpenRosterAfterAccept = (roomPost, invitation = {}) => {
    const teamId = invitation.teamId || roomPost?.targetTeamId || "";
    return Boolean(
      teamId &&
      invitation.role !== "referee" &&
      roomPost?.visibility === "private" &&
      roomPost?.hostJoinMode === "team" &&
      (invitation.side || "teamB") === "teamB" &&
      !invitation.reserve
    );
  };
  const acceptRoomInvitation = async (roomPost, invitation = {}, { paidCourtConfirmed = false } = {}) => {
    if (!invitation.id) return;
    if (invitation.role !== "referee" && !paidCourtConfirmed && requiresPaidCourtNotice(roomPost)) {
      setPaidCourtJoinPrompt({ action: "invitation", roomPost, invitation });
      return;
    }
    if (shouldOpenRosterAfterAccept(roomPost, invitation)) {
      setPendingRosterOpen({
        postId: roomPost.id,
        teamId: invitation.teamId || roomPost.targetTeamId,
        sideName: invitation.side || "teamB",
      });
    }
    try {
      const result = await app.actions.acceptRecruitingInvitation(roomPost.id, invitation.id);
      if (!result || result.ok === false) setPendingRosterOpen(null);
      else {
        onInvitationAccepted?.(roomPost.id, invitation);
      }
    } catch {
      setPendingRosterOpen(null);
    }
  };
  const confirmPaidCourtJoin = () => {
    const prompt = paidCourtJoinPrompt;
    setPaidCourtJoinPrompt(null);
    if (!prompt) return;
    if (prompt.action === "party") {
      void joinSideParty(prompt.roomPost, prompt.option, { paidCourtConfirmed: true });
      return;
    }
    if (prompt.action === "invitation") {
      void acceptRoomInvitation(prompt.roomPost, prompt.invitation, { paidCourtConfirmed: true });
      return;
    }
    void submitJoin(prompt.roomPost, { paidCourtConfirmed: true });
  };
  const getRoomEditDraftByPost = (roomPost) => roomEditDraftByPost[roomPost.id] ?? null;
  const openRoomEdit = (roomPost) => {
    setRoomEditDraftByPost((current) => ({
      ...current,
      [roomPost.id]: getRoomEditDraft(roomPost, sourceMatch),
    }));
    setRoomEditStatusByPost((current) => ({ ...current, [roomPost.id]: { pending: false, error: "" } }));
  };
  const closeRoomEdit = (roomPost) => {
    setRoomEditDraftByPost((current) => {
      const next = { ...current };
      delete next[roomPost.id];
      return next;
    });
  };
  const updateRoomEditDraft = (roomPost, patch) => {
    setRoomEditDraftByPost((current) => ({
      ...current,
      [roomPost.id]: { ...(current[roomPost.id] ?? getRoomEditDraft(roomPost, sourceMatch)), ...patch },
    }));
    setRoomEditStatusByPost((current) => ({
      ...current,
      [roomPost.id]: { pending: Boolean(current[roomPost.id]?.pending), error: "" },
    }));
  };
  const saveRoomEdit = async (roomPost) => {
    const roomEditDraft = getRoomEditDraftByPost(roomPost);
    if (!roomEditDraft) return;
    if (String(roomEditDraft.meetingPoint ?? "").trim().length < 2) return;
    if (!getMatchRuleInputValidation(roomEditDraft, { mode: roomPost.mode }).valid) return;
    const initialDraft = getRoomEditDraft(roomPost, sourceMatch);
    const roomEditPatch = Object.fromEntries(
      Object.entries(roomEditDraft).filter(([key, value]) => (
        JSON.stringify(value ?? null) !== JSON.stringify(initialDraft[key] ?? null)
      )),
    );
    if (!Object.keys(roomEditPatch).length) {
      closeRoomEdit(roomPost);
      return;
    }
    setRoomEditStatusByPost((current) => ({
      ...current,
      [roomPost.id]: { pending: true, error: "" },
    }));
    try {
      const result = sourceMatch
        ? await app.actions.updateMatchRoomRules(sourceMatch.id, roomEditPatch)
        : await app.actions.updateRecruitingRoomRules(roomPost.id, roomEditPatch);
      if (!result || result.ok === false) {
        setRoomEditStatusByPost((current) => ({
          ...current,
          [roomPost.id]: { pending: false, error: getRoomEditSaveError(result, Boolean(sourceMatch)) },
        }));
        return;
      }
      closeRoomEdit(roomPost);
      setRoomEditStatusByPost((current) => {
        const next = { ...current };
        delete next[roomPost.id];
        return next;
      });
    } catch (error) {
      setRoomEditStatusByPost((current) => ({
        ...current,
        [roomPost.id]: {
          pending: false,
          error: getRoomEditSaveError({ error: error?.message }, Boolean(sourceMatch)),
        },
      }));
    }
  };
  const updateInviteDraft = (patch) => {
    setInviteError("");
    setInviteDraft((current) => (current ? { ...current, ...patch } : current));
  };
  const toggleInvitePlayer = (playerId) => {
    setInviteError("");
    setInviteDraft((current) => {
      if (!current) return current;
      const selected = current.selectedPlayerIds ?? [];
      return {
        ...current,
        selectedPlayerIds: selected.includes(playerId)
          ? selected.filter((id) => id !== playerId)
          : [...selected, playerId],
      };
    });
  };
  const sendInvites = async (roomPost, playerIds, teamId = null, joinMode = "") => {
    if (!inviteDraft || !playerIds.length) return false;
    const playerOnlyRoom = isIndividualOnlyRecruitingRoom(roomPost);
    const inviteJoinMode = playerOnlyRoom ? "player" : (joinMode || (teamId ? "team" : "player"));
    const invite = {
      side: inviteDraft.sideName,
      reserve: Boolean(inviteDraft.reserve),
      playerIds,
      teamId: playerOnlyRoom ? null : teamId,
      joinMode: inviteJoinMode,
    };
    setInviteError("");

    try {
      const result = await app.actions.inviteRecruitingPlayers(roomPost.id, invite);
      if (result && result.ok !== false) {
        setInviteDraft(null);
        return result;
      }
      const message = result?.statusCode === 401 || result?.error === "missing_bearer_token"
        ? "로그인이 만료되었습니다. 다시 로그인한 뒤 초대해 주세요."
        : "초대를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      setInviteError(message);
      return result;
    } catch {
      setInviteError("초대를 저장하지 못했습니다.");
      return false;
    }
  };
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
      if (!matchId) return;
      closeModal();
      onOpenMatch?.(matchId);
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
    requiresPaidCourtNotice, roomCancellationPending, roomCancellationTarget, roomChatLocked, roomEditStatusByPost, roomShareEnabled, roomShareStatus,
    roomTeamFeedback, roomTeamQuery, roomTeamSavingSide, saveRoomEdit, selectedPost, sendInvites, setAttendanceStartStatus,
    setFinalizeMatchTarget, setInviteDraft, setPaidCourtJoinPrompt, setRoomCancellationPending, setRoomCancellationTarget, setRoomTeamFeedback, setRoomTeamQuery,
    setRoomTeamSavingSide, setSlotActionDraft, setSoloRecordDeleteTarget, setSourceDisputeDraft, shareRoom, sheetBackdropOpacity, sheetDragOffset,
    sheetDragSettling, sheetModalOpacity, slotActionDraft, soloRecordDeleteTarget, sourceDisputeDraft, sourceMatch, sourceMatchReviewRefreshing,
    startSheetDrag, submitChat, submitJoin, submitSourceDispute, teamById, toggleInvitePlayer, updateChatDraft,
    updateInviteDraft, updateJoinDraft, updateRefereeInviteQuery, updateRoomEditDraft, userById,
  };
}
