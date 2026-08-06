export function buildTeamMembershipActions(context) {
  const {
    acceptTeamInvitation,
    applyTeamInvitationMutation,
    applyTeamMutation,
    authEmail,
    authUserId,
    cancelTeamInvitation,
    createInitialMatchListStore,
    currentUserId,
    declineTeamInvitation,
    inviteTeamMember,
    isSupabaseConfigured,
    refreshRecruitingRelations,
    removeTeamMember,
    resetState,
    setMatchLists,
    setState,
    updateTeamMemberRole,
  } = context;

  return ({
inviteTeamMember: (teamId, targetUserId, role = "regular") => applyTeamInvitationMutation(
    "팀 초대",
    (prev) => inviteTeamMember({ ...prev, currentUserId }, teamId, targetUserId, role),
    "invite",
    (_before, after) => {
      const invitation = (after.teamInvitations ?? []).find((item) => (
        item.teamId === teamId &&
        item.targetUserId === targetUserId &&
        item.fromUserId === currentUserId &&
        item.status === "pending"
      ));
      return { teamId, targetUserId, role, invitationId: invitation?.id };
    },
  ),
  acceptTeamInvitation: (invitationId) => applyTeamInvitationMutation(
    "팀 초대 수락",
    (prev) => acceptTeamInvitation({ ...prev, currentUserId }, invitationId),
    "accept",
    () => ({ invitationId }),
  ).then(async (result) => {
    if (result && result.ok !== false) await refreshRecruitingRelations();
    return result;
  }),
  declineTeamInvitation: (invitationId) => applyTeamInvitationMutation(
    "팀 초대 거절",
    (prev) => declineTeamInvitation({ ...prev, currentUserId }, invitationId),
    "decline",
    () => ({ invitationId }),
  ),
  cancelTeamInvitation: (invitationId) => applyTeamInvitationMutation(
    "팀 초대 취소",
    (prev) => cancelTeamInvitation({ ...prev, currentUserId }, invitationId),
    "cancel",
    () => ({ invitationId }),
  ),
  requestTeamMembership: (teamId, application) => applyTeamInvitationMutation(
    "팀 가입 신청",
    (prev) => prev,
    "request_join",
    () => ({ teamId, application }),
  ),
  approveTeamJoinRequest: (invitationId) => applyTeamInvitationMutation(
    "팀 가입 승인",
    (prev) => prev,
    "approve_join",
    () => ({ invitationId }),
  ),
  declineTeamJoinRequest: (invitationId) => applyTeamInvitationMutation(
    "팀 가입 거절",
    (prev) => prev,
    "decline_join",
    () => ({ invitationId }),
  ),
  cancelTeamJoinRequest: (invitationId) => applyTeamInvitationMutation(
    "팀 가입 신청 취소",
    (prev) => prev,
    "cancel_join",
    () => ({ invitationId }),
  ),
  updateTeamDescription: (teamId, description) => applyTeamInvitationMutation(
    "팀 소개 저장",
    (prev) => prev,
    "update_description",
    () => ({ teamId, description }),
  ),
  updateTeamMemberRole: (teamId, userId, role) => applyTeamMutation(teamId, (prev) => updateTeamMemberRole({ ...prev, currentUserId }, teamId, userId, role)),
  removeTeamMember: (teamId, userId) => applyTeamMutation(teamId, (prev) => removeTeamMember({ ...prev, currentUserId }, teamId, userId)),
  reset: () => {
    const nextState = resetState({ includeDemo: !isSupabaseConfigured, authUserId, email: authEmail });
    setState(nextState);
    setMatchLists(createInitialMatchListStore(nextState));
  }
  });
}
