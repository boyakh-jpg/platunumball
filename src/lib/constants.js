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
  Rookie: "첫 드리블은 투박해도, 코트는 이미 당신을 기억하기 시작했습니다.",
  Bronze: "기본기를 쌓는 구간. 한 경기만 제대로 잠그면 흐름이 바뀝니다.",
  Silver: "동네 코트에서 이름이 들리기 시작하는 티어입니다.",
  Gold: "팀이 믿고 공을 맡기는 구간. 결정적인 한 포제션이 티어를 가릅니다.",
  Platinum: "상대가 매치업을 계산하기 시작합니다. 이제 기록이 실력의 증거입니다.",
  Diamond: "코트의 판도를 바꾸는 플레이어. 공식전 한 판이 랭킹을 흔듭니다.",
  Master: "지역 래더의 기준점. 승리보다 경기의 질로 기억됩니다.",
  Legend: "오늘의 판이 아니라 시즌의 서사가 됩니다.",
};

export const STORAGE_KEY = "rankball.mvp.state.v1";
