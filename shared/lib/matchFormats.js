import { MATCH_MODES } from "./matchConstants.js";

export const MATCH_FORMAT_FILTERS = Object.freeze(MATCH_MODES.flatMap((mode) => (
  mode.id === "3v3"
    ? [mode, { id: "3x3", label: "3x3" }]
    : [mode]
)).map(({ id, label }) => Object.freeze({ id, label })));

export function isFiba3x3Rules(mode = "", rules = {}) {
  if (mode !== "3v3") return false;
  const ruleSet = String(rules?.ruleSet ?? "").trim().toLowerCase();
  if (ruleSet === "fiba_3x3") return true;
  if (ruleSet) return false;
  return (
    Number(rules?.targetScore) === 21
    && Number(rules?.periodCount) === 1
    && Number(rules?.periodMinutes) === 12
    && rules?.endCondition === "target_or_time"
    && rules?.winByTwo === true
  );
}

export function getMatchFormatLabel(mode = "", rules = {}) {
  return isFiba3x3Rules(mode, rules) ? "3x3" : mode;
}

export function matchesMatchFormatFilter(match = {}, filter = "all") {
  const normalizedFilter = String(filter ?? "all");
  return normalizedFilter === "all"
    || getMatchFormatLabel(match?.mode, match?.rules) === normalizedFilter;
}

export function getMatchFormatFilterLabel(value = "all", fallback = "전체 방식") {
  if (value === "all") return fallback;
  return MATCH_FORMAT_FILTERS.find(({ id }) => id === value)?.label ?? value;
}
