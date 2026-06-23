export const REPORT_REASONS = [
  "나이 속임",
  "티어/MMR 조작 의심",
  "대리 참여",
  "무단 불참",
  "고의 트롤/비매너",
  "폭언/위협",
  "기록 조작",
  "허위 경기 결과",
  "허위 구장 등록",
  "기타 운영 확인 필요",
];

export const DEFAULT_REPORT_REASON = REPORT_REASONS[0];

export const REPORT_TARGET_TYPES = {
  player: "player",
  match: "match",
  courtRequest: "court_request",
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
  "허위 구장 등록": REPORT_TARGET_TYPES.courtRequest,
  "기타 운영 확인 필요": REPORT_TARGET_TYPES.mixed,
};

export function getReportTargetType(reason = "") {
  return REPORT_REASON_TARGET_TYPES[reason] ?? REPORT_TARGET_TYPES.mixed;
}
