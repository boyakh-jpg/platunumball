import { MATCH_SIDES } from "../../../lib/constants.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { hasRecruitingTeamMemberOnOtherSide } from "../../../lib/recruiting.js";
import { isIndividualOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { isMutableRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingPartyEntry } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { updateManyPinnedReservePlayers } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getPublicRoomDisciplineBlockedState, getRecruitingReserveLimitNotification } from "../guards.js";
import { getPendingScheduleChangeNotification } from "../roomRules.js";
import { buildRecruitingTeamAbsorbPost, withRecruitingPartySideConflictNotification } from "./partyPlacement.js";
import { setRecruitingPartyPlayerReserve } from "./partyRoster.js";

export function joinRecruitingSideParty(state, postId, teamId, sideName = "", entryId = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "팀 파티 합류");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !teamId) return state;
  if (isRoomScheduleChangePending(post)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications] };
  }
  const publicRoomDisciplineBlock = getPublicRoomDisciplineBlockedState(state, post);
  if (publicRoomDisciplineBlock) return publicRoomDisciplineBlock;
  if (isIndividualOnlyRecruitingRoom(post)) return state;

  const team = state.teams.find((item) => item.id === teamId && item.members.some((member) => member.userId === state.currentUserId));
  if (!team) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const currentApplicant = applicants.find((applicant) => (
    applicant.kind === "player" &&
    applicant.playerId === state.currentUserId &&
    team.members.some((member) => member.userId === applicant.playerId)
  ));
  const lobby = getRecruitingLobby(post, state);
  const teamMemberIds = new Set((team.members ?? []).map((member) => member.userId));
  const requestedSide = MATCH_SIDES.includes(sideName) ? sideName : "";
  const joinableSide = requestedSide || MATCH_SIDES.find((candidateSide) => (
    (lobby.sides[candidateSide]?.entries ?? []).some((entry) => (
      entry.team?.id === teamId ||
      (entry.kind === "player" && teamMemberIds.has(entry.playerId))
    ))
  ));
  if (!currentApplicant && !joinableSide) return state;

  const side = joinableSide || currentApplicant.side;
  if (hasRecruitingTeamMemberOnOtherSide(post, state, teamId, side, entryId)) {
    return withRecruitingPartySideConflictNotification(state, postId, side);
  }
  const sideEntries = lobby.sides[side]?.entries ?? [];
  const targetEntry = entryId
    ? sideEntries.find((entry) => entry.id === entryId)
    : sideEntries.find((entry) => entry.fixed && entry.team?.id === teamId) ?? null;
  const targetEntryIsSameTeamPlayer = Boolean(
    (
      targetEntry?.kind === "player" &&
      targetEntry.playerId &&
      teamMemberIds.has(targetEntry.playerId)
    ) ||
    (targetEntry?.fixed && targetEntry.team?.id === teamId),
  );
  const partyEntries = sideEntries.filter((entry) => (
    entry.team?.id === teamId &&
    isRecruitingPartyEntry(entry)
  ));
  const partyEntry = partyEntries.find((entry) => entry.id === entryId) ?? partyEntries[0] ?? null;
  const updatedAt = new Date().toISOString();
  const capacity = getRecruitingSideCapacity(post);
  const sideProjectedFilled = lobby.sides[side]?.projectedFilled ?? 0;
  const currentUserReserve = currentApplicant
    ? Boolean(currentApplicant.reserve && sideProjectedFilled >= capacity)
    : sideProjectedFilled >= capacity;

  if (partyEntry) {
    if ((partyEntry.reserves ?? []).includes(state.currentUserId)) {
      return setRecruitingPartyPlayerReserve(state, postId, partyEntry.id, state.currentUserId, false);
    }
    const absorbedPost = buildRecruitingTeamAbsorbPost(
      post,
      state,
      applicants,
      roomState,
      state.currentUserId,
      teamId,
      partyEntry.id,
      { side, reserve: currentUserReserve },
      updatedAt,
    );
    if (!absorbedPost) return state;
    const nextLobby = getRecruitingLobby(absorbedPost, state);
    if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
    if (isRecruitingReserveLimitExceeded(absorbedPost, state, side)) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
      };
    }
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? absorbedPost : item
      )),
    };
  }

  if (targetEntry?.fixed && targetEntryIsSameTeamPlayer) {
    const absorbedPost = buildRecruitingTeamAbsorbPost(
      post,
      state,
      applicants,
      roomState,
      state.currentUserId,
      teamId,
      targetEntry.id,
      { side, reserve: currentUserReserve },
      updatedAt,
    );
    if (!absorbedPost) return state;
    const nextLobby = getRecruitingLobby(absorbedPost, state);
    if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
    if (isRecruitingReserveLimitExceeded(absorbedPost, state, side)) {
      return {
        ...state,
        notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
      };
    }
    return {
      ...state,
      recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
        item.id === postId ? absorbedPost : item
      )),
    };
  }

  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const mergeApplicants = currentApplicant
    ? applicants
    : [
        ...applicants,
        {
          kind: "player",
          joinMode: "player",
          playerId: state.currentUserId,
          teamId: null,
          side,
          status: "ready",
          reserve: currentUserReserve,
          position: currentUser?.position ?? null,
          createdAt: updatedAt,
          updatedAt,
        },
      ];
  const sameTeamApplicants = mergeApplicants.filter((applicant) => (
    applicant.kind === "player" &&
    applicant.side === side &&
    team.members.some((member) => member.userId === applicant.playerId)
  ));
  if (sameTeamApplicants.length < 2) return state;

  const activePlayerIds = sameTeamApplicants
    .filter((applicant) => !applicant.reserve)
    .map((applicant) => applicant.playerId)
    .slice(0, capacity);
  if (!activePlayerIds.length) return state;

  const reservePlayerIds = sameTeamApplicants
    .filter((applicant) => applicant.reserve || !activePlayerIds.includes(applicant.playerId))
    .map((applicant) => applicant.playerId);
  const teamKey = `team:${teamId}`;
  const nextPartyReserves = { ...roomState.partyReserves, [teamKey]: Array.from(new Set(reservePlayerIds)) };
  if (!nextPartyReserves[teamKey].length) delete nextPartyReserves[teamKey];
  const sameTeamPlayerSet = new Set(sameTeamApplicants.map((applicant) => applicant.playerId));
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers({ ...roomState, partyReserves: nextPartyReserves }, side, activePlayerIds, false),
    side,
    reservePlayerIds,
    true,
  );
  const nextApplicant = {
    kind: "team",
    joinMode: "team",
    teamId,
    playerId: activePlayerIds[0],
    side,
    status: "ready",
    reserve: false,
    position: null,
    playerIds: activePlayerIds,
    createdAt: updatedAt,
    updatedAt,
  };
  const nextPost = {
    ...post,
    applicants: [
      ...mergeApplicants.filter((applicant) => !sameTeamPlayerSet.has(applicant.playerId)),
      nextApplicant,
    ],
    roomState: nextRoomState,
  };
  const nextLobby = getRecruitingLobby(nextPost, state);
  if (nextLobby.sides[side].projectedFilled > nextLobby.sides[side].capacity) return state;
  if (isRecruitingReserveLimitExceeded(nextPost, state, side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, side), ...state.notifications],
    };
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? nextPost : item
    )),
  };
}
