export const DEFAULT_RATING_POLICY = Object.freeze({});
export const RATING_POLICY_GROUPS = Object.freeze([]);
export const RATING_POLICY_MODE_IDS = Object.freeze(["1v1", "2v2", "3v3", "5v5"]);

export function cloneRatingPolicy(policy = {}) {
  return JSON.parse(JSON.stringify(policy ?? {}));
}

export function getRatingPolicyValue(policy, path = []) {
  return path.reduce((value, key) => value?.[key], policy);
}

export function setRatingPolicyValue(policy, path = [], value) {
  const next = cloneRatingPolicy(policy);
  let cursor = next;
  path.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key];
  });
  if (path.length) cursor[path.at(-1)] = value;
  return next;
}

export function normalizeRatingPolicy(policy = {}, groups = [], defaults = {}) {
  let normalized = cloneRatingPolicy(defaults);
  const fields = groups.flatMap((group) => group.fields ?? []);
  fields.forEach((field) => {
    const raw = Number(getRatingPolicyValue(policy, field.path));
    const fallback = Number(getRatingPolicyValue(defaults, field.path));
    const value = Number.isFinite(raw) ? raw : fallback;
    if (!Number.isFinite(value)) return;
    const stepped = Number(field.step) >= 1 ? Math.round(value) : value;
    normalized = setRatingPolicyValue(normalized, field.path, Math.max(field.min, Math.min(field.max, stepped)));
  });
  return normalized;
}
