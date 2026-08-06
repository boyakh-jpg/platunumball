import { BASKETBALL_POSITIONS, MAX_TEAM_MEMBERS, MAX_TEAM_MEMBERSHIPS } from "./constants.js";
import { AGE_GROUPS, getAgeGroupLabel } from "./profileSetup.js";

export const TEAM_JOIN_APPLICATION_LIMITS = Object.freeze({
  sns: 120,
  contact: 120,
  availability: 300,
  heightMin: 100,
  heightMax: 250,
});

export const TEAM_JOIN_AGE_OPTIONS = Object.freeze(AGE_GROUPS.map((group) => Object.freeze({
  value: group.id,
  label: getAgeGroupLabel(group.id),
})));

export const TEAM_JOIN_GENDER_OPTIONS = Object.freeze([
  Object.freeze({ value: "male", label: "남성" }),
  Object.freeze({ value: "female", label: "여성" }),
  Object.freeze({ value: "other", label: "기타" }),
]);

const cleanText = (value) => String(value ?? "").trim();
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function normalizeTeamJoinApplication(value = {}) {
  const source = asObject(value);
  const heightText = cleanText(source.heightCm);
  return {
    sns: cleanText(source.sns),
    contact: cleanText(source.contact),
    heightCm: heightText ? Number(heightText) : null,
    position: cleanText(source.position),
    availability: cleanText(source.availability),
    ageGroup: cleanText(source.ageGroup),
    gender: cleanText(source.gender),
  };
}

export function getTeamJoinApplicationError(value = {}) {
  if (value != null && (typeof value !== "object" || Array.isArray(value))) return "신청서 형식이 올바르지 않습니다.";
  const application = normalizeTeamJoinApplication(value);
  if (application.sns.length > TEAM_JOIN_APPLICATION_LIMITS.sns) return "SNS가 너무 깁니다.";
  if (application.contact.length > TEAM_JOIN_APPLICATION_LIMITS.contact) return "연락처가 너무 깁니다.";
  if (application.availability.length > TEAM_JOIN_APPLICATION_LIMITS.availability) return "경기 가능 시간이 너무 깁니다.";
  if (application.heightCm !== null && (!Number.isInteger(application.heightCm)
    || application.heightCm < TEAM_JOIN_APPLICATION_LIMITS.heightMin
    || application.heightCm > TEAM_JOIN_APPLICATION_LIMITS.heightMax)) return `키는 ${TEAM_JOIN_APPLICATION_LIMITS.heightMin}~${TEAM_JOIN_APPLICATION_LIMITS.heightMax}cm로 입력해 주세요.`;
  if (application.position && !BASKETBALL_POSITIONS.includes(application.position)) return "포지션을 다시 선택해 주세요.";
  if (application.ageGroup && !TEAM_JOIN_AGE_OPTIONS.some((option) => option.value === application.ageGroup)) return "연령대를 다시 선택해 주세요.";
  if (application.gender && !TEAM_JOIN_GENDER_OPTIONS.some((option) => option.value === application.gender)) return "성별을 다시 선택해 주세요.";
  return "";
}

export function getTeamJoinApplicationBlockReason({
  demoPreview = false,
  currentUserIsMember = false,
  currentTeamCount = 0,
  targetTeamMemberCount = 0,
  hasPendingRequest = false,
  hasPendingInvite = false,
} = {}) {
  if (demoPreview) return "로그인 후 가입을 신청할 수 있습니다.";
  if (currentUserIsMember) return "이미 소속된 팀입니다.";
  if (hasPendingRequest) return "이미 가입 승인을 기다리고 있습니다.";
  if (hasPendingInvite) return "먼저 도착한 팀 초대를 확인해 주세요.";
  if (targetTeamMemberCount >= MAX_TEAM_MEMBERS) return `팀 정원 ${MAX_TEAM_MEMBERS}명이 모두 찼습니다.`;
  if (currentTeamCount >= MAX_TEAM_MEMBERSHIPS) return `선수는 최대 ${MAX_TEAM_MEMBERSHIPS}개 팀에 소속될 수 있습니다.`;
  return "";
}
