import { DEFAULT_RATING } from "../../../lib/constants.js";
import { MATCH_SIDES } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { getLobbyPrimaryTeamId } from "../../../lib/recruiting.js";
import { getPendingReserveInvitationCount } from "../../../lib/recruiting.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingFit } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { inferSidePartyTeamIdForUser } from "../../../lib/recruiting.js";
import { isIndividualOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { isPickupRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingRoomParticipant } from "../../../lib/recruiting.js";
import { isTeamOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeMmrLimitMode as normalizeRecruitingMmrLimitMode } from "../../../lib/constants.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getRecruitingReserveLimitNotification } from "../guards.js";
import { applyTeamOnlyRosterSummon } from "./participation.js";

export function inviteRecruitingPlayers(state, postId, invite = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "매칭방 초대");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  if (!isRecruitingRoomParticipant(post, state.currentUserId, state)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "초대 권한 없음",
          body: "방에 참여한 사람만 빈 슬롯이나 후보를 초대할 수 있습니다.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }

  const side = MATCH_SIDES.includes(invite.side) ? invite.side : "teamB";
  const reserve = Boolean(invite.reserve);
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const playerOnlyRoom = isIndividualOnlyRecruitingRoom(post);
  const pickupRoom = isPickupRecruitingRoom(post);
  const teamOnly = isTeamOnlyRecruitingRoom({ ...post, roomState });
  const sideTeamId = getLobbyPrimaryTeamId(lobby, side);
  const requestedTargetIds = Array.from(new Set(invite.playerIds ?? [invite.playerId])).filter(Boolean);
  if (teamOnly) {
    if (!sideTeamId) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "초대 제한",
            body: "팀으로만 참여 방은 해당 사이드가 팀으로 점유된 뒤 같은 팀원만 초대할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    const sideTeam = state.teams.find((team) => team.id === sideTeamId);
    const sideTeamMemberIds = new Set((sideTeam?.members ?? []).map((member) => member.userId));
    const inviterInSideTeam = sideTeamMemberIds.has(state.currentUserId);
    const targetsInSideTeam = requestedTargetIds.every((playerId) => sideTeamMemberIds.has(playerId));
    const inviteTeamMatches = !invite.teamId || invite.teamId === sideTeamId;
    if (!inviterInSideTeam || !targetsInSideTeam || !inviteTeamMatches) {
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "초대 제한",
            body: "팀으로만 참여 방은 해당 사이드를 점유한 팀원만 같은 팀원을 초대할 수 있습니다.",
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
    const rosterResult = applyTeamOnlyRosterSummon(state, post, roomState, lobby, side, reserve, requestedTargetIds, sideTeamId);
    if (rosterResult.handled) {
      return rosterResult.notification
        ? { ...rosterResult.state, notifications: [rosterResult.notification, ...(rosterResult.state.notifications ?? [])] }
        : rosterResult.state;
    }
  }
  const existingPlayerIds = new Set([
    post.playerId,
    ...lobby.entries.flatMap((entry) => [entry.playerId, ...(entry.players ?? []), ...(entry.reserves ?? [])]),
    ...roomState.invitations
      .filter((invitation) => invitation.status === "pending")
      .map((invitation) => invitation.targetUserId),
  ].filter(Boolean));
  const targetUserIds = requestedTargetIds
    .filter((playerId) => state.users.some((user) => user.id === playerId))
    .filter((playerId) => !existingPlayerIds.has(playerId));

  if (!targetUserIds.length) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "초대 대상 없음",
          body: "이미 방에 있거나 초대된 선수입니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const mmrLimitMode = normalizeRecruitingMmrLimitMode(post.mmrLimitMode ?? roomState.mmrLimitMode);
  if (mmrLimitMode === "block") {
    const outOfRangeUser = targetUserIds
      .map((playerId) => state.users.find((user) => user.id === playerId))
      .find((targetUser) => targetUser && !getRecruitingFit(post, targetUser.ratings?.integrated ?? DEFAULT_RATING, state).allowed);
    if (outOfRangeUser) {
      const fit = getRecruitingFit(post, outOfRangeUser.ratings?.integrated ?? DEFAULT_RATING, state);
      return {
        ...state,
        notifications: [
          {
            id: makeId("n"),
            title: "티어 구간 제한",
            body: `${outOfRangeUser.name} 선수는 ${fit.range.label} 구간 밖이라 초대할 수 없습니다.`,
            tone: "orange",
            recruitingPostId: postId,
          },
          ...state.notifications,
        ],
      };
    }
  }

  if (reserve && !pickupRoom) {
    const benchCapacity = getRecruitingBenchCapacity(post);
    const reserveCount = lobby.sides[side]?.reserveCandidates?.length ?? 0;
    const pendingReserveCount = getPendingReserveInvitationCount(roomState, side);
    if (reserveCount + pendingReserveCount + targetUserIds.length > benchCapacity) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side, benchCapacity), ...state.notifications],
      };
    }
  }

  const now = new Date().toISOString();
  const inviteJoinMode = playerOnlyRoom
    ? "player"
    : invite.joinMode === "player" ? "player" : (invite.joinMode === "team" || invite.teamId ? "team" : "");
  const invitationSide = pickupRoom ? null : side;
  const invitationReserve = pickupRoom ? false : reserve;
  const invitationContext = String(invite.contextMessage ?? "").trim();
  const newInvitations = targetUserIds.map((targetUserId) => ({
    id: makeId("inv"),
    role: "player",
    targetUserId,
    fromUserId: state.currentUserId,
    teamId: inviteJoinMode === "player" ? null : invite.teamId || inferSidePartyTeamIdForUser(post, state, side, targetUserId),
    joinMode: inviteJoinMode,
    side: invitationSide,
    reserve: invitationReserve,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }));
  const invitations = [...roomState.invitations, ...newInvitations];

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? { ...item, roomState: { ...roomState, invitations } } : item
    )),
    notifications: [
      ...newInvitations.map((invitation) => ({
        id: makeId("n"),
        title: "매치방 초대",
        body: pickupRoom
          ? [`${post.title} 통합 참가 초대장이 도착했습니다.`, invitationContext].filter(Boolean).join("\n")
          : [
              `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "빈 슬롯"} 초대장이 도착했습니다.`,
              invitationContext,
            ].filter(Boolean).join("\n"),
        tone: "match",
        targetUserId: invitation.targetUserId,
        recruitingPostId: postId,
        invitationId: invitation.id,
        fromUserId: invitation.fromUserId,
      })),
      {
        id: makeId("n"),
        title: "초대장 발송",
        body: pickupRoom
          ? `${post.title} 통합 참가에 ${targetUserIds.length}명 초대장을 보냈습니다.`
          : `${post.title} ${SIDE_LABEL_TEXT[side]} ${reserve ? "후보" : "빈 슬롯"}에 ${targetUserIds.length}명 초대장을 보냈습니다.`,
        tone: "match",
      },
      ...state.notifications,
    ],
  };
}
