import { REPORT_TARGET_TYPES } from "../lib/reportReasons.js";
import { getMatchReservePlayerIds, getMatchSidePlayerIds } from "../lib/matchUtils.js";
import { REFEREE_EXAM_SIZE } from "../lib/refereeExamBank.js";
import { ADMIN_REVIEW_ACTIONS, getAdminStatusLabel } from "../lib/admin.js";
import { getCourtPublicAccessLabel } from "../lib/courts.js";
import { getMatchHashtag } from "../lib/handles.js";
import { formatKoreanDateTime } from "../../shared/lib/matchTimeUtils.js";

const COURT_LIMIT_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function getCourtRequestQuotaUi(requestLimit, aiQuota, trustScore) {
  const abuseBlocked = requestLimit?.abuseBlocked === true;
  const dailyBlocked = requestLimit?.dailyBlocked === true;
  const aiBlocked = aiQuota?.blocked === true;
  const dailyCount = Math.max(0, Number(requestLimit?.dailyCount) || 0);
  const dailyLimit = Math.max(1, Number(requestLimit?.dailyLimit) || 3);
  let message = "";
  if (abuseBlocked) {
    const blockedUntil = Date.parse(String(requestLimit.blockedUntil || ""));
    const untilLabel = Number.isFinite(blockedUntil)
      ? ` ${COURT_LIMIT_TIME_FORMATTER.format(new Date(blockedUntil))}까지`
      : " 제한 기간 동안";
    message = `허위 구장 신청이 운영자 확인으로 확정되어${untilLabel} 신청할 수 없습니다.`;
  } else if (dailyBlocked) {
    message = `구장 신청은 하루 ${dailyLimit}건까지 가능합니다. 한국시간 자정에 다시 신청할 수 있습니다.`;
  } else if (aiBlocked) {
    message = "금일 AI 구장 검증 가능량을 넘었습니다. 오전 9시 이후 다시 신청해 주세요.";
  }
  return {
    blocked: abuseBlocked || dailyBlocked || aiBlocked,
    label: abuseBlocked
      ? "신청 제한"
      : dailyBlocked
        ? `오늘 ${dailyLimit}/${dailyLimit}`
        : aiBlocked
          ? "오늘 마감"
          : requestLimit
            ? `오늘 ${dailyCount}/${dailyLimit}`
            : `신뢰도 ${trustScore}`,
    message,
    title: abuseBlocked ? "신청 제한" : "오늘 접수 마감",
  };
}

export const DEFAULT_COURT_REQUEST = {
  locationEntryMode: "onsite",
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
    communityPosts: privacy.communityPosts !== false,
    communityComments: privacy.communityComments !== false,
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

export function getSettingsReportTargetName(report = {}, context = {}) {
  const { courtRequests = [], approvedCourts = [], courtReviews = [], teams = [], userMap = {}, matchMap = {} } = context;
  if (report.type === "court_request") return courtRequests.find((item) => item.id === report.targetId)?.name ?? "구장 등록요청";
  if (report.type === "court") return approvedCourts.find((item) => item.id === report.targetId)?.name ?? "구장";
  if (report.type === "court_review") return courtReviews.find((item) => item.id === report.targetId)?.courtName ?? "구장 리뷰";
  if (report.type === "team_name" || report.type === "team_emblem") return teams.find((item) => item.id === report.targetId)?.name ?? report.teamName ?? "팀";
  if (report.type === "player") return userMap[report.targetId]?.name ?? "플레이어";
  const match = matchMap[report.targetId];
  return match ? `${getMatchHashtag(match)} ${match.title ?? "경기"}` : "경기";
}

function formatSettingsActivityTime(value) {
  return formatKoreanDateTime(value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) || "-";
}

export function getSettingsActivityDetail(detail = {}, context = {}) {
  const item = detail.item ?? {};
  if (detail.kind === "block") {
    const snapshot = context.app?.state?.settings?.blockedUserProfiles?.[item.userId] ?? {};
    const profile = { ...snapshot, ...(context.userMap?.[item.userId] ?? {}) };
    return {
      title: profile.name ?? "차단한 플레이어",
      status: "차단 중",
      tone: "orange",
      rows: [
        { label: "플레이어", value: profile.name ?? "플레이어" },
        { label: "해시태그", value: profile.hashtag || profile.handle || "-" },
        { label: "차단 시각", value: snapshot.blockedAt ? formatSettingsActivityTime(snapshot.blockedAt) : "-" },
        { label: "적용 상태", value: "검색·추천·초대·알림 숨김" },
      ],
    };
  }

  if (detail.kind === "courtRequest") {
    const status = item.status ?? "pending";
    const decidedAt = item.approvedAt ?? item.rejectedAt ?? (["approved", "rejected"].includes(status) ? item.updatedAt : null);
    const message = item.rejectionReason
      || (status === "approved"
        ? item.approvalSource === "ai" ? "사진과 위치 검증을 통과해 자동 승인되었습니다." : "구장 등록요청이 승인되었습니다."
        : "운영진 검토가 끝나면 결과가 표시됩니다.");
    return {
      title: item.name ?? "구장 등록요청",
      status: getAdminStatusLabel(status),
      tone: status === "approved" ? "green" : status === "rejected" ? "orange" : "neutral",
      rows: [
        { label: "주소", value: item.addressText || item.roadAddress || "-" },
        { label: "공개 여부", value: getCourtPublicAccessLabel(item) },
        { label: "신청 시각", value: formatSettingsActivityTime(item.createdAt) },
        { label: "처리 시각", value: decidedAt ? formatSettingsActivityTime(decidedAt) : "-" },
        { label: "운영진 메시지", value: message },
      ],
    };
  }

  const report = item;
  const status = report.status ?? "open";
  const resolution = report.resolution ?? {};
  return {
    title: getSettingsReportTargetName(report, {
      ...context,
      teams: context.app?.state?.teams ?? context.teams ?? [],
    }),
    status: getAdminStatusLabel(status),
    tone: status === "resolved" ? "green" : status === "dismissed" ? "orange" : "neutral",
    rows: [
      { label: "신고 번호", value: report.id || "-" },
      { label: "신고 사유", value: report.reason || "-" },
      { label: "접수 시각", value: formatSettingsActivityTime(report.createdAt) },
      { label: "처리 시각", value: report.resolvedAt ? formatSettingsActivityTime(report.resolvedAt) : "-" },
      { label: "처리 결과", value: resolution.actionLabel || ADMIN_REVIEW_ACTIONS[resolution.actionType]?.label || getAdminStatusLabel(status) },
      { label: "운영진 메시지", value: resolution.feedback || "아직 전달된 메시지가 없습니다." },
    ],
  };
}
