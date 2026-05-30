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
  "한강 노을코트",
  "잠실 실내체육관 보조코트",
  "성수 브릿지파크",
  "홍대 스트릿돔",
];

export const STORAGE_KEY = "rankball.mvp.state.v1";
