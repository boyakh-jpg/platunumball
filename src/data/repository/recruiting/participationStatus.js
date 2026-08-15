import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getUnsafeUserTextReason } from "../../../lib/inputSecurity.js";
import { isRecruitingRoomMember } from "../../../lib/recruiting.js";
import { isRecruitingRoomOwner } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState } from "../guards.js";
import { applyAutomaticRecruitingConfirmations } from "../lifecycle.js";

export function setRecruitingReady(state, postId, ready = true) {
  const disciplineBlock = getDisciplineBlockedState(state, "참가 확인 변경");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const updatedAt = new Date().toISOString();
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const currentApplicant = applicants.find((applicant) => (
    applicant.playerId === state.currentUserId || (applicant.playerIds ?? []).includes(state.currentUserId)
  ));
  const hostEntry = (lobby.entries ?? []).find((entry) => entry.id === "host");
  const hostPartyUser = !currentApplicant && (
    (hostEntry?.players ?? []).includes(state.currentUserId) ||
    (hostEntry?.reserves ?? []).includes(state.currentUserId) ||
    (post.hostJoinMode === "player" && post.playerId === state.currentUserId)
  );
  const activePlayerIds = new Set([...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers]);
  const reserveCandidate = [...lobby.sides.teamA.reserveCandidates, ...lobby.sides.teamB.reserveCandidates]
    .find((candidate) => candidate.playerId === state.currentUserId && !activePlayerIds.has(candidate.playerId));
  const nextReserveReady = { ...(roomState.reserveReady ?? {}) };
  if (reserveCandidate) {
    if (ready) nextReserveReady[state.currentUserId] = true;
    else delete nextReserveReady[state.currentUserId];
  }
  const nextRoomState = reserveCandidate
    ? { ...roomState, reserveReady: nextReserveReady }
    : roomState;

  return applyAutomaticRecruitingConfirmations({
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => {
      if (item.id !== postId) return item;
      if (hostPartyUser) {
        return { ...item, hostReady: Boolean(ready), roomState: nextRoomState };
      }
      return {
        ...item,
        roomState: nextRoomState,
        applicants: normalizeRecruitingApplicants(item.applicants ?? []).map((applicant) => (
          getRecruitingApplicantKey(applicant) === getRecruitingApplicantKey(currentApplicant)
            ? { ...applicant, status: ready ? "ready" : "waiting", updatedAt }
            : applicant
        )),
      };
    }),
  });
}
export function cancelRecruitingParticipation(state, postId) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || isRecruitingRoomOwner(post, state.currentUserId) || post.playerId === state.currentUserId) return state;
  const currentUserId = state.currentUserId;
  const removeUserFromRoomState = (roomState = {}, applicants = [], playerIds = []) => {
    const normalizedRoomState = normalizeRecruitingRoomState(roomState);
    const nextPartyReserves = Object.fromEntries(
      Object.entries(normalizedRoomState.partyReserves ?? {})
        .map(([key, ids]) => [key, ids.filter((playerId) => playerId !== currentUserId)])
        .filter(([, ids]) => ids.length),
    );
    const nextPinnedReservePlayers = Object.fromEntries(
      Object.entries(normalizedRoomState.pinnedReservePlayers ?? {})
        .map(([sideName, ids]) => [sideName, ids.filter((playerId) => playerId !== currentUserId)])
        .filter(([, ids]) => ids.length),
    );
    const nextReserveReady = { ...(normalizedRoomState.reserveReady ?? {}) };
    const nextSlotPositions = { ...(normalizedRoomState.slotPositions ?? {}) };
    const nextPartyLeaders = { ...(normalizedRoomState.partyLeaders ?? {}) };
    delete nextReserveReady[currentUserId];
    delete nextSlotPositions[currentUserId];
    Object.entries(nextPartyLeaders).forEach(([key, leaderId]) => {
      if (leaderId !== currentUserId) return;
      const applicant = applicants.find((item) => getRecruitingApplicantKey(item) === key);
      const nextLeaderId = key === "host"
        ? playerIds.find((playerId) => playerId !== currentUserId)
        : applicant?.playerId ?? applicant?.playerIds?.find((playerId) => playerId !== currentUserId) ?? "";
      if (nextLeaderId) nextPartyLeaders[key] = nextLeaderId;
      else delete nextPartyLeaders[key];
    });
    return {
      ...normalizedRoomState,
      partyReserves: nextPartyReserves,
      partyLeaders: nextPartyLeaders,
      pinnedReservePlayers: nextPinnedReservePlayers,
      reserveReady: nextReserveReady,
      slotPositions: nextSlotPositions,
      invitations: normalizedRoomState.invitations.filter((invitation) => !(
        invitation.status === "pending" && invitation.fromUserId === currentUserId
      )),
    };
  };

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => {
      if (item.id !== postId) return item;
      const applicants = normalizeRecruitingApplicants(item.applicants ?? [])
        .map((applicant) => {
          if (applicant.kind !== "team") return applicant.playerId === currentUserId ? null : applicant;
          const nextPlayerIds = (applicant.playerIds ?? []).filter((playerId) => playerId !== currentUserId);
          if (!nextPlayerIds.length) return null;
          return {
            ...applicant,
            playerIds: nextPlayerIds,
            playerId: applicant.playerId && applicant.playerId !== currentUserId ? applicant.playerId : nextPlayerIds[0],
          };
        })
        .filter(Boolean);
      const playerIds = Array.isArray(item.playerIds)
        ? item.playerIds.filter((playerId) => playerId !== currentUserId)
        : [];
      return {
        ...item,
        playerIds,
        roomState: removeUserFromRoomState(item.roomState ?? {}, applicants, playerIds),
        applicants,
      };
    }),
  };
}
export function sendRecruitingChat(state, postId, body = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "방 채팅");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  const text = String(body).trim();
  if (text.includes("\n") || text.includes("\r") || getUnsafeUserTextReason(text, { maxLength: 60 })) return state;
  if (
    !post ||
    post.status !== "open" ||
    Boolean(post.confirmedAt ?? post.confirmed_at) ||
    !text ||
    !isRecruitingRoomMember(post, state.currentUserId, state)
  ) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const message = {
    id: makeId("chat"),
    userId: state.currentUserId,
    body: text,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId
        ? { ...item, roomState: { ...roomState, chatMessages: [...roomState.chatMessages, message] } }
        : item
    )),
  };
}
