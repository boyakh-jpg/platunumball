import { MODE_SIZES } from "./constants.js";
import { TIERS, getTier, getTierDivision } from "./tier.js";

export const RECRUITING_TYPES = {
  need_player: {
    label: "매치 큐",
    shortLabel: "빈자리 모집",
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
    description: "용병처럼 한 자리로 참여",
  },
  team: {
    label: "팀",
    actionLabel: "팀으로 대기",
    description: "현재 팀 활성 멤버가 파티로 참여",
  },
};

const MERCENARY_ROLES = new Set(["mercenary", "guest"]);
const RESERVE_ROLES = new Set(["candidate", "substitute"]);
const VALID_SIDES = new Set(["teamA", "teamB"]);
const VALID_APPLICATION_STATUS = new Set(["waiting", "ready", "confirmed"]);

function clampIndex(index) {
  return Math.min(TIERS.length - 1, Math.max(0, index));
}

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

export function getTierIndex(mmr = 0) {
  const tier = getTier(mmr);
  return Math.max(0, TIERS.findIndex((item) => item.name === tier.name));
}

export function getRecruitingTypeMeta(type = "need_player") {
  return RECRUITING_TYPES[type] ?? RECRUITING_TYPES.need_player;
}

export function getRecruitingApplicantKind(post = {}) {
  return getRecruitingTypeMeta(post.type).applicantKind;
}

export function getRecruitingSideCapacity(post = {}) {
  return Math.max(1, Number(post.sideCapacity ?? MODE_SIZES[post.mode] ?? 5));
}

export function getRecruitingJoinMode(entry = {}) {
  if (entry.joinMode === "team" || entry.kind === "team" || entry.teamId) return "team";
  return "player";
}

export function getActiveTeamPlayerIds(team = {}, capacity = Infinity) {
  return (team.members ?? [])
    .filter((member) => !RESERVE_ROLES.has(member.role))
    .slice(0, capacity)
    .map((member) => member.userId);
}

export function getReserveTeamPlayerIds(team = {}) {
  return (team.members ?? [])
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
      side,
      status,
      reserve: Boolean(entry.reserve),
      position: entry.position ?? null,
      createdAt: entry.createdAt ?? null,
      updatedAt: entry.updatedAt ?? null,
    };
  }
  return null;
}

export function normalizeRecruitingApplicants(applicants = []) {
  return applicants.map(normalizeRecruitingApplicant).filter(Boolean);
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

export function normalizeRecruitingPost(post = {}) {
  const type = RECRUITING_TYPES[post.type] ? post.type : "need_player";
  const hostJoinMode = post.hostJoinMode === "player" || !post.teamId ? "player" : "team";
  return {
    ...post,
    type,
    hostJoinMode,
    hostSide: VALID_SIDES.has(post.hostSide) ? post.hostSide : "teamA",
    hostReady: Boolean(post.hostReady),
    sideCapacity: getRecruitingSideCapacity(post),
    applicants: normalizeRecruitingApplicants(post.applicants ?? []),
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

export function getRecruitingTierRange(targetMmr = 1200, ranked = true) {
  if (!ranked) {
    return {
      label: "티어 자유",
      detail: "친선은 티어 제한 없이 신뢰도만 반영합니다.",
      min: 0,
      max: 9999,
    };
  }

  const targetIndex = getTierIndex(targetMmr);
  const lowTier = TIERS[clampIndex(targetIndex - 2)];
  const highTier = TIERS[clampIndex(targetIndex + 2)];

  return {
    label: `${lowTier.name} ~ ${highTier.name}`,
    detail: `${getTierDivision(lowTier.min)}부터 ${getTierDivision(highTier.max)}까지 허용`,
    min: lowTier.min,
    max: highTier.max,
  };
}

export function isMmrInRecruitingRange(candidateMmr = 1200, targetMmr = 1200, ranked = true) {
  const range = getRecruitingTierRange(targetMmr, ranked);
  return !ranked || (candidateMmr >= range.min && candidateMmr <= range.max);
}

export function getRecruitingFit(post = {}, candidateMmr = 1200, state = {}) {
  const targetMmr = getRecruitingTargetMmr(post, state);
  const range = getRecruitingTierRange(targetMmr, post.ranked !== false);

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

export function getRecruitingHostEntry(post = {}, state = {}) {
  const user = state.users?.find((item) => item.id === post.playerId) ?? null;
  const team = post.teamId ? state.teams?.find((item) => item.id === post.teamId) ?? null : null;
  const capacity = getRecruitingSideCapacity(post);
  const joinMode = post.hostJoinMode === "player" || !team ? "player" : "team";
  const players = joinMode === "team" ? getActiveTeamPlayerIds(team, capacity) : [post.playerId].filter(Boolean);
  const reserves = joinMode === "team" ? getReserveTeamPlayerIds(team) : [];

  return {
    id: "host",
    fixed: true,
    kind: joinMode,
    joinMode,
    side: post.hostSide ?? "teamA",
    status: post.hostReady ? "ready" : "waiting",
    reserve: false,
    playerId: post.playerId,
    teamId: team?.id ?? null,
    user,
    team,
    players,
    reserves,
    createdAt: post.createdAt,
  };
}

export function getRecruitingApplicantEntry(applicant = {}, state = {}, post = {}) {
  const normalized = normalizeRecruitingApplicant(applicant);
  if (!normalized) return null;
  const capacity = getRecruitingSideCapacity(post);
  const user = normalized.playerId ? state.users?.find((item) => item.id === normalized.playerId) ?? null : null;
  const team = normalized.teamId ? state.teams?.find((item) => item.id === normalized.teamId) ?? null : null;
  const players = normalized.kind === "team"
    ? getActiveTeamPlayerIds(team, capacity)
    : [normalized.playerId].filter(Boolean);
  const reserves = normalized.kind === "team" ? getReserveTeamPlayerIds(team) : [];

  return {
    ...normalized,
    id: getRecruitingApplicantKey(normalized),
    user,
    team,
    players,
    reserves,
  };
}

export function getRecruitingLobby(post = {}, state = {}) {
  const normalizedPost = normalizeRecruitingPost(post);
  const host = getRecruitingHostEntry(normalizedPost, state);
  const applicants = normalizeRecruitingApplicants(normalizedPost.applicants ?? [])
    .map((applicant) => getRecruitingApplicantEntry(applicant, state, normalizedPost))
    .filter(Boolean);
  const entries = [host, ...applicants];

  const sides = ["teamA", "teamB"].reduce((acc, side) => {
    const sideEntries = entries.filter((entry) => entry.side === side && !entry.reserve);
    const reserveEntries = entries.filter((entry) => entry.side === side && entry.reserve);
    const players = unique(sideEntries.flatMap((entry) => entry.players));
    const reserves = unique([
      ...reserveEntries.flatMap((entry) => entry.players),
      ...sideEntries.flatMap((entry) => entry.reserves),
    ]);
    acc[side] = {
      entries: sideEntries,
      reserveEntries,
      players,
      reserves,
      filled: players.length,
      capacity: getRecruitingSideCapacity(normalizedPost),
    };
    return acc;
  }, {});

  const playingEntries = entries.filter((entry) => !entry.reserve);
  const full = sides.teamA.filled >= sides.teamA.capacity && sides.teamB.filled >= sides.teamB.capacity;
  const ready = playingEntries.length > 0 && playingEntries.every((entry) => entry.status === "ready");

  return {
    entries,
    sides,
    full,
    ready,
    canConfirm: full && ready,
  };
}

export function getRecruitingBestSide(post = {}, state = {}) {
  const lobby = getRecruitingLobby(post, state);
  return lobby.sides.teamA.filled <= lobby.sides.teamB.filled ? "teamA" : "teamB";
}

export function getMercenaryTeamWeight(memberMmr = 1200, teamMmr = 1200, role = "regular") {
  if (!MERCENARY_ROLES.has(role)) return role === "candidate" ? 0.75 : 1;
  if (memberMmr <= teamMmr - 140) return 0.65;
  if (memberMmr >= teamMmr + 140) return 0.22;
  return 0.4;
}

export function getMercenaryPlayerFactor(memberMmr = 1200, teamMmr = 1200, role = "regular") {
  if (!MERCENARY_ROLES.has(role)) return 1;
  if (memberMmr >= teamMmr + 140) return 0.62;
  if (memberMmr <= teamMmr - 140) return 0.96;
  return 0.82;
}
