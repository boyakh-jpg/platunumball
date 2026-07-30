import { MATCH_SIDES } from "../../../lib/constants.js";
import { PLAYER_POSITIONS } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { getRecruitingApplicantKey } from "../../../lib/recruiting.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingEntryPlayerIds } from "../../../lib/recruiting.js";
import { getRecruitingHostEditReady } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSlotEditStatus } from "../../../lib/recruiting.js";
import { getSelectableTeamPlayerIds } from "../../../lib/recruiting.js";
import { getSelectedTeamPlayerIds } from "../../../lib/recruiting.js";
import { hasRecruitingTeamMemberOnOtherSide } from "../../../lib/recruiting.js";
import { isIndividualOnlyRecruitingRoom } from "../../../lib/recruiting.js";
import { isMutableRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingEntryMember } from "../../../lib/recruiting.js";
import { isRecruitingPartyEntry } from "../../../lib/recruiting.js";
import { isRecruitingReserveLimitExceeded } from "../../../lib/recruiting.js";
import { isRecruitingTeamSideLocked } from "../../../lib/recruiting.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { updateManyPinnedReservePlayers } from "../../../lib/recruiting.js";
import { updatePinnedReservePlayers } from "../../../lib/recruiting.js";
import { getDisciplineBlockedState, getPublicRoomDisciplineBlockedState, getRecruitingReserveLimitNotification } from "../guards.js";
import { getPendingScheduleChangeNotification } from "../roomRules.js";

function buildRecruitingTeamAbsorbPost(post, state, applicants, roomState, playerId, sourceTeamId, sourceEntryId = null, placement = {}, updatedAt) {
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
    : target.playerId === state.currentUserId || (target.playerIds ?? []).includes(state.currentUserId);
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
  const activeWithLeader = partyLeaderId && teamPlayerIds.has(partyLeaderId) && !occupiedPlayerIds.has(partyLeaderId)
    ? [partyLeaderId, ...requestedActiveIds.filter((playerId) => playerId !== partyLeaderId)]
    : requestedActiveIds;
  const nextPlayerIds = activeWithLeader.slice(0, capacity);
  if (!nextPlayerIds.length) return state;

  const nextPlayerSet = new Set(nextPlayerIds);
  const nextReservePlayerIds = uniquePlayerIds(roster.reservePlayerIds ?? [])
    .filter((playerId) => teamPlayerIds.has(playerId) && !occupiedPlayerIds.has(playerId) && !nextPlayerSet.has(playerId))
    .slice(0, benchCapacity);
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
  const swapInPlayerId = reserve && currentReserveIds.length >= benchCapacity
    ? currentReserveIds.find((id) => id !== playerId)
    : "";
  const swapOutPlayerId = !reserve && currentPlayerIds.length >= capacity
    ? [...currentPlayerIds].reverse().find((id) => id !== playerId)
    : "";
  const nextPlayerIds = reserve
    ? uniquePlayerIds([...currentPlayerIds.filter((id) => id !== playerId), swapInPlayerId].filter(Boolean))
    : uniquePlayerIds([...currentPlayerIds.filter((id) => id !== swapOutPlayerId), playerId]);
  const partyBecomesReserve = reserve && !entry.fixed && currentPlayerIds.length === 1 && currentPlayerIds[0] === playerId && !swapInPlayerId;
  const fixedPartyBecomesReserve = reserve && entry.fixed && currentPlayerIds.length === 1 && currentPlayerIds[0] === playerId && !swapInPlayerId;
  if ((!partyBecomesReserve && !fixedPartyBecomesReserve && !nextPlayerIds.length) || nextPlayerIds.length > capacity) return state;

  const updatedAt = new Date().toISOString();
  const baseReserveIds = currentReserveIds.filter((id) => id !== playerId && id !== swapInPlayerId);
  const nextReserveIds = partyBecomesReserve
    ? currentReserveIds.filter((id) => id !== playerId)
    : reserve
      ? uniquePlayerIds([...baseReserveIds, playerId])
      : uniquePlayerIds([...baseReserveIds, swapOutPlayerId].filter(Boolean));
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
