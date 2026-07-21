const PERIOD_COUNTS = new Set([1, 2, 4]);
const END_CONDITIONS = new Set(["time", "target_or_time"]);
const CLOCK_MODES = new Set(["running", "stopped"]);

export const MATCH_PERIOD_OPTIONS = Object.freeze([
  { value: 1, label: "단일 경기" },
  { value: 2, label: "2하프" },
  { value: 4, label: "4쿼터" },
]);

export const MATCH_END_CONDITION_OPTIONS = Object.freeze([
  { value: "time", label: "시간 종료" },
  { value: "target_or_time", label: "목표 점수 또는 시간" },
]);

export const MATCH_CLOCK_MODE_OPTIONS = Object.freeze([
  { value: "running", label: "러닝타임" },
  { value: "stopped", label: "스톱타임" },
]);

export const MEET_BEFORE_MINUTE_OPTIONS = Object.freeze([10, 15, 20, 30]);

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function getDefaultMatchRules(mode = "3v3") {
  const fiveOnFive = mode === "5v5";
  return {
    endCondition: fiveOnFive ? "time" : "target_or_time",
    targetScore: 21,
    periodCount: fiveOnFive ? 4 : 1,
    periodMinutes: fiveOnFive ? 10 : 12,
    periodBreakMinutes: 2,
    halftimeMinutes: fiveOnFive ? 10 : 5,
    overtimeMinutes: fiveOnFive ? 5 : 3,
    clockMode: fiveOnFive ? "stopped" : "running",
    timeLimit: fiveOnFive ? 40 : 12,
    ball: "7호 공",
    winByTwo: !fiveOnFive,
    attackRule: "득점 후 공격권 교대",
    foulRule: "파울 콜 즉시 중단, 공격권 유지",
    meetingPoint: "",
    meetBeforeMinutes: 15,
  };
}

export function normalizeMatchRules(source = {}, { mode = "3v3" } = {}) {
  const defaults = getDefaultMatchRules(mode);
  const hasPeriodModel = PERIOD_COUNTS.has(Number(source.periodCount));
  const periodCount = hasPeriodModel ? Number(source.periodCount) : 1;
  const legacyPeriodMinutes = hasPeriodModel ? defaults.periodMinutes : source.timeLimit;
  const periodMinutes = clampInteger(source.periodMinutes ?? legacyPeriodMinutes, defaults.periodMinutes, 1, 60);
  const endCondition = END_CONDITIONS.has(source.endCondition) ? source.endCondition : defaults.endCondition;
  const clockMode = CLOCK_MODES.has(source.clockMode) ? source.clockMode : defaults.clockMode;
  const meetingPoint = String(source.meetingPoint ?? "").trim().slice(0, 120);

  return {
    ...source,
    endCondition,
    targetScore: clampInteger(source.targetScore, defaults.targetScore, 7, 99),
    periodCount,
    periodMinutes,
    periodBreakMinutes: clampInteger(source.periodBreakMinutes, defaults.periodBreakMinutes, 0, 30),
    halftimeMinutes: clampInteger(source.halftimeMinutes, defaults.halftimeMinutes, 0, 30),
    overtimeMinutes: clampInteger(source.overtimeMinutes, defaults.overtimeMinutes, 1, 20),
    clockMode,
    timeLimit: periodCount * periodMinutes,
    ball: String(source.ball || defaults.ball).slice(0, 40),
    winByTwo: endCondition === "target_or_time" && Boolean(source.winByTwo ?? defaults.winByTwo),
    attackRule: String(source.attackRule || defaults.attackRule).slice(0, 120),
    foulRule: String(source.foulRule || defaults.foulRule).slice(0, 120),
    meetingPoint,
    meetBeforeMinutes: clampInteger(source.meetBeforeMinutes, defaults.meetBeforeMinutes, 0, 60),
  };
}

export function getMatchRulesPayload(source = {}, options = {}) {
  const rules = normalizeMatchRules(source, options);
  return {
    endCondition: rules.endCondition,
    targetScore: rules.targetScore,
    periodCount: rules.periodCount,
    periodMinutes: rules.periodMinutes,
    periodBreakMinutes: rules.periodBreakMinutes,
    halftimeMinutes: rules.halftimeMinutes,
    overtimeMinutes: rules.overtimeMinutes,
    clockMode: rules.clockMode,
    timeLimit: rules.timeLimit,
    ball: rules.ball,
    winByTwo: rules.winByTwo,
    attackRule: rules.attackRule,
    foulRule: rules.foulRule,
    meetingPoint: rules.meetingPoint,
    meetBeforeMinutes: rules.meetBeforeMinutes,
  };
}

export function getMatchPeriodLabel(rules = {}, mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  if (normalized.periodCount === 4) return `4쿼터 × ${normalized.periodMinutes}분`;
  if (normalized.periodCount === 2) return `2하프 × ${normalized.periodMinutes}분`;
  return `단일 ${normalized.periodMinutes}분`;
}

export function getMatchRuleSummary(rules = {}, mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  return [
    getMatchPeriodLabel(normalized, mode),
    normalized.clockMode === "stopped" ? "스톱타임" : "러닝타임",
    normalized.endCondition === "target_or_time" ? `${normalized.targetScore}점 목표` : "시간 종료",
    normalized.ball,
  ].join(" · ");
}

export function getMeetingPointSummary(rules = {}, timingType = "scheduled", mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  if (!normalized.meetingPoint) return "만남 장소 미정";
  if (timingType === "instant" || normalized.meetBeforeMinutes <= 0) return normalized.meetingPoint;
  return `${normalized.meetingPoint} · 시작 ${normalized.meetBeforeMinutes}분 전`;
}
