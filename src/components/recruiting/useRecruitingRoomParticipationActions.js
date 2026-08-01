export function useRecruitingRoomParticipationActions({
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
}) {
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
      if (!result || result?.ok === false) throw new Error(result?.error || "chat_send_failed");
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
    if (!invitation.id) return false;
    setInviteError("");
    if (invitation.role !== "referee" && !paidCourtConfirmed && requiresPaidCourtNotice(roomPost)) {
      setPaidCourtJoinPrompt({ action: "invitation", roomPost, invitation });
      return { ok: true, deferred: true };
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
      if (!result || result.ok === false) {
        setPendingRosterOpen(null);
        setInviteError("초대를 수락하지 못했습니다. 다시 시도해 주세요.");
      }
      else {
        onInvitationAccepted?.(roomPost.id, invitation);
      }
      return result;
    } catch {
      setPendingRosterOpen(null);
      setInviteError("초대를 수락하지 못했습니다. 다시 시도해 주세요.");
      return false;
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

  return {
    getRefereeInviteQuery, updateRefereeInviteQuery, getJoinDraft, updateJoinDraft, submitJoin,
    joinSideParty, getChatDraft, updateChatDraft, setChatError, clearChatCooldown,
    handleChatVisibleChange, submitChat, getCommandAnchor, openInviteSlot, openSelfSlotAction,
    shouldOpenRosterAfterAccept, acceptRoomInvitation, confirmPaidCourtJoin,
  };
}
