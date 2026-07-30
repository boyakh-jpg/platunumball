export function useRecruitingRoomManagementActions({
  roomEditDraftByPost, setRoomEditDraftByPost, getRoomEditDraft, sourceMatch, setRoomEditStatusByPost,
  getMatchRuleInputValidation, app, getRoomEditSaveError, setInviteError, setInviteDraft,
  inviteDraft, isIndividualOnlyRecruitingRoom,
}) {
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

  return {
    getRoomEditDraftByPost, openRoomEdit, closeRoomEdit, updateRoomEditDraft, saveRoomEdit,
    updateInviteDraft, toggleInvitePlayer, sendInvites,
  };
}
