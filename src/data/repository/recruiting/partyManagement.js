import { MATCH_SIDES } from "../../../lib/constants.js";
import { adjustUserTrust } from "../../trustUtils.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingEntryPlayerIds } from "../../../lib/recruiting.js";
import { getRecruitingHostEditReady } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSlotEditStatus } from "../../../lib/recruiting.js";
import { isMutableRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingEntryMember } from "../../../lib/recruiting.js";
import { isRecruitingPartyEntry } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { isRecruitingRoomOwner } from "../../../lib/recruiting.js";
import { isRecruitingTeamSideLocked } from "../../../lib/recruiting.js";
import { isTeamOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { updatePinnedReservePlayers } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getRecruitingReserveLimitNotification } from "../guards.js";

export function detachRecruitingPartyPlayer(state, postId, entryId, playerId, placement = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "파티 분리");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;
  if (isTeamOnlyRecruitingRoom(post)) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingPartyEntry(entry) || !entry?.team) return state;
  if (!isRecruitingEntryMember(entry, playerId)) return state;
  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  const canDetach = post.playerId === state.currentUserId || playerId === state.currentUserId || partyLeaderId === state.currentUserId;
  if (!canDetach) return state;

  const capacity = getRecruitingSideCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const reserveKey = entry.id;
  const currentReserveIds = roomState.partyReserves?.[reserveKey] ?? [];
  const wasActive = !entry.reserve && currentPlayerIds.includes(playerId);
  const wasReserve = Boolean(entry.reserve) || currentReserveIds.includes(playerId);
  if (!wasActive && !wasReserve) return state;
  const targetSide = MATCH_SIDES.includes(placement.side) ? placement.side : entry.side;
  const targetReserve = placement.reserve === undefined ? (!wasActive && wasReserve) : Boolean(placement.reserve);
  if (isRecruitingTeamSideLocked(post) && targetSide !== entry.side) return state;

  const nextPlayerIds = currentPlayerIds.filter((id) => id !== playerId);

  const nextReserveIds = currentReserveIds.filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    targetSide,
    playerId,
    targetReserve,
  );
  const updatedAt = new Date().toISOString();
  const movedUser = state.users.find((user) => user.id === playerId);
  const movedApplicant = {
    kind: "player",
    joinMode: "player",
    playerId,
    teamId: null,
    sourceTeamId: entry.team?.id ?? entry.teamId ?? null,
    sourceEntryId: entry.id,
    side: targetSide,
    status: getRecruitingSlotEditStatus(post),
    reserve: targetReserve,
    position: movedUser?.position ?? null,
    createdAt: updatedAt,
    updatedAt,
  };
  let nextApplicants = applicants
    .filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`)
    .map((applicant) => {
      if (getRecruitingApplicantKey(applicant) === entry.id || applicant.kind !== "team") return applicant;
      const remainingPlayerIds = uniquePlayerIds(applicant.playerIds ?? []).filter((id) => id !== playerId);
      if (!remainingPlayerIds.length) return null;
      if (remainingPlayerIds.length === (applicant.playerIds ?? []).length) return applicant;
      return {
        ...applicant,
        playerId: remainingPlayerIds.includes(applicant.playerId) ? applicant.playerId : remainingPlayerIds[0],
        playerIds: remainingPlayerIds,
        status: getRecruitingSlotEditStatus(post),
        updatedAt,
      };
    })
    .filter(Boolean);
  if (!entry.fixed) {
    nextApplicants = nextApplicants
      .map((applicant) => {
        if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
        return nextPlayerIds.length
          ? { ...applicant, playerId: nextPlayerIds[0] ?? applicant.playerId, playerIds: nextPlayerIds, status: getRecruitingSlotEditStatus(post), updatedAt }
          : null;
      })
      .filter(Boolean);
  }
  nextApplicants = [...nextApplicants, movedApplicant];

  const nextPost = entry.fixed
    ? { ...post, hostReady: getRecruitingHostEditReady(post), playerIds: nextPlayerIds, roomState: nextRoomState, applicants: nextApplicants }
    : { ...post, roomState: nextRoomState, applicants: nextApplicants };

  if (targetReserve && isRecruitingReserveLimitExceeded(nextPost, state, targetSide)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, targetSide), ...state.notifications],
    };
  }
  if (!targetReserve) {
    const nextLobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(nextLobby.sides[targetSide].entries.flatMap((item) => item.players)).size;
    if (activePlayerCount > nextLobby.sides[targetSide].capacity) return state;
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? nextPost : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "파티에서 나감",
        body: `${entry.team.name} 파티에서 빠져 개인 참여로 전환되었습니다.`,
        tone: "team",
      },
      ...(state.notifications ?? []),
    ],
  };
}

export function removeRecruitingPartyPlayer(state, postId, entryId, playerId) {
  const disciplineBlock = getDisciplineBlockedState(state, "파티 인원 제거");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId) || !entryId || !playerId) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  if (entry.fixed && playerId === post.playerId) return state;

  const capacity = getRecruitingSideCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const nextPlayerIds = currentPlayerIds.filter((id) => id !== playerId);
  const reserveKey = entry.id;
  const nextReserveIds = (roomState.partyReserves?.[reserveKey] ?? []).filter((id) => id !== playerId);
  const nextPartyReserves = { ...roomState.partyReserves, [reserveKey]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[reserveKey];
  if (entry.fixed && !nextPlayerIds.length) return state;
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    entry.side,
    playerId,
    false,
  );

  const updatedAt = new Date().toISOString();
  let nextApplicants = applicants.filter((applicant) => getRecruitingApplicantKey(applicant) !== `player:${playerId}`);
  if (!entry.fixed) {
    nextApplicants = nextApplicants
      .map((applicant) => {
        if (getRecruitingApplicantKey(applicant) !== entry.id) return applicant;
        return nextPlayerIds.length
          ? { ...applicant, playerId: nextPlayerIds[0] ?? applicant.playerId, playerIds: nextPlayerIds, status: getRecruitingSlotEditStatus(post), updatedAt }
          : null;
      })
      .filter(Boolean);
  }

  const hostKickCount = roomState.kickLog.filter((item) => item.by === state.currentUserId).length + 1;
  const hostPenalty = hostKickCount >= 3 ? 1 : 0;
  const kickLog = [
    ...roomState.kickLog,
    { id: makeId("kick"), targetUserId: playerId, by: state.currentUserId, penalty: hostPenalty, createdAt: updatedAt },
  ];
  const nextPost = entry.fixed
    ? {
        ...post,
        hostReady: getRecruitingHostEditReady(post),
        playerIds: nextPlayerIds,
        roomState: { ...nextRoomState, kickLog },
        applicants: nextApplicants,
      }
    : {
        ...post,
        roomState: { ...nextRoomState, kickLog },
        applicants: nextApplicants,
      };

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -hostPenalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? nextPost : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: hostPenalty ? "강퇴 남발 패널티" : "참가자 강퇴",
        body: hostPenalty
          ? "한 방에서 강퇴가 3회 이상 발생해 방장 신뢰도가 감소했습니다."
          : "선택한 팀원을 방에서 내보냈습니다.",
        tone: hostPenalty ? "orange" : "team",
      },
      ...state.notifications,
    ],
  };
}

export function kickRecruitingApplicant(state, postId, playerId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId) || playerId === state.currentUserId) return state;
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const target = applicants.find((applicant) => applicant.playerId === playerId);
  if (!target) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const targetSide = target.side ?? "teamB";
  const nextRoomState = updatePinnedReservePlayers(roomState, targetSide, playerId, false);
  const hostKickCount = roomState.kickLog.filter((item) => item.by === state.currentUserId).length + 1;
  const hostPenalty = hostKickCount >= 3 ? 1 : 0;
  const now = new Date().toISOString();
  const kickLog = [
    ...roomState.kickLog,
    { id: makeId("kick"), targetUserId: playerId, by: state.currentUserId, penalty: hostPenalty, createdAt: now },
  ];

  return {
    ...state,
    users: adjustUserTrust(state.users, state.currentUserId, -hostPenalty),
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? {
            ...item,
            roomState: { ...nextRoomState, kickLog },
            applicants: applicants.filter((applicant) => applicant.playerId !== playerId),
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: hostPenalty ? "강퇴 남발 패널티" : "참가자 강퇴",
        body: hostPenalty
          ? "한 방에서 강퇴가 3회 이상 발생해 방장 신뢰도가 감소했습니다."
          : "참가자를 방에서 내보냈습니다.",
        tone: hostPenalty ? "orange" : "team",
      },
      ...state.notifications,
    ],
  };
}
