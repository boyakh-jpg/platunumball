import { REPORT_TARGET_TYPES } from "../lib/reportReasons.js";
import { getMatchReservePlayerIds, getMatchSidePlayerIds } from "../lib/matchUtils.js";
import { REFEREE_EXAM_SIZE } from "../lib/refereeExamBank.js";

export const DEFAULT_COURT_REQUEST = {
  name: "",
  buildingName: "",
  courtUnit: "",
  region: "",
  sido: "",
  sigungu: "",
  type: "확인 필요",
  addressText: "",
  roadAddress: "",
  jibunAddress: "",
  addressDong: "",
  searchAddressText: "",
  zonecode: "",
  detailAddress: "",
  locationNote: "",
  lat: "",
  lng: "",
  courtKind: "unknown",
  surfaceType: "unknown",
  courtLayout: "unknown",
  accessType: "unknown",
  publicAccess: "unknown",
  lighting: null,
  paid: null,
  sourceUrl: "",
};

export const COURT_NEARBY_REVIEW_FIELDS = new Set([
  "name",
  "buildingName",
  "courtUnit",
  "addressText",
  "roadAddress",
  "jibunAddress",
  "zonecode",
  "lat",
  "lng",
]);

export const COURT_COST_OPTIONS = [
  { id: "unknown", label: "확인 필요", value: null },
  { id: "free", label: "무료", value: false },
  { id: "paid", label: "유료", value: true },
];

export const COURT_LIGHTING_OPTIONS = [
  { id: "unknown", label: "확인 필요", value: null },
  { id: "yes", label: "있음", value: true },
  { id: "no", label: "없음", value: false },
];

export const DEFAULT_REFEREE_REQUEST = {
  qualification: "community_exam",
  experience: "",
  memo: "",
};

export const SETTINGS_SECTIONS = {
  main: { eyebrow: "Settings", title: "설정" },
  favorites: { eyebrow: "Favorites", title: "즐겨찾기 설정" },
  profile: { eyebrow: "Profile", title: "프로필 노출 설정" },
  discord: { eyebrow: "Discord", title: "디스코드 알림" },
  courts: { eyebrow: "Court", title: "구장 신청" },
  referee: { eyebrow: "Referee", title: "심판 등록" },
};

export const EMBEDDED_SETTINGS_SECTIONS = new Set(["profile", "discord"]);

export function getPrivacyDraft(privacy = {}) {
  return {
    regionRanking: privacy.regionRanking !== false,
    teamHistory: privacy.teamHistory !== false,
    statSummary: privacy.statSummary !== false,
  };
}

export function makeRefereeAttemptId() {
  return `rea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getLatestRefereeExamAttempt(attempts = [], userId) {
  return [...attempts]
    .filter((attempt) => attempt.userId === userId)
    .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())[0] ?? null;
}

export function getResumableRefereeExamAttempt(attempts = [], userId) {
  const latestAttempt = getLatestRefereeExamAttempt(attempts, userId);
  return latestAttempt?.status === "started" &&
    !latestAttempt.finishedAt &&
    Array.isArray(latestAttempt.questions) &&
    latestAttempt.questions.length === REFEREE_EXAM_SIZE
    ? latestAttempt
    : null;
}

export function getCourtAddressDong(source = {}) {
  const direct = String(source.addressDong ?? source.bname ?? source.hname ?? "").trim();
  if (direct) return direct;
  const addressText = String(source.addressText ?? source.roadAddress ?? source.jibunAddress ?? "").trim();
  return addressText.match(/[가-힣0-9]+동/)?.[0] ?? "";
}

export function getReportParticipantRows(match = {}, userMap = {}) {
  const rows = [];
  const seen = new Set();
  const addSideRows = (sideName, role, playerIds) => {
    playerIds.forEach((userId) => {
      const user = userMap[userId];
      if (!user || seen.has(userId)) return;
      seen.add(userId);
      rows.push({
        userId,
        user,
        sideName,
        sideLabel: sideName === "teamA" ? "A사이드" : "B사이드",
        teamName: match[sideName]?.name ?? (sideName === "teamA" ? "A사이드" : "B사이드"),
        role,
        stats: match.result?.playerStats?.[userId] ?? match.playerStats?.[userId] ?? {},
      });
    });
  };

  addSideRows("teamA", "출전", getMatchSidePlayerIds(match, "teamA"));
  addSideRows("teamB", "출전", getMatchSidePlayerIds(match, "teamB"));
  addSideRows("teamA", "후보", getMatchReservePlayerIds(match, "teamA"));
  addSideRows("teamB", "후보", getMatchReservePlayerIds(match, "teamB"));
  return rows;
}

export function getMatchReportTitle(match = {}) {
  const versus = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return match.title || versus || "경기 기록";
}

export function getReportTargetLabel(targetType) {
  if (targetType === REPORT_TARGET_TYPES.player) return "선수 검색";
  if (targetType === REPORT_TARGET_TYPES.match) return "경기기록 검색";
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "구장 등록요청 검색";
  if (targetType === REPORT_TARGET_TYPES.court) return "구장 검색";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "구장 리뷰 검색";
  if (targetType === REPORT_TARGET_TYPES.teamName || targetType === REPORT_TARGET_TYPES.teamEmblem) return "팀 검색";
  return "신고 대상 검색";
}

export function getReportTargetPlaceholder(targetType) {
  if (targetType === REPORT_TARGET_TYPES.player) return "선수명, 포지션, 경기, #경기기록 검색";
  if (targetType === REPORT_TARGET_TYPES.match) return "경기명, 팀명, 구장, #경기기록 검색";
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "요청 구장명, 주소, #구장 검색";
  if (targetType === REPORT_TARGET_TYPES.court) return "구장명, 주소, #구장 검색";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "구장명, 리뷰, 경기, #구장 검색";
  if (targetType === REPORT_TARGET_TYPES.teamName || targetType === REPORT_TARGET_TYPES.teamEmblem) return "팀명, 홈코트, 지역 검색";
  return "선수, 경기, 구장, 해시태그 검색";
}

export function getReportTargetEmptyText(targetType) {
  if (targetType === REPORT_TARGET_TYPES.courtRequest) return "신고 가능한 구장 등록요청 없음";
  if (targetType === REPORT_TARGET_TYPES.court) return "신고 가능한 구장 없음";
  if (targetType === REPORT_TARGET_TYPES.courtReview) return "신고 가능한 구장 리뷰 없음";
  if (targetType === REPORT_TARGET_TYPES.player) return "신고 가능한 선수 없음";
  if (targetType === REPORT_TARGET_TYPES.teamName || targetType === REPORT_TARGET_TYPES.teamEmblem) return "신고 가능한 팀 없음";
  return "신고 가능한 대상 없음";
}

export function matchesReportSearchQuery(haystack = "", query = "") {
  const normalize = (value) => String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  const normalizedHaystack = normalize(haystack);
  const queryTokens = normalize(query).split(" ").filter(Boolean);
  return !queryTokens.length || queryTokens.every((token) => normalizedHaystack.includes(token));
}

export function formatCourtDistance(distanceMeters) {
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance)) return "거리 미확인";
  if (distance < 1000) return `${Math.max(0, Math.round(distance))}m`;
  return `${(distance / 1000).toFixed(1)}km`;
}
