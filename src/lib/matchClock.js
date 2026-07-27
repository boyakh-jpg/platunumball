import { postServerAction } from "./serverActions.js";
import { isPracticeId, PRACTICE_LOCAL_ONLY_ERROR } from "./practiceMode.js";

export const SHOT_CLOCK_OPTIONS = Object.freeze([
  { value: 0, label: "사용 안 함" },
  { value: 24, label: "24초" },
  { value: 30, label: "30초" },
  { value: 60, label: "1분" },
]);

export const MATCH_CLOCK_FALLBACK_FACTORS = Object.freeze({
  "1v1": 0.5,
  "2v2": 0.65,
  "3v3": 0.8,
  "5v5": 0.9,
});

export function requestMatchClock(matchId, action = "read", payload = {}) {
  if (isPracticeId(matchId)) {
    const error = new Error(PRACTICE_LOCAL_ONLY_ERROR);
    error.code = PRACTICE_LOCAL_ONLY_ERROR;
    return Promise.reject(error);
  }
  return postServerAction("/api/matches/clock", { matchId, action, payload });
}

export function deriveMatchClock(clock, nowMs = Date.now()) {
  if (!clock) return null;
  const serverNowMs = Date.parse(clock.serverNow || "") || nowMs;
  const resumedAtMs = Date.parse(clock.lastResumedAt || "") || serverNowMs;
  const receivedAtMs = Number(clock.clientReceivedAtMs || nowMs);
  const liveElapsedMs = clock.status === "running"
    ? Math.max(0, serverNowMs - resumedAtMs + nowMs - receivedAtMs)
    : 0;
  const appliedMs = Math.min(liveElapsedMs, Number(clock.periodRemainingMs || 0));
  return {
    ...clock,
    periodRemainingMs: Math.max(0, Number(clock.periodRemainingMs || 0) - appliedMs),
    shotRemainingMs: Number(clock.shotClockSeconds || 0) > 0
      ? Math.max(0, Number(clock.shotRemainingMs || 0) - appliedMs)
      : 0,
    activeElapsedMs: Number(clock.activeElapsedMs || 0) + appliedMs,
  };
}

export function formatClockTime(milliseconds, { tenths = false } = {}) {
  const safeMs = Math.max(0, Number(milliseconds || 0));
  if (tenths && safeMs < 60000) {
    const minutes = Math.floor(safeMs / 60000);
    const seconds = Math.floor((safeMs % 60000) / 1000);
    const displayTenths = Math.floor((safeMs % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${displayTenths}`;
  }
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getMatchClockPeriodLabel(clock) {
  if (!clock) return "";
  return Number(clock.overtimeCount || 0) > 0
    ? `연장 ${clock.overtimeCount}`
    : `${clock.currentPeriod}쿼터`;
}

export function getMatchClockRecognition(clock) {
  if (!clock) return { ratio: 0, recognized: false };
  const minimumMs = Number(clock.minimumActiveMs || 0);
  const expectedMs = minimumMs > 0 ? minimumMs / 0.7 : 0;
  const ratio = expectedMs > 0 ? Math.min(1, Number(clock.activeElapsedMs || 0) / expectedMs) : 0;
  return {
    ratio,
    recognized: Boolean(clock.clockUsed),
    startedInWindow: Boolean(clock.startedWithinWindow),
  };
}
