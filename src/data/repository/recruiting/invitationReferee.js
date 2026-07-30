import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { getRecruitingRoomParticipantIds } from "../../../lib/recruiting.js";
import { isEligibleReferee } from "../../../lib/matchUtils.js";
import { isRecruitingRoomParticipant } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState } from "../guards.js";

export function inviteRecruitingReferee(state, postId, refereeId) {
  const disciplineBlock = getDisciplineBlockedState(state, "심판 초대");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (!isRecruitingRoomParticipant(post, state.currentUserId, state)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 권한 없음",
          body: "방에 참여한 사람만 심판을 초대할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  if (post.refereeId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 제한",
          body: "이미 배정된 심판이 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const targetUser = state.users.find((user) => user.id === refereeId);
  const participantIds = new Set(getRecruitingRoomParticipantIds(post, state));
  const pendingRefereeInvite = roomState.invitations.some((invitation) => (
    invitation.role === "referee" &&
    invitation.targetUserId === refereeId &&
    invitation.status === "pending"
  ));
  const canInviteReferee = Boolean(
    targetUser &&
    !participantIds.has(refereeId) &&
    !pendingRefereeInvite &&
    isEligibleReferee(targetUser, post.refereeTrustMin ?? REFEREE_TRUST_MIN, state.settings?.refereeAppointments)
  );
  if (!canInviteReferee) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 초대 대상 아님",
          body: "심판 자격이 있고 아직 방에 참여하지 않은 사람만 초대할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const now = new Date().toISOString();
  const invitation = {
    id: makeId("inv"),
    role: "referee",
    targetUserId: refereeId,
    fromUserId: state.currentUserId,
    teamId: null,
    side: "teamB",
    reserve: false,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? {
            ...item,
            refereeWanted: true,
            roomState: {
              ...roomState,
              refereeWanted: true,
              invitations: [...roomState.invitations, invitation],
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "심판 초대",
        body: `${post.title} 심판 초대가 도착했습니다. 수락하면 심판으로 배정됩니다.`,
        tone: "match",
        targetUserId: refereeId,
        recruitingPostId: postId,
        invitationId: invitation.id,
        fromUserId: invitation.fromUserId,
      },
      {
        id: makeId("n"),
        title: "심판 초대 발송",
        body: `${targetUser.name}에게 심판 초대를 보냈습니다.`,
        tone: "match",
        recruitingPostId: postId,
      },
      ...state.notifications,
    ],
  };
}
