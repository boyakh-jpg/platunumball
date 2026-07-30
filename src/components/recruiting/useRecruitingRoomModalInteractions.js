export function useRecruitingRoomModalInteractions({
  useCallback, setRoomShareStatus, roomShareStatusTimerRef, copyTextToClipboard, roomShareUrl,
  getRecruitingDisplayTitle, selectedPost, BRAND_NAME, getRoomScheduleLabel, setInviteDraft,
  setSlotActionDraft, setSoloRecordDeleteTarget, setPaidCourtJoinPrompt, onClose, isPersonalRecordMatch,
  app, soloRecordDeleteTarget, sheetDragTimerRef, setSheetDragSettling, setSheetDragOffset,
  inviteDraft, slotActionDraft, pendingRosterOpen, getRoomEditDraftByPost, lobbyModalRef,
  sheetDragRef, sheetDragOffset, sourceMatch, sourceDisputeDraft, getMatchResultRevision,
  buildMatchDisputeRequest, PLAYER_STAT_FIELDS,
}) {
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

  return {
    showRoomShareStatus, copyRoomShareUrl, shareRoom, closeModal, closeFromBackdrop,
    deleteSourceSoloRecord, confirmDeleteSourceSoloRecord, resetSheetDrag, getSheetDismissDistance, isSheetDragInteractiveTarget,
    canDismissBySheetDrag, startSheetDrag, moveSheetDrag, finishSheetDrag, cancelSheetDrag,
    sheetDragProgress, sheetBackdropOpacity, sheetModalOpacity, submitSourceDispute,
  };
}
