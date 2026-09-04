import { getMatchHostPlayerId, isSeedSampleMatch } from "../../shared/lib/matchAuthority.js";
import { isMatchRecordMatch, isPersonalRecordMatch } from "../../shared/lib/matchRecordTypes.js";
import { getMatchRoomPhase } from "../../shared/lib/matchRoomLifecycle.js";
import { isMatchReferee } from "../../shared/lib/refereeEligibility.js";

const NOW_PHASES = new Set(["checkin", "live", "postgame", "dispute"]);
const PAST_PHASES = new Set(["record", "cancelled", "void"]);
const OPERATIONS_PHASES = new Set(["waiting", "locked", ...NOW_PHASES, ...PAST_PHASES]);

function getSourcePost(recruitingPosts, recruitingPostId) {
  if (!recruitingPostId) return null;
  if (recruitingPosts instanceof Map) return recruitingPosts.get(recruitingPostId) ?? null;
  if (Array.isArray(recruitingPosts)) {
    return recruitingPosts.find((post) => post?.id === recruitingPostId) ?? null;
  }
  return recruitingPosts?.[recruitingPostId] ?? null;
}

export function getOperationsMatchRole(match = {}, userId = "", sourcePost = null) {
  if (!userId) return null;
  if (isMatchReferee(match, userId)) return "referee";
  if (getMatchHostPlayerId(match, sourcePost) === userId) return "host";
  return null;
}

export function getOperationsMatchBucket(match = {}, now = new Date()) {
  const phase = getMatchRoomPhase(match, now).phase;
  if (NOW_PHASES.has(phase)) return "now";
  if (PAST_PHASES.has(phase)) return "past";
  return "upcoming";
}

export function isOperationsMatchEligible(match = {}, now = new Date()) {
  if (
    !match?.id
    || isSeedSampleMatch(match)
    || isPersonalRecordMatch(match)
    || isMatchRecordMatch(match)
    || String(match.status ?? "").trim().toLowerCase() === "closed"
  ) return false;
  return OPERATIONS_PHASES.has(getMatchRoomPhase(match, now).phase);
}

export function canRepeatOperationsMatch(match = {}, userId = "", sourcePost = null, now = new Date()) {
  if (!userId || !match.recruitingPostId || getMatchHostPlayerId(match, sourcePost) !== userId) return false;
  return PAST_PHASES.has(getMatchRoomPhase(match, now).phase);
}

export function selectOperationsMatches(matches = [], userId = "", options = {}) {
  const { recruitingPosts = [], now = new Date() } = options ?? {};
  const result = { now: [], upcoming: [], past: [] };

  for (const match of Array.isArray(matches) ? matches : []) {
    if (!isOperationsMatchEligible(match, now)) continue;
    const sourcePost = getSourcePost(recruitingPosts, match.recruitingPostId);
    const role = getOperationsMatchRole(match, userId, sourcePost);
    if (!role) continue;
    const phase = getMatchRoomPhase(match, now);
    const bucket = getOperationsMatchBucket(match, now);
    result[bucket].push({
      match,
      sourcePost,
      phase,
      role,
      canRepeat: canRepeatOperationsMatch(match, userId, sourcePost, now),
    });
  }

  return result;
}
