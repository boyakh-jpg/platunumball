export function normalizeStatRecorders(recorders = {}) {
  // LEGACY READ-ONLY:
  // 과거 경기 데이터 해석 전용.
  // 신규 권한 판정 및 저장에 사용하지 않는다.
  return {
    teamA: recorders.teamA ?? "",
    teamB: recorders.teamB ?? "",
  };
}
