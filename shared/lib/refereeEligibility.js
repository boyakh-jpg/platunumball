import {
  REFEREE_TRUST_MIN,
  TEST_REFEREE_LOGIN_IDS,
  isRefereeGrade,
} from "./constants.js";

const INACTIVE_REFEREE_STATUSES = new Set([
  "pending",
  "rejected",
  "revoked",
  "expired",
  "suspended",
  "blocked",
]);
const TEST_REFEREE_LOGIN_ID_SET = new Set(TEST_REFEREE_LOGIN_IDS);

function isActiveRefereeStatus(status = "active") {
  return !INACTIVE_REFEREE_STATUSES.has(String(status || "active"));
}

function isActiveRefereeTerm(record = {}, nowMs = Date.now(), throughMs = nowMs) {
  const startsAt = record.startsAt ? new Date(record.startsAt).getTime() : 0;
  const endsAt = record.endsAt ? new Date(record.endsAt).getTime() : Infinity;
  const normalizedStart = Number.isFinite(startsAt) ? startsAt : 0;
  const normalizedEnd = Number.isFinite(endsAt) ? endsAt : Infinity;
  const normalizedThrough = Number.isFinite(throughMs) ? Math.max(nowMs, throughMs) : nowMs;
  return normalizedStart <= nowMs && normalizedThrough <= normalizedEnd;
}

function hasRefereeQualification(
  user = {},
  refereeAppointments = [],
  nowMs = Date.now(),
  throughMs = nowMs,
) {
  if (!user?.id) return false;
  if (TEST_REFEREE_LOGIN_ID_SET.has(String(user.testLoginId ?? "").toLowerCase())) return true;
  const profile = user.refereeProfile ?? {};
  const profileGrade = profile.grade ?? user.refereeGrade;
  const profileStatus = profile.status ?? user.refereeStatus ?? "active";
  const profileQualified = (
    user.officialReferee === true
    || user.refereeLicenseVerified === true
    || profile.licenseVerified === true
    || profile.examPassed === true
    || isRefereeGrade(profileGrade)
  );
  if (
    profileQualified
    && isActiveRefereeStatus(profileStatus)
    && isActiveRefereeTerm(profile, nowMs, throughMs)
  ) return true;

  return refereeAppointments.some((appointment) => {
    const appointmentUserId = appointment.userId ?? appointment.user_id;
    const role = appointment.role ?? "referee";
    const grade = appointment.grade ?? appointment.refereeGrade;
    return (
      appointmentUserId === user.id
      && role === "referee"
      && isRefereeGrade(grade)
      && isActiveRefereeStatus(appointment.status)
      && isActiveRefereeTerm(appointment, nowMs, throughMs)
    );
  });
}

export function getMatchReferee(match = {}, users = []) {
  return users.find((user) => user.id === match.refereeId) ?? null;
}

export function isEligibleReferee(
  user = {},
  minTrust = REFEREE_TRUST_MIN,
  refereeAppointments = [],
  throughDate = null,
) {
  const parsedThroughMs = throughDate
    ? new Date(
      String(throughDate).length === 10
        ? `${throughDate}T23:59:59.999Z`
        : throughDate,
    ).getTime()
    : Date.now();
  if (TEST_REFEREE_LOGIN_ID_SET.has(String(user?.testLoginId ?? "").toLowerCase())) return true;
  return (
    Number(user?.trustScore ?? 0) >= Number(minTrust ?? REFEREE_TRUST_MIN)
    && hasRefereeQualification(user, refereeAppointments, Date.now(), parsedThroughMs)
  );
}

export function isMatchReferee(match = {}, userId) {
  return Boolean(match.refereeId && userId && match.refereeId === userId);
}
