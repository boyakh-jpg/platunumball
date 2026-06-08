import { TIERS, getTier, getTierDivision } from "./tier.js";

export const RECRUITING_TYPES = {
  need_player: {
    label: "팀원 구해요",
    shortLabel: "팀이 개인 모집",
    emptyTitle: "오늘 경기 용병 1명",
    applicantKind: "player",
    actionLabel: "혼자 참여",
    unitLabel: "개인 신청",
  },
  find_team: {
    label: "혼자 팀 구해요",
    shortLabel: "솔로 큐",
    emptyTitle: "오늘 뛸 팀 구해요",
    applicantKind: "team",
    actionLabel: "팀으로 제안",
    unitLabel: "팀 제안",
  },
  need_team: {
    label: "상대팀 구해요",
    shortLabel: "팀 큐",
    emptyTitle: "오늘 경기 상대팀 구해요",
    applicantKind: "team",
    actionLabel: "팀으로 참여",
    unitLabel: "팀 신청",
  },
};

const MERCENARY_ROLES = new Set(["mercenary", "guest"]);

function clampIndex(index) {
  return Math.min(TIERS.length - 1, Math.max(0, index));
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

export function normalizeRecruitingApplicant(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return { kind: "player", playerId: entry };
  }

  const kind = entry.kind === "team" || entry.teamId ? "team" : "player";
  if (kind === "team" && entry.teamId) {
    return {
      kind: "team",
      teamId: entry.teamId,
      playerId: entry.playerId ?? null,
      createdAt: entry.createdAt ?? null,
    };
  }
  if (entry.playerId) {
    return {
      kind: "player",
      playerId: entry.playerId,
      createdAt: entry.createdAt ?? null,
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
  return {
    ...post,
    type,
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
      detail: "친선은 제한 없이 소폭 반영합니다.",
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
