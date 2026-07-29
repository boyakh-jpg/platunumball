// Shared affiliation policy.
export const AFFILIATION_TYPE = "organization";
export const AFFILIATION_MAX_NAME_LENGTH = 40;
export const AFFILIATION_CHANGE_COOLDOWN_DAYS = 30;

export const NAME_REPORT_REASONS = Object.freeze([
  "혐오·차별 표현",
  "정치적 혐오 표현",
  "사칭·혼동 유발",
  "부적절한 이름",
  "기타 운영 확인 필요",
]);

export function normalizeAffiliationName(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, AFFILIATION_MAX_NAME_LENGTH);
}

export function getAffiliationNormalizedKey(value = "") {
  return normalizeAffiliationName(value).replace(/\s+/g, "").toLocaleLowerCase("ko-KR");
}

export function getAffiliationMemberCount(affiliation = {}) {
  const count = Number(affiliation.memberCount ?? affiliation.member_count ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function getNextAffiliationChangeDate(user = {}) {
  const value = user.affiliationUpdatedAt ?? user.affiliation_updated_at;
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  date.setDate(date.getDate() + AFFILIATION_CHANGE_COOLDOWN_DAYS);
  return date;
}

export function canChangeAffiliation(user = {}, now = new Date()) {
  const nextDate = getNextAffiliationChangeDate(user);
  return !nextDate || nextDate <= now;
}

export function formatAffiliationChangeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}
