import { DEFAULT_RATING } from "../../../lib/constants.js";
import { MATCH_SIDES } from "../../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { currentUserCanRefereeRecruitingRoom } from "../../../lib/recruiting.js";
import { expirePendingPlayerInvitationsWhenFull } from "../../../lib/recruiting.js";
import { getExplicitInvitationTeamPlayerIds } from "../../../lib/recruiting.js";
import { getLobbyPrimaryTeamId } from "../../../lib/recruiting.js";
import { getPendingReserveInvitationCount } from "../../../lib/recruiting.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingBestSide } from "../../../lib/recruiting.js";
import { getRecruitingFit } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../../lib/recruiting.js";
import { getRecruitingRoomParticipantIds } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getTeamMemberIds } from "../../teamMappers.js";
import { hasRecruitingApplicant } from "../../../lib/recruiting.js";
import { hasRecruitingTeamMemberOnOtherSide } from "../../../lib/recruiting.js";
import { inferRecruitingInvitationTeamId } from "../../../lib/recruiting.js";
import { inferSidePartyTeamIdForUser } from "../../../lib/recruiting.js";
import { isEligibleReferee } from "../../../lib/matchUtils.js";
import { isIndividualOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { isPickupRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { isRecruitingRoomOwner } from "../../../lib/recruiting.js";
import { isRecruitingRoomParticipant } from "../../../lib/recruiting.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { isTeamOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode } from "../../../lib/constants.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { removeAcceptedRecruitingInvitations } from "../../../lib/recruiting.js";
import { updatePinnedReservePlayers } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getPublicRoomDisciplineBlockedState, getRecruitingReserveLimitNotification } from "../guards.js";
import { applyAutomaticRecruitingConfirmations } from "../lifecycle.js";
import { getPendingScheduleChangeNotification } from "../roomRules.js";
import { applyTeamOnlyRosterSummon } from "./participation.js";
import { withRecruitingPartySideConflictNotification } from "./party.js";

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
