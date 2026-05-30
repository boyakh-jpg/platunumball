export const MATCH_MODES = [
  { id: "1v1", label: "1v1", size: 1, integratedWeight: 0.4 },
  { id: "2v2", label: "2v2", size: 2, integratedWeight: 0.55 },
  { id: "3v3", label: "3v3", size: 3, integratedWeight: 0.75 },
  { id: "5v5", label: "5v5", size: 5, integratedWeight: 0.95 },
];

export const MODE_SIZES = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = mode.size;
  return map;
}, {});

export const TEAM_ROLES = {
  captain: "팀장",
  regular: "정규멤버",
  candidate: "후보멤버",
  mercenary: "용병",
  guest: "게스트",
};

export const AFFILIATION_TYPES = {
  region: "지역",
  school: "학교",
  company: "회사",
  club: "동호회",
};

export const EVIDENCE_OPTIONS = [
  { id: "photo", label: "스코어보드 사진", factor: 0.05 },
  { id: "referee", label: "심판/운영자 확인", factor: 0.08 },
  { id: "captain", label: "양팀 주장 확인", factor: 0.07 },
];

export const PLAYER_STAT_FIELDS = [
  { id: "points", label: "득점", shortLabel: "PTS", weight: 0.035 },
  { id: "rebounds", label: "리바운드", shortLabel: "REB", weight: 0.055 },
  { id: "assists", label: "어시스트", shortLabel: "AST", weight: 0.055 },
  { id: "steals", label: "스틸", shortLabel: "STL", weight: 0.08 },
  { id: "blocks", label: "블록", shortLabel: "BLK", weight: 0.08 },
];

export const COURTS = [
  { id: "c1", name: "한강 노을코트", region: "마포", type: "야외", favorite: true },
  { id: "c2", name: "성수 브릿지파크", region: "성수", type: "야외", favorite: true },
  { id: "c3", name: "잠실 실내체육관 보조코트", region: "잠실", type: "실내", favorite: true },
  { id: "c4", name: "홍대 스트릿돔", region: "마포", type: "실내", favorite: true },
  { id: "c5", name: "뚝섬 리버사이드", region: "성수", type: "야외", favorite: true },
  { id: "c6", name: "양재 플로우코트", region: "강남", type: "실내", favorite: true },
  { id: "c7", name: "반포 선셋파크", region: "서초", type: "야외", favorite: true },
  { id: "c8", name: "노량진 루프코트", region: "동작", type: "야외", favorite: true },
  { id: "c9", name: "연남 레일파크", region: "마포", type: "야외", favorite: false },
  { id: "c10", name: "왕십리 언더패스", region: "성동", type: "야외", favorite: false },
  { id: "c11", name: "신촌 블루짐", region: "서대문", type: "실내", favorite: false },
  { id: "c12", name: "문래 팩토리코트", region: "영등포", type: "실내", favorite: false },
];

export const REGIONS = ["마포", "성수", "잠실", "강남", "서초", "동작", "성동", "서대문", "영등포"];

export const TIER_QUOTES = {
  Rookie: "아직 이름표는 작다. 하지만 첫 승은 이미 코트의 불빛을 향하고 있다.",
  Bronze: "기본기를 증명하는 구간. 흔들리지 않는 한 포제션이 당신의 첫 기준이 된다.",
  Silver: "동네 코트에서 이름이 들리기 시작한다. 이제 상대는 당신의 습관을 기억한다.",
  Gold: "팀이 공을 맡기는 티어. 마지막 공격권이 왔을 때, 시선은 당신에게 모인다.",
  Platinum: "매치업을 바꾸는 존재. 기록은 더 이상 숫자가 아니라 경고문이다.",
  Diamond: "코트의 흐름을 꺾는 플레이어. 한 경기만으로 랭킹판의 공기가 바뀐다.",
  Master: "지역 래더의 기준점. 이기는 법보다 판을 지배하는 법을 보여준다.",
  Legend: "오늘의 승패를 넘어 시즌의 장면이 된다. 코트는 당신의 이름으로 기억된다.",
};

export const STORAGE_KEY = "rankball.mvp.state.v1";
