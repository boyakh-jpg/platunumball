import {
  LIFECYCLE_TITLE_PATTERN,
  POST_MATCH_TITLE_PATTERN,
  normalizeDisputeWindowMinutes,
} from "./constants.js";
import { getMatchScheduledDate } from "./matchScheduleTime.js";
import { isInstantRoom } from "./matchTimeUtils.js";

export function getScheduledStartMs(match = {}) {
  if (isInstantRoom(match)) return null;
  return getMatchScheduledDate(match)?.getTime() ?? null;
}

export function isFutureScheduledMatch(match = {}) {
  const scheduledMs = getScheduledStartMs(match);
  return Number.isFinite(scheduledMs) && scheduledMs > Date.now();
}

function getPregameMatchTitle(match = {}) {
  const label = match.status === "contract" ? "동의 대기" : "진행 예정";
  const versus = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return `${label} · ${versus || String(match.title ?? "").replace(POST_MATCH_TITLE_PATTERN, "") || "경기"}`;
}

function getLifecycleTitleLabel(status) {
  if (status === "contract") return "동의 대기";
  if (status === "agreed") return "진행 예정";
  if (status === "approval") return "결과 승인";
  if (status === "disputed") return "이의 확인";
  if (status === "confirmed") return "확정";
  return "";
}

export function repairLifecycleTitle(match) {
  const label = getLifecycleTitleLabel(match.status);
  if (!label || !LIFECYCLE_TITLE_PATTERN.test(match.title ?? "")) return match;
  const versus = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return { ...match, title: `${label} · ${versus || String(match.title ?? "").replace(LIFECYCLE_TITLE_PATTERN, "") || "경기"}` };
}

export function resetFuturePostMatchState(match) {
  const repaired = { ...match, status: "agreed" };
  const nextRules = { ...(match.rules ?? {}) };
  delete nextRules.startedAt;
  return {
    ...repaired,
    status: "agreed",
    title: getPregameMatchTitle(repaired),
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    result: null,
    ratingResult: null,
    teamRatingResult: null,
    startedAt: null,
    endedAt: null,
    confirmedAt: null,
    rules: nextRules,
    teamA: { ...(match.teamA ?? {}), score: 0 },
    teamB: { ...(match.teamB ?? {}), score: 0 },
  };
}

export function clearFuturePregameStartState(match) {
  if (!["contract", "agreed"].includes(match.status) || !isFutureScheduledMatch(match)) return match;
  if (!match.startedAt && !match.rules?.startedAt) return match;
  const nextRules = { ...(match.rules ?? {}) };
  delete nextRules.startedAt;
  return { ...match, startedAt: null, rules: nextRules };
}

export function repairFuturePregameTitle(match) {
  if (!["contract", "agreed"].includes(match.status) || !POST_MATCH_TITLE_PATTERN.test(match.title ?? "")) return match;
  return { ...match, title: getPregameMatchTitle(match) };
}

export function normalizeDisputeMinutes(match) {
  return normalizeDisputeWindowMinutes(match.disputeMinutes);
}
