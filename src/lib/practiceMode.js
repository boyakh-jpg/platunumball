export const PRACTICE_ID_PREFIX = "practice-";
export const PRACTICE_LOCAL_ONLY_ERROR = "practice_mode_is_local_only";

const PRACTICE_ID_KEYS = new Set([
  "id",
  "matchId",
  "postId",
  "recruitingPostId",
  "preferredMatchId",
  "preferredPostId",
  "remakeSourceId",
  "remakeSourceMatchId",
]);

export function isPracticeId(value = "") {
  return String(value || "").startsWith(PRACTICE_ID_PREFIX);
}

export function isPracticeEntity(value) {
  if (typeof value === "string") return isPracticeId(value);
  if (!value || typeof value !== "object") return false;
  return value.practiceMode === true
    || value.rules?.practiceMode === true
    || value.roomState?.practiceMode === true
    || isPracticeId(value.id);
}

export function hasPracticeMutationPayload(value, key = "", depth = 0) {
  if (depth > 12 || value === null || value === undefined) return false;
  if (key === "practiceMode" && value === true) return true;
  if (typeof value === "string") return PRACTICE_ID_KEYS.has(key) && isPracticeId(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasPracticeMutationPayload(item, key, depth + 1));
  }
  if (isPracticeEntity(value)) return true;
  return Object.entries(value).some(([childKey, childValue]) => (
    hasPracticeMutationPayload(childValue, childKey, depth + 1)
  ));
}
