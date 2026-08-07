export function getRecruitingRoomRosterProps(context, sideName) {
  const {
    app,
    canInviteSideFromRoom,
    canManageEntry,
    canManageMatchCheckin,
    lobby,
    mine,
    moveCandidate,
    openInviteSlot,
    openSelfSlotAction,
    roomOwnerId,
    roomState,
    selectedPost,
    showCaptainBadge,
    slotPositions,
    sourceMatch,
    sourceMatchSideLeaderIds,
    sourceMatchSlotManagementOpen,
    sourceRoomReadOnly,
    teamOnlyRoom,
    userById,
  } = context;

  return {
    lobby,
    userById,
    teams: context.roomDataState?.teams ?? app.state.teams,
    hostPlayerId: roomOwnerId,
    currentUserId: app.currentUser.id,
    showCaptainBadge: !sourceMatch && showCaptainBadge,
    roomState,
    sideLeaderId: sourceMatchSideLeaderIds[sideName],
    slotPositions,
    canInvite: !sourceRoomReadOnly && canInviteSideFromRoom(sideName),
    inviteLabel: teamOnlyRoom ? "소집" : "초대",
    canManageEntry: sourceRoomReadOnly ? null : canManageEntry,
    canManage: mine,
    onInviteSlot: sourceRoomReadOnly
      ? null
      : (targetSide, reserve, slotKey, event) => openInviteSlot(selectedPost, targetSide, reserve, slotKey, event),
    onSelfSlotAction: sourceMatchSlotManagementOpen && (!sourceMatch || canManageMatchCheckin)
      ? (targetSide, reserve, playerId, entryId, event) => openSelfSlotAction(selectedPost, targetSide, reserve, playerId, entryId, event)
      : null,
    onMoveCandidate: moveCandidate,
  };
}
