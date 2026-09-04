import { DEFAULT_BENCH_CAPACITY, MAX_BENCH_CAPACITY, getModeSize } from "./constants.js";
import {
  getDefaultMatchRules,
  getMatchRuleInputValidation,
  getMatchRuleSummary,
  getMatchRulesPayload,
} from "./matchRules.js";
import {
  MATCH_FORMATION_OPTIONS,
  MATCH_INTENT_OPTIONS,
  MATCH_PURPOSE_OPTIONS,
  PAYMENT_POLICY_OPTIONS,
  PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS,
  PLAYING_TIME_POLICY_OPTIONS,
  VENUE_PAYMENT_TYPE_OPTIONS,
  VENUE_SECURED_OPTIONS,
} from "./matchCreationPolicyOptions.js";
import { buildRoomRemakeDraft } from "./matchCreationRemake.js";
export * from "./matchCreationPolicyOptions.js";
export { getRoomRemakeWarningCopy } from "./matchCreationRemake.js";

const MATCH_INTENT_IDS = new Set(MATCH_INTENT_OPTIONS.map((option) => option.id));
const MATCH_PURPOSE_IDS = new Set(MATCH_PURPOSE_OPTIONS.map((option) => option.id));
const MATCH_FORMATION_IDS = new Set(MATCH_FORMATION_OPTIONS.map((option) => option.id));
const PLAYING_TIME_POLICY_IDS = new Set(PLAYING_TIME_POLICY_OPTIONS.map((option) => option.id));
const PICKUP_TEAM_ASSIGNMENT_MODE_IDS = new Set(PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS.map((option) => option.id));
const PAYMENT_POLICY_IDS = new Set(PAYMENT_POLICY_OPTIONS.map((option) => option.id));
const VENUE_PAYMENT_TYPE_IDS = new Set(VENUE_PAYMENT_TYPE_OPTIONS.map((option) => option.id));
const VENUE_SECURED_IDS = new Set(VENUE_SECURED_OPTIONS.map((option) => option.id));
const PERSONAL_RECORD_EXCLUDED_FIELDS = new Set([
  "matchIntent",
  "benchCapacity",
  "waitlistCapacity",
  "playingTimePolicy",
  "paymentPolicy",
  "benchPaymentAcknowledged",
  "lastPeriodStopMinutes",
  "venuePaymentType",
  "venueSecured",
  "venueFee",
  "refereeFee",
  "recordingFee",
  "equipmentFee",
  "otherFee",
  "costRoundUnit",
  "freeCancellationHours",
  "refundPolicy",
  "gameClockEnabled",
  "ballProvider",
  "vestsProvided",
  "scoreboardAvailable",
  "shotClockAvailable",
  "statRecorderAvailable",
  "courtReserved",
  "courtFee",
  "refereeWanted",
  "refereeId",
]);

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeMoney(value) {
  return clampInteger(value, 0, 0, 100_000_000);
}

export function getMatchCreationPolicySource(source = {}) {
  const rules = source?.rules && typeof source.rules === "object" ? source.rules : {};
  return { ...rules, ...source, rules };
}

export function getMatchPurpose(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  if (MATCH_PURPOSE_IDS.has(policySource.matchPurpose)) return policySource.matchPurpose;
  return policySource.matchIntent === "friendly" || policySource.matchIntent === "pickup" ? "friendly" : "competitive";
}

export function getMatchFormationMode(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  if (MATCH_FORMATION_IDS.has(policySource.formationMode)) return policySource.formationMode;
  return policySource.matchIntent === "pickup" ? "pickup" : "prearranged";
}

export function getLegacyMatchIntent(source = {}) {
  if (getMatchFormationMode(source) === "pickup") return "pickup";
  return getMatchPurpose(source) === "friendly" ? "friendly" : "standard_competitive";
}

export function getPickupTeamAssignmentMode(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  return PICKUP_TEAM_ASSIGNMENT_MODE_IDS.has(policySource.pickupTeamAssignmentMode)
    ? policySource.pickupTeamAssignmentMode
    : "manual";
}

export function getPickupTeamAssignmentModeOption(source = {}) {
  const mode = typeof source === "string" ? source : getPickupTeamAssignmentMode(source);
  return PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS.find((option) => option.id === mode)
    ?? PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS[0];
}

export function getModeClockPreset(mode = "5v5", presetId = "community") {
  const defaults = getDefaultMatchRules(mode);
  if (presetId === "community") {
    return {
      ...defaults,
      periodCount: 2,
      periodMinutes: 8,
      halftimeMinutes: mode === "5v5" ? 5 : 3,
      clockMode: "running",
      timeLimit: 16,
      lastPeriodStopMinutes: 0,
    };
  }
  if (presetId === "quarters") {
    return {
      ...defaults,
      periodCount: 4,
      periodMinutes: 8,
      clockMode: "running",
      timeLimit: 32,
      lastPeriodStopMinutes: mode === "5v5" ? 2 : 0,
    };
  }
  if (mode !== "5v5") {
    if (presetId === "quick") return { ...defaults, targetScore: 11, periodMinutes: 8, timeLimit: 8, lastPeriodStopMinutes: 0 };
    if (presetId === "score21") return {
      ...defaults,
      ruleSet: mode === "3v3" ? "fiba_3x3" : "standard",
      periodCount: 1,
      periodMinutes: mode === "3v3" ? 10 : defaults.periodMinutes,
      timeLimit: mode === "3v3" ? 10 : defaults.timeLimit,
      targetScore: 21,
      endCondition: "target_or_time",
      clockMode: "running",
      winByTwo: true,
      ball: mode === "3v3" ? "6호 공" : defaults.ball,
      lastPeriodStopMinutes: 0,
    };
    if (presetId === "extended") return { ...defaults, periodMinutes: 15, timeLimit: 15, lastPeriodStopMinutes: 0 };
    return getModeClockPreset(mode, "community");
  }
  if (presetId === "official") {
    return {
      ...defaults,
      lastPeriodStopMinutes: 0,
    };
  }
  if (presetId === "quick" || presetId === "extended") {
    const periodMinutes = presetId === "quick" ? 10 : 15;
    return {
      ...defaults,
      periodCount: 2,
      periodMinutes,
      halftimeMinutes: 5,
      overtimeMinutes: 3,
      clockMode: "running",
      timeLimit: periodMinutes * 2,
      lastPeriodStopMinutes: 0,
    };
  }
  return getModeClockPreset(mode, "community");
}

export function getMatchClockPresetOptions(mode = "5v5") {
  if (mode !== "5v5") {
    return [
      { id: "community", label: "기본 8분×2", patch: getModeClockPreset(mode, "community") },
      { id: "quarters", label: "4쿼터 8분×4", patch: getModeClockPreset(mode, "quarters") },
      { id: "quick", label: "빠른 11점", patch: getModeClockPreset(mode, "quick") },
      { id: "score21", label: mode === "3v3" ? "3x3 · 21점" : "기본 21점", patch: getModeClockPreset(mode, "score21") },
      { id: "extended", label: "긴 경기 15분", patch: getModeClockPreset(mode, "extended") },
    ];
  }
  return [
    { id: "community", label: "기본 8분×2", patch: getModeClockPreset(mode, "community") },
    { id: "quarters", label: "4쿼터 8분×4", patch: getModeClockPreset(mode, "quarters") },
    { id: "quick", label: "빠른 10분×2", patch: getModeClockPreset(mode, "quick") },
    { id: "extended", label: "긴 경기 15분×2", patch: getModeClockPreset(mode, "extended") },
    { id: "official", label: "정규 10분×4", patch: getModeClockPreset(mode, "official") },
  ];
}

export function getMatchIntentPresetPatch(intent = "standard_competitive", mode = "5v5") {
  const matchIntent = MATCH_INTENT_IDS.has(intent) ? intent : "standard_competitive";
  const pickup = matchIntent === "pickup";
  const competitive = matchIntent === "standard_competitive";
  return {
    matchIntent,
    matchPurpose: pickup || !competitive ? "friendly" : "competitive",
    formationMode: pickup ? "pickup" : "prearranged",
    benchCapacity: DEFAULT_BENCH_CAPACITY,
    waitlistCapacity: 3,
    playingTimePolicy: pickup ? "equal_rotation" : "appearance_guaranteed",
    lineupSelectionPolicy: pickup ? "no_fixed_starter" : undefined,
    pickupTeamAssignmentMode: pickup ? "manual" : undefined,
    paymentPolicy: "equal_all_confirmed",
    benchPaymentAcknowledged: true,
    ranked: competitive,
    official: false,
    preRegistered: true,
    mmrLimitMode: competitive ? "block" : "off",
    ...(pickup ? { hostJoinMode: "player", teamOnly: false } : {}),
    ...getModeClockPreset(mode, "community"),
  };
}

export function getMatchConfigurationChangePatch(source = {}, change = {}) {
  const formationMode = MATCH_FORMATION_IDS.has(change.formationMode)
    ? change.formationMode
    : getMatchFormationMode(source);
  const requestedPurpose = MATCH_PURPOSE_IDS.has(change.matchPurpose)
    ? change.matchPurpose
    : getMatchPurpose(source);
  const matchPurpose = requestedPurpose;
  const matchIntent = formationMode === "pickup"
    ? "pickup"
    : matchPurpose === "friendly" ? "friendly" : "standard_competitive";
  return {
    ...getMatchIntentChangePatch(source, matchIntent),
    matchPurpose,
    formationMode,
    ranked: matchPurpose === "competitive",
  };
}

export function getMatchIntentChangePatch(source = {}, intent = "standard_competitive") {
  const matchIntent = MATCH_INTENT_IDS.has(intent) ? intent : "standard_competitive";
  const pickup = matchIntent === "pickup";
  const sourcePlayingTimePolicy = PLAYING_TIME_POLICY_IDS.has(source.playingTimePolicy)
    ? source.playingTimePolicy
    : "appearance_guaranteed";
  const playingTimePolicy = pickup
    ? "equal_rotation"
    : sourcePlayingTimePolicy;
  const benchCapacity = clampInteger(source.benchCapacity, DEFAULT_BENCH_CAPACITY, 0, MAX_BENCH_CAPACITY);
  const paymentPolicy = PAYMENT_POLICY_IDS.has(source.paymentPolicy) ? source.paymentPolicy : "equal_all_confirmed";
  const requiresAcknowledgement = benchCapacity > 0
    && paymentPolicy === "equal_all_confirmed"
    && playingTimePolicy === "none";

  return {
    matchIntent,
    playingTimePolicy,
    lineupSelectionPolicy: pickup ? "no_fixed_starter" : undefined,
    ranked: matchIntent === "standard_competitive",
    mmrLimitMode: matchIntent === "standard_competitive" ? "block" : "off",
    official: false,
    preRegistered: true,
    benchPaymentAcknowledged: requiresAcknowledgement ? Boolean(source.benchPaymentAcknowledged) : true,
    ...(pickup ? { hostJoinMode: "player", teamOnly: false } : {}),
  };
}

export function getMatchModeChangePatch(source = {}, mode = "5v5") {
  const nextMode = String(mode || "5v5");
  if (String(source.mode || "") === nextMode) return { mode: nextMode };
  const preset = getModeClockPreset(nextMode, "community");
  return {
    mode: nextMode,
    ...preset,
    gameClockEnabled: source.gameClockEnabled !== false && source.gameClockEnabled !== "false",
    attackRule: source.attackRule ?? preset.attackRule,
    foulRule: source.foulRule ?? preset.foulRule,
    ball: source.ball ?? preset.ball,
    meetingPoint: source.meetingPoint ?? preset.meetingPoint,
    meetBeforeMinutes: source.meetBeforeMinutes ?? preset.meetBeforeMinutes,
  };
}

export function getDefaultMatchCreationPolicy(mode = "5v5") {
  return {
    ...getMatchIntentPresetPatch("standard_competitive", mode),
    venuePaymentType: "free_public",
    venueSecured: "confirmed",
    venueFee: 0,
    refereeFee: 0,
    recordingFee: 0,
    equipmentFee: 0,
    otherFee: 0,
    costRoundUnit: 100,
    freeCancellationHours: 24,
    refundPolicy: "full_before_deadline",
    ballProvider: "host",
    vestsProvided: false,
  };
}

export function getRoomRemakeDraft(source = {}) {
  return buildRoomRemakeDraft(source, {
    getMatchCreationPolicyPayload,
    getMatchRulesPayload,
  });
}

export function getRoomRemakeNavigationState(selectedPost = {}, sourceMatch = null) {
  const repeatMatch = sourceMatch?.status === "confirmed";
  const remakeSource = sourceMatch
    ? {
        ...selectedPost,
        ...sourceMatch,
        visibility: selectedPost.visibility,
        hostJoinMode: selectedPost.hostJoinMode,
        teamOnly: selectedPost.teamOnly,
        teamId: selectedPost.teamId,
        targetTeamId: selectedPost.targetTeamId,
        rules: { ...(selectedPost.rules ?? {}), ...(sourceMatch.rules ?? {}) },
        repeatMatch,
      }
    : selectedPost;

  return {
    remakeDraft: getRoomRemakeDraft(remakeSource),
    remakeSourceId: repeatMatch
      ? ""
      : sourceMatch?.recruitingPostId ?? (/^match-room-/.test(selectedPost.id) ? "" : selectedPost.id),
    remakeSourceMatchId: repeatMatch ? "" : sourceMatch?.id ?? "",
  };
}

export function getMatchCreationPolicyPayload(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  const mode = String(policySource.mode || "5v5");
  const onCourtCount = getModeSize(mode, 5);
  const benchCapacity = clampInteger(policySource.benchCapacity, DEFAULT_BENCH_CAPACITY, 0, MAX_BENCH_CAPACITY);
  const formationMode = getMatchFormationMode(policySource);
  const matchPurpose = getMatchPurpose(policySource);
  const matchIntent = getLegacyMatchIntent({ ...policySource, matchPurpose, formationMode });
  const pickup = formationMode === "pickup";
  const playingTimePolicy = pickup
    ? "equal_rotation"
    : PLAYING_TIME_POLICY_IDS.has(policySource.playingTimePolicy)
      ? policySource.playingTimePolicy
      : "appearance_guaranteed";
  const paymentPolicy = PAYMENT_POLICY_IDS.has(policySource.paymentPolicy) ? policySource.paymentPolicy : "equal_all_confirmed";
  const venuePaymentType = VENUE_PAYMENT_TYPE_IDS.has(policySource.venuePaymentType) ? policySource.venuePaymentType : "free_public";
  const venueSecured = VENUE_SECURED_IDS.has(policySource.venueSecured) ? policySource.venueSecured : "confirmed";
  const freeVenue = venuePaymentType === "free_public" || venuePaymentType === "first_come_public";
  const venueFee = freeVenue ? 0 : normalizeMoney(policySource.venueFee ?? policySource.courtFee);
  const refereeFee = normalizeMoney(policySource.refereeFee);
  const recordingFee = normalizeMoney(policySource.recordingFee);
  const equipmentFee = normalizeMoney(policySource.equipmentFee);
  const otherFee = normalizeMoney(policySource.otherFee);
  const totalCost = venueFee + refereeFee + recordingFee + equipmentFee + otherFee;
  const costRoundUnit = [100, 500].includes(Number(policySource.costRoundUnit)) ? Number(policySource.costRoundUnit) : 100;
  const confirmedCapacity = (onCourtCount + benchCapacity) * 2;
  const estimatedFeePerPlayer = paymentPolicy === "equal_all_confirmed" && totalCost > 0
    ? Math.ceil(totalCost / confirmedCapacity / costRoundUnit) * costRoundUnit
    : 0;
  const requiresBenchPaymentAcknowledgement = benchCapacity > 0
    && paymentPolicy === "equal_all_confirmed"
    && playingTimePolicy === "none";
  const periodCount = clampInteger(policySource.periodCount, 1, 1, 4);
  const requestedRotationMode = String(policySource.rotationMode ?? "");
  const rotationMode = pickup
    ? ["period", "interval", "manual"].includes(requestedRotationMode)
      ? requestedRotationMode
      : periodCount > 1 ? "period" : "interval"
    : undefined;
  const requestedRotationMinutes = clampInteger(policySource.rotationIntervalMinutes, 5, 3, 10);
  const rotationIntervalMinutes = [3, 5, 7, 10].includes(requestedRotationMinutes) ? requestedRotationMinutes : 5;
  const pickupTeamAssignmentMode = pickup ? getPickupTeamAssignmentMode(policySource) : undefined;

  return {
    matchIntent,
    matchPurpose,
    formationMode,
    onCourtCount,
    starterCount: onCourtCount,
    benchCapacity,
    teamCapacity: onCourtCount + benchCapacity,
    participantCapacity: pickup ? (onCourtCount + benchCapacity) * 2 : undefined,
    waitingPlayerCapacity: pickup ? benchCapacity * 2 : undefined,
    waitlistCapacity: clampInteger(policySource.waitlistCapacity, 3, 0, 10),
    playingTimePolicy,
    rotationMode,
    rotationIntervalMinutes: pickup && rotationMode === "interval" ? rotationIntervalMinutes : undefined,
    pickupTeamAssignmentMode,
    lineupSelectionPolicy: pickup ? "no_fixed_starter" : policySource.hostJoinMode === "team" ? "team_captain_assigns" : "automatic",
    hostJoinMode: pickup ? "player" : policySource.hostJoinMode === "team" ? "team" : "player",
    teamOnly: pickup ? false : policySource.hostJoinMode === "team" || policySource.teamOnly === true,
    ranked: matchPurpose === "competitive" && policySource.ranked !== false,
    official: pickup ? false : Boolean(policySource.official),
    mmrLimitMode: pickup || matchPurpose !== "competitive" ? "off" : "block",
    paymentPolicy,
    benchPaymentAcknowledged: Boolean(policySource.benchPaymentAcknowledged),
    requiresBenchPaymentAcknowledgement,
    lastPeriodStopMinutes: policySource.clockMode === "running"
      ? clampInteger(policySource.lastPeriodStopMinutes, 0, 0, clampInteger(policySource.periodMinutes, 60, 1, 60))
      : 0,
    venuePaymentType,
    venueSecured,
    venueFee,
    refereeFee,
    recordingFee,
    equipmentFee,
    otherFee,
    totalCost,
    costRoundUnit,
    estimatedFeePerPlayer,
    freeCancellationHours: clampInteger(policySource.freeCancellationHours, 24, 0, 168),
    refundPolicy: ["full_before_deadline", "no_refund", "custom"].includes(policySource.refundPolicy)
      ? policySource.refundPolicy
      : "full_before_deadline",
    ballProvider: ["host", "venue", "participant", "unknown"].includes(policySource.ballProvider)
      ? policySource.ballProvider
      : "host",
    vestsProvided: onCourtCount > 1 && Boolean(policySource.vestsProvided),
  };
}

export function getScopedMatchCreationPolicyPayload(source = {}, scope = "match") {
  if (scope === "personal_record") return {};
  const policy = getMatchCreationPolicyPayload(source);
  if (scope === "match") return policy;
  const rosterPolicy = {
    onCourtCount: policy.onCourtCount,
    starterCount: policy.starterCount,
    benchCapacity: policy.benchCapacity,
    teamCapacity: policy.teamCapacity,
    waitlistCapacity: policy.waitlistCapacity,
    playingTimePolicy: policy.playingTimePolicy,
    lineupSelectionPolicy: policy.lineupSelectionPolicy,
    lastPeriodStopMinutes: policy.lastPeriodStopMinutes,
  };
  if (scope === "match_record") {
    const benchCapacity = source.recordComposition === "team" ? MAX_BENCH_CAPACITY : 0;
    return {
      onCourtCount: policy.onCourtCount,
      starterCount: policy.onCourtCount,
      benchCapacity,
      teamCapacity: policy.onCourtCount + benchCapacity,
      waitlistCapacity: 0,
    };
  }
  if (scope === "tournament") {
    return {
      ...rosterPolicy,
      ballProvider: policy.ballProvider,
      vestsProvided: policy.vestsProvided,
    };
  }
  return rosterPolicy;
}

export function getPersonalRecordDraftPayload(source = {}) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !PERSONAL_RECORD_EXCLUDED_FIELDS.has(key)));
}

export function getMatchCreationValidation(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  const policy = getMatchCreationPolicyPayload(policySource);
  const ruleValidation = getMatchRuleInputValidation(policySource, { mode: policySource.mode });
  const policyErrors = [];
  const warnings = [];
  const paidVenue = policy.venuePaymentType === "paid_reserved" || policy.venuePaymentType === "paid_not_reserved";
  if (paidVenue && policy.venueFee <= 0) policyErrors.push("유료구장은 대관료를 1원 이상 입력해야 합니다.");
  if (policy.requiresBenchPaymentAcknowledgement && !policy.benchPaymentAcknowledged) {
    policyErrors.push("후보의 동일 결제와 출전 미보장 조건을 확인해야 합니다.");
  }
  if (policy.formationMode === "pickup") {
    if (policy.hostJoinMode !== "player" || policy.teamOnly === true) {
      policyErrors.push("픽업은 개인 참가 방식으로만 만들 수 있습니다.");
    }
    if (policy.official !== false) {
      policyErrors.push("픽업은 공식 경기로 만들 수 없습니다.");
    }
    warnings.push("체크인에서 방장 또는 배정 심판이 팀 배치와 교대 순서를 확정해야 시작할 수 있습니다.");
  }
  if (policy.venueSecured === "first_come") {
    warnings.push("현장 상황에 따라 경기가 취소되거나 다른 장소로 이동할 수 있습니다.");
  }
  if (policy.venueSecured === "unconfirmed" && policySource.ranked !== false) {
    warnings.push("경쟁전 구장이 아직 확보되지 않았습니다.");
  }
  if (policy.ranked && getMatchRulesPayload(policySource, { mode: policySource.mode }).gameClockEnabled === false) {
    warnings.push("경기시계를 사용하지 않으면 해당 여부를 최종 MMR 반영 전에 서버에서 검증합니다.");
  }
  return {
    policy,
    ruleValidation,
    ruleErrors: ruleValidation.errors,
    policyErrors,
    errors: [...ruleValidation.errors, ...policyErrors],
    warnings,
  };
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

const BALL_PROVIDER_LABELS = Object.freeze({
  host: "방장 제공",
  venue: "구장 제공",
  participant: "참가자 제공",
  unknown: "현장 협의",
});

export function getMatchOperationsSummaryRows(source = {}, { includeCost = false } = {}) {
  const policy = getMatchCreationPolicyPayload(source);
  return [
    { label: "공 제공", value: BALL_PROVIDER_LABELS[policy.ballProvider] ?? BALL_PROVIDER_LABELS.host },
    ...(policy.onCourtCount > 1 ? [{ label: "조끼 제공", value: policy.vestsProvided ? "방장 제공" : "미제공" }] : []),
    ...(includeCost && policy.totalCost > 0 ? [{
      label: "비용",
      value: `총 ${formatCurrency(policy.totalCost)}${policy.estimatedFeePerPlayer > 0 ? ` · 1인 예상 ${formatCurrency(policy.estimatedFeePerPlayer)}` : ""}`,
    }] : []),
  ];
}

export function getMatchCreationSummary(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  const policy = getMatchCreationPolicyPayload(policySource);
  const rulesValid = getMatchRuleInputValidation(policySource, { mode: policySource.mode }).valid;
  const purpose = MATCH_PURPOSE_OPTIONS.find((option) => option.id === policy.matchPurpose) ?? MATCH_PURPOSE_OPTIONS[1];
  const playingTime = PLAYING_TIME_POLICY_OPTIONS.find((option) => option.id === policy.playingTimePolicy)?.label ?? "출전 보장 없음";
  const payment = PAYMENT_POLICY_OPTIONS.find((option) => option.id === policy.paymentPolicy)?.label ?? "확정 인원 전원 균등";
  const pickup = policy.formationMode === "pickup";
  const rosterText = pickup
    ? `개인 참가 · 출전 ${policy.onCourtCount * 2}명${policy.waitingPlayerCapacity > 0 ? ` · 통합 대기 ${policy.waitingPlayerCapacity}명` : ""}`
    : policy.benchCapacity > 0
    ? `사이드당 선발 ${policy.onCourtCount}명과 후보 ${policy.benchCapacity}명`
    : `사이드당 출전 ${policy.onCourtCount}명`;
  const costText = policy.totalCost > 0
    ? `총 ${formatCurrency(policy.totalCost)}${policy.estimatedFeePerPlayer > 0 ? ` · 1인 예상 ${formatCurrency(policy.estimatedFeePerPlayer)}` : ""}`
    : "참가비 없음";
  return {
    policy,
    rows: [
      { label: "경기 목적", value: purpose.label },
      { label: "팀 구성", value: pickup ? "현장 픽업" : "경기 전 구성" },
      { label: "명단", value: `${policySource.mode || "5v5"} · ${rosterText}` },
      ...(pickup ? [{ label: "팀 배치", value: "출석 후 현장 결정" }] : []),
      ...(pickup ? [{ label: "운영 정책", value: policy.rotationMode === "period" ? "쿼터·하프 종료마다 균등 교대" : policy.rotationMode === "interval" ? `${policy.rotationIntervalMinutes}분 간격 균등 교대` : "방장·심판 직접 교대" }] : policy.benchCapacity > 0 ? [{ label: "출전 정책", value: playingTime }] : []),
      { label: "경기 규칙", value: rulesValid ? getMatchRuleSummary(policySource, policySource.mode) : "입력값 확인 필요" },
      ...getMatchOperationsSummaryRows(policySource),
      { label: "비용", value: `${costText} · ${payment}` },
      { label: "구장", value: policySource.court || "구장 미정" },
      { label: "일정", value: policySource.timingType === "instant" ? "즉시" : [policySource.scheduledDate, policySource.scheduledTime].filter(Boolean).join(" ") || "일정 미정" },
    ],
    sentence: pickup
      ? `개인 참가자를 통합 풀로 모집하고 출석 후 현장에서 팀 배치 방식을 정합니다.${policy.ranked ? " 최종 방식과 경기 검증 결과를 서버 정책으로 판정합니다." : " 친선전은 MMR을 반영하지 않습니다."}`
      : policy.benchCapacity > 0
      ? `${rosterText}입니다. 후보의 출전 정책은 '${playingTime}', 비용 정책은 '${payment}'입니다.`
      : `${rosterText}이며 비용 정책은 '${payment}'입니다.`,
  };
}
