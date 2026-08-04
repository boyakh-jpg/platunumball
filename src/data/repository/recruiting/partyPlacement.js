import { MATCH_SIDES } from "../../../lib/constants.js";
import { PLAYER_POSITIONS } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingHostEditReady } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingMmrBalance } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSlotEditStatus } from "../../../lib/recruiting.js";
import { getSelectedTeamPlayerIds } from "../../../lib/recruiting.js";
import { hasRecruitingTeamMemberOnOtherSide } from "../../../lib/recruiting.js";
import { isIndividualOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { isMmrBalanceTransitionAllowed } from "../../../lib/recruiting.js";
import { isMmrBalancedRecruitingRoom } from "../../../lib/recruiting.js";
import { isMutableRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingEntryMember } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { isRecruitingTeamSideLocked } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { updatePinnedReservePlayers } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getRecruitingReserveLimitNotification } from "../guards.js";

export function buildRecruitingTeamAbsorbPost(post, state, applicants, roomState, playerId, sourceTeamId, sourceEntryId = null, placement = {}, updatedAt) {
  if (!sourceTeamId || !playerId) return null;
  if (isIndividualOnlyRecruitingRoom(post)) return null;
  const side = MATCH_SIDES.includes(placement.side) ? placement.side : null;
  if (!side) return null;
  if (hasRecruitingTeamMemberOnOtherSide(post, state, sourceTeamId, side, sourceEntryId ?? "")) return null;
  const reserve = Boolean(placement.reserve);
  const team = (state.teams ?? []).find((item) => item.id === sourceTeamId && item.members.some((member) => member.userId === playerId));
  if (!team) return null;

  const capacity = getRecruitingSideCapacity(post);
  const teamKey = `team:${sourceTeamId}`;
  const hostPlayerInTeam = team.members.some((member) => member.userId === post.playerId);
  const isHostParty = post.teamId === sourceTeamId && post.hostJoinMode !== "player" && (post.hostSide ?? "teamA") === side;
  const canPromoteHostPlayerParty = post.hostJoinMode === "player" && hostPlayerInTeam && (post.hostSide ?? "teamA") === side;
  const targetApplicant = applicants.find((applicant) => getRecruitingApplicantKey(applicant) === teamKey && applicant.side === side);
  const canUseHostParty = sourceEntryId ? sourceEntryId === "host" && (isHostParty || canPromoteHostPlayerParty) : (isHostParty || canPromoteHostPlayerParty);
  const canUseTeamParty = Boolean(targetApplicant) && (!sourceEntryId || sourceEntryId === teamKey || targetApplicant.teamId === sourceTeamId);
  if (!canUseHostParty && !canUseTeamParty) return null;

  const currentPlayerIds = canUseHostParty
    ? canPromoteHostPlayerParty
      ? [post.playerId].filter(Boolean)
      : getSelectedTeamPlayerIds(team, capacity, post.playerIds)
    : getSelectedTeamPlayerIds(team, capacity, targetApplicant.playerIds);
  const nextPlayerIds = reserve
    ? currentPlayerIds.filter((id) => id !== playerId)
    : Array.from(new Set([...currentPlayerIds, playerId])).slice(0, capacity);
  if (!reserve && !nextPlayerIds.includes(playerId)) return null;

  const reserveKey = canUseHostParty ? "host" : teamKey;
  const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
  const nextReserveIds = reserve
    ? Array.from(new Set([...currentReserveIds, playerId]))
    : currentReserveIds.filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    side,
    playerId,
    reserve,
  );
  const nextApplicants = applicants
    .filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`)
    .map((applicant) => (
      !canUseHostParty && getRecruitingApplicantKey(applicant) === teamKey
        ? {
            ...applicant,
            reserve: reserve ? applicant.reserve : false,
            status: getRecruitingSlotEditStatus(post),
            playerIds: reserve ? currentPlayerIds : nextPlayerIds,
            updatedAt,
          }
        : applicant
    ));

  return canUseHostParty
    ? {
        ...post,
        teamId: sourceTeamId,
        hostJoinMode: "team",
        hostReady: getRecruitingHostEditReady(post),
        playerIds: reserve ? currentPlayerIds : nextPlayerIds,
        roomState: nextRoomState,
        applicants: nextApplicants,
      }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };
}
function getRecruitingPartySideConflictNotification(postId, sideName = "") {
  return {
    id: makeId("n"),
    title: "팀 파티 합류 불가",
    body: `같은 팀 파티는 한 사이드에서만 묶을 수 있습니다. ${SIDE_LABEL_TEXT[sideName] ?? "다른 사이드"}로 가려면 먼저 파티에서 나가야 합니다.`,
    tone: "orange",
    recruitingPostId: postId,
  };
}
export function withRecruitingPartySideConflictNotification(state, postId, sideName = "") {
  return {
    ...state,
    notifications: [
      getRecruitingPartySideConflictNotification(postId, sideName),
      ...(state.notifications ?? []),
    ],
  };
}
export function setRecruitingApplicantPlacement(state, postId, playerId, placement = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "매칭방 배치");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = applicants.find((applicant) => getRecruitingApplicantKey(applicant) === `player:${playerId}`);
  const hostTarget = playerId === post.playerId;
  const hostSide = post.hostSide ?? "teamA";
  const target = targetApplicant ?? (hostTarget
    ? { side: hostSide, reserve: roomState.hostReserve }
    : null);
  if (!target) return state;
  const requesterControlsTarget = hostTarget
    ? post.playerId === state.currentUserId
    : post.playerId === state.currentUserId || target.playerId === state.currentUserId || (target.playerIds ?? []).includes(state.currentUserId);
  if (!requesterControlsTarget) return state;

  const explicitRequestedSide = MATCH_SIDES.includes(placement.side) ? placement.side : null;
  if (hostTarget && explicitRequestedSide && explicitRequestedSide !== hostSide) return state;
  const requestedSide = explicitRequestedSide ?? target.side;
  const side = hostTarget ? hostSide : requestedSide;
  const reserve = Boolean(placement.reserve);
  if (!hostTarget && isRecruitingTeamSideLocked(post) && side !== target.side) return state;
  const updatedAt = new Date().toISOString();
  const nextApplicants = hostTarget
    ? applicants
    : applicants.map((applicant) => (
      getRecruitingApplicantKey(applicant) === getRecruitingApplicantKey(targetApplicant)
        ? { ...applicant, side, reserve, status: getRecruitingSlotEditStatus(post), updatedAt }
        : applicant
    ));
  const nextRoomState = updatePinnedReservePlayers(roomState, side, playerId, reserve);
  const nextPost = hostTarget
    ? {
      ...post,
      hostSide: side,
      hostReady: getRecruitingHostEditReady(post),
      roomState: { ...nextRoomState, hostReserve: reserve },
      applicants: nextApplicants,
    }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };

  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  if (!reserve) {
    const lobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(lobby.sides[side].entries.flatMap((entry) => entry.players)).size;
    if (activePlayerCount > lobby.sides[side].capacity) return state;
  }

  if (isMmrBalancedRecruitingRoom(post)) {
    const userById = Object.fromEntries((state.users ?? []).map((user) => [user.id, user]));
    const currentBalance = getRecruitingMmrBalance(post, getRecruitingLobby(post, state), userById);
    const nextBalance = getRecruitingMmrBalance(nextPost, getRecruitingLobby(nextPost, state), userById);
    if (!isMmrBalanceTransitionAllowed(currentBalance, nextBalance)) {
      return {
        ...state,
        notifications: [{
          id: makeId("n"),
          title: "MMR 균형 이동 불가",
          body: `평균 차이와 사이드 내부 MMR 폭은 ${nextBalance.limit} 이하여야 합니다.`,
          tone: "orange",
          recruitingPostId: postId,
        }, ...state.notifications],
      };
    }
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? nextPost : item
    )),
  };
}
export function setRecruitingApplicantReserve(state, postId, playerId, reserve = true) {
  return setRecruitingApplicantPlacement(state, postId, playerId, { reserve });
}
export function setRecruitingSlotPosition(state, postId, playerId, position = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "포지션 변경");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !playerId || playerId !== state.currentUserId) return state;

  const lobby = getRecruitingLobby(post, state);
  const isRoomMember = (lobby.entries ?? []).some((entry) => isRecruitingEntryMember(entry, playerId));
  if (!isRoomMember) return state;

  const normalizedPosition = PLAYER_POSITIONS.includes(position) ? position : "";
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const nextSlotPositions = { ...(roomState.slotPositions ?? {}) };
  if (normalizedPosition) nextSlotPositions[playerId] = normalizedPosition;
  else delete nextSlotPositions[playerId];

  const nextRoomState = { ...roomState, slotPositions: nextSlotPositions };
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? { ...item, roomState: nextRoomState } : item
    )),
  };
}
