
import { DEFAULT_RATING, DISPUTE_WINDOW_MINUTES, MATCH_SIDES, MODE_SIZES, PLAYER_POSITIONS, REFEREE_TRUST_MIN, ROOM_KINDS, STAT_ENTRY_WINDOW_MINUTES, isMercenaryTeamRole, normalizeBenchCapacity } from "./constants.js";
import { normalizeCourtOptionalBoolean } from "./courtPolicy.js";
import { isEligibleReferee, isInstantRoom } from "./matchUtils.js";
import { getAgeGroupForUser } from "./profileSetup.js";
import { TIERS, getTierDivision } from "./tier.js";

export const SYNTHETIC_MATCH_ROOM_PREFIX = "match-room-";
const FREE_RECRUITING_COURT_FEE_VALUES = new Set(["0", "0원", "무료", "free", "없음"]);

export function isSyntheticMatchRoomId(roomId = "") {
  return String(roomId ?? "").startsWith(SYNTHETIC_MATCH_ROOM_PREFIX);
}

export function isPaidRecruitingCourt(post = {}, court = null) {
  const postPaid = normalizeCourtOptionalBoolean(post.courtPaid ?? post.court_paid);
  const courtPaid = normalizeCourtOptionalBoolean(court?.paid);
  if (postPaid === true || courtPaid === true) return true;

  const courtFee = String(post.courtFee ?? post.court_fee ?? "").trim().toLowerCase();
  return Boolean(courtFee && !FREE_RECRUITING_COURT_FEE_VALUES.has(courtFee));
}

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
  narrow: { label: "좁게", detail: "비슷한 실력만", gap: 120 },
  normal: { label: "보통", detail: "적당한 범위", gap: 220 },
  wide: { label: "넓게", detail: "대기 풀 우선", gap: 360 },
};

const RESERVE_ROLES = new Set();
const VALID_SIDES = new Set(MATCH_SIDES);
export const RECRUITING_APPLICATION_STATUSES = Object.freeze(["waiting", "ready", "confirmed"]);
const VALID_APPLICATION_STATUS = new Set(RECRUITING_APPLICATION_STATUSES);

export function normalizeRecruitingApplicationStatus(value = "") {
  return VALID_APPLICATION_STATUS.has(value) ? value : "waiting";
}

export function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

export function getRecruitingEntryParticipantIds(entry = {}) {
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

export function expirePendingPlayerInvitationsWhenFull(
  invitations = [],
  { occupiedCount = 0, capacity = 0, now = new Date().toISOString() } = {},
) {
  if (capacity <= 0 || occupiedCount < capacity) return invitations;
  return invitations.map((candidate) => (
    candidate.role !== "referee" && candidate.status === "pending"
      ? { ...candidate, status: "expired", updatedAt: now }
      : candidate
  ));
}

export function isMutableRecruitingRoom(post) {
  return Boolean(post && !getRecruitingPostTerminalState(post));
}

export function getRecruitingPostTerminalState(post = {}) {
  if (!post || post.confirmedAt) return null;
  const status = String(post.status ?? post.roomState?.status ?? "").trim().toLowerCase();
  const cancellationReason = String(post.roomState?.cancellationReason ?? "").trim();

  if (status === "closed") {
    return { label: "취소됨", tone: "neutral", detail: "방장이 취소한 방입니다." };
  }
  if (["cancelled", "canceled"].includes(status)) {
    if (cancellationReason === "instant_expired") {
      return { label: "자동 취소됨", tone: "neutral", detail: "즉시방 운영 시간이 지나 자동 취소됐습니다." };
    }
    if (cancellationReason === "scheduled_underfilled") {
      return { label: "자동 취소됨", tone: "neutral", detail: "시작 시각까지 정원이 차지 않아 자동 취소됐습니다." };
    }
    return { label: "취소됨", tone: "neutral", detail: "취소된 방입니다." };
  }
  if (status === "expired") {
    return { label: "만료됨", tone: "neutral", detail: "운영 시간이 끝난 방입니다." };
  }
  return null;
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
  if (!teamId || !MATCH_SIDES.includes(sideName)) return null;
  return lobby.sides?.[sideName]?.entries?.find((entry) => (
    entry.kind === "team" &&
    (entry.team?.id ?? entry.teamId) === teamId
  )) ?? null;
}

export function getLobbyEntryTeamId(entry = {}) {
  if (!isRecruitingTeamEntry(entry)) return null;
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






export function getExplicitInvitationTeamPlayerIds(team = {}, capacity = Infinity, playerIds = [], fallbackPlayerId = "") {
  const sourceIds = Array.isArray(playerIds) ? playerIds : [fallbackPlayerId];
  const teamPlayerSet = new Set((team?.members ?? []).map((member) => member.userId));
  return unique(sourceIds).filter((playerId) => teamPlayerSet.has(playerId)).slice(0, capacity);
}

export function getRecruitingEntryLeaderId(entry = null, roomState = {}, hostPlayerId = "") {
  if (!entry) return "";
  return roomState?.partyLeaders?.[entry.id] ?? (entry.fixed ? hostPlayerId : entry.playerId) ?? "";
}

export function compareCandidates(a, b) {
  const readyDiff = Number(b.status === "ready") - Number(a.status === "ready");
  if (readyDiff) return readyDiff;
  const trustDiff = Number(b.user?.trustScore ?? 0) - Number(a.user?.trustScore ?? 0);
  if (trustDiff) return trustDiff;
  return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
}

export function uniqueCandidates(candidates = []) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.playerId || seen.has(candidate.playerId)) return false;
    seen.add(candidate.playerId);
    return true;
  });
}

export function normalizeRecruitingMmrRangeMode(mode = "narrow") {
  if (mode === "standard") return "normal";
  return MMR_RANGE_POLICIES[mode] ? mode : "narrow";
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

export function getRecruitingBenchCapacity(post = {}) {
  return normalizeBenchCapacity(post.benchCapacity ?? post.bench_capacity ?? post.rules?.benchCapacity);
}

function getRecruitingJoinMode(entry = {}) {
  if (entry.joinMode === "team" || entry.kind === "team" || entry.teamId) return "team";
  return "player";
}

export function isSoloIndividualRecruitingRoom(post = {}) {
  return getRecruitingSideCapacity(post) <= 1 && (post.hostJoinMode === "player" || !post.teamId);
}

export function isPickupRecruitingRoom(post = {}) {
  return (post.formationMode ?? post.rules?.formationMode) === "pickup"
    || (post.matchIntent ?? post.rules?.matchIntent) === "pickup";
}

export function isIndividualOnlyRecruitingRoom(post = {}) {
  return isPickupRecruitingRoom(post) || isSoloIndividualRecruitingRoom(post);
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
    const playerMmr = Number(user.ratings?.integrated ?? user.mmr ?? DEFAULT_RATING);
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
        ? "팀원 정보를 불러온 뒤 다시 확인해 주세요."
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

export function getExplicitTeamPlayerIds(team = {}, capacity = Infinity, playerIds = []) {
  if (!Array.isArray(playerIds) || !playerIds.length) return [];
  const teamPlayerSet = new Set(getTeamPlayerIds(team));
  return unique(playerIds).filter((playerId) => teamPlayerSet.has(playerId)).slice(0, capacity);
}

function getActiveTeamPlayerIds(team = {}, capacity = Infinity, playerIds) {
  return Array.isArray(playerIds)
    ? getExplicitTeamPlayerIds(team, capacity, playerIds)
    : getSelectableTeamPlayerIds(team).slice(0, capacity);
}

export function getTeamEntryPlayerIds(team = null, capacity = Infinity, playerIds, fallbackPlayerId = "") {
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

export function getReserveTeamPlayerIds(team = {}) {
  return (team?.members ?? [])
    .filter((member) => RESERVE_ROLES.has(member.role))
    .map((member) => member.userId);
}

export function normalizeRecruitingApplicant(entry) {
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
  const status = normalizeRecruitingApplicationStatus(entry.status);

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

export function getRecruitingInvitationSenderName(state = {}, invitation = {}) {
  const senderId = String(invitation.fromUserId ?? "").trim();
  const sender = (state.users ?? []).find((user) => user.id === senderId);
  return sender?.name || invitation.fromUserName || "방 참가자";
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


export function normalizeRecruitingPost(post = {}) {
  post = post && typeof post === "object" ? post : {};
  const type = RECRUITING_TYPES[post.type] ? post.type : "need_player";
  const hostJoinMode = post.hostJoinMode === "team"
    || (post.hostJoinMode !== "player" && Boolean(post.teamId))
    ? "team"
    : "player";
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
  const benchCapacity = getRecruitingBenchCapacity(post);
  return {
    ...post,
    type,
    mmrRangeMode,
    hostJoinMode,
    hostSide: VALID_SIDES.has(post.hostSide) ? post.hostSide : "teamA",
    hostReady: true,
    sideCapacity: getRecruitingSideCapacity(post),
    benchCapacity,
    ownerId,
    refereeWanted,
    refereeId: post.refereeId ?? "",
    refereeTrustMin: Number(post.refereeTrustMin ?? REFEREE_TRUST_MIN),
    statEntryMinutes: Number(post.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
    disputeMinutes: Number(post.disputeMinutes ?? DISPUTE_WINDOW_MINUTES),
    timingType,
    rules: { ...(post.rules ?? {}), benchCapacity },
    roomState: { ...roomState, ownerId, mmrRangeMode, timingType, refereeWanted },
    playerId: hostPlayerId,
    playerIds,
    applicants: acceptedApplicants,
  };
}

export function getRecruitingTargetMmr(post = {}, state = {}) {
  if (post.teamId) {
    return state.teams?.find((team) => team.id === post.teamId)?.mmr ?? DEFAULT_RATING;
  }
  if (post.playerId) {
    return state.users?.find((user) => user.id === post.playerId)?.ratings?.integrated ?? DEFAULT_RATING;
  }
  return DEFAULT_RATING;
}

export function getRecruitingTierRange(targetMmr = DEFAULT_RATING, ranked = true, rangeMode = "narrow") {
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
    detail: `${getTierDivision(min)} ~ ${getTierDivision(max)} · 상세 산식 비공개`,
    mode,
    min,
    max,
  };
}

export function isMmrInRecruitingRange(candidateMmr = DEFAULT_RATING, targetMmr = DEFAULT_RATING, ranked = true, rangeMode = "narrow") {
  const range = getRecruitingTierRange(targetMmr, ranked, rangeMode);
  return !ranked || (candidateMmr >= range.min && candidateMmr <= range.max);
}

export function getRecruitingFit(post = {}, candidateMmr = DEFAULT_RATING, state = {}) {
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
