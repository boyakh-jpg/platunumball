import { DISPUTE_WINDOW_MINUTES, MAX_RECRUITING_RESERVES_PER_SIDE, MODE_SIZES, PLAYER_POSITIONS, RECORDABLE_RESERVE_SOURCES, REFEREE_TRUST_MIN, ROOM_KINDS, STAT_ENTRY_WINDOW_MINUTES, isMercenaryTeamRole } from "./constants.js";
import { isEligibleReferee, isInstantRoom } from "./matchUtils.js";
import { getAgeGroupForUser } from "./profileSetup.js";
import { TIERS, getTierDivision } from "./tier.js";

const RECRUITING_TYPES = {
  need_player: {
    label: "매치 큐",
    shortLabel: "빈자리 대기",
    emptyTitle: "오늘 매치 큐",
    applicantKind: "player",
    actionLabel: "개인 대기",
    unitLabel: "참여",
  },
  find_team: {
    label: "매치 큐",
    shortLabel: "개인 참가",
    emptyTitle: "오늘 매치 큐",
    applicantKind: "team",
    actionLabel: "팀 대기",
    unitLabel: "참여",
  },
  need_team: {
    label: "매치 큐",
    shortLabel: "팀 참가",
    emptyTitle: "오늘 매치 큐",
    applicantKind: "team",
    actionLabel: "팀 대기",
    unitLabel: "참여",
  },
};

export const RECRUITING_JOIN_MODES = {
  player: {
    label: "개인",
    actionLabel: "개인으로 대기",
    description: "빈 슬롯 한 자리로 참여",
  },
  team: {
    label: "팀",
    actionLabel: "팀으로 대기",
    description: "선택한 팀원이 파티로 참여",
  },
};

export const MMR_RANGE_POLICIES = {
  narrow: { label: "좁게", detail: "비슷한 실력만", gap: 120, ratingScale: 1 },
  standard: { label: "보통", detail: "적당한 범위", gap: 220, ratingScale: 0.9 },
  wide: { label: "넓게", detail: "대기 풀 우선", gap: 360, ratingScale: 0.7 },
};

const RESERVE_ROLES = new Set();
const VALID_SIDES = new Set(["teamA", "teamB"]);
const VALID_APPLICATION_STATUS = new Set(["waiting", "ready", "confirmed"]);

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function getRecruitingEntryParticipantIds(entry = {}) {
  return unique([...(entry.players ?? []), ...(entry.reserves ?? [])]);
}

export function isRecruitingPartyEntry(entry = {}) {
  return entry?.kind === "team" && getRecruitingEntryParticipantIds(entry).length >= 2;
}

export function isRecruitingTeamEntry(entry = {}) {
  return entry?.kind === "team" || entry?.joinMode === "team" || Boolean(entry?.teamId);
}

export function removeAcceptedRecruitingInvitations(invitations = [], acceptedInvitation = {}, targetUserId = "") {
  if (acceptedInvitation.role === "referee") {
    return invitations.filter((candidate) => candidate.role !== "referee");
  }
  return invitations.filter((candidate) => {
    if (candidate.id === acceptedInvitation.id) return false;
    return !(
      candidate.role !== "referee" &&
      candidate.status === "pending" &&
      candidate.targetUserId === targetUserId
    );
  });
}

export function isMutableRecruitingRoom(post) {
  return Boolean(post && post.status !== "closed");
}

export function getRecruitingSlotEditStatus(post) {
  return "ready";
}

export function getRecruitingHostEditReady(post) {
  return true;
}

export function isRecruitingTeamSideLocked(post = {}) {
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const teamOnly = isTeamOnlyRecruitingRoom({ ...post, roomState });
  return Boolean(
    (post.hostJoinMode === "team" || post.teamId) &&
    (post.visibility === "private" || teamOnly)
  );
}

export function isRecruitingEntryMember(entry, playerId) {
  if (!entry || !playerId) return false;
  return (entry.players ?? []).includes(playerId) || (entry.reserves ?? []).includes(playerId);
}

export function getRecruitingEntryPlayerIds(entry, targetApplicant, post, capacity) {
  const storedPlayerIds = unique(entry.fixed ? post.playerIds : targetApplicant?.playerIds);
  return (storedPlayerIds.length ? storedPlayerIds : unique(entry.players ?? [])).slice(0, capacity);
}

export function getLobbyPrimaryTeamId(lobby, sideName) {
  return lobby.sides[sideName].entries
    .map((entry) => (entry.kind === "team" ? entry.team?.id ?? entry.teamId ?? null : null))
    .find(Boolean) ?? null;
}

export function getLobbyTeamEntry(lobby, sideName, teamId) {
  if (!teamId || !["teamA", "teamB"].includes(sideName)) return null;
  return lobby.sides?.[sideName]?.entries?.find((entry) => (
    entry.kind === "team" &&
    (entry.team?.id ?? entry.teamId) === teamId
  )) ?? null;
}

export function getLobbyEntryTeamId(entry = {}) {
  if (!isRecruitingPartyEntry(entry)) return null;
  return entry.team?.id ?? entry.teamId ?? null;
}

export function getLobbySidePlayerTeamIds(lobby, sideName) {
  return Object.fromEntries(
    lobby.sides[sideName].entries
      .flatMap((entry) => {
        const teamId = getLobbyEntryTeamId(entry);
        if (!teamId) return [];
        return (entry.players ?? []).map((playerId) => [playerId, teamId]);
      }),
  );
}

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

export function getPendingReserveInvitationCount(roomState, sideName) {
  return (roomState.invitations ?? []).filter((invitation) => (
    invitation.status === "pending" &&
    invitation.reserve &&
    invitation.side === sideName
  )).length;
}

export function updatePinnedReservePlayers(roomState = {}, sideName, playerId, reserve = true) {
  if (!VALID_SIDES.has(sideName) || !playerId) return roomState;
  const currentPinned = roomState.pinnedReservePlayers && typeof roomState.pinnedReservePlayers === "object"
    ? roomState.pinnedReservePlayers
    : {};
  const nextPinned = {};
  Array.from(VALID_SIDES).forEach((currentSideName) => {
    const ids = new Set(Array.isArray(currentPinned[currentSideName]) ? currentPinned[currentSideName] : []);
    ids.delete(playerId);
    if (reserve && currentSideName === sideName) ids.add(playerId);
    if (ids.size) nextPinned[currentSideName] = Array.from(ids);
  });
  return { ...roomState, pinnedReservePlayers: nextPinned };
}

export function updateManyPinnedReservePlayers(roomState = {}, sideName, playerIds = [], reserve = true) {
  return playerIds.reduce(
    (nextRoomState, playerId) => updatePinnedReservePlayers(nextRoomState, sideName, playerId, reserve),
    roomState,
  );
}

export function isRecruitingReserveLimitExceeded(post, state, sideName) {
  if (!VALID_SIDES.has(sideName)) return true;
  const lobby = getRecruitingLobby(post, state);
  return (lobby.sides[sideName]?.reserveCandidates?.length ?? 0) > MAX_RECRUITING_RESERVES_PER_SIDE;
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

export function getValidRecruitingRecorder(post, state, sideName, playerId) {
  if (!playerId || post.refereeId) return "";
  const lobby = getRecruitingLobby(post, state);
  const playingIds = new Set([...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers]);
  const candidate = (lobby.sides[sideName]?.reserveCandidates ?? []).find((item) => (
    item.playerId === playerId &&
    RECORDABLE_RESERVE_SOURCES.has(item.source) &&
    item.status === "ready" &&
    !playingIds.has(item.playerId)
  ));
  return candidate ? playerId : "";
}

export function getRecruitingRoomStatRecorders(post, state) {
  const lobby = getRecruitingLobby(post, state);
  const playingIds = new Set([...lobby.sides.teamA.projectedPlayers, ...lobby.sides.teamB.projectedPlayers]);
  const getRecorder = (sideName) => {
    const candidate = (lobby.sides[sideName]?.reserveCandidates ?? []).find((item) => (
      RECORDABLE_RESERVE_SOURCES.has(item.source) &&
      item.status === "ready" &&
      !playingIds.has(item.playerId)
    ));
    return candidate?.playerId ?? "";
  };
  return {
    teamA: getRecorder("teamA"),
    teamB: getRecorder("teamB"),
  };
}

export function cleanRecruitingRoomStatRecorders(post, state) {
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  return {
    ...post,
    roomState: {
      ...roomState,
      statRecorders: getRecruitingRoomStatRecorders({ ...post, roomState }, state),
    },
  };
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

export function getExplicitInvitationTeamPlayerIds(team = {}, capacity = Infinity, playerIds = [], fallbackPlayerId = "") {
  const sourceIds = Array.isArray(playerIds) ? playerIds : [fallbackPlayerId];
  const teamPlayerSet = new Set((team?.members ?? []).map((member) => member.userId));
  return unique(sourceIds).filter((playerId) => teamPlayerSet.has(playerId)).slice(0, capacity);
}

export function getRecruitingEntryLeaderId(entry = null, roomState = {}, hostPlayerId = "") {
  if (!entry) return "";
  return roomState?.partyLeaders?.[entry.id] ?? (entry.fixed ? hostPlayerId : entry.playerId) ?? "";
}

function compareCandidates(a, b) {
  const readyDiff = Number(b.status === "ready") - Number(a.status === "ready");
  if (readyDiff) return readyDiff;
  const trustDiff = Number(b.user?.trustScore ?? 0) - Number(a.user?.trustScore ?? 0);
  if (trustDiff) return trustDiff;
  return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
}

function uniqueCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.playerId || seen.has(candidate.playerId)) return false;
    seen.add(candidate.playerId);
    return true;
  });
}

export function normalizeRecruitingMmrRangeMode(mode = "narrow") {
  if (mode === "normal") return "standard";
  return MMR_RANGE_POLICIES[mode] ? mode : "narrow";
}

export function getRecruitingRatingScale(post = {}) {
  if (post.ranked === false) return 1;
  const mode = normalizeRecruitingMmrRangeMode(post.mmrRangeMode ?? post.roomState?.mmrRangeMode);
  return MMR_RANGE_POLICIES[mode].ratingScale;
}

function getRecruitingTypeMeta(type = "need_player") {
  return RECRUITING_TYPES[type] ?? RECRUITING_TYPES.need_player;
}

export function getRecruitingApplicantKind(post = {}) {
  return getRecruitingTypeMeta(post.type).applicantKind;
}

export function getRecruitingSideCapacity(post = {}) {
  const modeCapacity = MODE_SIZES[post.mode] ?? 5;
  const rawCapacity = Number(post.sideCapacity ?? modeCapacity);
  const safeCapacity = Number.isFinite(rawCapacity) ? rawCapacity : modeCapacity;
  return Math.max(1, Math.min(5, modeCapacity, safeCapacity));
}

function getRecruitingJoinMode(entry = {}) {
  if (entry.joinMode === "team" || entry.kind === "team" || entry.teamId) return "team";
  return "player";
}

export function isSoloIndividualRecruitingRoom(post = {}) {
  return getRecruitingSideCapacity(post) <= 1 && (post.hostJoinMode === "player" || !post.teamId);
}

export function isPublicTeamRecruitingRoom(post = {}) {
  return post.visibility === "public" && post.hostJoinMode === "team";
}

export function isTeamOnlyRecruitingRoom(post = {}) {
  return post.teamOnly === true || post.roomState?.teamOnly === true || isPublicTeamRecruitingRoom(post);
}

export function isTeamRecruitingRoom(post = {}) {
  return post.hostJoinMode === "team" ||
    isTeamOnlyRecruitingRoom(post) ||
    Boolean(post.teamId || post.targetTeamId);
}

export function getRoomKindFromRecruitingPost(post = {}) {
  return post.visibility === "public" ? ROOM_KINDS.publicRecruiting : ROOM_KINDS.privateInvite;
}

export function getSelectableTeamPlayerIds(team = {}) {
  return (team?.members ?? [])
    .filter((member) => !RESERVE_ROLES.has(member.role))
    .map((member) => member.userId);
}

export function getTeamEventEligibility(team = null, users = [], options = {}) {
  const capacity = Math.max(1, Math.min(5, Number(options.capacity) || 1));
  const allowedAgeGroups = Array.isArray(options.allowedAgeGroups) && options.allowedAgeGroups.length
    ? new Set(options.allowedAgeGroups)
    : null;
  const ranked = options.ranked !== false;
  const mmrLimitMode = options.mmrLimitMode ?? "block";
  const rangeMode = normalizeRecruitingMmrRangeMode(options.mmrRangeMode);
  const targetMmr = Number(options.targetMmr);
  const enforceMmr = ranked && mmrLimitMode === "block" && Number.isFinite(targetMmr);
  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const captainId = team?.members?.find((member) => member.role === "captain")?.userId ?? "";
  const memberIds = getSelectableTeamPlayerIds(team);
  const missingProfileIds = memberIds.filter((playerId) => !userById.has(playerId));
  const eligiblePlayerIds = memberIds.filter((playerId) => {
    const user = userById.get(playerId);
    if (!user) return false;
    if (allowedAgeGroups && !allowedAgeGroups.has(getAgeGroupForUser(user))) return false;
    const playerMmr = Number(user.ratings?.integrated ?? user.mmr ?? 1200);
    return !enforceMmr || isMmrInRecruitingRange(playerMmr, targetMmr, true, rangeMode);
  });
  const missingCount = Math.max(0, capacity - eligiblePlayerIds.length);
  const captainPresent = Boolean(captainId && memberIds.includes(captainId));
  const captainEligible = Boolean(captainId && eligiblePlayerIds.includes(captainId));
  const allowed = Boolean(team?.id && captainPresent && (!options.requireCaptainEligible || captainEligible) && missingCount === 0);
  const reason = !team?.id
    ? "팀이 없습니다."
    : !captainPresent
      ? "팀장이 지정되지 않았습니다."
      : options.requireCaptainEligible && !captainEligible
        ? "팀장이 연령·MMR 조건을 충족하지 않습니다."
      : missingProfileIds.length && eligiblePlayerIds.length < capacity
        ? "팀원 정보를 불러온 뒤 다시 확인하세요."
        : missingCount
          ? `조건을 충족한 선수가 ${missingCount}명 부족합니다.`
          : "참가 가능";

  return {
    allowed,
    reason,
    capacity,
    captainId,
    captainEligible,
    eligiblePlayerIds,
    eligibleCount: eligiblePlayerIds.length,
    missingCount,
    missingProfileIds,
  };
}

function getTeamPlayerIds(team = {}) {
  return (team?.members ?? []).map((member) => member.userId);
}

export function getSelectedTeamPlayerIds(team = {}, capacity = Infinity, playerIds) {
  const selectableIds = getSelectableTeamPlayerIds(team);
  if (!Array.isArray(playerIds) || !playerIds.length) return selectableIds.slice(0, capacity);
  const teamPlayerSet = new Set(getTeamPlayerIds(team));
  return unique(playerIds).filter((playerId) => teamPlayerSet.has(playerId)).slice(0, capacity);
}

function getExplicitTeamPlayerIds(team = {}, capacity = Infinity, playerIds = []) {
  if (!Array.isArray(playerIds) || !playerIds.length) return [];
  const teamPlayerSet = new Set(getTeamPlayerIds(team));
  return unique(playerIds).filter((playerId) => teamPlayerSet.has(playerId)).slice(0, capacity);
}

function getActiveTeamPlayerIds(team = {}, capacity = Infinity, playerIds) {
  return Array.isArray(playerIds)
    ? getExplicitTeamPlayerIds(team, capacity, playerIds)
    : getSelectableTeamPlayerIds(team).slice(0, capacity);
}

function getTeamEntryPlayerIds(team = null, capacity = Infinity, playerIds, fallbackPlayerId = "") {
  const hasExplicitPlayerIds = Array.isArray(playerIds);
  const activePlayerIds = team
    ? getActiveTeamPlayerIds(team, capacity, playerIds)
    : unique(playerIds ?? []).slice(0, capacity);
  if (activePlayerIds.length) return activePlayerIds;

  const teamPlayerIds = getTeamPlayerIds(team);
  const selectableIds = getSelectableTeamPlayerIds(team);
  if (fallbackPlayerId) {
    return [fallbackPlayerId].slice(0, capacity);
  }
  if (hasExplicitPlayerIds) return [];
  return selectableIds.slice(0, capacity);
}

function getReserveTeamPlayerIds(team = {}) {
  return (team?.members ?? [])
    .filter((member) => RESERVE_ROLES.has(member.role))
    .map((member) => member.userId);
}

function normalizeRecruitingApplicant(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return {
      kind: "player",
      joinMode: "player",
      playerId: entry,
      teamId: null,
      side: "teamB",
      status: "waiting",
      reserve: false,
      position: null,
      playerIds: [],
      sourceEntryId: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  const joinMode = getRecruitingJoinMode(entry);
  const kind = joinMode === "team" ? "team" : "player";
  const side = VALID_SIDES.has(entry.side) ? entry.side : "teamB";
  const status = VALID_APPLICATION_STATUS.has(entry.status) ? entry.status : "waiting";

  if (kind === "team" && entry.teamId) {
    return {
      kind,
      joinMode,
      teamId: entry.teamId,
      playerId: entry.playerId ?? null,
      side,
      status,
      reserve: Boolean(entry.reserve),
      position: entry.position ?? null,
      playerIds: unique(entry.playerIds ?? entry.players ?? []),
      createdAt: entry.createdAt ?? null,
      updatedAt: entry.updatedAt ?? null,
    };
  }
  if (entry.playerId) {
    return {
      kind,
      joinMode,
      playerId: entry.playerId,
      teamId: null,
      sourceTeamId: entry.sourceTeamId ?? entry.partyTeamId ?? null,
      sourceEntryId: entry.sourceEntryId ?? entry.partyEntryId ?? null,
      side,
      status,
      reserve: Boolean(entry.reserve),
      position: entry.position ?? null,
      playerIds: [],
      createdAt: entry.createdAt ?? null,
      updatedAt: entry.updatedAt ?? null,
    };
  }
  return null;
}

export function normalizeRecruitingApplicants(applicants = []) {
  return applicants.map(normalizeRecruitingApplicant).filter(Boolean);
}

export function normalizeRecruitingRoomState(roomState = {}) {
  roomState = roomState && typeof roomState === "object" ? roomState : {};
  const chatMessages = Array.isArray(roomState.chatMessages)
    ? roomState.chatMessages
        .map((message) => ({
          id: message.id ?? "",
          userId: message.userId ?? message.playerId ?? "",
          body: String(message.body ?? "").slice(0, 500),
          createdAt: message.createdAt ?? null,
        }))
        .filter((message) => message.userId && message.body.trim())
    : [];
  const kickLog = Array.isArray(roomState.kickLog)
    ? roomState.kickLog.map((item) => ({
        id: item.id ?? "",
        targetUserId: item.targetUserId ?? "",
        by: item.by ?? "",
        penalty: Number(item.penalty ?? 0),
        createdAt: item.createdAt ?? null,
      }))
    : [];
  const hostPenalties = Array.isArray(roomState.hostPenalties)
    ? roomState.hostPenalties.map((item) => ({
        id: item.id ?? "",
        by: item.by ?? "",
        penalty: Number(item.penalty ?? 0),
        reason: item.reason ?? "",
        createdAt: item.createdAt ?? null,
      }))
    : [];
  const invitations = Array.isArray(roomState.invitations)
    ? roomState.invitations
        .map((item) => ({
          id: item.id ?? "",
          role: item.role === "referee" ? "referee" : "player",
          targetUserId: item.targetUserId ?? item.userId ?? "",
          fromUserId: item.fromUserId ?? item.by ?? "",
          teamId: item.teamId ?? null,
          joinMode: item.joinMode === "player" ? "player" : (item.joinMode === "team" || item.teamId ? "team" : ""),
          side: VALID_SIDES.has(item.side) ? item.side : "teamB",
          reserve: Boolean(item.reserve),
          status: ["pending", "accepted", "declined", "expired"].includes(item.status) ? item.status : "pending",
          createdAt: item.createdAt ?? null,
          updatedAt: item.updatedAt ?? null,
        }))
        .filter((item) => item.id && item.targetUserId)
    : [];
  const partyReserves = roomState.partyReserves && typeof roomState.partyReserves === "object"
    ? Object.fromEntries(
        Object.entries(roomState.partyReserves)
          .map(([key, ids]) => [key, unique(Array.isArray(ids) ? ids : [])])
          .filter(([, ids]) => ids.length),
      )
    : {};
  const reserveReady = roomState.reserveReady && typeof roomState.reserveReady === "object"
    ? Object.fromEntries(Object.entries(roomState.reserveReady).filter(([playerId, ready]) => playerId && ready))
    : {};
  const pinnedReservePlayers = roomState.pinnedReservePlayers && typeof roomState.pinnedReservePlayers === "object"
    ? Object.fromEntries(
        Object.entries(roomState.pinnedReservePlayers)
          .map(([sideName, ids]) => [sideName, unique(Array.isArray(ids) ? ids : [])])
          .filter(([sideName, ids]) => VALID_SIDES.has(sideName) && ids.length),
      )
    : {};
  const slotPositions = roomState.slotPositions && typeof roomState.slotPositions === "object"
    ? Object.fromEntries(
        Object.entries(roomState.slotPositions)
          .map(([playerId, position]) => [playerId, String(position ?? "").trim()])
          .filter(([playerId, position]) => playerId && PLAYER_POSITIONS.includes(position)),
      )
    : {};

  return {
    ...roomState,
    hostReserve: Boolean(roomState.hostReserve),
    refereeWanted: Boolean(roomState.refereeWanted),
    chatMessages,
    kickLog,
    hostPenalties,
    invitations,
    partyReserves,
    reserveReady,
    pinnedReservePlayers,
    slotPositions,
  };
}

export function getRecruitingApplicantKey(entry) {
  const applicant = normalizeRecruitingApplicant(entry);
  if (!applicant) return "";
  return applicant.kind === "team" ? `team:${applicant.teamId}` : `player:${applicant.playerId}`;
}

export function hasRecruitingApplicant(post = {}, entry) {
  const key = getRecruitingApplicantKey(entry);
  if (!key) return false;
  return normalizeRecruitingApplicants(post.applicants ?? []).some((applicant) => getRecruitingApplicantKey(applicant) === key);
}

export function getPendingRecruitingInvitations(state = {}, userId) {
  if (!userId) return [];
  return (state.recruitingPosts ?? [])
    .filter((post) => post.status === "open")
    .flatMap((post) => normalizeRecruitingRoomState(post.roomState ?? {}).invitations
      .filter((invitation) => invitation.targetUserId === userId && invitation.status === "pending")
      .map((invitation) => ({ post, invitation })));
}

export function hasPendingRecruitingInvitation(post = {}, userId) {
  if (!userId || post.status !== "open") return false;
  const hasInvitationSnapshot = post.__invitationsPartial === true || Object.prototype.hasOwnProperty.call(post.roomState ?? {}, "invitations");
  const hasPendingInvitation = normalizeRecruitingRoomState(post.roomState ?? {}).invitations.some((invitation) => (
    invitation.targetUserId === userId && invitation.status === "pending"
  ));
  if (hasInvitationSnapshot) return hasPendingInvitation;
  if (Array.isArray(post.__feedRelations) && post.__feedRelations.includes("invited")) return true;
  return hasPendingInvitation;
}

export function getRecruitingRoomOwnerId(post = {}) {
  const safePost = post ?? {};
  const roomState = normalizeRecruitingRoomState(safePost.roomState ?? {});
  return safePost.ownerId || roomState.ownerId || safePost.createdBy || safePost.createdPlayerId || safePost.playerId || "";
}

export function isRecruitingRoomOwner(post = {}, userId = "") {
  return Boolean(userId && getRecruitingRoomOwnerId(post) === userId);
}

function getRoomScheduleDate(post = {}) {
  if (isInstantRoom(post)) return null;
  if (!post.scheduledDate || !post.scheduledTime) return null;
  const date = new Date(`${post.scheduledDate}T${post.scheduledTime}`);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getRoomClosePenalty(post = {}, nowMs = Date.now()) {
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const scheduled = getRoomScheduleDate(post);
  const hoursUntil = scheduled ? (scheduled.getTime() - nowMs) / 36e5 : Infinity;
  if (!applicants.length && hoursUntil > 24) return 0;

  let penalty = applicants.length ? 2 : 0;
  if (!post.hostReady) penalty += 2;
  if (hoursUntil < 0) penalty += 8;
  else if (hoursUntil <= 6) penalty += 5;
  else if (hoursUntil <= 24) penalty += 3;
  else if (hoursUntil <= 72) penalty += 1;

  const createdAt = post.createdAt ? new Date(post.createdAt).getTime() : null;
  const shortNotice = scheduled && Number.isFinite(createdAt) && (scheduled.getTime() - createdAt) / 36e5 <= 24;
  if (shortNotice) penalty = Math.max(0, penalty - 2);
  return Math.min(12, penalty);
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

export function isRecruitingPostForUser(post = {}, userId, teamIds = []) {
  if (!userId) return false;
  if (Array.isArray(post.__feedRelations) && post.__feedRelations.some((relation) => ["owner", "participant", "referee"].includes(relation))) return true;
  if (getRecruitingRoomOwnerId(post) === userId) return true;
  if (post.playerId === userId) return true;
  if (post.refereeId === userId) return true;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  if (unique(post.playerIds ?? post.players ?? []).includes(userId)) return true;
  if ((roomState.partyReserves.host ?? []).includes(userId)) return true;
  return normalizeRecruitingApplicants(post.applicants ?? []).some((applicant) => {
    if (applicant.playerId === userId) return true;
    if ((applicant.playerIds ?? []).includes(userId)) return true;
    const reserveKey = getRecruitingApplicantKey(applicant);
    return Boolean(reserveKey && (roomState.partyReserves[reserveKey] ?? []).includes(userId));
  });
}

export function getRecruitingEntryForUser(lobby = {}, userId) {
  if (!userId) return null;
  return (lobby.entries ?? []).find((entry) => (
    (entry.players ?? []).includes(userId) ||
    (entry.reserves ?? []).includes(userId)
  )) ?? null;
}

export function isRecruitingRoomInUserSchedule(post, state, userId, teamIds = []) {
  if (!post || !userId) return false;
  if (isRecruitingPostForUser(post, userId, teamIds)) return true;
  const lobby = getRecruitingLobby(post, state);
  return Boolean(getRecruitingEntryForUser(lobby, userId));
}

export function normalizeRecruitingPost(post = {}) {
  post = post && typeof post === "object" ? post : {};
  const type = RECRUITING_TYPES[post.type] ? post.type : "need_player";
  const hostJoinMode = post.hostJoinMode === "player" || !post.teamId ? "player" : "team";
  const playerIds = unique(post.playerIds ?? post.players ?? []);
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const ownerId = getRecruitingRoomOwnerId({ ...post, roomState });
  const hostPlayerId = post.playerId || ownerId;
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(post.mmrRangeMode ?? roomState.mmrRangeMode);
  const timingType = post.timingType === "instant" || roomState.timingType === "instant" || post.scheduledAt === "즉시" ? "instant" : "scheduled";
  const ruleRevision = Number(roomState.ruleRevision ?? 0);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const acceptedApplicants = applicants.map((applicant) => ({ ...applicant, status: "ready" }));
  const refereeWanted = Boolean(post.refereeWanted ?? roomState.refereeWanted ?? post.refereeId);
  return {
    ...post,
    type,
    mmrRangeMode,
    ratingScale: post.ratingScale ?? getRecruitingRatingScale({ ...post, mmrRangeMode, roomState }),
    hostJoinMode,
    hostSide: VALID_SIDES.has(post.hostSide) ? post.hostSide : "teamA",
    hostReady: true,
    sideCapacity: getRecruitingSideCapacity(post),
    ownerId,
    refereeWanted,
    refereeId: post.refereeId ?? "",
    refereeTrustMin: Number(post.refereeTrustMin ?? REFEREE_TRUST_MIN),
    statEntryMinutes: Number(post.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
    disputeMinutes: Number(post.disputeMinutes ?? DISPUTE_WINDOW_MINUTES),
    timingType,
    roomState: { ...roomState, ownerId, mmrRangeMode, timingType, refereeWanted },
    playerId: hostPlayerId,
    playerIds,
    applicants: acceptedApplicants,
  };
}

export function getRecruitingTargetMmr(post = {}, state = {}) {
  if (post.teamId) {
    return state.teams?.find((team) => team.id === post.teamId)?.mmr ?? 1200;
  }
  if (post.playerId) {
    return state.users?.find((user) => user.id === post.playerId)?.ratings?.integrated ?? 1200;
  }
  return 1200;
}

export function getRecruitingTierRange(targetMmr = 1200, ranked = true, rangeMode = "narrow") {
  if (!ranked) {
    return {
      label: "티어 자유",
      detail: "친선은 티어 제한 없이 신뢰도만 반영합니다.",
      min: 0,
      max: 9999,
    };
  }

  const mode = normalizeRecruitingMmrRangeMode(rangeMode);
  const policy = MMR_RANGE_POLICIES[mode];
  const min = Math.max(0, Math.round(Number(targetMmr) - policy.gap));
  const max = Math.round(Number(targetMmr) + policy.gap);

  return {
    label: `${policy.label} · ${min}~${max} MMR`,
    detail: `${getTierDivision(min)} ~ ${getTierDivision(max)} · MMR ${Math.round(policy.ratingScale * 100)}% 반영`,
    mode,
    min,
    max,
    ratingScale: policy.ratingScale,
  };
}

export function isMmrInRecruitingRange(candidateMmr = 1200, targetMmr = 1200, ranked = true, rangeMode = "narrow") {
  const range = getRecruitingTierRange(targetMmr, ranked, rangeMode);
  return !ranked || (candidateMmr >= range.min && candidateMmr <= range.max);
}

export function getRecruitingFit(post = {}, candidateMmr = 1200, state = {}) {
  const targetMmr = getRecruitingTargetMmr(post, state);
  const range = getRecruitingTierRange(targetMmr, post.ranked !== false, post.mmrRangeMode ?? post.roomState?.mmrRangeMode);

  if (post.ranked === false) {
    return { allowed: true, tone: "neutral", label: "친선 자유", range };
  }
  if (candidateMmr < range.min) {
    return { allowed: false, tone: "orange", label: "티어 낮음", range };
  }
  if (candidateMmr > range.max) {
    return { allowed: false, tone: "orange", label: "티어 높음", range };
  }
  return { allowed: true, tone: "green", label: "허용 구간", range };
}

export function isNationalRecruitingPost(post = {}, state = {}) {
  return getRecruitingTargetMmr(post, state) >= TIERS.find((tier) => tier.name === "Master").min;
}

function getRecruitingHostEntry(post = {}, state = {}) {
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const user = state.users?.find((item) => item.id === post.playerId) ?? null;
  const team = post.teamId ? state.teams?.find((item) => item.id === post.teamId) ?? null : null;
  const capacity = getRecruitingSideCapacity(post);
  const exactTournamentRoster = Boolean(post.tournamentId);
  const joinMode = post.hostJoinMode === "team" && (team || post.teamId || post.playerIds?.length) ? "team" : "player";
  const players = joinMode === "team"
    ? (exactTournamentRoster ? unique(post.playerIds ?? []).slice(0, capacity) : getTeamEntryPlayerIds(team, capacity, post.playerIds, post.playerId))
    : [post.playerId].filter(Boolean);
  const explicitReserves = joinMode === "team"
    ? (team ? getExplicitTeamPlayerIds(team, Infinity, roomState.partyReserves.host ?? []) : unique(roomState.partyReserves.host ?? []))
    : [];
  const reserves = joinMode === "team"
    ? unique([...(exactTournamentRoster ? [] : team ? getReserveTeamPlayerIds(team) : []), ...explicitReserves]).filter((playerId) => !players.includes(playerId))
    : [];

  return {
    id: "host",
    fixed: true,
    kind: joinMode,
    joinMode,
    side: post.hostSide ?? "teamA",
    status: post.hostReady ? "ready" : "waiting",
    reserve: roomState.hostReserve,
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
  const soloIndividualRoom = isSoloIndividualRecruitingRoom(post);
  const normalizedEntry = soloIndividualRoom && normalized.kind === "team"
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
  if (soloIndividualRoom && !normalizedEntry.playerId) return null;
  const user = normalizedEntry.playerId ? state.users?.find((item) => item.id === normalizedEntry.playerId) ?? null : null;
  const displayTeamId = normalizedEntry.kind === "team" ? normalizedEntry.teamId : normalizedEntry.sourceTeamId;
  const team = displayTeamId ? state.teams?.find((item) => item.id === displayTeamId) ?? null : null;
  const exactTournamentRoster = Boolean(post.tournamentId);
  const players = normalizedEntry.kind === "team"
    ? (exactTournamentRoster ? unique(normalizedEntry.playerIds ?? []).slice(0, capacity) : getTeamEntryPlayerIds(team, capacity, normalizedEntry.playerIds, normalizedEntry.playerId))
    : [normalizedEntry.playerId].filter(Boolean);
  const explicitReserves = normalizedEntry.kind === "team"
    ? (team ? getExplicitTeamPlayerIds(team, Infinity, roomState.partyReserves[getRecruitingApplicantKey(normalizedEntry)] ?? []) : unique(roomState.partyReserves[getRecruitingApplicantKey(normalizedEntry)] ?? []))
    : [];
  const reserves = normalizedEntry.kind === "team"
    ? unique([...(exactTournamentRoster ? [] : team ? getReserveTeamPlayerIds(team) : []), ...explicitReserves]).filter((playerId) => !players.includes(playerId))
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
    const full = safeSides.teamA.filled >= safeSides.teamA.capacity && safeSides.teamB.filled >= safeSides.teamB.capacity;
    const projectedFull =
      safeSides.teamA.projectedFilled >= safeSides.teamA.capacity &&
      safeSides.teamB.projectedFilled >= safeSides.teamB.capacity;
    const confirmationProjectedFull =
      safeSides.teamA.confirmationProjectedFilled >= safeSides.teamA.capacity &&
      safeSides.teamB.confirmationProjectedFilled >= safeSides.teamB.capacity;
    return {
      entries: [],
      sides: safeSides,
      full,
      projectedFull,
      confirmationProjectedFull,
      ready: false,
      fillReady: true,
      confirmationFillReady: true,
      canConfirm: false,
    };
  }
  const host = getRecruitingHostEntry(normalizedPost, state);
  const applicants = normalizeRecruitingApplicants(normalizedPost.applicants ?? [])
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

  const sides = ["teamA", "teamB"].reduce((acc, side) => {
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
  const full = safeSides.teamA.filled >= safeSides.teamA.capacity && safeSides.teamB.filled >= safeSides.teamB.capacity;
  const projectedFull =
    safeSides.teamA.projectedFilled >= safeSides.teamA.capacity &&
    safeSides.teamB.projectedFilled >= safeSides.teamB.capacity;
  const confirmationProjectedFull =
    safeSides.teamA.confirmationProjectedFilled >= safeSides.teamA.capacity &&
    safeSides.teamB.confirmationProjectedFilled >= safeSides.teamB.capacity;
  const ready = playingEntries.length > 0 && playingEntries.every((entry) => entry.status === "ready");
  const fillReady = [...safeSides.teamA.fillSlots, ...safeSides.teamB.fillSlots].every((candidate) => candidate.status === "ready");
  const confirmationFillReady = [...safeSides.teamA.confirmationFillSlots, ...safeSides.teamB.confirmationFillSlots].every((candidate) => candidate.status === "ready");

  return {
    entries,
    sides: safeSides,
    full,
    projectedFull,
    confirmationProjectedFull,
    ready,
    fillReady,
    confirmationFillReady,
    canConfirm: confirmationProjectedFull && ready && confirmationFillReady,
  };
}

export function getRecruitingListCardLobby(post = {}, state = {}) {
  if (post?.listCardOnly !== true || !post?.listCounts) return getRecruitingLobby(post, state);
  return getRecruitingLobby({
    ...post,
    listCardOnly: true,
    playerIds: [],
    applicants: [],
  }, state);
}

export function getRecruitingBestSide(post = {}, state = {}) {
  const lobby = getRecruitingLobby(post, state);
  return lobby.sides.teamA.projectedFilled <= lobby.sides.teamB.projectedFilled ? "teamA" : "teamB";
}

export function getMercenaryTeamWeight(memberMmr = 1200, teamMmr = 1200, role = "regular") {
  if (!isMercenaryTeamRole(role)) return 1;
  if (memberMmr <= teamMmr - 140) return 0.65;
  if (memberMmr >= teamMmr + 140) return 0.22;
  return 0.4;
}

export function getMercenaryPlayerFactor(memberMmr = 1200, teamMmr = 1200, role = "regular") {
  if (!isMercenaryTeamRole(role)) return 1;
  if (memberMmr >= teamMmr + 140) return 0.62;
  if (memberMmr <= teamMmr - 140) return 0.96;
  return 0.82;
}
