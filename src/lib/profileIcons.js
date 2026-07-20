const icon = (id, name) => Object.freeze({
  id,
  name,
  src: `/assets/profile-icons/${id}.png`,
});

const requirement = (metric, target, label) => Object.freeze({ metric, target, label });
const achievement = (condition, requirements = []) => Object.freeze({ condition, requirements: Object.freeze(requirements) });

const PROFILE_ICON_ACHIEVEMENTS = {
  "01-first-bucket": achievement("기본 지급"),
  "02-court-rookie": achievement("기본 지급"),
  "03-laced-up": achievement("기본 지급"),
  "04-ready-whistle": achievement("기본 지급"),
  "05-playbook": achievement("기본 지급"),
  "06-team-jersey": achievement("팀 1개 가입", [requirement("teamCount", 1, "가입 팀")]),
  "07-game-clock": achievement("확정 경기 3회", [requirement("matchCount", 3, "확정 경기")]),
  "08-water-break": achievement("확정 경기 5회", [requirement("matchCount", 5, "확정 경기")]),
  "09-home-court": achievement("확정 경기 10회", [requirement("matchCount", 10, "확정 경기")]),
  "10-net-swish": achievement("누적 50득점", [requirement("points", 50, "누적 득점")]),
  "11-first-medal": achievement("3승", [requirement("winCount", 3, "승리")]),
  "12-captain-star": achievement("팀 주장 되기", [requirement("captainCount", 1, "주장 팀")]),
  "13-court-vision": achievement("누적 20어시스트", [requirement("assists", 20, "누적 어시스트")]),
  "14-crossover": achievement("누적 100득점", [requirement("points", 100, "누적 득점")]),
  "15-perfect-pass": achievement("누적 50어시스트", [requirement("assists", 50, "누적 어시스트")]),
  "16-three-point": achievement("누적 200득점", [requirement("points", 200, "누적 득점")]),
  "17-clutch-clock": achievement("2점 차 이내 승리 3회", [requirement("closeWinCount", 3, "접전 승리")]),
  "18-lock-down": achievement("누적 스틸+블록 25개", [requirement("stealsBlocks", 25, "스틸+블록")]),
  "19-rebound-crown": achievement("누적 50리바운드", [requirement("rebounds", 50, "누적 리바운드")]),
  "20-fair-play": achievement("확정 경기 10회 및 신뢰도 90", [
    requirement("matchCount", 10, "확정 경기"),
    requirement("trustScore", 90, "신뢰도"),
  ]),
  "21-pg-floor-general": achievement("PG 출전 1회", [requirement("pgAppearances", 1, "PG 출전")]),
  "22-sg-sharpshooter": achievement("SG 출전 1회", [requirement("sgAppearances", 1, "SG 출전")]),
  "23-sf-two-way-wing": achievement("SF 출전 1회", [requirement("sfAppearances", 1, "SF 출전")]),
  "24-pf-enforcer": achievement("PF 출전 1회", [requirement("pfAppearances", 1, "PF 출전")]),
  "25-c-rim-anchor": achievement("C 출전 1회", [requirement("cAppearances", 1, "C 출전")]),
  "51-first-win": achievement("첫 승", [requirement("winCount", 1, "승리")]),
  "52-win-streak": achievement("3연승 달성", [requirement("streak", 3, "최고 연승")]),
  "53-buzzer-beater": achievement("2점 차 이내 승리 1회", [requirement("closeWinCount", 1, "접전 승리")]),
  "54-double-double": achievement("더블더블 1회", [requirement("doubleDoubleCount", 1, "더블더블")]),
  "55-triple-double": achievement("트리플더블 1회", [requirement("tripleDoubleCount", 1, "트리플더블")]),
  "56-ironman": achievement("확정 경기 50회", [requirement("matchCount", 50, "확정 경기")]),
  "57-mvp": achievement("20득점 및 리바운드+어시스트 10 이상 경기 3회", [requirement("mvpPerformanceCount", 3, "고효율 경기")]),
  "58-team-huddle": achievement("팀 소속으로 확정 경기 10회", [requirement("teamMatchCount", 10, "팀 경기")]),
  "59-mentor-torch": achievement("누적 100어시스트", [requirement("assists", 100, "누적 어시스트")]),
  "60-referee-shield": achievement("심판 수행 5회", [requirement("refereeCount", 5, "심판 경기")]),
  "61-record-keeper": achievement("기록원 수행 5회", [requirement("recorderCount", 5, "기록 경기")]),
  "62-court-scout": achievement("구장 후기·승인 제보 합계 3회", [requirement("courtContributionCount", 3, "구장 기여")]),
  "63-team-founder": achievement("팀 주장 되기", [requirement("captainCount", 1, "주장 팀")]),
  "64-trusted-player": achievement("확정 경기 20회 및 신뢰도 95", [
    requirement("matchCount", 20, "확정 경기"),
    requirement("trustScore", 95, "신뢰도"),
  ]),
  "65-community-star": achievement("확정 경기 30회 및 신뢰도 98", [
    requirement("matchCount", 30, "확정 경기"),
    requirement("trustScore", 98, "신뢰도"),
  ]),
  "66-iron-ball": achievement("확정 경기 1회", [requirement("matchCount", 1, "확정 경기")]),
  "67-bronze-blaze": achievement("통합 MMR 800 도달", [requirement("integratedMmr", 800, "통합 MMR")]),
  "68-silver-wing": achievement("통합 MMR 1000 도달", [requirement("integratedMmr", 1000, "통합 MMR")]),
  "69-gold-crown": achievement("통합 MMR 1200 도달", [requirement("integratedMmr", 1200, "통합 MMR")]),
  "70-platinum-comet": achievement("통합 MMR 1400 도달", [requirement("integratedMmr", 1400, "통합 MMR")]),
  "71-diamond-prism": achievement("통합 MMR 1600 도달", [requirement("integratedMmr", 1600, "통합 MMR")]),
  "72-master-phoenix": achievement("통합 MMR 1800 도달", [requirement("integratedMmr", 1800, "통합 MMR")]),
  "73-legend-dragon": achievement("통합 MMR 2000 도달", [requirement("integratedMmr", 2000, "통합 MMR")]),
  "74-cosmic-hoop": achievement("통합 MMR 2200 도달", [requirement("integratedMmr", 2200, "통합 MMR")]),
  "75-aurora-core": achievement("통합 MMR 2400 도달", [requirement("integratedMmr", 2400, "통합 MMR")]),
  "76-alley-cat": achievement("확정 경기 25회", [requirement("matchCount", 25, "확정 경기")]),
  "77-court-owl": achievement("밤 9시 이후 경기 10회", [requirement("nightMatchCount", 10, "야간 경기")]),
  "78-lucky-rabbit": achievement("5연승 달성", [requirement("streak", 5, "최고 연승")]),
  "79-bulldog-center": achievement("누적 리바운드+블록 150개", [requirement("interiorStops", 150, "리바운드+블록")]),
  "80-crown-goat": achievement("확정 경기 100회·60승·MMR 2000·신뢰도 95", [
    requirement("matchCount", 100, "확정 경기"),
    requirement("winCount", 60, "승리"),
    requirement("integratedMmr", 2000, "통합 MMR"),
    requirement("trustScore", 95, "신뢰도"),
  ]),
};

const POSITION_PLAY_ICON_IDS = [
  ["PG", "pgAppearances", ["26-pg-no-look-pass", "27-pg-crossover", "28-pg-fast-break", "29-pg-behind-back", "30-pg-court-vision"]],
  ["SG", "sgAppearances", ["31-sg-catch-shoot", "32-sg-step-back", "33-sg-corner-three", "34-sg-pull-up", "35-sg-free-throw"]],
  ["SF", "sfAppearances", ["36-sf-slashing-drive", "37-sf-chase-block", "38-sf-wing-three", "39-sf-fast-break-finish", "40-sf-defensive-stance"]],
  ["PF", "pfAppearances", ["41-pf-screen-set", "42-pf-box-out", "43-pf-offensive-rebound", "44-pf-putback", "45-pf-turnaround"]],
  ["C", "cAppearances", ["46-c-rim-protection", "47-c-power-rebound", "48-c-hook-shot", "49-c-two-hand-dunk", "50-c-outlet-pass"]],
];

for (const [position, metric, iconIds] of POSITION_PLAY_ICON_IDS) {
  [5, 10, 20, 35, 50].forEach((target, index) => {
    PROFILE_ICON_ACHIEVEMENTS[iconIds[index]] = achievement(`${position} 출전 ${target}회`, [requirement(metric, target, `${position} 출전`)]);
  });
}

const PROFILE_ICON_SERIES_TIERS = Object.freeze([
  Object.freeze({ id: "bronze", name: "브론즈" }),
  Object.freeze({ id: "silver", name: "실버" }),
  Object.freeze({ id: "gold", name: "골드" }),
  Object.freeze({ id: "platinum", name: "플래티넘" }),
  Object.freeze({ id: "legend", name: "레전드" }),
]);

const trackedSeries = (slug, name, metric, targets, requirementLabel, unit = "회", condition = null) => Object.freeze({
  slug,
  name,
  metric,
  targets: Object.freeze(targets),
  requirementLabel,
  condition: condition ?? ((target) => `${requirementLabel} ${target}${unit}`),
});

const PROFILE_ICON_SERIES_GROUPS = Object.freeze([
  Object.freeze({
    id: "career",
    name: "경기 경력",
    series: Object.freeze([
      trackedSeries("court-journey", "코트 여정", "matchCount", [25, 50, 100, 250, 500], "확정 경기"),
      trackedSeries("victory-road", "승리의 길", "winCount", [10, 25, 50, 100, 250], "승리"),
      trackedSeries("streak-forge", "연승 행진", "streak", [7, 10, 12, 15, 20], "최고 연승", "연승", (target) => `${target}연승 달성`),
      trackedSeries("clutch-wins", "클러치 승리", "closeWinCount", [5, 10, 20, 35, 50], "접전 승리"),
      trackedSeries("ranked-grind", "랭크 전사", "rankedMatchCount", [10, 25, 50, 100, 250], "랭크 경기"),
      trackedSeries("official-stage", "공인 무대", "officialMatchCount", [5, 10, 25, 50, 100], "공인 경기"),
      trackedSeries("open-court", "오픈 코트", "publicMatchCount", [10, 25, 50, 100, 250], "공개 경기"),
      trackedSeries("closed-court", "클로즈드 코트", "privateMatchCount", [5, 10, 25, 50, 100], "비공개 경기"),
      trackedSeries("team-campaign", "팀전 원정", "teamMatchCount", [25, 50, 100, 250, 500], "팀 경기"),
      trackedSeries("team-victories", "팀전 승리", "teamMatchWinCount", [5, 10, 25, 50, 100], "팀 경기 승리"),
      trackedSeries("private-team-series", "비공개 팀전", "privateTeamMatchCount", [3, 10, 25, 50, 100], "비공개 팀전"),
      trackedSeries("matchmaking-success", "매칭 성사", "matchmakingSuccessCount", [1, 5, 10, 25, 50], "매칭 성사"),
    ]),
  }),
  Object.freeze({
    id: "records",
    name: "누적 기록",
    series: Object.freeze([
      trackedSeries("scoring-total", "득점 누적", "points", [250, 500, 1000, 2500, 5000], "누적 득점", "점"),
      trackedSeries("rebound-total", "리바운드 누적", "rebounds", [100, 250, 500, 1000, 2500], "누적 리바운드", "개"),
      trackedSeries("assist-total", "어시스트 누적", "assists", [250, 500, 1000, 2000, 5000], "누적 어시스트", "개"),
      trackedSeries("steal-total", "스틸 누적", "steals", [25, 50, 100, 250, 500], "누적 스틸", "개"),
      trackedSeries("block-total", "블록 누적", "blocks", [25, 50, 100, 250, 500], "누적 블록", "개"),
      trackedSeries("double-double-run", "더블더블", "doubleDoubleCount", [3, 5, 10, 25, 50], "더블더블"),
      trackedSeries("triple-double-run", "트리플더블", "tripleDoubleCount", [2, 3, 5, 10, 25], "트리플더블"),
      trackedSeries("all-around-games", "고효율 경기", "mvpPerformanceCount", [5, 10, 20, 35, 50], "고효율 경기"),
    ]),
  }),
  Object.freeze({
    id: "leaders",
    name: "경기 기록왕",
    series: Object.freeze([
      trackedSeries("scoring-leader", "경기 득점왕", "scoringLeaderGameCount", [1, 3, 10, 25, 50], "득점왕 경기", "회", (target) => `경기 득점 1위 ${target}회 · 경기당 10점 이상`),
      trackedSeries("rebound-leader", "경기 리바운드왕", "reboundLeaderGameCount", [1, 3, 10, 25, 50], "리바운드왕 경기", "회", (target) => `경기 리바운드 1위 ${target}회 · 경기당 5개 이상`),
      trackedSeries("assist-leader", "경기 어시스트왕", "assistLeaderGameCount", [1, 3, 10, 25, 50], "어시스트왕 경기", "회", (target) => `경기 어시스트 1위 ${target}회 · 경기당 5개 이상`),
      trackedSeries("steal-leader", "경기 스틸왕", "stealLeaderGameCount", [1, 3, 10, 25, 50], "스틸왕 경기", "회", (target) => `경기 스틸 1위 ${target}회 · 경기당 2개 이상`),
      trackedSeries("block-leader", "경기 블록왕", "blockLeaderGameCount", [1, 3, 10, 25, 50], "블록왕 경기", "회", (target) => `경기 블록 1위 ${target}회 · 경기당 2개 이상`),
    ]),
  }),
  Object.freeze({
    id: "modes",
    name: "경기 인원",
    series: Object.freeze([
      trackedSeries("one-on-one", "1v1 스페셜리스트", "mode1v1Count", [1, 10, 25, 50, 100], "1v1 확정 경기"),
      trackedSeries("two-on-two", "2v2 스페셜리스트", "mode2v2Count", [1, 10, 25, 50, 100], "2v2 확정 경기"),
      trackedSeries("three-on-three", "3v3 스페셜리스트", "mode3v3Count", [1, 10, 25, 50, 100], "3v3 확정 경기"),
      trackedSeries("four-on-four", "4v4 스페셜리스트", "mode4v4Count", [1, 10, 25, 50, 100], "4v4 확정 경기"),
      trackedSeries("five-on-five", "5v5 스페셜리스트", "mode5v5Count", [1, 10, 25, 50, 100], "5v5 확정 경기"),
    ]),
  }),
  Object.freeze({
    id: "community",
    name: "운영·커뮤니티",
    series: Object.freeze([
      trackedSeries("referee-service", "심판 경력", "refereeCount", [10, 25, 50, 75, 100], "심판 수행"),
      trackedSeries("recorder-service", "기록원 경력", "recorderCount", [10, 25, 50, 75, 100], "기록원 수행"),
      trackedSeries("recruiting-invites", "매칭 초대 성공", "recruitingInviteAcceptedCount", [1, 5, 10, 25, 50], "수락된 매칭 초대"),
      trackedSeries("team-invites", "팀 초대 성공", "teamInviteAcceptedCount", [1, 3, 5, 10, 25], "수락된 팀 초대"),
      trackedSeries("approved-courts", "구장 등록", "approvedCourtCount", [1, 3, 5, 10, 25], "승인 구장 등록"),
      trackedSeries("court-reviews", "구장 리뷰", "courtReviewCount", [1, 3, 10, 25, 50], "활성 구장 리뷰"),
      trackedSeries("reserve-duty", "후보 경력", "reserveCount", [1, 5, 10, 25, 50], "후보 등록 경기"),
      trackedSeries("reserve-promotion", "후보 승격", "promotedReserveCount", [1, 3, 5, 10, 25], "후보 출전 승격"),
    ]),
  }),
  Object.freeze({
    id: "tournaments",
    name: "대회",
    series: Object.freeze([
      trackedSeries("tournament-games", "대회 경기", "tournamentMatchCount", [1, 3, 10, 25, 50], "대회 확정 경기"),
      trackedSeries("tournament-entry", "대회 참가", "tournamentParticipationCount", [1, 3, 5, 10, 20], "참가 대회"),
      trackedSeries("tournament-wins", "대회 승리", "tournamentWinCount", [1, 3, 10, 25, 50], "대회 경기 승리"),
      trackedSeries("tournament-finals", "대회 결승", "tournamentFinalCount", [1, 3, 5, 10, 20], "대회 결승 진출"),
      trackedSeries("tournament-titles", "대회 우승", "tournamentTitleCount", [1, 2, 3, 5, 10], "대회 우승"),
      trackedSeries("tournament-host", "대회 개최", "tournamentHostCount", [1, 3, 5, 10, 20], "개최 대회"),
    ]),
  }),
]);

const EXPANDED_PROFILE_ICON_ENTRIES = [];
let nextExpandedIconNumber = 81;

for (const seriesGroup of PROFILE_ICON_SERIES_GROUPS) {
  const entries = [];
  for (const seriesDefinition of seriesGroup.series) {
    PROFILE_ICON_SERIES_TIERS.forEach((tier, tierIndex) => {
      const iconId = `${String(nextExpandedIconNumber).padStart(3, "0")}-${seriesDefinition.slug}-${tier.id}`;
      const target = seriesDefinition.targets[tierIndex];
      PROFILE_ICON_ACHIEVEMENTS[iconId] = achievement(seriesDefinition.condition(target), [
        requirement(seriesDefinition.metric, target, seriesDefinition.requirementLabel),
      ]);
      entries.push([iconId, `${seriesDefinition.name} · ${tier.name}`]);
      nextExpandedIconNumber += 1;
    });
  }
  EXPANDED_PROFILE_ICON_ENTRIES.push(Object.freeze({ id: seriesGroup.id, name: seriesGroup.name, entries: Object.freeze(entries) }));
}

if (nextExpandedIconNumber !== 301) throw new Error("profile_icon_catalog_size_mismatch");

const group = (id, name, icons) => Object.freeze({
  id,
  name,
  icons: Object.freeze(icons.map(([iconId, iconName]) => Object.freeze({
    ...icon(iconId, iconName),
    groupId: id,
    achievement: PROFILE_ICON_ACHIEVEMENTS[iconId],
  }))),
});

const EXPANDED_PROFILE_ICON_GROUPS = Object.freeze(
  EXPANDED_PROFILE_ICON_ENTRIES.map((item) => group(item.id, item.name, item.entries)),
);

export const PROFILE_ICON_GROUPS = Object.freeze([
  group("default", "기본 지급", [
    ["01-first-bucket", "첫 득점"],
    ["02-court-rookie", "코트 루키"],
    ["03-laced-up", "경기 준비"],
    ["04-ready-whistle", "준비된 휘슬"],
    ["05-playbook", "작전판"],
  ]),
  group("beginner", "초급 업적", [
    ["06-team-jersey", "팀 저지"],
    ["07-game-clock", "경기 시계"],
    ["08-water-break", "물 한 모금"],
    ["09-home-court", "홈 코트"],
    ["10-net-swish", "스위시"],
    ["11-first-medal", "첫 메달"],
    ["12-captain-star", "주장 별"],
    ["13-court-vision", "코트 비전"],
    ["14-crossover", "크로스오버"],
    ["15-perfect-pass", "완벽한 패스"],
    ["16-three-point", "3점슛"],
    ["17-clutch-clock", "클러치 타임"],
    ["18-lock-down", "락다운"],
    ["19-rebound-crown", "리바운드 왕관"],
    ["20-fair-play", "페어플레이"],
  ]),
  group("position", "포지션 기본", [
    ["21-pg-floor-general", "PG 플로어 제너럴"],
    ["22-sg-sharpshooter", "SG 샤프슈터"],
    ["23-sf-two-way-wing", "SF 투웨이 윙"],
    ["24-pf-enforcer", "PF 인포서"],
    ["25-c-rim-anchor", "C 림 앵커"],
  ]),
  group("position-play", "포지션 플레이", [
    ["26-pg-no-look-pass", "PG 노룩 패스"],
    ["27-pg-crossover", "PG 크로스오버"],
    ["28-pg-fast-break", "PG 속공"],
    ["29-pg-behind-back", "PG 비하인드 백"],
    ["30-pg-court-vision", "PG 코트 비전"],
    ["31-sg-catch-shoot", "SG 캐치 앤 슛"],
    ["32-sg-step-back", "SG 스텝백"],
    ["33-sg-corner-three", "SG 코너 3점"],
    ["34-sg-pull-up", "SG 풀업 점퍼"],
    ["35-sg-free-throw", "SG 자유투"],
    ["36-sf-slashing-drive", "SF 슬래싱 드라이브"],
    ["37-sf-chase-block", "SF 체이스다운 블록"],
    ["38-sf-wing-three", "SF 윙 3점"],
    ["39-sf-fast-break-finish", "SF 속공 마무리"],
    ["40-sf-defensive-stance", "SF 수비 자세"],
    ["41-pf-screen-set", "PF 스크린"],
    ["42-pf-box-out", "PF 박스아웃"],
    ["43-pf-offensive-rebound", "PF 공격 리바운드"],
    ["44-pf-putback", "PF 풋백"],
    ["45-pf-turnaround", "PF 턴어라운드"],
    ["46-c-rim-protection", "C 림 프로텍션"],
    ["47-c-power-rebound", "C 파워 리바운드"],
    ["48-c-hook-shot", "C 훅슛"],
    ["49-c-two-hand-dunk", "C 투핸드 덩크"],
    ["50-c-outlet-pass", "C 아웃렛 패스"],
  ]),
  group("achievement", "경기·커뮤니티", [
    ["51-first-win", "첫 승"],
    ["52-win-streak", "연승"],
    ["53-buzzer-beater", "버저비터"],
    ["54-double-double", "더블더블"],
    ["55-triple-double", "트리플더블"],
    ["56-ironman", "아이언맨"],
    ["57-mvp", "MVP"],
    ["58-team-huddle", "팀 허들"],
    ["59-mentor-torch", "멘토의 횃불"],
    ["60-referee-shield", "심판 방패"],
    ["61-record-keeper", "기록관"],
    ["62-court-scout", "코트 스카우트"],
    ["63-team-founder", "팀 창단자"],
    ["64-trusted-player", "신뢰받는 선수"],
    ["65-community-star", "커뮤니티 스타"],
  ]),
  group("rank", "등급", [
    ["66-iron-ball", "아이언 볼"],
    ["67-bronze-blaze", "브론즈 블레이즈"],
    ["68-silver-wing", "실버 윙"],
    ["69-gold-crown", "골드 크라운"],
    ["70-platinum-comet", "플래티넘 코멧"],
    ["71-diamond-prism", "다이아몬드 프리즘"],
    ["72-master-phoenix", "마스터 피닉스"],
    ["73-legend-dragon", "레전드 드래곤"],
    ["74-cosmic-hoop", "코스믹 후프"],
    ["75-aurora-core", "오로라 코어"],
  ]),
  group("special", "특별", [
    ["76-alley-cat", "앨리 캣"],
    ["77-court-owl", "코트 아울"],
    ["78-lucky-rabbit", "럭키 래빗"],
    ["79-bulldog-center", "불독 센터"],
    ["80-crown-goat", "크라운 GOAT"],
  ]),
  ...EXPANDED_PROFILE_ICON_GROUPS,
]);

export const PROFILE_ICON_CATALOG = Object.freeze(PROFILE_ICON_GROUPS.flatMap((item) => item.icons));
export const DEFAULT_PROFILE_ICON_ID = PROFILE_ICON_GROUPS[0].icons[0].id;

const PROFILE_ICON_BY_ID = new Map(PROFILE_ICON_CATALOG.map((item) => [item.id, item]));

export function getProfileIcon(iconId = "") {
  return PROFILE_ICON_BY_ID.get(String(iconId || "").trim()) ?? null;
}

export function getProfileIconAchievementState(iconId = "", metrics = {}, unlockedIconKeys = []) {
  const item = getProfileIcon(iconId);
  if (!item) return null;
  const requirements = item.achievement?.requirements ?? [];
  const persisted = new Set(unlockedIconKeys).has(item.id);
  const ratios = requirements.map(({ metric, target }) => Math.min(1, Math.max(0, Number(metrics?.[metric] ?? 0) / target)));
  const achieved = requirements.length === 0 || ratios.every((ratio) => ratio >= 1);
  return {
    ...item,
    unlocked: persisted || achieved,
    achieved,
    progress: requirements.length ? Math.min(...ratios) : 1,
  };
}

export function isSelectableProfileIcon(iconId = "", unlockedIconKeys = []) {
  return getProfileIconAchievementState(iconId, {}, unlockedIconKeys)?.unlocked === true;
}
