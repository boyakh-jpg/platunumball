import { RECORD_TYPES } from "./constants.js";

export const MATCH_INTENT_OPTIONS = Object.freeze([
  {
    id: "friendly",
    label: "친선전",
    description: "MMR을 반영하지 않습니다.",
  },
  {
    id: "standard_competitive",
    label: "경쟁전",
    description: "MMR을 반영합니다.",
  },
  {
    id: "pickup",
    label: "픽업",
    description: "개인으로 참가하고 현장에서 팀과 교대 순서를 정합니다.",
  },
]);

export const MATCH_PURPOSE_OPTIONS = Object.freeze([
  { id: "friendly", label: "친선전", description: "MMR을 반영하지 않습니다." },
  { id: "competitive", label: "경쟁전", description: "MMR을 반영합니다." },
]);

export const MATCH_FORMATION_OPTIONS = Object.freeze([
  {
    id: "prearranged",
    label: "경기 전 구성",
    description: "경기 전에 A/B사이드와 출전·후보를 정합니다.",
  },
  {
    id: "pickup",
    label: "현장 픽업",
    description: "개인으로 참가해 현장에서 팀과 교대 순서를 정합니다.",
  },
]);

export const HOST_JOIN_MODE_OPTIONS = Object.freeze([
  { id: "team", label: "팀전" },
  { id: "player", label: "개인전" },
]);

export const PLAYING_TIME_POLICY_OPTIONS = Object.freeze([
  { id: "appearance_guaranteed", label: "최소 1회 출전" },
  { id: "equal_rotation", label: "균등 순환" },
  { id: "none", label: "출전 보장 없음" },
]);

export const PICKUP_ROTATION_MODE_OPTIONS = Object.freeze([
  { id: "period", label: "쿼터·하프 종료마다" },
  { id: "interval", label: "시간 간격으로" },
  { id: "manual", label: "직접 교대" },
]);

export const PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS = Object.freeze([
  {
    id: "manual",
    label: "현장 직접 배치",
    description: "체크인한 참가자를 방장 또는 심판이 직접 나눕니다.",
  },
  {
    id: "random",
    label: "완전 랜덤 배치",
    description: "체크인한 참가자를 무작위로 나눈 뒤 방장 또는 심판이 확정합니다.",
  },
  {
    id: "mmr_balanced",
    label: "MMR 균형 배치",
    description: "체크인한 참가자의 MMR 합이 비슷하도록 나눈 뒤 방장 또는 심판이 확정합니다.",
  },
]);

export const PAYMENT_POLICY_OPTIONS = Object.freeze([
  { id: "equal_all_confirmed", label: "확정 인원 전원 균등" },
  { id: "team_fixed_share", label: "팀별 균등" },
  { id: "host_pays", label: "방장 부담" },
  { id: "free", label: "참가비 없음" },
]);

export const VENUE_PAYMENT_TYPE_OPTIONS = Object.freeze([
  { id: "free_public", label: "무료 공공구장" },
  { id: "first_come_public", label: "무료·현장 선점" },
  { id: "paid_reserved", label: "유료·예약 완료" },
  { id: "paid_not_reserved", label: "유료·예약 전" },
  { id: "private", label: "사설·별도 협의" },
]);

export const VENUE_SECURED_OPTIONS = Object.freeze([
  { id: "confirmed", label: "확보 완료" },
  { id: "first_come", label: "현장 선점" },
  { id: "unconfirmed", label: "미확정" },
]);

export const COST_ROUND_UNIT_OPTIONS = Object.freeze([
  { id: 100, label: "100원 단위" },
  { id: 500, label: "500원 단위" },
]);

export const REFUND_POLICY_OPTIONS = Object.freeze([
  { id: "full_before_deadline", label: "마감 전 전액 환불" },
  { id: "no_refund", label: "환불 없음" },
  { id: "custom", label: "별도 협의" },
]);

export const VESTS_PROVIDED_OPTIONS = Object.freeze([
  { id: "provided", label: "제공", value: true },
  { id: "not_provided", label: "미제공", value: false },
]);

export const RECORD_ENTRY_MODE_OPTIONS = Object.freeze([
  {
    id: "quick",
    label: "빠른 기록",
    description: "상대 정보 없이 날짜·방식·점수와 내 활약만 남깁니다.",
  },
  {
    id: "named",
    label: "이름 기록",
    description: "선수 이름을 자유롭게 적고 승인 없이 내 기록으로 저장합니다.",
  },
]);

export const RECORD_COMPOSITION_OPTIONS = Object.freeze([
  {
    id: "individual",
    label: "개인 구성",
    description: "A/B 선수를 계정으로 직접 채웁니다.",
  },
  {
    id: "team",
    label: "팀 구성",
    description: "등록된 두 팀의 팀장이 실제 출전 명단을 확인합니다.",
  },
]);

const RECORD_ENTRY_MODE_IDS = new Set(RECORD_ENTRY_MODE_OPTIONS.map((option) => option.id));
const RECORD_COMPOSITION_IDS = new Set(RECORD_COMPOSITION_OPTIONS.map((option) => option.id));

export function getRecordEntryMode(source = {}) {
  if (RECORD_ENTRY_MODE_IDS.has(source.recordEntryMode)) return source.recordEntryMode;
  return "quick";
}

export function getRecordComposition(source = {}) {
  if (RECORD_COMPOSITION_IDS.has(source.recordComposition)) return source.recordComposition;
  return source.hostJoinMode === "team" || source.teamOnly === true ? "team" : "individual";
}

export function getMatchCreationWizardType(source = {}, { recordIntent = false } = {}) {
  if (source.recordType === RECORD_TYPES.personalRecord) return "personal_record";
  if (source.recordType === RECORD_TYPES.matchRecord || recordIntent) return "match_record";
  if (source.visibility === "tournament") return "tournament";
  return "match";
}
