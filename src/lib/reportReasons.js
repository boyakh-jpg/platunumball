export const VOID_MATCH_RESTORE_REPORT_REASON = "무효 경기 복구 요청";

export const TEAM_NAME_REPORT_REASONS = Object.freeze([
  "팀명 · 혐오·차별 표현",
  "팀명 · 사칭 또는 혼동 유발",
  "팀명 · 개인정보 노출",
  "팀명 · 기타 운영 확인 필요",
]);

export const TEAM_EMBLEM_REPORT_REASONS = Object.freeze([
  "팀 엠블럼 · 부적절한 이미지",
  "팀 엠블럼 · 혐오·폭력 표현",
  "팀 엠블럼 · 사칭 또는 저작권 침해",
  "팀 엠블럼 · 기타 운영 확인 필요",
]);

export const REPORT_REASONS = [
  "나이 속임",
  "티어/MMR 조작 의심",
  "대리 참여",
  "무단 불참",
  "고의 트롤/비매너",
  "폭언/위협",
  "기록 조작",
  "허위 경기 결과",
  VOID_MATCH_RESTORE_REPORT_REASON,
  "허위 구장 등록",
  "구장 위치 오류",
  "구장 상태 위험",
  "구장 리뷰 문제",
  ...TEAM_NAME_REPORT_REASONS,
  ...TEAM_EMBLEM_REPORT_REASONS,
  "기타 운영 확인 필요",
];

export const DEFAULT_REPORT_REASON = REPORT_REASONS[0];

export const REPORT_TARGET_TYPES = {
  player: "player",
  match: "match",
  courtRequest: "court_request",
  court: "court",
  courtReview: "court_review",
  teamName: "team_name",
  teamEmblem: "team_emblem",
  mixed: "mixed",
};

const REPORT_REASON_TARGET_TYPES = {
  "나이 속임": REPORT_TARGET_TYPES.player,
  "티어/MMR 조작 의심": REPORT_TARGET_TYPES.player,
  "대리 참여": REPORT_TARGET_TYPES.player,
  "무단 불참": REPORT_TARGET_TYPES.player,
  "고의 트롤/비매너": REPORT_TARGET_TYPES.player,
  "폭언/위협": REPORT_TARGET_TYPES.player,
  "기록 조작": REPORT_TARGET_TYPES.match,
  "허위 경기 결과": REPORT_TARGET_TYPES.match,
  [VOID_MATCH_RESTORE_REPORT_REASON]: REPORT_TARGET_TYPES.match,
  "허위 구장 등록": REPORT_TARGET_TYPES.courtRequest,
  "구장 위치 오류": REPORT_TARGET_TYPES.court,
  "구장 상태 위험": REPORT_TARGET_TYPES.court,
  "구장 리뷰 문제": REPORT_TARGET_TYPES.courtReview,
  ...Object.fromEntries(TEAM_NAME_REPORT_REASONS.map((reason) => [reason, REPORT_TARGET_TYPES.teamName])),
  ...Object.fromEntries(TEAM_EMBLEM_REPORT_REASONS.map((reason) => [reason, REPORT_TARGET_TYPES.teamEmblem])),
  "기타 운영 확인 필요": REPORT_TARGET_TYPES.mixed,
};

export function getReportReasonValue(reason = "") {
  return String(reason).replace(/^팀명 · /, "").replace(/^팀 엠블럼 · /, "");
}

export function getReportTargetType(reason = "") {
  return REPORT_REASON_TARGET_TYPES[reason] ?? REPORT_TARGET_TYPES.mixed;
}
