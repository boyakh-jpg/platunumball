import { MATCH_SIDES, REFEREE_TRUST_MIN } from "./constants.js";
import { isEligibleReferee } from "./matchUtils.js";
import { TIERS } from "./tier.js";
import {
  unique,
  isRecruitingPartyEntry,
  compareCandidates,
  uniqueCandidates,
  getRecruitingSideCapacity,
  getRecruitingBenchCapacity,
  isIndividualOnlyRecruitingRoom,
  getExplicitTeamPlayerIds,
  getTeamEntryPlayerIds,
  getReserveTeamPlayerIds,
  normalizeRecruitingApplicant,
  normalizeRecruitingApplicants,
  normalizeRecruitingRoomState,
  getRecruitingApplicantKey,
  normalizeRecruitingPost,
  getRecruitingTargetMmr,
  isRecruitingRoomOwner,
  isRecruitingPostForUser,
  getRecruitingEntryForUser,
} from "./recruitingPolicy.js";
export { getRecruitingListCardCounts } from "./recruitingLobbyCounts.js";

const VALID_SIDES = new Set(MATCH_SIDES);

export function hasRecruitingTeamMemberOnOtherSide(post, state, teamId, targetSide, allowedEntryId = "") {
  if (!teamId || !VALID_SIDES.has(targetSide)) return false;
  const team = (state.teams ?? []).find((item) => item.id === teamId);
  const teamMemberIds = new Set((team?.members ?? []).map((member) => member.userId).filter(Boolean));
  if (!teamMemberIds.size) return false;

  const lobby = getRecruitingLobby(post, state);
  return (lobby.entries ?? []).some((entry) => {
    if (!entry || entry.id === allowedEntryId || entry.side === targetSide) return false;
    if (entry.team?.id === teamId) return true;
    return [
      entry.playerId,
      ...(entry.players ?? []),
      ...(entry.reserves ?? []),
    ].some((playerId) => teamMemberIds.has(playerId));
  });
}

export function isRecruitingReserveLimitExceeded(post, state, sideName) {
  if (!VALID_SIDES.has(sideName)) return true;
  const lobby = getRecruitingLobby(post, state);
  return (lobby.sides[sideName]?.reserveCandidates?.length ?? 0) > getRecruitingBenchCapacity(post);
}

export function getRecruitingRoomParticipantIds(post, state) {
  const lobby = getRecruitingLobby(post, state);
  return unique([
    post.playerId,
    ...(post.playerIds ?? []),
    ...lobby.entries.flatMap((entry) => [
      entry.playerId,
      ...(entry.players ?? []),
      ...(entry.reserves ?? []),
    ]),
  ]);
}

export function currentUserCanRefereeRecruitingRoom(state, post) {
  const currentUser = state.users.find((item) => item.id === state.currentUserId);
  if (!isEligibleReferee(currentUser, post.refereeTrustMin ?? REFEREE_TRUST_MIN, state.settings?.refereeAppointments)) return false;
  return !getRecruitingRoomParticipantIds(post, state).includes(state.currentUserId);
}

export function inferSidePartyTeamIdForUser(post = {}, state = {}, sideName = "", userId = "") {
  if (!userId || !VALID_SIDES.has(sideName)) return null;
  const lobby = getRecruitingLobby(post, state);
  const matchingTeamIds = new Set(
    (lobby.sides?.[sideName]?.entries ?? [])
      .filter((entry) => isRecruitingPartyEntry(entry) && entry.team?.members?.some((member) => member.userId === userId))
      .map((entry) => entry.team?.id ?? entry.teamId)
      .filter(Boolean),
  );
  return matchingTeamIds.size === 1 ? [...matchingTeamIds][0] : null;
}

export function inferRecruitingInvitationTeamId(post = {}, state = {}, invitation = {}) {
  if (invitation.joinMode === "player") return null;
  return invitation.teamId || inferSidePartyTeamIdForUser(post, state, invitation.side, invitation.targetUserId) || null;
}

export function isRecruitingRoomMember(post = {}, userId, state = {}) {
  if (!userId) return false;
  if (isRecruitingRoomOwner(post, userId)) return true;
  if (post.refereeId === userId) return true;
  const lobby = getRecruitingLobby(post, state);
  return (lobby.entries ?? []).some((entry) => (
    (entry.players ?? []).includes(userId) ||
    (entry.reserves ?? []).includes(userId)
  ));
}

export function isRecruitingRoomParticipant(post = {}, userId, state = null) {
  if (!userId) return false;
  if (state) return isRecruitingRoomMember(post, userId, state);
  if (post.refereeId === userId) return true;
  if (post.playerId === userId || post.playerIds?.includes(userId)) return true;
  return normalizeRecruitingApplicants(post.applicants ?? []).some((applicant) => (
    applicant.playerId === userId || applicant.playerIds?.includes(userId)
  ));
}

export function isRecruitingRoomInUserSchedule(post, state, userId, teamIds = []) {
  if (!post || !userId) return false;
  if (isRecruitingPostForUser(post, userId, teamIds)) return true;
  const lobby = getRecruitingLobby(post, state);
  return Boolean(getRecruitingEntryForUser(lobby, userId));
}

export function isNationalRecruitingPost(post = {}, state = {}) {
  return getRecruitingTargetMmr(post, state) >= TIERS.find((tier) => tier.name === "Master").min;
}

function getRecruitingHostEntry(post = {}, state = {}) {
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const user = state.users?.find((item) => item.id === post.playerId) ?? null;
  const team = post.teamId ? state.teams?.find((item) => item.id === post.teamId) ?? null : null;
  const capacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const exactStoredRoster = Boolean(post.tournamentId || roomState.matchRosterProjection);
  const joinMode = post.hostJoinMode === "team" ? "team" : "player";
  const waitingForHostTeam = joinMode === "team" && !post.teamId && !post.playerIds?.length;
  if (waitingForHostTeam) return null;
  const players = joinMode === "team"
    ? (exactStoredRoster ? unique(post.playerIds ?? []).slice(0, capacity) : getTeamEntryPlayerIds(team, capacity, post.playerIds, post.playerId))
    : [post.playerId].filter(Boolean);
  const explicitReserves = joinMode === "team"
    ? (exactStoredRoster
        ? unique(roomState.partyReserves.host ?? [])
        : team
          ? getExplicitTeamPlayerIds(team, Infinity, roomState.partyReserves.host ?? [])
          : unique(roomState.partyReserves.host ?? []))
    : [];
  const reserves = joinMode === "team"
    ? unique([...(exactStoredRoster ? [] : team ? getReserveTeamPlayerIds(team) : []), ...explicitReserves])
        .filter((playerId) => !players.includes(playerId))
        .slice(0, benchCapacity)
    : [];

  return {
    id: "host",
    fixed: true,
    kind: joinMode,
    joinMode,
    side: post.hostSide ?? "teamA",
    status: post.hostReady ? "ready" : "waiting",
    reserve: exactStoredRoster && joinMode === "team" ? false : roomState.hostReserve,
    playerId: post.playerId,
    teamId: team?.id ?? post.teamId ?? null,
    user,
    team,
    players,
    reserves,
    createdAt: post.createdAt,
  };
}

function getRecruitingApplicantEntry(applicant = {}, state = {}, post = {}) {
  const normalized = normalizeRecruitingApplicant(applicant);
  if (!normalized) return null;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const capacity = getRecruitingSideCapacity(post);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const individualOnlyRoom = isIndividualOnlyRecruitingRoom(post);
  const normalizedEntry = individualOnlyRoom && normalized.kind === "team"
    ? {
        ...normalized,
        kind: "player",
        joinMode: "player",
        playerId: normalized.playerId || normalized.playerIds?.[0] || "",
        teamId: null,
        sourceTeamId: null,
        sourceEntryId: null,
        playerIds: [],
      }
    : normalized;
  if (individualOnlyRoom && !normalizedEntry.playerId) return null;
  const user = normalizedEntry.playerId ? state.users?.find((item) => item.id === normalizedEntry.playerId) ?? null : null;
  const displayTeamId = normalizedEntry.kind === "team" ? normalizedEntry.teamId : normalizedEntry.sourceTeamId;
  const team = displayTeamId ? state.teams?.find((item) => item.id === displayTeamId) ?? null : null;
  const exactStoredRoster = Boolean(post.tournamentId || roomState.matchRosterProjection);
  const players = normalizedEntry.kind === "team"
    ? (exactStoredRoster ? unique(normalizedEntry.playerIds ?? []).slice(0, capacity) : getTeamEntryPlayerIds(team, capacity, normalizedEntry.playerIds, normalizedEntry.playerId))
    : [normalizedEntry.playerId].filter(Boolean);
  const explicitReserves = normalizedEntry.kind === "team"
    ? (exactStoredRoster
        ? unique(roomState.partyReserves[getRecruitingApplicantKey(normalizedEntry)] ?? [])
        : team
          ? getExplicitTeamPlayerIds(team, Infinity, roomState.partyReserves[getRecruitingApplicantKey(normalizedEntry)] ?? [])
          : unique(roomState.partyReserves[getRecruitingApplicantKey(normalizedEntry)] ?? []))
    : [];
  const reserves = normalizedEntry.kind === "team"
    ? unique([...(exactStoredRoster ? [] : team ? getReserveTeamPlayerIds(team) : []), ...explicitReserves])
        .filter((playerId) => !players.includes(playerId))
        .slice(0, benchCapacity)
    : [];

  return {
    ...normalizedEntry,
    id: getRecruitingApplicantKey(normalizedEntry),
    user,
    team,
    players,
    reserves,
  };
}

function expandIndividualOnlyApplicant(applicant = {}, post = {}) {
  if (!isIndividualOnlyRecruitingRoom(post) || applicant.kind !== "team") return [applicant];
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const entryKey = getRecruitingApplicantKey(applicant);
  const sourcePlayers = unique([applicant.playerId, ...(applicant.playerIds ?? [])]).filter(Boolean);
  const activeIds = applicant.reserve ? [] : sourcePlayers;
  const reserveIds = unique([
    ...(applicant.reserve ? sourcePlayers : []),
    ...(roomState.partyReserves?.[entryKey] ?? []),
  ]).filter((playerId) => playerId && !activeIds.includes(playerId));
  const toPlayerApplicant = (playerId, reserve) => ({
    ...applicant,
    kind: "player",
    joinMode: "player",
    playerId,
    teamId: null,
    playerIds: [],
    reserve,
    sourceTeamId: null,
    sourceEntryId: null,
  });
  return [
    ...activeIds.map((playerId) => toPlayerApplicant(playerId, false)),
    ...reserveIds.map((playerId) => toPlayerApplicant(playerId, true)),
  ];
}

function getEmptyLobbySide(post = {}) {
  return {
    entries: [],
    reserveEntries: [],
    reserveCandidates: [],
    fillSlots: [],
    confirmationFillSlots: [],
    players: [],
    projectedPlayers: [],
    confirmationProjectedPlayers: [],
    reserves: [],
    filled: 0,
    projectedFilled: 0,
    confirmationProjectedFilled: 0,
    capacity: getRecruitingSideCapacity(post),
  };
}

function getCountOnlyLobbySide(post = {}, sideName = "teamA") {
  const compactSideName = sideName === "teamA" ? "a" : "b";
  const rawValue = post.listCounts?.[sideName] ?? post.listCounts?.[compactSideName];
  const raw = rawValue && typeof rawValue === "object" ? rawValue : {};
  const compactValues = Array.isArray(rawValue) ? rawValue : null;
  const compactCapacity = compactValues ? compactValues[3] : undefined;
  const compactFilled = compactValues ? compactValues[0] : undefined;
  const compactProjectedFilled = compactValues ? compactValues[1] : undefined;
  const compactConfirmationProjectedFilled = compactValues ? compactValues[2] : undefined;
  const capacity = Math.max(1, Number(raw.capacity ?? getRecruitingSideCapacity(post)) || getRecruitingSideCapacity(post));
  const normalizedCapacity = Math.max(1, Number(raw.capacity ?? raw.c ?? compactCapacity ?? capacity) || capacity);
  const filled = Math.max(0, Number(raw.filled ?? raw.f ?? raw.count ?? compactFilled ?? 0) || 0);
  const projectedFilled = Math.max(filled, Number(raw.projectedFilled ?? raw.p ?? compactProjectedFilled ?? filled) || 0);
  const confirmationProjectedFilled = Math.max(projectedFilled, Number(raw.confirmationProjectedFilled ?? raw.cf ?? compactConfirmationProjectedFilled ?? projectedFilled) || 0);
  return {
    ...getEmptyLobbySide(post),
    filled: Math.min(filled, normalizedCapacity),
    projectedFilled: Math.min(projectedFilled, normalizedCapacity),
    confirmationProjectedFilled: Math.min(confirmationProjectedFilled, normalizedCapacity),
    capacity: normalizedCapacity,
  };
}

function getLobbyCapacityStatus(sides) {
  return {
    full:
      sides.teamA.filled >= sides.teamA.capacity
      && sides.teamB.filled >= sides.teamB.capacity,
    projectedFull:
      sides.teamA.projectedFilled >= sides.teamA.capacity
      && sides.teamB.projectedFilled >= sides.teamB.capacity,
    confirmationProjectedFull:
      sides.teamA.confirmationProjectedFilled >= sides.teamA.capacity
      && sides.teamB.confirmationProjectedFilled >= sides.teamB.capacity,
  };
}

export function getRecruitingLobby(post = {}, state = {}) {
  const normalizedPost = normalizeRecruitingPost(post);
  const countOnlyCard = normalizedPost.listCardOnly === true &&
    normalizedPost.listCounts &&
    !normalizedPost.playerIds?.length &&
    !normalizedPost.applicants?.length;
  if (countOnlyCard) {
    const safeSides = {
      teamA: getCountOnlyLobbySide(normalizedPost, "teamA"),
      teamB: getCountOnlyLobbySide(normalizedPost, "teamB"),
    };
    const capacityStatus = getLobbyCapacityStatus(safeSides);
    return {
      entries: [],
      sides: safeSides,
      ...capacityStatus,
      ready: false,
      fillReady: true,
      confirmationFillReady: true,
      canConfirm: false,
    };
  }
  const host = getRecruitingHostEntry(normalizedPost, state);
  const applicants = normalizeRecruitingApplicants(normalizedPost.applicants ?? [])
    .flatMap((applicant) => expandIndividualOnlyApplicant(applicant, normalizedPost))
    .map((applicant) => getRecruitingApplicantEntry(applicant, state, normalizedPost))
    .filter(Boolean);
  const rawEntries = [host, ...applicants].filter(Boolean);
  const activeSeen = new Set();
  const entries = rawEntries
    .map((entry) => {
      const players = entry.reserve
        ? unique(entry.players ?? []).filter(Boolean)
        : unique(entry.players ?? []).filter((playerId) => {
            if (!playerId || activeSeen.has(playerId)) return false;
            activeSeen.add(playerId);
            return true;
          });
      return {
        ...entry,
        players,
        reserves: unique(entry.reserves ?? []).filter((playerId) => playerId && !players.includes(playerId)),
      };
    })
    .filter((entry) => (
      entry.fixed ||
      (normalizedPost.tournamentId && entry.kind === "team" && entry.teamId) ||
      entry.players.length ||
      entry.reserves.length
    ));
  const activePlayerIds = new Set(entries.filter((entry) => !entry.reserve).flatMap((entry) => entry.players));
  const reserveSeen = new Set();
  const userById = Object.fromEntries((state.users ?? []).map((user) => [user.id, user]));

  const sides = MATCH_SIDES.reduce((acc, side) => {
    const pinnedReserveIds = new Set(normalizedPost.roomState?.pinnedReservePlayers?.[side] ?? []);
    const sideEntries = entries.filter((entry) => entry.side === side && !entry.reserve);
    const reserveEntries = entries.filter((entry) => entry.side === side && entry.reserve);
    const players = unique(sideEntries.flatMap((entry) => entry.players));
    const reserveCandidates = uniqueCandidates([
      ...reserveEntries.flatMap((entry) =>
        entry.players.map((playerId) => ({
          playerId,
          user: userById[playerId],
          source: "reserve-entry",
          sourceLabel: "후보",
          entryId: entry.id,
          status: entry.status,
          side,
          pinned: pinnedReserveIds.has(playerId),
          createdAt: entry.createdAt,
        })),
      ),
      ...sideEntries.flatMap((entry) =>
        entry.reserves.map((playerId) => ({
          playerId,
          user: userById[playerId],
          source: "team-reserve",
          sourceLabel: "후보",
          entryId: entry.id,
          status: "ready",
          side,
          pinned: pinnedReserveIds.has(playerId),
          createdAt: entry.createdAt,
        })),
      ),
    ])
      .filter((candidate) => candidate.playerId && !activePlayerIds.has(candidate.playerId))
      .filter((candidate) => {
        if (reserveSeen.has(candidate.playerId)) return false;
        reserveSeen.add(candidate.playerId);
        return true;
      })
      .sort(compareCandidates);
    const fillSlots = reserveCandidates
      .filter((candidate) => candidate.status === "ready" && !candidate.pinned)
      .slice(0, Math.max(0, getRecruitingSideCapacity(normalizedPost) - players.length));
    const confirmationFillSlots = reserveCandidates
      .filter((candidate) => candidate.status === "ready")
      .slice(0, Math.max(0, getRecruitingSideCapacity(normalizedPost) - players.length));
    const fillPlayerIds = new Set(fillSlots.map((candidate) => candidate.playerId));
    const visibleReserveCandidates = reserveCandidates.filter((candidate) => !fillPlayerIds.has(candidate.playerId));
    const reserves = visibleReserveCandidates.map((candidate) => candidate.playerId);
    const projectedPlayers = unique([...players, ...fillSlots.map((candidate) => candidate.playerId)]);
    const confirmationProjectedPlayers = unique([...players, ...confirmationFillSlots.map((candidate) => candidate.playerId)]);
    acc[side] = {
      entries: sideEntries,
      reserveEntries,
      reserveCandidates: visibleReserveCandidates,
      fillSlots,
      confirmationFillSlots,
      players,
      projectedPlayers,
      confirmationProjectedPlayers,
      reserves,
      filled: players.length,
      projectedFilled: projectedPlayers.length,
      confirmationProjectedFilled: confirmationProjectedPlayers.length,
      capacity: getRecruitingSideCapacity(normalizedPost),
    };
    return acc;
  }, {});

  const safeSides = {
    teamA: sides.teamA ?? getEmptyLobbySide(normalizedPost),
    teamB: sides.teamB ?? getEmptyLobbySide(normalizedPost),
  };
  const playingEntries = entries.filter((entry) => !entry.reserve && (entry.players ?? []).length);
  const capacityStatus = getLobbyCapacityStatus(safeSides);
  const ready = playingEntries.length > 0 && playingEntries.every((entry) => entry.status === "ready");
  const fillReady = [...safeSides.teamA.fillSlots, ...safeSides.teamB.fillSlots].every((candidate) => candidate.status === "ready");
  const confirmationFillReady = [...safeSides.teamA.confirmationFillSlots, ...safeSides.teamB.confirmationFillSlots].every((candidate) => candidate.status === "ready");

  return {
    entries,
    sides: safeSides,
    ...capacityStatus,
    ready,
    fillReady,
    confirmationFillReady,
    canConfirm:
      capacityStatus.confirmationProjectedFull
      && ready
      && confirmationFillReady,
  };
}

export function getRecruitingListCardLobby(post = {}, state = {}) {
  if (!post?.listCounts) return getRecruitingLobby(post, state);
  return getRecruitingLobby({
    ...post,
    listCardOnly: true,
    playerIds: [],
    applicants: [],
  }, state);
}

export function getRecruitingBestSide(post = {}, state = {}) {
  const lobby = getRecruitingLobby(post, state);
  const benchCapacity = getRecruitingBenchCapacity(post);
  const occupancy = (side) => (
    (lobby.sides[side]?.filled ?? 0)
    + (lobby.sides[side]?.reserveCandidates?.length ?? 0)
  );
  const hasCapacity = (side) => occupancy(side) < (lobby.sides[side]?.capacity ?? 0) + benchCapacity;
  if (hasCapacity("teamA") && !hasCapacity("teamB")) return "teamA";
  if (!hasCapacity("teamA") && hasCapacity("teamB")) return "teamB";
  return occupancy("teamA") <= occupancy("teamB") ? "teamA" : "teamB";
}
