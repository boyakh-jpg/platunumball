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

export const MATCH_SIDE_FALLBACK_NAMES = Object.freeze({
  teamA: "Team A",
  teamB: "Team B",
});

export const RECORD_TYPES = Object.freeze({
  match: "match",
  matchRecord: "match_record",
  personalRecord: "solo",
});

export const ROOM_KINDS = Object.freeze({
  publicRecruiting: "public_recruiting",
  privateInvite: "private_invite",
  matchRecord: "match_record",
  personalRecord: "personal_record",
  tournament: "tournament",
});

const ROOM_KIND_LABELS = Object.freeze({
  [ROOM_KINDS.publicRecruiting]: "공개 모집방",
  [ROOM_KINDS.privateInvite]: "비공개 초대방",
  [ROOM_KINDS.matchRecord]: "경기 기록방",
  [ROOM_KINDS.personalRecord]: "내 기록",
  [ROOM_KINDS.tournament]: "대회방",
});

export const ROOM_RELATION_TERMS = Object.freeze({
  pregame: Object.freeze({
    request: "초대",
    accept: "참가 확정",
    subject: "참가자",
  }),
  record: Object.freeze({
    request: "확인 요청",
    accept: "기록 확인",
    subject: "기록 대상",
  }),
  teamRoster: Object.freeze({
    request: "팀원 소집",
    accept: "로스터 등록",
    subject: "출전 선수",
  }),
});

export function getRoomKindLabel(roomKind = "") {
  return ROOM_KIND_LABELS[roomKind] ?? ROOM_KIND_LABELS[ROOM_KINDS.privateInvite];
}

export function getRoomKindFromDraft(draft = {}) {
  if (draft.recordType === RECORD_TYPES.personalRecord) return ROOM_KINDS.personalRecord;
  if (draft.recordType === RECORD_TYPES.matchRecord) return ROOM_KINDS.matchRecord;
  if (draft.visibility === "tournament") return ROOM_KINDS.tournament;
  if (draft.visibility === "public") return ROOM_KINDS.publicRecruiting;
  return ROOM_KINDS.privateInvite;
}

export const MAX_TEAM_MEMBERSHIPS = 3;
export const MAX_TEAM_MEMBERS = 10;
export const MAX_TEAM_NAME_LENGTH = 14;
export const REFEREE_TRUST_MIN = 90;
export const HOST_TRUST_MIN = {
  rankedPrivate: 70,
  rankedPublic: 75,
  official: 80,
};
export function getHostTrustRequirement({ ranked = true, visibility = "private", official = false } = {}) {
  if (!ranked) return 0;
  if (official) return HOST_TRUST_MIN.official;
  return visibility === "public" ? HOST_TRUST_MIN.rankedPublic : HOST_TRUST_MIN.rankedPrivate;
}
export const COURT_REQUEST_TRUST_MIN = 70;
export const FALSE_COURT_REPORT_TRUST_PENALTY = 8;
export const REFEREE_ABSENCE_TRUST_PENALTY = 4;
export const INSTANT_ROOM_EXPIRE_MINUTES = 120;
export const STAT_ENTRY_WINDOW_MINUTES = 60;
export const DISPUTE_WINDOW_MINUTES = 30;
export const DISPUTE_WINDOW_MAX_MINUTES = 60;
export function normalizeDisputeWindowMinutes(value, fallback = DISPUTE_WINDOW_MINUTES) {
  const minutes = Number(value ?? fallback);
  if (!Number.isFinite(minutes) || minutes <= 0) return fallback;
  return Math.min(minutes, DISPUTE_WINDOW_MAX_MINUTES);
}
export const TEST_ACCOUNT_COUNT = 50;
const TEAM_INVITE_ROLES = ["regular", "mercenary"];
export function normalizeMmrLimitMode(mode = "block") {
  return ["off", "warn", "block"].includes(mode) ? mode : "block";
}
export const QUEUE_SCHEDULE_START_DATE = "2026-06-15";
export const QUEUE_SCHEDULE_TIMES = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
export const POST_MATCH_STATUSES = new Set(["approval", "disputed"]);
export const RECORDABLE_RESERVE_SOURCES = new Set(["reserve-entry", "team-reserve"]);
export const MAX_RECRUITING_RESERVES_PER_SIDE = 2;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const SCHEDULE_MAX_DAYS = 365;
export const ROOM_SCHEDULE_MAX_DAYS = 30;
export const PUBLIC_ROOM_SCHEDULE_MAX_DAYS = 5;
export const PUBLIC_ROOM_MIN_LEAD_HOURS = 4;
export const REFEREE_EXAM_COOLDOWN_MS = 7 * DAY_MS;
export const REPORT_MATCH_WINDOW_MS = 7 * DAY_MS;
export const LIFECYCLE_TITLE_PATTERN = /^(동의 대기|진행 예정|결과 승인|이의 확인|이의제기|확정|결과 입력)\s*·\s*/;
export const POST_MATCH_TITLE_PATTERN = /^(결과 승인|이의 확인|이의제기|확정|결과 입력)\s*·\s*/;
export const SIDE_LABEL_TEXT = { teamA: "A사이드", teamB: "B사이드" };
export const TEST_PROFILE_SETUP_AT = "2026-06-17T09:00:00.000Z";
export const TEST_PROFILE_BIRTH_YEAR = 2000;
export const TEST_PROFILE_AGE_GROUP = "open";
export const TEST_PROFILE_AGE_GROUP_SEASON = "2026-h1";
export const REMOTE_PAGE_SIZE = 1000;
export const REMOTE_WRITE_CHUNK_SIZE = 500;
export const REMOTE_CLIENT_MATCH_LIMIT = 50;
export const REMOTE_CLIENT_RECRUITING_LIMIT = 50;
export const REMOTE_CLIENT_INITIAL_MATCH_LIMIT = 5;
export const REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT = 5;
export const REMOTE_CLIENT_ACTIVE_MATCH_LIMIT = 200;
export const REMOTE_CLIENT_RECORD_MATCH_LIMIT = 200;
export const REMOTE_CLIENT_RECORD_MONTHS = 6;
export const REMOTE_CLIENT_HOME_LOCAL_RECRUITING_LIMIT = 3;
export const REMOTE_CLIENT_TOURNAMENT_LIMIT = 80;
export const REMOTE_CLIENT_MAX_LIMIT = 500;
export const FAVORITE_LIMIT = 10;
export const SOLO_RECORD_MODE_IDS = new Set(["1v1", "2v2", "3v3", "4v4", "5v5"]);
export const SOLO_RECORD_ANONYMOUS_POSITION = "free";
export const SOLO_RECORD_ANONYMOUS_SOURCE = "개인참여";

export const PLAYER_POSITIONS = ["상관없음", "PG", "SG", "SF", "PF", "C"];

const TEAM_ROLES = {
  captain: "팀장",
  regular: "정규멤버",
  mercenary: "용병",
};

const TEAM_ROLE_ALIASES = {
  candidate: "regular",
  substitute: "regular",
  guest: "mercenary",
};

export function normalizeTeamRole(role = "regular", { allowCaptain = true } = {}) {
  const safeRole = String(role || "regular").trim();
  const canonicalRole = TEAM_ROLE_ALIASES[safeRole] ?? safeRole;
  if (canonicalRole === "captain" && allowCaptain) return "captain";
  if (canonicalRole === "regular" || canonicalRole === "mercenary") return canonicalRole;
  return "regular";
}

export function isTeamInviteRole(role = "regular") {
  return TEAM_INVITE_ROLES.includes(normalizeTeamRole(role, { allowCaptain: false }));
}

export function getTeamRoleLabel(role = "regular") {
  return TEAM_ROLES[normalizeTeamRole(role)] ?? TEAM_ROLES.regular;
}

export function isMercenaryTeamRole(role = "regular") {
  return normalizeTeamRole(role) === "mercenary";
}

function padTestAccountNumber(value) {
  return String(value).padStart(3, "0");
}

export function normalizeTestLoginId(value = "") {
  const text = String(value).trim().toLowerCase();
  const numeric = text.match(/^\d{1,3}$/)?.[0];
  if (numeric) return `rankball-${padTestAccountNumber(numeric)}`;
  const match = text.match(/^rankball-(\d{1,3})$/);
  return match ? `rankball-${padTestAccountNumber(match[1])}` : text;
}

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

export const REGIONS = ["마포", "성수", "광진", "잠실", "강남", "서초", "동작", "성동", "서대문", "영등포"];

function normalizeRegionText(value = "") {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

export function getCanonicalRegion(value = "") {
  const normalized = normalizeRegionText(value);
  return REGIONS.find((region) => normalized.includes(normalizeRegionText(region))) ?? String(value ?? "").trim();
}

export function isSameRegion(left = "", right = "") {
  const leftKey = normalizeRegionText(getCanonicalRegion(left));
  const rightKey = normalizeRegionText(getCanonicalRegion(right));
  return Boolean(leftKey && rightKey && (leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey)));
}

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
