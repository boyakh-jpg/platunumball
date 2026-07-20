const icon = (id, name) => Object.freeze({
  id,
  name,
  src: `/assets/profile-icons/${id}.png`,
});

const group = (id, name, unlockDescription, unlocked, icons) => Object.freeze({
  id,
  name,
  unlockDescription,
  unlocked,
  icons: Object.freeze(icons.map(([iconId, iconName]) => Object.freeze({
    ...icon(iconId, iconName),
    groupId: id,
    description: unlocked ? "기본 제공" : unlockDescription,
    unlocked,
  }))),
});

export const PROFILE_ICON_GROUPS = Object.freeze([
  group("default", "기본 지급", "모든 사용자 선택 가능", true, [
    ["01-first-bucket", "첫 득점"],
    ["02-court-rookie", "코트 루키"],
    ["03-laced-up", "경기 준비"],
    ["04-ready-whistle", "준비된 휘슬"],
    ["05-playbook", "작전판"],
  ]),
  group("beginner", "초급 업적", "업적 조건 확정 후 해금", false, [
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
  group("position", "포지션 기본", "포지션 조건 확정 후 해금", false, [
    ["21-pg-floor-general", "PG 플로어 제너럴"],
    ["22-sg-sharpshooter", "SG 샤프슈터"],
    ["23-sf-two-way-wing", "SF 투웨이 윙"],
    ["24-pf-enforcer", "PF 인포서"],
    ["25-c-rim-anchor", "C 림 앵커"],
  ]),
  group("position-play", "포지션 플레이", "포지션별 플레이 업적 달성 시 해금 예정", false, [
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
  group("achievement", "경기·커뮤니티", "경기·운영·커뮤니티 업적 달성 시 해금 예정", false, [
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
  group("rank", "등급", "등급 도달 시 해금 예정", false, [
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
  group("special", "특별", "이벤트·장기 활동 조건 확정 후 해금", false, [
    ["76-alley-cat", "앨리 캣"],
    ["77-court-owl", "코트 아울"],
    ["78-lucky-rabbit", "럭키 래빗"],
    ["79-bulldog-center", "불독 센터"],
    ["80-crown-goat", "크라운 GOAT"],
  ]),
]);

export const PROFILE_ICON_CATALOG = Object.freeze(PROFILE_ICON_GROUPS.flatMap((item) => item.icons));
export const DEFAULT_PROFILE_ICON_ID = PROFILE_ICON_GROUPS[0].icons[0].id;

const PROFILE_ICON_BY_ID = new Map(PROFILE_ICON_CATALOG.map((item) => [item.id, item]));

export function getProfileIcon(iconId = "") {
  return PROFILE_ICON_BY_ID.get(String(iconId || "").trim()) ?? null;
}

export function isSelectableProfileIcon(iconId = "") {
  return getProfileIcon(iconId)?.unlocked === true;
}
