import { MATCH_SIDES } from "../../../lib/constants.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingEntryPlayerIds } from "../../../lib/recruiting.js";
import { getRecruitingHostEditReady } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSlotEditStatus } from "../../../lib/recruiting.js";
import { getSelectableTeamPlayerIds } from "../../../lib/recruiting.js";
import { hasRecruitingTeamMemberOnOtherSide } from "../../../lib/recruiting.js";
import { isIndividualOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { isMutableRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingEntryMember } from "../../../lib/recruiting.js";
import { isRecruitingPartyEntry } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { updateManyPinnedReservePlayers } from "../../../lib/recruiting.js";
import { updatePinnedReservePlayers } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getRecruitingReserveLimitNotification } from "../guards.js";
import { withRecruitingPartySideConflictNotification } from "./partyPlacement.js";

export function setRecruitingTeamPartyRoster(state, postId, entryId, roster = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "팀 파티 명단 조정");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId) return state;
  if (isIndividualOnlyRecruitingRoom(post)) return state;

  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (entry?.kind !== "team" || !entry.team) return state;

  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  if (partyLeaderId !== state.currentUserId) return state;
  if (hasRecruitingTeamMemberOnOtherSide(post, state, entry.team.id, entry.side, entry.id)) {
    return withRecruitingPartySideConflictNotification(state, postId, entry.side);
  }

  const capacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const teamPlayerIds = new Set(getSelectableTeamPlayerIds(entry.team));
  const occupiedPlayerIds = new Set(
    (lobby.entries ?? [])
      .filter((item) => item.id !== entry.id)
      .flatMap((item) => [item.playerId, ...(item.players ?? []), ...(item.reserves ?? [])])
      .filter(Boolean),
  );
  const requestedActiveIds = uniquePlayerIds(roster.playerIds ?? [])
    .filter((playerId) => teamPlayerIds.has(playerId) && !occupiedPlayerIds.has(playerId));
  const nextPlayerIds = requestedActiveIds.slice(0, capacity);
  if (!nextPlayerIds.length) return state;

  const nextPlayerSet = new Set(nextPlayerIds);
  const nextReservePlayerIds = uniquePlayerIds(roster.reservePlayerIds ?? [])
    .filter((playerId) => teamPlayerIds.has(playerId) && !occupiedPlayerIds.has(playerId) && !nextPlayerSet.has(playerId))
    .slice(0, benchCapacity);
  if (partyLeaderId && !nextPlayerSet.has(partyLeaderId) && !nextReservePlayerIds.includes(partyLeaderId)) return state;
  const nextPartyReserves = { ...roomState.partyReserves, [entry.id]: nextReservePlayerIds };
  if (!nextReservePlayerIds.length) delete nextPartyReserves[entry.id];
  const nextRoomState = updateManyPinnedReservePlayers(
    updateManyPinnedReservePlayers({ ...roomState, partyReserves: nextPartyReserves }, entry.side, nextPlayerIds, false),
    entry.side,
    nextReservePlayerIds,
    true,
  );
  const updatedAt = new Date().toISOString();
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const nextPost = entry.fixed
    ? { ...post, hostReady: getRecruitingHostEditReady(post), playerIds: nextPlayerIds, roomState: nextRoomState }
    : {
        ...post,
        roomState: nextRoomState,
        applicants: applicants.map((applicant) => (
          getRecruitingApplicantKey(applicant) === entry.id
            ? {
                ...applicant,
                playerId: partyLeaderId,
                reserve: false,
                status: post.visibility === "private" && post.hostJoinMode === "team" && entry.side === "teamB"
                  ? "ready"
                  : getRecruitingSlotEditStatus(post),
                playerIds: nextPlayerIds,
                updatedAt,
              }
            : applicant
        )),
      };

  const nextLobby = getRecruitingLobby(nextPost, state);
  if (nextLobby.sides[entry.side].projectedFilled > nextLobby.sides[entry.side].capacity) return state;
  if (isRecruitingReserveLimitExceeded(nextPost, state, entry.side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, entry.side, benchCapacity), ...state.notifications],
    };
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? nextPost : item
    )),
  };
}
export function setRecruitingPartyPlayerReserve(state, postId, entryId, playerId, reserve = true) {
  const disciplineBlock = getDisciplineBlockedState(state, "파티 예비 조정");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});

  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  if (partyLeaderId !== state.currentUserId && playerId !== state.currentUserId) return state;

  const capacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  const currentPlayerIds = getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity);
  const currentReserveIds = uniquePlayerIds(roomState.partyReserves?.[entry.id] ?? []);
  if (!reserve && currentPlayerIds.includes(playerId)) return state;
  if (reserve && currentReserveIds.includes(playerId) && !currentPlayerIds.includes(playerId)) return state;
  if (reserve && currentReserveIds.length >= benchCapacity) return state;
  if (!reserve && currentPlayerIds.length >= capacity) return state;
  const activeWithoutPlayer = currentPlayerIds.filter((id) => id !== playerId);
  const reserveWithoutPlayer = currentReserveIds.filter((id) => id !== playerId);
  const nextPlayerIds = reserve
    ? activeWithoutPlayer
    : uniquePlayerIds([...activeWithoutPlayer, playerId]);
  const partyBecomesReserve = reserve && !entry.fixed && activeWithoutPlayer.length === 0;
  const fixedPartyBecomesReserve = reserve && entry.fixed && activeWithoutPlayer.length === 0;
  if ((!partyBecomesReserve && !fixedPartyBecomesReserve && !nextPlayerIds.length) || nextPlayerIds.length > capacity) return state;

  const updatedAt = new Date().toISOString();
  const nextReserveIds = partyBecomesReserve
    ? reserveWithoutPlayer
    : reserve
      ? uniquePlayerIds([...reserveWithoutPlayer, playerId])
      : reserveWithoutPlayer;
  if (nextReserveIds.length > benchCapacity) return state;
  const nextPartyReserves = { ...roomState.partyReserves, [entry.id]: nextReserveIds };
  if (!nextReserveIds.length) delete nextPartyReserves[entry.id];
  const nextRoomState = updatePinnedReservePlayers(
    { ...roomState, partyReserves: nextPartyReserves },
    entry.side,
    playerId,
    reserve,
  );
  const nextPost = entry.fixed
    ? { ...post, hostReady: getRecruitingHostEditReady(post), playerIds: nextPlayerIds, roomState: nextRoomState }
    : {
      ...post,
      roomState: nextRoomState,
      applicants: applicants.map((applicant) => (
        getRecruitingApplicantKey(applicant) === entry.id
          ? {
              ...applicant,
              reserve: partyBecomesReserve ? true : false,
              playerIds: partyBecomesReserve ? currentPlayerIds : nextPlayerIds,
              status: getRecruitingSlotEditStatus(post),
              updatedAt,
            }
          : applicant
      )),
    };

  if (reserve && isRecruitingReserveLimitExceeded(nextPost, state, entry.side)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, entry.side), ...state.notifications],
    };
  }

  if (!reserve) {
    const nextLobby = getRecruitingLobby(nextPost, state);
    const activePlayerCount = new Set(nextLobby.sides[entry.side].entries.flatMap((item) => item.players)).size;
    if (activePlayerCount > nextLobby.sides[entry.side].capacity) return state;
  }

  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (
      item.id === postId ? nextPost : item
    )),
  };
}
export function setRecruitingPartyPlayerPlacement(state, postId, entryId, playerId, placement = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "파티 배치");
  if (disciplineBlock) return disciplineBlock;
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!isMutableRecruitingRoom(post) || !entryId || !playerId) return state;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});

  const lobby = getRecruitingLobby(post, state);
  const entry = (lobby.entries ?? []).find((item) => item.id === entryId);
  if (!isRecruitingPartyEntry(entry) || !entry?.team || !isRecruitingEntryMember(entry, playerId)) return state;
  const partyLeaderId = roomState.partyLeaders?.[entryId] ?? (entry.fixed ? post.playerId : entry.playerId) ?? "";
  if (partyLeaderId !== state.currentUserId && playerId !== state.currentUserId) return state;

  const side = MATCH_SIDES.includes(placement.side) ? placement.side : entry.side;
  const reserve = Boolean(placement.reserve);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const targetApplicant = entry.fixed
    ? null
    : applicants.find((applicant) => getRecruitingApplicantKey(applicant) === entry.id);
  if (!entry.fixed && !targetApplicant) return state;

  if (side !== entry.side) return state;
  return setRecruitingPartyPlayerReserve(state, postId, entryId, playerId, reserve);
}
