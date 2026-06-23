export const MATCH_MODES = [
  { id: "1v1", label: "1v1", size: 1, integratedWeight: 0.25, modeCap: 25, integratedCap: 8 },
  { id: "2v2", label: "2v2", size: 2, integratedWeight: 0.45, modeCap: 28, integratedCap: 14 },
  { id: "3v3", label: "3v3", size: 3, integratedWeight: 0.85, modeCap: 32, integratedCap: 25 },
  { id: "5v5", label: "5v5", size: 5, integratedWeight: 1.35, modeCap: 40, integratedCap: 45, officialModeCap: 50, officialIntegratedCap: 55 },
];

export const MODE_SIZES = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = mode.size;
  return map;
}, {});

export const MAX_TEAM_MEMBERSHIPS = 3;
export const MAX_TEAM_NAME_LENGTH = 14;
export const REFEREE_TRUST_MIN = 90;
export const STAT_ENTRY_WINDOW_MINUTES = 60;
export const DISPUTE_WINDOW_MINUTES = 30;

export const PLAYER_POSITIONS = ["상관없음", "PG", "SG", "SF", "PF", "C"];

export const TEAM_ROLES = {
  captain: "팀장",
  regular: "정규멤버",
  candidate: "정식팀원",
  substitute: "정식팀원",
  mercenary: "용병",
  guest: "게스트",
};

export const AFFILIATION_TYPES = {
  region: "지역",
  school: "학교",
  company: "회사",
};

export const EVIDENCE_OPTIONS = [
  { id: "court_reservation", label: "구장 예약내역", factor: 0.2 },
];

export const CREDIBILITY_LEVELS = {
  self_record: { label: "친선 기록", factor: 0.18 },
  street_majority: { label: "길농 과반 승인", factor: 0.7 },
  pre_registered: { label: "사전등록", factor: 1 },
  evidence_verified: { label: "증빙 확인", factor: 1.15 },
  official: { label: "공식경기", factor: 1.35 },
  official_with_evidence: { label: "공식+증빙", factor: 1.5 },
};

export const PLAYER_STAT_FIELDS = [
  { id: "points", label: "득점", shortLabel: "PTS", weight: 0.035 },
  { id: "rebounds", label: "리바운드", shortLabel: "REB", weight: 0.055 },
  { id: "assists", label: "어시스트", shortLabel: "AST", weight: 0.055 },
  { id: "steals", label: "스틸", shortLabel: "STL", weight: 0.08 },
  { id: "blocks", label: "블록", shortLabel: "BLK", weight: 0.08 },
  { id: "fouls", label: "파울", shortLabel: "F", weight: 0 },
];

export const COURTS = [
  {
    id: "c1",
    name: "한강 노을코트",
    region: "마포",
    type: "야외",
    favorite: true,
    addressText: "서울 마포구 망원동 한강공원 망원지구",
    locationNote: "망원나들목에서 한강 방향으로 내려와 오른쪽 골대.",
    courtKind: "street_hoop",
    hoopCount: 2,
    lighting: true,
    paid: false,
    reservation: false,
  },
  {
    id: "c2",
    name: "성수 브릿지파크",
    region: "성수",
    type: "야외",
    favorite: true,
    addressText: "서울 성동구 성수동1가 서울숲 인근",
    locationNote: "서울숲역에서 강변 방향, 다리 아래 코트.",
    courtKind: "street_hoop",
    hoopCount: 2,
    lighting: true,
    paid: false,
    reservation: false,
  },
  {
    id: "c3",
    name: "잠실 실내체육관 보조코트",
    region: "잠실",
    type: "실내",
    favorite: true,
    addressText: "서울 송파구 올림픽로 25",
    locationNote: "실내체육관 보조코트 입구 확인 필요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
  },
  {
    id: "c4",
    name: "홍대 스트릿돔",
    region: "마포",
    type: "실내",
    favorite: true,
    addressText: "서울 마포구 홍익로 인근",
    locationNote: "홍대입구역 9번 출구 쪽, 실내 대관 확인.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
  },
  {
    id: "c5",
    name: "뚝섬 리버사이드",
    region: "성수",
    type: "야외",
    favorite: true,
    addressText: "서울 광진구 자양동 뚝섬한강공원",
    locationNote: "뚝섬유원지역에서 한강공원 진입 후 농구장 표지 확인.",
    courtKind: "street_hoop",
    hoopCount: 2,
    lighting: true,
    paid: false,
    reservation: false,
  },
  {
    id: "c6",
    name: "양재 플로우코트",
    region: "강남",
    type: "실내",
    favorite: true,
    addressText: "서울 강남구 양재천로 인근",
    locationNote: "유료 대관 여부는 방 규칙에서 확인.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
  },
  {
    id: "c7",
    name: "반포 선셋파크",
    region: "서초",
    type: "야외",
    favorite: true,
    addressText: "서울 서초구 반포동 반포한강공원",
    locationNote: "달빛광장 쪽 코트, 주말 대기 가능.",
    courtKind: "street_hoop",
    hoopCount: 2,
    lighting: true,
    paid: false,
    reservation: false,
  },
  {
    id: "c8",
    name: "노량진 루프코트",
    region: "동작",
    type: "야외",
    favorite: true,
    addressText: "서울 동작구 노량진동 인근",
    locationNote: "옥상/야외 코트라 입구 안내 확인 필요.",
    courtKind: "street_hoop",
    hoopCount: 1,
    lighting: true,
    paid: false,
    reservation: false,
  },
  {
    id: "c9",
    name: "연남 레일파크",
    region: "마포",
    type: "야외",
    favorite: false,
    addressText: "서울 마포구 연남동 경의선숲길 인근",
    locationNote: "공원 길 안쪽 골대 위치 확인.",
    courtKind: "street_hoop",
    hoopCount: 1,
    lighting: false,
    paid: false,
    reservation: false,
  },
  {
    id: "c10",
    name: "왕십리 언더패스",
    region: "성동",
    type: "야외",
    favorite: false,
    addressText: "서울 성동구 왕십리로 인근",
    locationNote: "고가 아래 코트, 비 오는 날 바닥 상태 확인.",
    courtKind: "street_hoop",
    hoopCount: 1,
    lighting: true,
    paid: false,
    reservation: false,
  },
  {
    id: "c11",
    name: "신촌 블루짐",
    region: "서대문",
    type: "실내",
    favorite: false,
    addressText: "서울 서대문구 신촌로 인근",
    locationNote: "실내 대관형 코트. 예약 내역 확인 필요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
  },
  {
    id: "c12",
    name: "문래 팩토리코트",
    region: "영등포",
    type: "실내",
    favorite: false,
    addressText: "서울 영등포구 문래동 인근",
    locationNote: "공장형 실내 코트. 주차/입구 안내 확인.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
  },
];

export const REGIONS = ["마포", "성수", "잠실", "강남", "서초", "동작", "성동", "서대문", "영등포"];

export const TIER_QUOTES = {
  Rookie: "입문 구간. 경기 기록을 쌓는 단계입니다.",
  Bronze: "기본기를 확인하는 구간입니다.",
  Silver: "꾸준히 경기에 참여하는 플레이어입니다.",
  Gold: "팀 기여도가 안정적인 플레이어입니다.",
  Platinum: "상위권 진입을 노릴 수 있는 구간입니다.",
  Diamond: "지역 랭킹 상위권 플레이어입니다.",
  Master: "대부분의 경기에서 높은 영향력을 보입니다.",
  Legend: "최상위권 기록을 유지하는 플레이어입니다.",
};

export const STORAGE_KEY = "rankball.mvp.state.v3";
