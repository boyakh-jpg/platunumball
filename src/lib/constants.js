export const MATCH_MODES = [
  { id: "1v1", label: "1v1", size: 1 },
  { id: "2v2", label: "2v2", size: 2 },
  { id: "3v3", label: "3v3", size: 3 },
  { id: "5v5", label: "5v5", size: 5 },
];

export const MATCH_MODE_IDS = Object.freeze(MATCH_MODES.map((mode) => mode.id));

export function isSupportedMatchMode(mode = "") {
  return MATCH_MODE_IDS.includes(mode);
}

export const MODE_SIZES = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = mode.size;
  return map;
}, {});

export function getModeSize(mode = "5v5", fallback = 5) {
  const configuredSize = Number(MODE_SIZES[mode]);
  if (Number.isFinite(configuredSize)) return configuredSize;
  const parsedSize = Number(String(mode).match(/^(\d+)/)?.[1] ?? fallback);
  return Math.max(1, Math.min(5, Number.isFinite(parsedSize) ? parsedSize : fallback));
}

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
  [ROOM_KINDS.matchRecord]: "경기 기록",
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
export const HOME_RIVAL_TEAM_LIMIT = 4;
export const HOME_REGION_PLAYER_LIMIT = 5;
export const MAX_TEAM_MEMBERS = 10;
export const MAX_TEAM_NAME_LENGTH = 14;
export const REFEREE_TRUST_MIN = 90;
export const REFEREE_GRADE_IDS = Object.freeze(["candidate", "silver", "gold", "platinum", "official"]);
export const TEST_REFEREE_LOGIN_IDS = Object.freeze(["rankball-001", "rankball-011"]);
const REFEREE_GRADE_ID_SET = new Set(REFEREE_GRADE_IDS);
export function isRefereeGrade(value = "") {
  return REFEREE_GRADE_ID_SET.has(value);
}
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
export const DISPUTE_WINDOW_OPTIONS = Object.freeze([10, 15, 20]);
export const DISPUTE_WINDOW_MINUTES = 15;
export const DISPUTE_WINDOW_MAX_MINUTES = 20;
export function normalizeDisputeWindowMinutes(value, fallback = DISPUTE_WINDOW_MINUTES) {
  const minutes = Number(value ?? fallback);
  if (DISPUTE_WINDOW_OPTIONS.includes(minutes)) return minutes;
  const fallbackMinutes = Number(fallback);
  return DISPUTE_WINDOW_OPTIONS.includes(fallbackMinutes) ? fallbackMinutes : DISPUTE_WINDOW_MINUTES;
}
export const TEST_ACCOUNT_COUNT = 50;
export const TEAM_INVITE_ROLES = Object.freeze(["regular", "mercenary"]);
export const MMR_LIMIT_MODES = Object.freeze(["off", "warn", "block"]);
const MMR_LIMIT_MODE_SET = new Set(MMR_LIMIT_MODES);
export function normalizeMmrLimitMode(mode = "block") {
  return MMR_LIMIT_MODE_SET.has(mode) ? mode : "block";
}
export const QUEUE_SCHEDULE_START_DATE = "2026-06-15";
export const QUEUE_SCHEDULE_TIMES = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
export const POST_MATCH_STATUSES = new Set(["approval", "disputed"]);
export const RECORDABLE_RESERVE_SOURCES = new Set(["reserve-entry", "team-reserve"]);
export const MIN_BENCH_CAPACITY = 0;
export const MAX_BENCH_CAPACITY = 3;
export const DEFAULT_BENCH_CAPACITY = 2;
export const BENCH_CAPACITY_OPTIONS = Object.freeze([0, 1, 2, 3]);
export const MAX_RECRUITING_RESERVES_PER_SIDE = MAX_BENCH_CAPACITY;
export function isValidBenchCapacity(value) {
  if (typeof value === "string" && !/^[0-3]$/.test(value)) return false;
  if (typeof value !== "string" && typeof value !== "number") return false;
  const capacity = Number(value);
  return Number.isInteger(capacity) && capacity >= MIN_BENCH_CAPACITY && capacity <= MAX_BENCH_CAPACITY;
}
export function normalizeBenchCapacity(value, fallback = DEFAULT_BENCH_CAPACITY) {
  if (isValidBenchCapacity(value)) return Number(value);
  return isValidBenchCapacity(fallback) ? Number(fallback) : DEFAULT_BENCH_CAPACITY;
}
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const SCHEDULE_MAX_DAYS = 365;
export const ROOM_SCHEDULE_MAX_DAYS = 30;
export const PUBLIC_ROOM_SCHEDULE_MAX_DAYS = 5;
export const PUBLIC_ROOM_MIN_LEAD_HOURS = 4;
export const DEFAULT_TOURNAMENT_MMR_GAP = 250;
export const REFEREE_EXAM_COOLDOWN_DAYS = 7;
export const REPORT_MATCH_WINDOW_DAYS = 7;
export const REFEREE_EXAM_COOLDOWN_MS = REFEREE_EXAM_COOLDOWN_DAYS * DAY_MS;
export const REPORT_MATCH_WINDOW_MS = REPORT_MATCH_WINDOW_DAYS * DAY_MS;
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
export const REMOTE_CLIENT_RECORD_LIST_YEARS = 5;
export const REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT = 100;
export const REMOTE_CLIENT_HOME_LOCAL_RECRUITING_LIMIT = 3;
export const REMOTE_CLIENT_TOURNAMENT_LIMIT = 80;
export const REMOTE_CLIENT_MAX_LIMIT = 500;
export const FAVORITE_LIMIT = 10;
export const SOLO_RECORD_MODE_IDS = new Set(["1v1", "2v2", "3v3", "4v4", "5v5"]);
export function isSupportedSoloRecordMode(mode = "") {
  return SOLO_RECORD_MODE_IDS.has(mode);
}
export const SOLO_RECORD_ANONYMOUS_POSITION = "free";
export const SOLO_RECORD_ANONYMOUS_SOURCE = "개인참여";

export const BASKETBALL_POSITIONS = Object.freeze(["PG", "SG", "SF", "PF", "C"]);
export const PLAYER_POSITIONS = Object.freeze(["상관없음", ...BASKETBALL_POSITIONS]);

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

export function getTestAccountDisplayLabel(value = "") {
  const text = String(value ?? "").trim();
  const match = text.match(/rankball-(\d{1,3})(?:@rankball\.test|\s+test)?$/i);
  if (!match) return text;
  return `${Number(match[1])}번 계정`;
}

export const AFFILIATION_TYPES = {
  region: "지역",
  school: "학교",
  company: "회사",
  organization: "소속",
};

export const EVIDENCE_OPTIONS = [
  { id: "court_reservation", label: "구장 예약내역" },
];

export const MATCH_SIDES = Object.freeze(["teamA", "teamB"]);
export const DEFAULT_RATING = 1200;
export const DEFAULT_PLAYER_RATINGS = Object.freeze({
  integrated: DEFAULT_RATING,
  modes: Object.freeze(Object.fromEntries(MATCH_MODES.map((mode) => [mode.id, DEFAULT_RATING]))),
  placement: Object.freeze({
    matchCount: 0,
    target: 5,
    completed: false,
    completedAt: null,
    evidenceWeight: 0,
    modeCounts: Object.freeze({}),
  }),
});

export const CREDIBILITY_LEVELS = {
  self_record: { label: "친선 기록" },
  street_majority: { label: "길농 과반 승인" },
  pre_registered: { label: "사전등록" },
  evidence_verified: { label: "증빙 확인" },
  official: { label: "공식경기" },
  official_with_evidence: { label: "공식+증빙" },
};

export const PLAYER_STAT_FIELDS = [
  { id: "points", label: "득점", shortLabel: "PTS" },
  { id: "rebounds", label: "리바운드", shortLabel: "REB" },
  { id: "assists", label: "어시스트", shortLabel: "AST" },
  { id: "steals", label: "스틸", shortLabel: "STL" },
  { id: "blocks", label: "블록", shortLabel: "BLK" },
  { id: "turnovers", label: "턴오버", shortLabel: "TO" },
  { id: "fouls", label: "파울", shortLabel: "F" },
];
export const PLAYER_STAT_FIELD_IDS = Object.freeze(PLAYER_STAT_FIELDS.map((field) => field.id));

export const COURTS = [
  {
    id: "c1",
    hashtag: "#10001",
    name: "망원한강공원 농구장",
    region: "마포",
    type: "야외",
    favorite: true,
    addressText: "서울특별시 마포구 마포나루길 467 한강공원 망원안내센터",
    roadAddress: "서울특별시 마포구 마포나루길 467 한강공원 망원안내센터",
    jibunAddress: "서울특별시 마포구 망원동 205-4 한강공원 망원안내센터",
    zonecode: "04005",
    lat: 37.5523461,
    lng: 126.8998896,
    locationNote: "망원한강공원 농구시설입니다. 핀은 시설 주소를 기준으로 표시됩니다.",
    courtKind: "street_hoop",
    hoopCount: 2,
    lighting: null,
    paid: false,
    reservation: false,
    pinPrecision: "facility_address",
    sourceUrl: "https://hangang.seoul.go.kr/www/contents/666.do?mid=468",
  },
  {
    id: "c2",
    hashtag: "#10002",
    name: "서울숲복합문화체육센터 체육관",
    region: "성수",
    type: "실내",
    favorite: true,
    addressText: "서울특별시 성동구 왕십리로11길 19 서울숲 복합문화체육센터",
    roadAddress: "서울특별시 성동구 왕십리로11길 19 서울숲 복합문화체육센터",
    jibunAddress: "서울특별시 성동구 성수동1가 685-61 서울숲 복합문화체육센터",
    zonecode: "04767",
    lat: 37.5490719,
    lng: 127.0415013,
    locationNote: "서울숲복합문화체육센터 실내 체육관입니다. 대관 가능 여부를 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://www.sd.go.kr/main/contents.do?key=1449",
  },
  {
    id: "c3",
    hashtag: "#10003",
    name: "잠실실내체육관 보조농구장",
    region: "잠실",
    type: "실내",
    favorite: true,
    addressText: "서울특별시 송파구 올림픽로 25 서울종합운동장",
    roadAddress: "서울특별시 송파구 올림픽로 25 서울종합운동장",
    jibunAddress: "서울특별시 송파구 잠실동 10 서울종합운동장",
    zonecode: "05500",
    lat: 37.5148022,
    lng: 127.0736261,
    locationNote: "잠실실내체육관 보조농구장입니다. 대관 일정과 출입구를 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://stadium.seoul.go.kr/reserve/jamsil/inside-stadium",
  },
  {
    id: "c4",
    hashtag: "#10004",
    name: "마포구민체육센터 체육관",
    region: "마포",
    type: "실내",
    favorite: true,
    addressText: "서울특별시 마포구 월드컵로25길 190 마포구민체육센터",
    roadAddress: "서울특별시 마포구 월드컵로25길 190 마포구민체육센터",
    jibunAddress: "서울특별시 마포구 망원동 450-3 마포구민체육센터",
    zonecode: "03954",
    lat: 37.5567653,
    lng: 126.8969649,
    locationNote: "마포구민체육센터 실내 체육관입니다. 대관 일정을 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://yeyak.maposc.or.kr/",
  },
  {
    id: "c5",
    hashtag: "#10005",
    name: "뚝섬한강공원 농구장",
    region: "성수",
    type: "야외",
    favorite: true,
    addressText: "서울특별시 광진구 강변북로 2273 한강공원뚝섬안내센터",
    roadAddress: "서울특별시 광진구 강변북로 2273 한강공원뚝섬안내센터",
    jibunAddress: "서울특별시 광진구 자양동 427-1 한강공원뚝섬안내센터",
    zonecode: "05097",
    lat: 37.5293646,
    lng: 127.0739782,
    locationNote: "뚝섬한강공원 농구시설입니다. 핀은 시설 주소를 기준으로 표시됩니다.",
    courtKind: "street_hoop",
    hoopCount: 2,
    lighting: null,
    paid: false,
    reservation: false,
    pinPrecision: "facility_address",
    sourceUrl: "https://hangang.seoul.go.kr/www/contents/654.do?mid=622",
  },
  {
    id: "c6",
    hashtag: "#10006",
    name: "강남구민체육관",
    region: "강남",
    type: "실내",
    favorite: true,
    addressText: "서울특별시 강남구 개포로28길 47 구민체육관",
    roadAddress: "서울특별시 강남구 개포로28길 47 구민체육관",
    jibunAddress: "서울특별시 강남구 개포동 1271 구민체육관",
    zonecode: "06311",
    lat: 37.4771366,
    lng: 127.0519105,
    locationNote: "강남구민체육관 실내 체육관입니다. 대관 일정을 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://life.gangnam.go.kr/fmcs/105",
  },
  {
    id: "c7",
    hashtag: "#10007",
    name: "반포한강공원 농구장",
    region: "서초",
    type: "야외",
    favorite: true,
    addressText: "서울특별시 서초구 신반포로11길 40 한강공원 반포 안내센터",
    roadAddress: "서울특별시 서초구 신반포로11길 40 한강공원 반포 안내센터",
    jibunAddress: "서울특별시 서초구 반포동 115-5 한강공원 반포 안내센터",
    zonecode: "06500",
    lat: 37.5077215,
    lng: 126.9927291,
    locationNote: "반포한강공원 농구시설입니다. 핀은 시설 주소를 기준으로 표시됩니다.",
    courtKind: "street_hoop",
    hoopCount: 2,
    lighting: null,
    paid: false,
    reservation: false,
    pinPrecision: "facility_address",
    sourceUrl: "https://hangang.seoul.go.kr/www/contents/663.do?mid=463",
  },
  {
    id: "c8",
    hashtag: "#10008",
    name: "흑석체육센터 체육관",
    region: "동작",
    type: "실내",
    favorite: true,
    addressText: "서울특별시 동작구 현충로 73 흑석체육센터",
    roadAddress: "서울특별시 동작구 현충로 73 흑석체육센터",
    jibunAddress: "서울특별시 동작구 흑석동 116-1 흑석체육센터",
    zonecode: "06904",
    lat: 37.5100566,
    lng: 126.963469,
    locationNote: "흑석체육센터 실내 체육관입니다. 대관 일정을 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://www.idongjak.or.kr/html/facility/facility01_01_04.php",
  },
  {
    id: "c9",
    hashtag: "#10009",
    name: "마포아트센터 종합체육관",
    region: "마포",
    type: "실내",
    favorite: false,
    addressText: "서울특별시 마포구 대흥로20길 28 마포아트센터",
    roadAddress: "서울특별시 마포구 대흥로20길 28 마포아트센터",
    jibunAddress: "서울특별시 마포구 대흥동 30-3 마포아트센터",
    zonecode: "04136",
    lat: 37.5499061,
    lng: 126.9455338,
    locationNote: "마포아트센터 종합체육관입니다. 대관 일정을 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://www.mfac.or.kr/rental/rental_info_gym.jsp",
  },
  {
    id: "c10",
    hashtag: "#10010",
    name: "성동구민종합체육센터 체육관",
    region: "성동",
    type: "실내",
    favorite: false,
    addressText: "서울특별시 성동구 왕십리로 89 성동구민종합체육센터",
    roadAddress: "서울특별시 성동구 왕십리로 89 성동구민종합체육센터",
    jibunAddress: "서울특별시 성동구 성수동1가 685-697 성동구민종합체육센터",
    zonecode: "04769",
    lat: 37.5458701,
    lng: 127.0440144,
    locationNote: "성동구민종합체육센터 실내 체육관입니다. 대관 일정을 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://www.sd.go.kr/main/contents.do?key=1449",
  },
  {
    id: "c11",
    hashtag: "#10011",
    name: "서대문문화체육회관 대체육관",
    region: "서대문",
    type: "실내",
    favorite: false,
    addressText: "서울특별시 서대문구 백련사길 39 서대문문화체육회관",
    roadAddress: "서울특별시 서대문구 백련사길 39 서대문문화체육회관",
    jibunAddress: "서울특별시 서대문구 홍은동 산26-155 서대문문화체육회관",
    zonecode: "03657",
    lat: 37.5806749,
    lng: 126.9314526,
    locationNote: "서대문문화체육회관 대체육관입니다. 대관 일정을 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://cs.sscmc.or.kr/sdmcs/21",
  },
  {
    id: "c12",
    hashtag: "#10012",
    name: "영등포제1스포츠센터 체육관",
    region: "영등포",
    type: "실내",
    favorite: false,
    addressText: "서울특별시 영등포구 신풍로 1 영등포제1스포츠센터",
    roadAddress: "서울특별시 영등포구 신풍로 1 영등포제1스포츠센터",
    jibunAddress: "서울특별시 영등포구 신길동 426-3 영등포제1스포츠센터",
    zonecode: "07398",
    lat: 37.5005379,
    lng: 126.9062946,
    locationNote: "영등포제1스포츠센터 실내 체육관입니다. 대관 일정을 확인해 주세요.",
    courtKind: "official",
    hoopCount: 2,
    lighting: true,
    paid: true,
    reservation: true,
    pinPrecision: "facility_address",
    sourceUrl: "https://spc.y-sisul.or.kr/",
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
