const PERIOD_COUNTS = new Set([1, 2, 4]);
const END_CONDITIONS = new Set(["time", "target_or_time"]);
const CLOCK_MODES = new Set(["running", "stopped"]);

export const MATCH_CLOCK_FORCE_END_MINUTES = 90;
export const MATCH_CONFIGURED_DURATION_PERCENT = 70;
export const MATCH_MAX_REGULATION_MINUTES = Math.floor(
  (MATCH_CLOCK_FORCE_END_MINUTES * MATCH_CONFIGURED_DURATION_PERCENT) / 100,
);
export const MATCH_RULE_NUMBER_FIELDS = Object.freeze([
  "targetScore",
  "periodMinutes",
  "lastPeriodStopMinutes",
  "periodBreakMinutes",
  "halftimeMinutes",
  "overtimeMinutes",
]);

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

export const MATCH_BALL_OPTIONS = Object.freeze([
  { value: "7호 공", label: "7호 공" },
  { value: "6호 공", label: "6호 공" },
  { value: "코트 공", label: "코트 공" },
]);

export const MATCH_WIN_BY_TWO_OPTIONS = Object.freeze([
  { value: true, label: "적용" },
  { value: false, label: "미적용" },
]);

export const MEET_BEFORE_MINUTE_OPTIONS = Object.freeze([10, 15, 20, 30]);

function clampInteger(value, fallback, min, max) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function parseInteger(value) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

export function getMatchPeriodMinutesMax(periodCount = 1) {
  const count = PERIOD_COUNTS.has(Number(periodCount)) ? Number(periodCount) : 1;
  return Math.max(1, Math.floor(MATCH_MAX_REGULATION_MINUTES / count));
}

export function getMatchRuleInputValidation(source = {}, { mode = source.mode || "3v3" } = {}) {
  const defaults = getDefaultMatchRules(mode);
  const hasValue = (key) => Object.prototype.hasOwnProperty.call(source, key);
  const valueFor = (key) => (hasValue(key) ? source[key] : defaults[key]);
  const normalized = normalizeMatchRules(source, { mode });
  const fieldMessages = {};
  const errors = [];

  const validateInteger = (key, {
    min,
    max,
    minimumLabel = `최소 ${min}`,
    maximumLabel = `최대 ${max}`,
    errorLabel,
  }) => {
    const rawValue = valueFor(key);
    const text = String(rawValue ?? "").trim();
    const number = parseInteger(rawValue);
    let message = "";
    if (!text) message = "필수";
    else if (number === null) message = "정수만";
    else if (number < min) message = minimumLabel;
    else if (number > max) message = maximumLabel;
    if (!message) return number;
    fieldMessages[key] = message;
    errors.push(errorLabel);
    return null;
  };

  if (normalized.endCondition === "target_or_time") {
    validateInteger("targetScore", {
      min: 7,
      max: 99,
      minimumLabel: "최소 7점",
      maximumLabel: "최대 99점",
      errorLabel: "목표 점수는 7~99점의 정수로 입력해 주세요.",
    });
  }

  const periodCount = normalized.periodCount;
  const periodMinutesMax = getMatchPeriodMinutesMax(periodCount);
  const periodMinutes = validateInteger("periodMinutes", {
    min: 1,
    max: periodMinutesMax,
    minimumLabel: "최소 1분",
    maximumLabel: `전체 최대 ${MATCH_MAX_REGULATION_MINUTES}분`,
    errorLabel: `정규 경기시간은 총 ${MATCH_MAX_REGULATION_MINUTES}분 이하로 입력해 주세요.`,
  });

  if (normalized.gameClockEnabled && normalized.clockMode === "running") {
    validateInteger("lastPeriodStopMinutes", {
      min: 0,
      max: periodMinutes ?? periodMinutesMax,
      minimumLabel: "최소 0분",
      maximumLabel: `최대 ${periodMinutes ?? periodMinutesMax}분`,
      errorLabel: "마지막 스톱 구간은 해당 경기 구간 시간 이내로 입력해 주세요.",
    });
  }
  if (periodCount === 4) {
    validateInteger("periodBreakMinutes", {
      min: 0,
      max: 30,
      minimumLabel: "최소 0분",
      maximumLabel: "최대 30분",
      errorLabel: "쿼터 사이 휴식은 0~30분으로 입력해 주세요.",
    });
  }
  if (periodCount > 1) {
    validateInteger("halftimeMinutes", {
      min: 0,
      max: 30,
      minimumLabel: "최소 0분",
      maximumLabel: "최대 30분",
      errorLabel: "하프타임은 0~30분으로 입력해 주세요.",
    });
  }
  validateInteger("overtimeMinutes", {
    min: 1,
    max: 20,
    minimumLabel: "최소 1분",
    maximumLabel: "최대 20분",
    errorLabel: "연장 시간은 1~20분으로 입력해 주세요.",
  });

  return {
    valid: errors.length === 0,
    fieldMessages,
    errors: [...new Set(errors)],
    regulationMinutes: periodMinutes === null ? null : periodCount * periodMinutes,
    maxRegulationMinutes: MATCH_MAX_REGULATION_MINUTES,
  };
}

export function getDefaultMatchRules(mode = "3v3") {
  const fiveOnFive = mode === "5v5";
  return {
    ruleSet: "standard",
    gameClockEnabled: true,
    endCondition: fiveOnFive ? "time" : "target_or_time",
    targetScore: 21,
    periodCount: fiveOnFive ? 4 : 1,
    periodMinutes: fiveOnFive ? 10 : 12,
    periodBreakMinutes: 2,
    halftimeMinutes: fiveOnFive ? 10 : 5,
    overtimeMinutes: fiveOnFive ? 5 : 3,
    clockMode: fiveOnFive ? "stopped" : "running",
    lastPeriodStopMinutes: 0,
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
  const gameClockEnabled = source.gameClockEnabled !== false && source.gameClockEnabled !== "false";
  const qrAttendanceEnabled = !["match_record", "solo", "personal_record"].includes(String(source.recordType ?? "").trim().toLowerCase());
  const hasPeriodModel = PERIOD_COUNTS.has(Number(source.periodCount));
  const periodCount = hasPeriodModel ? Number(source.periodCount) : 1;
  const legacyPeriodMinutes = hasPeriodModel ? defaults.periodMinutes : source.timeLimit;
  const periodMinutes = clampInteger(
    source.periodMinutes ?? legacyPeriodMinutes,
    defaults.periodMinutes,
    1,
    getMatchPeriodMinutesMax(periodCount),
  );
  const endCondition = END_CONDITIONS.has(source.endCondition) ? source.endCondition : defaults.endCondition;
  const clockMode = CLOCK_MODES.has(source.clockMode) ? source.clockMode : defaults.clockMode;
  const lastPeriodStopMinutes = clockMode === "running"
    ? clampInteger(source.lastPeriodStopMinutes, defaults.lastPeriodStopMinutes, 0, periodMinutes)
    : 0;
  const meetingPoint = String(source.meetingPoint ?? "").trim().slice(0, 120);

  return {
    ...source,
    ruleSet: source.ruleSet === "fiba_3x3" && mode === "3v3" ? "fiba_3x3" : "standard",
    gameClockEnabled,
    qrAttendanceEnabled,
    endCondition,
    targetScore: clampInteger(source.targetScore, defaults.targetScore, 7, 99),
    periodCount,
    periodMinutes,
    periodBreakMinutes: clampInteger(source.periodBreakMinutes, defaults.periodBreakMinutes, 0, 30),
    halftimeMinutes: clampInteger(source.halftimeMinutes, defaults.halftimeMinutes, 0, 30),
    overtimeMinutes: clampInteger(source.overtimeMinutes, defaults.overtimeMinutes, 1, 20),
    clockMode,
    lastPeriodStopMinutes,
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
    ruleSet: rules.ruleSet,
    gameClockEnabled: rules.gameClockEnabled,
    qrAttendanceEnabled: rules.qrAttendanceEnabled,
    endCondition: rules.endCondition,
    targetScore: rules.targetScore,
    periodCount: rules.periodCount,
    periodMinutes: rules.periodMinutes,
    periodBreakMinutes: rules.periodBreakMinutes,
    halftimeMinutes: rules.halftimeMinutes,
    overtimeMinutes: rules.overtimeMinutes,
    clockMode: rules.clockMode,
    lastPeriodStopMinutes: rules.lastPeriodStopMinutes,
    timeLimit: rules.timeLimit,
    ball: rules.ball,
    winByTwo: rules.winByTwo,
    attackRule: rules.attackRule,
    foulRule: rules.foulRule,
    meetingPoint: rules.meetingPoint,
    meetBeforeMinutes: rules.meetBeforeMinutes,
  };
}

export function isFiba3x3Rules(mode = "", rules = {}) {
  if (mode !== "3v3") return false;
  const normalized = normalizeMatchRules(rules, { mode });
  return normalized.ruleSet === "fiba_3x3" || (
    Number(normalized.targetScore) === 21
    && Number(normalized.periodCount) === 1
    && Number(normalized.periodMinutes) === 12
    && normalized.endCondition === "target_or_time"
    && normalized.winByTwo === true
  );
}

export function getMatchFormatLabel(mode = "", rules = {}) {
  return isFiba3x3Rules(mode, rules) ? "3x3" : mode;
}

export function getMatchPeriodLabel(rules = {}, mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  if (normalized.periodCount === 4) return `4쿼터 × ${normalized.periodMinutes}분`;
  if (normalized.periodCount === 2) return `2하프 × ${normalized.periodMinutes}분`;
  return `단일 ${normalized.periodMinutes}분`;
}

export function getMatchClockLabel(rules = {}, mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  if (!normalized.gameClockEnabled) return "사용 안 함";
  if (normalized.clockMode === "stopped") return "사용 · 스톱타임";
  return normalized.lastPeriodStopMinutes > 0
    ? `사용 · 러닝타임 · 마지막 ${normalized.lastPeriodStopMinutes}분 스톱`
    : "사용 · 러닝타임";
}

export function getMatchEndLabel(rules = {}, mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  if (normalized.endCondition === "time") return "시간 종료";
  return `${normalized.targetScore}점 또는 시간${normalized.winByTwo ? " · 2점 차 승리" : ""}`;
}

export function getMatchBreakLabel(rules = {}, mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  if (normalized.periodCount === 4) {
    return `쿼터 사이 ${normalized.periodBreakMinutes}분 · 하프타임 ${normalized.halftimeMinutes}분`;
  }
  if (normalized.periodCount === 2) return `하프타임 ${normalized.halftimeMinutes}분`;
  return "별도 휴식 없음";
}

export function getMatchRuleDetailRows(rules = {}, mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  return [
    { label: "경기 구성", value: getMatchPeriodLabel(normalized, mode) },
    { label: "BOXTIER 모바일 전광판", value: getMatchClockLabel(normalized, mode) },
    ...(normalized.qrAttendanceEnabled ? [{ label: "출석", value: "QR 출석 · 경기 20분 전부터" }] : []),
    { label: "종료 기준", value: getMatchEndLabel(normalized, mode) },
    ...(normalized.periodCount > 1 ? [{ label: "휴식", value: getMatchBreakLabel(normalized, mode) }] : []),
    { label: "연장", value: `${normalized.overtimeMinutes}분` },
    { label: "사용 공", value: normalized.ball },
  ];
}

export function getMatchRuleSummary(rules = {}, mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  return [
    getMatchPeriodLabel(normalized, mode),
    getMatchClockLabel(normalized, mode),
    getMatchEndLabel(normalized, mode),
    normalized.ball,
  ].join(" · ");
}

export function getMeetingPointSummary(rules = {}, timingType = "scheduled", mode = "3v3") {
  const normalized = normalizeMatchRules(rules, { mode });
  if (!normalized.meetingPoint) return "만남 장소 미정";
  if (timingType === "instant" || normalized.meetBeforeMinutes <= 0) return normalized.meetingPoint;
  return `${normalized.meetingPoint} · 시작 ${normalized.meetBeforeMinutes}분 전`;
}
