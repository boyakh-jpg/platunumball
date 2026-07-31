// Shared age-group policy used by client profile flows and server validation.
export const PROFILE_NAME_MAX_LENGTH = 20;

export function normalizeProfileName(value) {
  return String(value ?? "").trim().slice(0, PROFILE_NAME_MAX_LENGTH);
}

export const AGE_GROUPS = [
  { id: "junior", label: "Junior", rangeLabel: "U-13", minAge: 0, maxAge: 12 },
  { id: "rising", label: "Rising", rangeLabel: "U-20", minAge: 13, maxAge: 19 },
  { id: "open", label: "Open", rangeLabel: "Open", minAge: 20, maxAge: 120 },
];

export function getAgeGroupByBirthYear(birthYear, now = new Date()) {
  const year = Number(birthYear);
  if (!Number.isInteger(year) || year < 1900) return null;
  if (year > now.getFullYear()) return null;
  const age = now.getFullYear() - year;
  return AGE_GROUPS.find((group) => age >= group.minAge && age <= group.maxAge)?.id ?? "open";
}

export function formatProfileDate(date) {
  if (!date) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export function getAgeGroupSeasonForDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = safeDate.getFullYear();
  const isFirstHalf = safeDate.getMonth() < 6;
  return {
    id: `${year}-${isFirstHalf ? "h1" : "h2"}`,
    label: `${year} ${isFirstHalf ? "1" : "2"}시즌`,
    startsAt: `${year}-${isFirstHalf ? "01-01" : "07-01"}`,
    endsAt: `${year}-${isFirstHalf ? "06-30" : "12-31"}`,
  };
}

export function getAgeGroupSeasonLabel(now = new Date()) {
  const season = getAgeGroupSeasonForDate(now);
  return `${season.label} · ${season.startsAt.slice(5).replace("-", ".")}~${season.endsAt.slice(5).replace("-", ".")}`;
}

export function shouldRecheckAgeGroup(user, now = new Date()) {
  return Boolean(user?.birthYear && user?.onboardingComplete && user?.ageGroupCheckedSeason !== getAgeGroupSeasonForDate(now).id);
}

export function getAgeGroupLabel(ageGroupId) {
  const group = AGE_GROUPS.find((item) => item.id === ageGroupId) ?? AGE_GROUPS[2];
  if (String(group.label).toLowerCase() === String(group.rangeLabel).toLowerCase()) return group.label;
  return `${group.label} · ${group.rangeLabel}`;
}

export function getAgeGroupForUser(user, now = new Date()) {
  return getAgeGroupByBirthYear(user?.birthYear, now) ?? user?.ageGroup ?? "open";
}
