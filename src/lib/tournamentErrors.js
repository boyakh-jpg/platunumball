const TOURNAMENT_ERROR_MESSAGES = {
  tournament_schedule_lineup_submitted: "한 팀이라도 출전 명단을 제출한 뒤에는 경기 일정을 변경할 수 없습니다.",
  tournament_schedule_revision_limit: "경기 일정은 최초 지정 후 한 번만 변경할 수 있습니다.",
  tournament_match_schedule_locked: "이미 시작·종료·취소·무효 처리된 경기는 일정을 바꿀 수 없습니다.",
  invalid_tournament_match_schedule: "오늘부터 365일 안의 날짜와 시간을 입력해야 합니다.",
  tournament_owner_required: "대회 생성자만 처리할 수 있습니다.",
  tournament_court_not_allowed: "대회 사용 구장으로 등록된 승인 구장만 선택할 수 있습니다.",
  tournament_court_not_active: "대회 사용 구장으로 등록된 승인 구장만 선택할 수 있습니다.",
  tournament_referee_not_eligible: "심판 자격, 임기 또는 신뢰도 조건을 충족하지 못했습니다.",
  tournament_referee_pool_insufficient: "팀 수에 필요한 승인 심판 수가 부족합니다.",
  tournament_neutral_referee_coverage_required: "모든 가능한 대진에 중립 심판을 배정할 수 있어야 합니다.",
  tournament_approval_not_ready: "팀장과 필수 심판 전원의 승인이 먼저 필요합니다.",
  tournament_region_manager_required: "해당 지역관리자 이상만 처리할 수 있습니다.",
  tournament_referee_required: "경기 심판이 배정되지 않았습니다. 중립 심판을 배정한 뒤 일정을 저장해 주세요.",
  tournament_referee_not_neutral: "배정된 심판이 경기 팀에 속해 있습니다. 양 팀에 속하지 않은 중립 심판으로 변경해 주세요.",
  tournament_referee_schedule_conflict: "같은 심판의 다른 경기와 시간이 겹칩니다. 경기 시간을 바꾸거나 다른 중립 심판을 배정해 주세요.",
};

export function formatTournamentError(message = "", fallback = "대회 작업을 완료하지 못했습니다.") {
  const entry = Object.entries(TOURNAMENT_ERROR_MESSAGES).find(([code]) => String(message).includes(code));
  return entry?.[1] ?? fallback;
}
