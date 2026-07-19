export const DEFAULT_RATING_POLICY = Object.freeze({
  playerMmr: {
    resultScalePercent: 100,
    statScalePercent: 100,
    deltaCapPercent: 100,
    modeScalePercent: { "1v1": 100, "2v2": 100, "3v3": 100, "5v5": 100 },
    integratedScalePercent: { "1v1": 100, "2v2": 100, "3v3": 100, "5v5": 100 },
  },
  teamMmr: {
    resultScalePercent: 100,
    deltaCapPercent: 100,
  },
  trust: {
    matchCompletionReward: 1,
    foulGrace: 2,
    foulPenaltyPer: 1,
    maxFoulPenalty: 4,
    candidateRecorderReward: 2,
    refereeReward: 1,
    thumbsDelta: 1,
    refereeAbsencePenalty: 4,
    falseCourtReportPenalty: 8,
    closeWithApplicantsPenalty: 2,
    closeUnreadyPenalty: 2,
    closeExpiredPenalty: 8,
    closeWithin6HoursPenalty: 5,
    closeWithin24HoursPenalty: 3,
    closeWithin72HoursPenalty: 1,
    closeShortNoticeDiscount: 2,
    closeMaxPenalty: 12,
    repeatedKickThreshold: 3,
    repeatedKickPenalty: 1,
  },
});

export const RATING_POLICY_GROUPS = Object.freeze([
  {
    id: "player-result",
    label: "개인 MMR",
    description: "승패 결과, 개인 스탯, 경기당 최대 변동 폭의 전역 반영률입니다.",
    fields: [
      { path: ["playerMmr", "resultScalePercent"], label: "승패 반영률", unit: "%", min: 25, max: 200, step: 5 },
      { path: ["playerMmr", "statScalePercent"], label: "개인 스탯 반영률", unit: "%", min: 0, max: 200, step: 5 },
      { path: ["playerMmr", "deltaCapPercent"], label: "최대 변동폭", unit: "%", min: 50, max: 150, step: 5 },
    ],
  },
  {
    id: "player-mode",
    label: "경기 형식별 MMR",
    description: "모드 MMR과 통합 MMR에 각 경기 형식이 반영되는 비율입니다.",
    fields: [
      ...["1v1", "2v2", "3v3", "5v5"].map((mode) => ({
        path: ["playerMmr", "modeScalePercent", mode], label: `${mode} 모드`, unit: "%", min: 50, max: 150, step: 5,
      })),
      ...["1v1", "2v2", "3v3", "5v5"].map((mode) => ({
        path: ["playerMmr", "integratedScalePercent", mode], label: `${mode} 통합`, unit: "%", min: 50, max: 150, step: 5,
      })),
    ],
  },
  {
    id: "team-mmr",
    label: "팀 MMR",
    description: "팀전 승패와 경기당 최대 팀 MMR 변동 폭입니다.",
    fields: [
      { path: ["teamMmr", "resultScalePercent"], label: "승패 반영률", unit: "%", min: 25, max: 200, step: 5 },
      { path: ["teamMmr", "deltaCapPercent"], label: "최대 변동폭", unit: "%", min: 50, max: 150, step: 5 },
    ],
  },
  {
    id: "match-trust",
    label: "경기 신뢰도",
    description: "경기 확정, 파울, 기록자, 심판, 추천 이벤트의 신뢰도 증감값입니다.",
    fields: [
      { path: ["trust", "matchCompletionReward"], label: "경기 확정", unit: "점", min: 0, max: 5, step: 1 },
      { path: ["trust", "foulGrace"], label: "파울 허용", unit: "개", min: 0, max: 6, step: 1 },
      { path: ["trust", "foulPenaltyPer"], label: "초과 파울당 차감", unit: "점", min: 0, max: 5, step: 1 },
      { path: ["trust", "maxFoulPenalty"], label: "파울 최대 차감", unit: "점", min: 0, max: 15, step: 1 },
      { path: ["trust", "candidateRecorderReward"], label: "후보 기록자", unit: "점", min: 0, max: 5, step: 1 },
      { path: ["trust", "refereeReward"], label: "심판 수행", unit: "점", min: 0, max: 5, step: 1 },
      { path: ["trust", "thumbsDelta"], label: "추천 증감", unit: "점", min: 0, max: 5, step: 1 },
      { path: ["trust", "refereeAbsencePenalty"], label: "심판 불참", unit: "점", min: 0, max: 15, step: 1 },
    ],
  },
  {
    id: "room-trust",
    label: "방 운영 신뢰도",
    description: "임박한 방 닫기, 반복 강퇴, 허위 구장 등록 이벤트의 차감값입니다.",
    fields: [
      { path: ["trust", "closeWithApplicantsPenalty"], label: "신청자 있는 방 닫기", unit: "점", min: 0, max: 10, step: 1 },
      { path: ["trust", "closeUnreadyPenalty"], label: "방장 미준비", unit: "점", min: 0, max: 10, step: 1 },
      { path: ["trust", "closeExpiredPenalty"], label: "시작시각 경과", unit: "점", min: 0, max: 15, step: 1 },
      { path: ["trust", "closeWithin6HoursPenalty"], label: "6시간 이내", unit: "점", min: 0, max: 15, step: 1 },
      { path: ["trust", "closeWithin24HoursPenalty"], label: "24시간 이내", unit: "점", min: 0, max: 15, step: 1 },
      { path: ["trust", "closeWithin72HoursPenalty"], label: "72시간 이내", unit: "점", min: 0, max: 15, step: 1 },
      { path: ["trust", "closeShortNoticeDiscount"], label: "급조 방 감면", unit: "점", min: 0, max: 10, step: 1 },
      { path: ["trust", "closeMaxPenalty"], label: "방 닫기 최대 차감", unit: "점", min: 0, max: 20, step: 1 },
      { path: ["trust", "repeatedKickThreshold"], label: "반복 강퇴 기준", unit: "회", min: 2, max: 10, step: 1 },
      { path: ["trust", "repeatedKickPenalty"], label: "반복 강퇴 차감", unit: "점", min: 0, max: 10, step: 1 },
      { path: ["trust", "falseCourtReportPenalty"], label: "허위 구장 등록", unit: "점", min: 0, max: 20, step: 1 },
    ],
  },
]);

export const RATING_POLICY_FIELDS = Object.freeze(RATING_POLICY_GROUPS.flatMap((group) => group.fields));

export function cloneRatingPolicy(policy = DEFAULT_RATING_POLICY) {
  return JSON.parse(JSON.stringify(policy));
}

export function getRatingPolicyValue(policy, path) {
  return path.reduce((value, key) => value?.[key], policy);
}

export function setRatingPolicyValue(policy, path, value) {
  const next = cloneRatingPolicy(policy);
  let cursor = next;
  path.slice(0, -1).forEach((key) => {
    cursor = cursor[key];
  });
  cursor[path.at(-1)] = value;
  return next;
}

export function normalizeRatingPolicy(policy = {}) {
  let normalized = cloneRatingPolicy(DEFAULT_RATING_POLICY);
  RATING_POLICY_FIELDS.forEach((field) => {
    const raw = Number(getRatingPolicyValue(policy, field.path));
    const fallback = getRatingPolicyValue(DEFAULT_RATING_POLICY, field.path);
    const value = Number.isFinite(raw) ? raw : fallback;
    const stepped = field.step >= 1 ? Math.round(value) : value;
    normalized = setRatingPolicyValue(normalized, field.path, Math.max(field.min, Math.min(field.max, stepped)));
  });
  return normalized;
}
