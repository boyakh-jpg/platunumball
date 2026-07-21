import {
  COURTS,
  DISPUTE_WINDOW_MINUTES,
  MATCH_MODES,
  MODE_SIZES,
  PLAYER_POSITIONS,
  REFEREE_TRUST_MIN,
  REGIONS,
  STAT_ENTRY_WINDOW_MINUTES,
} from "./constants.js";
import { demoFlowState } from "./demoFlowState.js";
import { toHashtag } from "./handles.js";

// P-DEMO-CLEANUP: seed/local-dev only. Production app must not import this module.
const DEMO_TODAY = "2026-06-18";
const DEMO_NOW = "2026-06-18T12:00:00";
const DEMO_QUEUE_START = "2026-06-18";
const DEMO_QUEUE_TIMES = ["18:00", "19:30", "21:00"];

function getDemoQueueSlot(slotIndex) {
  const date = new Date(`${DEMO_QUEUE_START}T00:00:00`);
  date.setDate(date.getDate() + Math.floor(slotIndex / DEMO_QUEUE_TIMES.length));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const scheduledDate = `${year}-${month}-${day}`;
  const scheduledTime = DEMO_QUEUE_TIMES[slotIndex % DEMO_QUEUE_TIMES.length];
  return {
    scheduledDate,
    scheduledTime,
    scheduledAt: `${scheduledDate} ${scheduledTime}`,
  };
}

function makeDemoTimestamp(scheduledDate, scheduledTime, extraMinutes = 0) {
  const date = new Date(`${scheduledDate}T${scheduledTime}`);
  date.setMinutes(date.getMinutes() + extraMinutes);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:00.000Z`;
}

function makeRelativeDemoDateTime(extraMinutes = 0) {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + extraMinutes);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const scheduledDate = `${year}-${month}-${day}`;
  const scheduledTime = `${hours}:${minutes}`;
  return {
    scheduledDate,
    scheduledTime,
    scheduledAt: `${scheduledDate} ${scheduledTime}`,
    iso: `${scheduledDate}T${scheduledTime}:00.000`,
  };
}

function getDemoModeSize(mode) {
  return MODE_SIZES[mode] ?? 5;
}

function getTeamDemoPlayerIds(team = {}, capacity = 5) {
  return (team.members ?? [])
    .map((member) => member.userId)
    .slice(0, capacity);
}

function makeEmptyStatRecorders() {
  return { teamA: "", teamB: "" };
}

function makeTrustFeedback(stars = {}) {
  return { stars, updatedAt: null };
}

function makeDefaultRoomState(chatMessages = []) {
  return {
    chatMessages,
    kickLog: [],
    hostPenalties: [],
    invitations: [],
    partyReserves: {},
    reserveReady: {},
    pinnedReservePlayers: {},
    slotPositions: {},
    ruleRevision: 1,
    approvalModeA: "leader",
    approvalModeB: "leader",
  };
}

function makeDemoStatSubmissions(teamAPlayers = [], teamBPlayers = [], submittedAt, source = "player", by = null) {
  const rows = [
    ...teamAPlayers.map((playerId) => [playerId, { by: by ?? playerId, side: "teamA", source, submittedAt }]),
    ...teamBPlayers.map((playerId) => [playerId, { by: by ?? playerId, side: "teamB", source, submittedAt }]),
  ];
  return Object.fromEntries(rows);
}

function makeDemoApplicant({
  kind = "player",
  playerId = null,
  teamId = null,
  side = "teamB",
  status = "waiting",
  reserve = false,
  position = null,
  playerIds = [],
  createdAt = "2026-06-15T09:00:00.000Z",
} = {}) {
  const joinMode = kind === "team" || teamId ? "team" : "player";
  return {
    kind: joinMode,
    joinMode,
    playerId,
    teamId: joinMode === "team" ? teamId : null,
    side,
    status,
    reserve,
    position,
    playerIds: joinMode === "team" ? playerIds : [],
    createdAt,
    updatedAt: createdAt,
  };
}

const baseState = {
  currentUserId: "u1",
  users: [
    {
      id: "u1",
      name: "민준",
      handle: "#minjun",
      hashtag: "#minjun",
      position: "PG",
      region: "마포",
      school: "연희대",
      company: "프리랜서",
      club: "노을농구회",
      trustScore: 94,
      streak: 3,
      avatarColor: "#58d2c0",
      ratings: { integrated: 1378, modes: { "1v1": 1180, "2v2": 1264, "3v3": 1330, "5v5": 1412 } },
    },
    {
      id: "u2",
      name: "서윤",
      handle: "#seoyun",
      hashtag: "#seoyun",
      position: "SG",
      region: "마포",
      school: "연희대",
      company: "라임랩",
      club: "노을농구회",
      trustScore: 91,
      streak: 1,
      avatarColor: "#f4c74f",
      ratings: { integrated: 1322, modes: { "1v1": 1085, "2v2": 1222, "3v3": 1302, "5v5": 1368 } },
    },
    {
      id: "u3",
      name: "지후",
      handle: "#jihoo",
      hashtag: "#jihoo",
      position: "SF",
      region: "마포",
      school: "동교고",
      company: "라임랩",
      club: "노을농구회",
      trustScore: 86,
      streak: 0,
      avatarColor: "#ff8a5b",
      ratings: { integrated: 1288, modes: { "1v1": 1160, "2v2": 1190, "3v3": 1276, "5v5": 1312 } },
    },
    {
      id: "u4",
      name: "태오",
      handle: "#taeo",
      hashtag: "#taeo",
      position: "PF",
      region: "마포",
      school: "연희대",
      company: "오픈코트",
      club: "노을농구회",
      trustScore: 88,
      streak: 2,
      avatarColor: "#74a8ff",
      ratings: { integrated: 1420, modes: { "1v1": 1240, "2v2": 1320, "3v3": 1398, "5v5": 1456 } },
    },
    {
      id: "u5",
      name: "하린",
      handle: "#harin",
      hashtag: "#harin",
      position: "C",
      region: "마포",
      school: "서강대",
      company: "오픈코트",
      club: "노을농구회",
      trustScore: 90,
      streak: 0,
      avatarColor: "#d98cff",
      ratings: { integrated: 1351, modes: { "1v1": 1010, "2v2": 1250, "3v3": 1322, "5v5": 1402 } },
    },
    {
      id: "u6",
      name: "도윤",
      handle: "#doyun",
      hashtag: "#doyun",
      position: "PG",
      region: "성수",
      school: "건대",
      company: "스틸픽",
      club: "브릿지볼",
      trustScore: 83,
      streak: -1,
      avatarColor: "#ff6f61",
      ratings: { integrated: 1295, modes: { "1v1": 1214, "2v2": 1248, "3v3": 1306, "5v5": 1280 } },
    },
    {
      id: "u7",
      name: "나은",
      handle: "#naeun",
      hashtag: "#naeun",
      position: "SG",
      region: "성수",
      school: "건대",
      company: "스틸픽",
      club: "브릿지볼",
      trustScore: 87,
      streak: 2,
      avatarColor: "#7bd389",
      ratings: { integrated: 1256, modes: { "1v1": 1110, "2v2": 1188, "3v3": 1228, "5v5": 1300 } },
    },
    {
      id: "u8",
      name: "현우",
      handle: "#hyunwoo",
      hashtag: "#hyunwoo",
      position: "SF",
      region: "성수",
      school: "한양대",
      company: "플레이메이트",
      club: "브릿지볼",
      trustScore: 79,
      streak: 0,
      avatarColor: "#f05d5e",
      ratings: { integrated: 1214, modes: { "1v1": 1155, "2v2": 1196, "3v3": 1208, "5v5": 1220 } },
    },
    {
      id: "u9",
      name: "유나",
      handle: "#yuna",
      hashtag: "#yuna",
      position: "PF",
      region: "성수",
      school: "한양대",
      company: "플레이메이트",
      club: "브릿지볼",
      trustScore: 85,
      streak: 1,
      avatarColor: "#ffc857",
      ratings: { integrated: 1340, modes: { "1v1": 1190, "2v2": 1288, "3v3": 1344, "5v5": 1360 } },
    },
    {
      id: "u10",
      name: "시온",
      handle: "#sion",
      hashtag: "#sion",
      position: "C",
      region: "성수",
      school: "건대",
      company: "스틸픽",
      club: "브릿지볼",
      trustScore: 82,
      streak: -2,
      avatarColor: "#8ac7db",
      ratings: { integrated: 1272, modes: { "1v1": 1040, "2v2": 1210, "3v3": 1262, "5v5": 1326 } },
    },
  ],
  teams: [
    {
      id: "t1",
      name: "Noeul Kings",
      homeCourt: "한강 노을코트",
      region: "마포",
      mmr: 1395,
      wins: 18,
      losses: 9,
      accent: "#58d2c0",
      favorite: true,
      members: [
        { userId: "u1", role: "captain" },
        { userId: "u2", role: "regular" },
        { userId: "u3", role: "candidate" },
        { userId: "u4", role: "regular" },
        { userId: "u5", role: "regular" },
      ],
    },
    {
      id: "t2",
      name: "Bridge Ballers",
      homeCourt: "성수 브릿지파크",
      region: "성수",
      mmr: 1318,
      wins: 14,
      losses: 11,
      accent: "#ff6f61",
      favorite: true,
      members: [
        { userId: "u6", role: "captain" },
        { userId: "u7", role: "regular" },
        { userId: "u8", role: "regular" },
        { userId: "u9", role: "regular" },
        { userId: "u10", role: "mercenary" },
      ],
    },
    {
      id: "t3",
      name: "Hongdae Rimfire",
      homeCourt: "홍대 스트릿돔",
      region: "마포",
      mmr: 1284,
      wins: 11,
      losses: 8,
      accent: "#ffd36c",
      favorite: true,
      members: [
        { userId: "u2", role: "captain" },
        { userId: "u1", role: "regular" },
        { userId: "u5", role: "regular" },
        { userId: "u8", role: "mercenary" },
        { userId: "u3", role: "candidate" },
      ],
    },
    {
      id: "t4",
      name: "Ttukseom Flow",
      homeCourt: "뚝섬 리버사이드",
      region: "성수",
      mmr: 1268,
      wins: 10,
      losses: 10,
      accent: "#46e0b6",
      favorite: true,
      members: [
        { userId: "u7", role: "captain" },
        { userId: "u6", role: "regular" },
        { userId: "u9", role: "regular" },
        { userId: "u13", role: "guest" },
      ],
    },
    {
      id: "t5",
      name: "Jamsil Meteors",
      homeCourt: "잠실 실내체육관 보조코트",
      region: "잠실",
      mmr: 1442,
      wins: 22,
      losses: 7,
      accent: "#76a9ff",
      favorite: true,
      members: [
        { userId: "u4", role: "captain" },
        { userId: "u33", role: "regular" },
        { userId: "u10", role: "regular" },
        { userId: "u34", role: "mercenary" },
      ],
    },
    {
      id: "t6",
      name: "Gangnam Switch",
      homeCourt: "양재 플로우코트",
      region: "강남",
      mmr: 1336,
      wins: 16,
      losses: 13,
      accent: "#c792ff",
      favorite: true,
      members: [
        { userId: "u11", role: "captain" },
        { userId: "u12", role: "regular" },
        { userId: "u13", role: "candidate" },
        { userId: "u14", role: "regular" },
      ],
    },
    {
      id: "t7",
      name: "Banpo Arc",
      homeCourt: "반포 선셋파크",
      region: "서초",
      mmr: 1248,
      wins: 9,
      losses: 12,
      accent: "#ffab4c",
      favorite: true,
      members: [
        { userId: "u15", role: "captain" },
        { userId: "u16", role: "regular" },
        { userId: "u17", role: "candidate" },
      ],
    },
    {
      id: "t8",
      name: "Noryangjin Press",
      homeCourt: "노량진 루프코트",
      region: "동작",
      mmr: 1198,
      wins: 8,
      losses: 14,
      accent: "#ff755f",
      favorite: true,
      members: [
        { userId: "u18", role: "captain" },
        { userId: "u19", role: "regular" },
        { userId: "u20", role: "guest" },
      ],
    },
    {
      id: "t9",
      name: "Yeonnam Rails",
      homeCourt: "연남 레일파크",
      region: "마포",
      mmr: 1226,
      wins: 12,
      losses: 16,
      accent: "#8ac7db",
      favorite: false,
      members: [
        { userId: "u21", role: "captain" },
        { userId: "u22", role: "regular" },
        { userId: "u23", role: "mercenary" },
      ],
    },
    {
      id: "t10",
      name: "Mullae Iron",
      homeCourt: "문래 팩토리코트",
      region: "영등포",
      mmr: 1302,
      wins: 15,
      losses: 13,
      accent: "#9aa4b2",
      favorite: false,
      members: [
        { userId: "u24", role: "captain" },
        { userId: "u25", role: "regular" },
        { userId: "u26", role: "candidate" },
      ],
    },
    {
      id: "t11",
      name: "Wangsimni Breakers",
      homeCourt: "왕십리 언더패스",
      region: "성동",
      mmr: 1176,
      wins: 7,
      losses: 15,
      accent: "#f05d5e",
      favorite: false,
      members: [
        { userId: "u27", role: "captain" },
        { userId: "u28", role: "regular" },
        { userId: "u29", role: "regular" },
      ],
    },
    {
      id: "t12",
      name: "Sinchon Blue",
      homeCourt: "신촌 블루짐",
      region: "서대문",
      mmr: 1210,
      wins: 10,
      losses: 14,
      accent: "#74a8ff",
      favorite: false,
      members: [
        { userId: "u30", role: "captain" },
        { userId: "u31", role: "regular" },
        { userId: "u32", role: "guest" },
      ],
    },
  ],
  affiliations: [
    { id: "a1", type: "region", name: "마포", score: 1420, wins: 38, losses: 24 },
    { id: "a2", type: "region", name: "성수", score: 1362, wins: 32, losses: 27 },
    { id: "a3", type: "school", name: "연희대", score: 1398, wins: 21, losses: 13 },
    { id: "a4", type: "company", name: "스틸픽", score: 1298, wins: 17, losses: 16 },
  ],
  seasons: [
    {
      id: "season-zero",
      name: "Season Zero",
      subtitle: "지역 래더와 승인 시스템을 검증하는 프리시즌",
      startsAt: "2026-05-31",
      endsAt: "2026-08-31",
      active: true,
      regions: ["마포", "성수", "잠실", "강남"],
      promotionLine: 4,
      rules: [
        "지역 랭킹은 같은 지역 플레이어를 먼저 정렬합니다.",
        "정규전은 티어 구간 제한과 과반 승인을 모두 통과해야 합니다.",
        "경기 전 동의와 결과 승인은 각 팀 과반 기준으로 처리합니다.",
      ],
    },
  ],
  matches: [
    {
      id: "m-live-recorder",
      title: "Recorder Live 3v3 · Hongdae Rimfire vs Bridge Ballers",
      mode: "3v3",
      court: "Recorder Test Court",
      scheduledDate: "2026-06-16",
      scheduledTime: "00:00",
      scheduledAt: "2026-06-16 00:00",
      status: "agreed",
      official: false,
      preRegistered: true,
      refereeId: "",
      refereeTrustMin: REFEREE_TRUST_MIN,
      statRecorders: { teamA: "u1", teamB: "" },
      statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
      disputeMinutes: DISPUTE_WINDOW_MINUTES,
      rules: { targetScore: 21, timeLimit: 1440, winByTwo: false, ball: "7호" },
      memo: "u1 recorder live demo. u1 is not playing and records teamA stats.",
      stakes: "Demo match for recorder room access.",
      ranked: true,
      objectionWindow: "2시간",
      evidence: [],
      teamA: { name: "Hongdae Rimfire", teamId: "t3", players: ["u2", "u5", "u8"], score: 0 },
      teamB: { name: "Bridge Ballers", teamId: "t2", players: ["u6", "u7", "u9"], score: 0 },
      parties: [
        { kind: "team", side: "teamA", teamId: "t3", playerId: "u2", players: ["u2", "u5", "u8"], reserves: ["u1", "u3"], reserve: false },
        { kind: "team", side: "teamB", teamId: "t2", playerId: "u6", players: ["u6", "u7", "u9"], reserves: ["u10"], reserve: false },
      ],
      reservePlayers: { teamA: ["u1", "u3"], teamB: ["u10"] },
      promotedReserveIds: { teamA: [], teamB: [] },
      agreements: { teamA: ["u2", "u5", "u8"], teamB: ["u6", "u7", "u9"] },
      approvals: { teamA: [], teamB: [] },
      disputes: [],
      result: null,
      ratingResult: null,
      teamRatingResult: null,
      endedAt: null,
      trustFeedback: makeTrustFeedback(),
      createdAt: "2026-06-15T12:00:00.000Z",
      agreedAt: "2026-06-15T12:10:00.000Z",
      confirmedAt: null,
    },
    {
      id: "m1",
      title: "토요 5v5 공식전",
      mode: "5v5",
      court: "한강 노을코트",
      scheduledDate: "2026-06-18",
      scheduledTime: "20:30",
      scheduledAt: "2026-06-18 20:30",
      status: "contract",
      official: true,
      preRegistered: true,
      refereeId: "",
      refereeTrustMin: REFEREE_TRUST_MIN,
      statRecorders: makeEmptyStatRecorders(),
      statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
      disputeMinutes: DISPUTE_WINDOW_MINUTES,
      rules: { targetScore: 21, timeLimit: 12, winByTwo: true, ball: "7호 공" },
      memo: "승자팀 다음 경기 우선권. 금전 거래 없이 약속만 기록합니다.",
      stakes: "승자팀 다음 경기 우선권. 금전 거래 없이 약속만 기록합니다.",
      ranked: true,
      objectionWindow: "24시간",
      evidence: [{ id: "court_reservation", label: "구장 예약내역" }],
      teamA: { name: "Noeul Kings", teamId: "t1", players: ["u1", "u2", "u3", "u4", "u5"], score: 0 },
      teamB: { name: "Bridge Ballers", teamId: "t2", players: ["u6", "u7", "u8", "u9", "u10"], score: 0 },
      agreements: { teamA: [], teamB: [] },
      approvals: { teamA: [], teamB: [] },
      disputes: [],
      result: null,
      ratingResult: null,
      teamRatingResult: null,
      endedAt: null,
      trustFeedback: makeTrustFeedback(),
      createdAt: "2026-06-15T10:00:00.000Z",
      confirmedAt: null,
    },
    {
      id: "m0",
      title: "성수 3v3 리벤지",
      mode: "3v3",
      court: "성수 브릿지파크",
      scheduledDate: "2026-05-30",
      scheduledTime: "21:00",
      scheduledAt: "2026-05-30 21:00",
      status: "confirmed",
      official: false,
      preRegistered: true,
      refereeId: "",
      refereeTrustMin: REFEREE_TRUST_MIN,
      statRecorders: makeEmptyStatRecorders(),
      statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
      disputeMinutes: DISPUTE_WINDOW_MINUTES,
      rules: { targetScore: 15, timeLimit: 10, winByTwo: false, ball: "7호 공" },
      memo: "빠른 입력 테스트용 기록",
      stakes: "리벤지 매치. 패자는 다음 판 물/음료 준비.",
      evidence: [],
      ranked: true,
      objectionWindow: "1시간",
      teamA: { name: "Noeul Kings", teamId: "t1", players: ["u1", "u2", "u4"], score: 15 },
      teamB: { name: "Bridge Ballers", teamId: "t2", players: ["u6", "u7", "u9"], score: 12 },
      agreements: { teamA: ["u1", "u2"], teamB: ["u6", "u7"] },
      approvals: { teamA: ["u1", "u2"], teamB: ["u6", "u7"] },
      disputes: [],
      result: {
        scoreA: 15,
        scoreB: 12,
        playerStats: {
          u1: { points: 6, rebounds: 2, assists: 5, steals: 1, blocks: 0 },
          u2: { points: 5, rebounds: 3, assists: 2, steals: 2, blocks: 0 },
          u4: { points: 4, rebounds: 6, assists: 1, steals: 0, blocks: 1 },
          u6: { points: 4, rebounds: 2, assists: 4, steals: 1, blocks: 0 },
          u7: { points: 3, rebounds: 4, assists: 2, steals: 1, blocks: 0 },
          u9: { points: 5, rebounds: 5, assists: 1, steals: 0, blocks: 1 },
        },
        statSubmissions: makeDemoStatSubmissions(["u1", "u2", "u4"], ["u6", "u7", "u9"], "2026-05-30T12:20:00.000Z"),
        submittedBy: "u1",
        submittedAt: "2026-05-30T12:20:00.000Z",
        updatedAt: "2026-05-30T12:20:00.000Z",
      },
      ratingResult: [
        { playerId: "u1", integratedDelta: 12.2, modeDelta: 15.8, result: "win" },
        { playerId: "u6", integratedDelta: -10.6, modeDelta: -13.9, result: "loss" },
      ],
      teamRatingResult: { teamA: 12, teamB: -11 },
      endedAt: "2026-05-30T12:10:00.000Z",
      trustFeedback: makeTrustFeedback({ u1: ["u6"], u6: ["u1"] }),
      createdAt: "2026-05-30T11:10:00.000Z",
      confirmedAt: "2026-05-30T12:25:00.000Z",
    },
  ],
  notifications: [
    { id: "n-invite-q2-u1", title: "매치방 초대", body: "성수 친선 3v3 팀 구해요 A사이드 빈 슬롯 초대장이 도착했습니다.", tone: "match", targetUserId: "u1", recruitingPostId: "q2" },
    { id: "n1", title: "경기 전 동의 대기", body: "토요 5v5 공식전의 경기 전 동의를 기다리고 있습니다.", tone: "match", matchId: "m1" },
    { id: "n2", title: "3연승", body: "민준의 통합 티어가 Platinum에 가까워지고 있어요.", tone: "tier" },
  ],
  tournaments: [],
  recruitingPosts: [
    {
      id: "q1",
      type: "need_player",
      title: "Noeul Kings 5v5 용병 1명",
      region: "마포",
      court: "한강 노을코트",
      mode: "5v5",
      ...getDemoQueueSlot(0),
      ranked: true,
      spots: 6,
      teamId: "t1",
      targetTeamId: null,
      refereeId: "",
      refereeTrustMin: REFEREE_TRUST_MIN,
      statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
      disputeMinutes: DISPUTE_WINDOW_MINUTES,
      hostJoinMode: "team",
      hostSide: "teamA",
      hostReady: false,
      sideCapacity: 5,
      playerIds: ["u1", "u2", "u4", "u5"],
      position: "PF",
      playerId: "u1",
      memo: "리바운드 같이 잡아줄 포워드/센터면 좋아요.",
      status: "open",
      applicants: [makeDemoApplicant({ kind: "player", playerId: "u8", side: "teamB", status: "waiting", position: "SF", createdAt: "2026-06-15T09:44:00.000Z" })],
      roomState: makeDefaultRoomState([{ id: "chat-q1-1", userId: "u1", body: "Need one more player for teamB.", createdAt: "2026-06-15T09:35:00.000Z" }]),
      createdAt: "2026-06-15T09:30:00.000Z",
    },
    {
      id: "q2",
      type: "find_team",
      title: "성수 친선 3v3 팀 구해요",
      region: "성수",
      court: "성수 브릿지파크",
      mode: "3v3",
      ...getDemoQueueSlot(1),
      ranked: false,
      spots: 5,
      teamId: null,
      targetTeamId: null,
      refereeId: "",
      refereeTrustMin: REFEREE_TRUST_MIN,
      statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
      disputeMinutes: DISPUTE_WINDOW_MINUTES,
      hostJoinMode: "player",
      hostSide: "teamA",
      hostReady: false,
      sideCapacity: 3,
      playerIds: [],
      position: "SG",
      playerId: "u9",
      memo: "티어 상관없이 빠르게 두세 판 뛸 팀 찾습니다.",
      status: "open",
      applicants: [makeDemoApplicant({ kind: "team", teamId: "t2", playerId: "u6", side: "teamB", status: "ready", playerIds: ["u6", "u7", "u8"], createdAt: "2026-06-15T08:55:00.000Z" })],
      roomState: {
        ...makeDefaultRoomState([{ id: "chat-q2-1", userId: "u6", body: "Team party can fill the opposite side.", createdAt: "2026-06-15T08:57:00.000Z" }]),
        demoInviteQ2Seeded: true,
        invitations: [
          {
            id: "inv-demo-q2-u1",
            targetUserId: "u1",
            fromUserId: "u9",
            teamId: null,
            side: "teamA",
            reserve: false,
            status: "pending",
            createdAt: "2026-06-15T09:05:00.000Z",
            updatedAt: "2026-06-15T09:05:00.000Z",
          },
        ],
      },
      createdAt: "2026-06-15T08:40:00.000Z",
    },
    {
      id: "q3",
      type: "need_player",
      title: "잠실 5v5 공식전 가드 대타",
      region: "잠실",
      court: "잠실 실내체육관 보조코트",
      mode: "5v5",
      ...getDemoQueueSlot(2),
      ranked: true,
      spots: 6,
      teamId: "t5",
      targetTeamId: null,
      refereeId: "",
      refereeTrustMin: REFEREE_TRUST_MIN,
      statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
      disputeMinutes: DISPUTE_WINDOW_MINUTES,
      hostJoinMode: "team",
      hostSide: "teamA",
      hostReady: true,
      sideCapacity: 5,
      playerIds: ["u4", "u5", "u10", "u1"],
      position: "PG",
      playerId: "u4",
      memo: "볼 운반이 가능한 가드는 포지션 제한이 없습니다.",
      status: "open",
      applicants: [makeDemoApplicant({ kind: "player", playerId: "u2", side: "teamB", status: "ready", position: "SG", createdAt: "2026-06-15T08:05:00.000Z" })],
      roomState: makeDefaultRoomState([{ id: "chat-q3-1", userId: "u4", body: "Ready when the opposite side fills.", createdAt: "2026-06-15T08:00:00.000Z" }]),
      createdAt: "2026-06-15T07:55:00.000Z",
    },
    {
      id: "q4",
      type: "need_team",
      title: "마포 정규전 5v5 상대팀 구해요",
      region: "마포",
      court: "홍대 스트릿돔",
      mode: "5v5",
      ...getDemoQueueSlot(3),
      ranked: true,
      spots: 6,
      teamId: "t1",
      targetTeamId: null,
      refereeId: "",
      refereeTrustMin: REFEREE_TRUST_MIN,
      statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
      disputeMinutes: DISPUTE_WINDOW_MINUTES,
      hostJoinMode: "team",
      hostSide: "teamA",
      hostReady: false,
      sideCapacity: 5,
      playerIds: ["u1", "u2", "u4", "u5"],
      position: "상관없음",
      playerId: "u1",
      memo: "비슷한 티어의 팀과 경기방을 만들고 양 팀 동의 후 진행합니다.",
      status: "open",
      applicants: [makeDemoApplicant({ kind: "team", teamId: "t3", playerId: "u2", side: "teamB", status: "waiting", playerIds: ["u2", "u5", "u8"], createdAt: "2026-06-15T10:10:00.000Z" })],
      roomState: makeDefaultRoomState([{ id: "chat-q4-1", userId: "u2", body: "We can bring three now and keep reserves open.", createdAt: "2026-06-15T10:12:00.000Z" }]),
      createdAt: "2026-06-15T10:00:00.000Z",
    },
  ],
  settings: {
    theme: "dark",
    privacy: {
      regionRanking: true,
      teamHistory: true,
      statSummary: true,
    },
    blockedUserIds: [],
    favoritePlayerIds: ["u2", "u3", "u4"],
    favoriteTeamIds: ["t1", "t2", "t5"],
    favoriteCourtIds: ["c1", "c2", "c3"],
    favoriteRefereeIds: ["u11"],
  },
  reports: [],
};

const demoSurnames = ["강", "김", "박", "이", "최", "정", "한", "오", "문", "서", "윤", "장", "배", "권", "노", "신"];
const demoGivenNames = ["도하", "이준", "채원", "하준", "라온", "서진", "지민", "유겸", "태린", "아린", "현준", "나겸", "시우", "예준", "하온", "민서"];
const demoSchools = ["연희대", "건대", "서강대", "한양대", "중앙대", "상암고", "동교고", "잠실고"];
const demoCompanies = ["라임랩", "스틸픽", "오픈코트", "플레이메이트", "넥스트런", "픽앤롤", "프리랜서"];
const demoClubs = ["노을농구회", "브릿지볼", "림파이어", "메테오스", "리버런", "언더패스"];
const demoColors = ["#58d2c0", "#f4c74f", "#ff8a5b", "#74a8ff", "#d98cff", "#ff6f61", "#7bd389", "#f05d5e", "#ffc857", "#8ac7db"];
const demoTeamNames = [
  "Noeul Kings", "Bridge Ballers", "Rimfire", "Ttukseom Flow", "Jamsil Meteors",
  "Sunset Riders", "Underpass Five", "Factory Hoops", "Blue Gym", "River Slash",
  "Court Atlas", "Night Switch", "Rookie Press", "Arc Shooters", "Steel Motion",
  "Lime Runners", "West Paint", "East Break", "High Glass", "Street Pulse",
];

function padNumber(value, size = 3) {
  return String(value).padStart(size, "0");
}

function cycle(list, index) {
  return list[index % list.length];
}

function makeDemoUser(index) {
  const region = cycle(REGIONS, index - 1);
  const position = cycle(PLAYER_POSITIONS.slice(1), index - 1);
  const mmr = 980 + ((index * 43) % 640);
  const name = `${cycle(demoSurnames, index)}${cycle(demoGivenNames, index * 3)}`;
  const hashtag = `#boxtier${padNumber(index)}`;
  return {
    id: `u${index}`,
    name,
    handle: hashtag,
    hashtag,
    position,
    region,
    school: cycle(demoSchools, index),
    company: cycle(demoCompanies, index * 2),
    club: cycle(demoClubs, index * 3),
    trustScore: 72 + ((index * 7) % 27),
    streak: (index % 7) - 3,
    avatarColor: cycle(demoColors, index),
    testLoginId: `rankball-${padNumber(index)}`,
    testPassword: "test-0000",
    ratings: {
      integrated: mmr,
      modes: {
        "1v1": Math.max(800, mmr - 130 + ((index * 13) % 120)),
        "2v2": Math.max(800, mmr - 80 + ((index * 17) % 100)),
        "3v3": Math.max(800, mmr - 35 + ((index * 19) % 90)),
        "5v5": Math.max(800, mmr + ((index * 23) % 90)),
      },
    },
  };
}

function buildDemoUsers(baseUsers) {
  const users = [...baseUsers];
  for (let index = users.length + 1; index <= 100; index += 1) {
    users.push(makeDemoUser(index));
  }
  return users.map((user, userIndex) => ({
    testLoginId: `rankball-${padNumber(userIndex + 1)}`,
    testPassword: "test-0000",
    ...user,
  }));
}

function makeDemoTeam(index, users) {
  const firstUserIndex = index * 5;
  const members = users.slice(firstUserIndex, firstUserIndex + 5).map((user, memberIndex) => ({
    userId: user.id,
    role: memberIndex === 0 ? "captain" : memberIndex === 4 && index % 3 === 0 ? "mercenary" : memberIndex === 3 && index % 4 === 0 ? "candidate" : "regular",
  }));
  const region = members[0] ? users.find((user) => user.id === members[0].userId)?.region : cycle(REGIONS, index);
  const court = COURTS.find((item) => item.region === region) ?? COURTS[index % COURTS.length];

  return {
    id: `td${padNumber(index + 1, 2)}`,
    name: `${cycle(demoTeamNames, index)} ${padNumber(index + 1, 2)}`,
    homeCourt: court.name,
    region,
    mmr: 1080 + ((index * 37) % 430),
    wins: 42 + ((index * 11) % 36),
    losses: 28 + ((index * 7) % 31),
    accent: cycle(demoColors, index * 2),
    favorite: index < 6,
    members,
  };
}

function buildDemoTeams(baseTeams, users) {
  const teams = [...baseTeams];
  for (let index = 0; index < 20; index += 1) {
    teams.push(makeDemoTeam(index, users));
  }
  return teams;
}

function makePlayerStats(matchIndex, sideIndex, playerIndex, user) {
  const positionBonus = user.position === "C" || user.position === "PF" ? 2 : 0;
  const guardBonus = user.position === "PG" || user.position === "SG" ? 2 : 0;
  return {
    points: 4 + ((matchIndex + playerIndex * 3 + sideIndex * 5) % 13),
    rebounds: 2 + positionBonus + ((matchIndex + playerIndex * 2 + sideIndex) % 8),
    assists: 1 + guardBonus + ((matchIndex + playerIndex + sideIndex * 2) % 7),
    steals: (matchIndex + playerIndex + sideIndex) % 4,
    blocks: positionBonus ? (matchIndex + playerIndex) % 3 : (matchIndex + sideIndex) % 2,
    fouls: (matchIndex + playerIndex * 2 + sideIndex) % 5,
  };
}

function sumPoints(playerStats, playerIds) {
  return playerIds.reduce((sum, playerId) => sum + Number(playerStats[playerId]?.points ?? 0), 0);
}

function makeMatchTitle(matchIndex, teamA, teamB, mode) {
  const label = matchIndex % 4 === 0 ? "공식전" : matchIndex % 5 === 0 ? "친선전" : "정규전";
  return `${teamA.region} ${mode} ${label} #${padNumber(matchIndex + 1, 4)}`
    + ` · ${teamA.name.split(" ")[0]} vs ${teamB.name.split(" ")[0]}`;
}

function getDemoPastDate(matchIndex) {
  const date = new Date(`${DEMO_TODAY}T00:00:00`);
  date.setDate(date.getDate() - 1 - (matchIndex % 45));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeConfirmedMatch(matchIndex, teams, userById) {
  const teamA = teams[matchIndex % teams.length];
  let teamB = teams[(matchIndex * 7 + 3) % teams.length];
  if (teamA.id === teamB.id) teamB = teams[(matchIndex + 9) % teams.length];
  const mode = "5v5";
  const playersA = teamA.members.slice(0, 5).map((member) => member.userId);
  const playersB = teamB.members.slice(0, 5).map((member) => member.userId);
  const playerStats = {};

  playersA.forEach((playerId, playerIndex) => {
    playerStats[playerId] = makePlayerStats(matchIndex, 0, playerIndex, userById[playerId]);
  });
  playersB.forEach((playerId, playerIndex) => {
    playerStats[playerId] = makePlayerStats(matchIndex, 1, playerIndex, userById[playerId]);
  });

  let scoreA = sumPoints(playerStats, playersA);
  const scoreB = sumPoints(playerStats, playersB);
  if (scoreA === scoreB) {
    playerStats[playersA[0]].points += 1;
    scoreA += 1;
  }

  const aWon = scoreA > scoreB;
  const scheduledDate = getDemoPastDate(matchIndex);
  const scheduledTime = `${String(10 + (matchIndex % 11)).padStart(2, "0")}:${matchIndex % 2 ? "30" : "00"}`;
  const startedAt = makeDemoTimestamp(scheduledDate, scheduledTime);
  const endedAt = makeDemoTimestamp(scheduledDate, scheduledTime, 12);
  const submittedAt = makeDemoTimestamp(scheduledDate, scheduledTime, 22);
  const court = COURTS.find((item) => item.region === teamA.region)?.name ?? teamA.homeCourt;

  return {
    id: `md${padNumber(matchIndex + 1, 4)}`,
    title: makeMatchTitle(matchIndex, teamA, teamB, mode),
    mode,
    court,
    scheduledDate,
    scheduledTime,
    scheduledAt: `${scheduledDate} ${scheduledTime}`,
    status: "confirmed",
    ranked: matchIndex % 5 !== 0,
    official: matchIndex % 4 === 0,
    preRegistered: true,
    refereeId: "",
    refereeTrustMin: REFEREE_TRUST_MIN,
    statRecorders: makeEmptyStatRecorders(),
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    rules: {
      targetScore: 21,
      timeLimit: 12,
      winByTwo: matchIndex % 3 === 0,
      ball: "7호 공",
      attackRule: "공격권은 득점 후 교대",
      foulRule: "파울은 콜한 쪽 기준으로 즉시 중단",
    },
    memo: "테스트 리그 시드 경기입니다. 개인 기록과 팀 히스토리 검증용 데이터입니다.",
    stakes: "금전 거래 없이 약속과 벌칙만 기록합니다.",
    objectionWindow: "24시간",
    evidence: [{ id: "court_reservation", label: "구장 예약내역" }],
    teamA: { name: teamA.name, teamId: teamA.id, players: playersA, score: scoreA },
    teamB: { name: teamB.name, teamId: teamB.id, players: playersB, score: scoreB },
    agreements: { teamA: playersA, teamB: playersB },
    approvals: { teamA: playersA, teamB: playersB },
    disputes: [],
    result: {
      scoreA,
      scoreB,
      playerStats,
      statSubmissions: makeDemoStatSubmissions(playersA, playersB, submittedAt),
      submittedBy: playersA[0],
      submittedAt,
      updatedAt: submittedAt,
    },
    ratingResult: [...playersA, ...playersB].map((playerId, playerIndex) => {
      const teamAWinner = playersA.includes(playerId) ? aWon : !aWon;
      const delta = (teamAWinner ? 7 : -7) + ((matchIndex + playerIndex) % 5) * (teamAWinner ? 1 : -1);
      return { playerId, integratedDelta: delta, modeDelta: Math.round(delta * 1.2), result: teamAWinner ? "win" : "loss" };
    }),
    teamRatingResult: { teamA: aWon ? 11 : -9, teamB: aWon ? -9 : 11 },
    endedAt,
    trustFeedback: makeTrustFeedback({ [playersA[0]]: [playersB[0]], [playersB[0]]: [playersA[0]] }),
    createdAt: startedAt,
    confirmedAt: submittedAt,
  };
}

function isDemoFutureSlot(scheduledDate, scheduledTime) {
  const scheduled = new Date(`${scheduledDate}T${scheduledTime}`);
  const now = new Date(DEMO_NOW);
  return Number.isFinite(scheduled.getTime()) && scheduled.getTime() > now.getTime();
}

function getActiveMatchStatus(activeIndex, scheduledDate, scheduledTime) {
  if (isDemoFutureSlot(scheduledDate, scheduledTime)) return cycle(["contract", "agreed"], activeIndex + Math.floor(activeIndex / 18));
  return cycle(["approval", "disputed"], activeIndex);
}

function getActiveMatchTitle(status) {
  if (status === "contract") return "동의 대기";
  if (status === "agreed") return "진행 예정";
  if (status === "approval") return "결과 승인";
  return "이의 확인";
}

function makeActiveMatch(activeIndex, teams, userById) {
  const base = makeConfirmedMatch(1000 + activeIndex, teams, userById);
  const scheduledDate = `2026-06-${String(10 + (activeIndex % 18)).padStart(2, "0")}`;
  const scheduledTime = `${String(18 + (activeIndex % 4)).padStart(2, "0")}:00`;
  const endedAt = makeDemoTimestamp(scheduledDate, scheduledTime, 12);
  const submittedAt = makeDemoTimestamp(scheduledDate, scheduledTime, 22);
  const status = getActiveMatchStatus(activeIndex, scheduledDate, scheduledTime);
  const activeResult = base.result
    ? {
        ...base.result,
        submittedBy: base.teamA.players[0],
        statSubmissions: makeDemoStatSubmissions(base.teamA.players, base.teamB.players, submittedAt),
        submittedAt,
        updatedAt: submittedAt,
      }
    : null;
  const common = {
    ...base,
    id: `ma${padNumber(activeIndex + 1, 3)}`,
    title: `${getActiveMatchTitle(status)} · ${base.teamA.name} vs ${base.teamB.name}`,
    scheduledDate,
    scheduledTime,
    scheduledAt: `${scheduledDate} ${scheduledTime}`,
    status,
    result: activeResult,
    endedAt,
    confirmedAt: null,
    ratingResult: null,
    teamRatingResult: null,
  };

  if (["approval", "disputed"].includes(status) && scheduledDate < DEMO_TODAY) {
    return {
      ...common,
      title: `기록 확정 · ${base.teamA.name} vs ${base.teamB.name}`,
      status: "confirmed",
      agreements: { teamA: common.teamA.players, teamB: common.teamB.players },
      approvals: { teamA: common.teamA.players, teamB: common.teamB.players },
      disputes: [],
      result: activeResult,
      ratingResult: base.ratingResult,
      teamRatingResult: base.teamRatingResult,
      confirmedAt: submittedAt,
    };
  }

  if (status === "contract") {
    return {
      ...common,
      teamA: { ...common.teamA, score: 0 },
      teamB: { ...common.teamB, score: 0 },
      agreements: { teamA: common.teamA.players.slice(0, 2), teamB: common.teamB.players.slice(0, 1) },
      approvals: { teamA: [], teamB: [] },
      result: null,
      endedAt: null,
    };
  }
  if (status === "agreed") {
    return {
      ...common,
      teamA: { ...common.teamA, score: 0 },
      teamB: { ...common.teamB, score: 0 },
      agreements: { teamA: common.teamA.players, teamB: common.teamB.players },
      approvals: { teamA: [], teamB: [] },
      result: null,
      endedAt: null,
    };
  }
  if (status === "approval") {
    return { ...common, agreements: { teamA: common.teamA.players, teamB: common.teamB.players }, approvals: { teamA: common.teamA.players.slice(0, 2), teamB: common.teamB.players.slice(0, 3) } };
  }
  return {
    ...common,
    agreements: { teamA: common.teamA.players, teamB: common.teamB.players },
    approvals: { teamA: common.teamA.players.slice(0, 1), teamB: common.teamB.players.slice(0, 1) },
    disputes: [{ id: `dd${padNumber(activeIndex, 3)}`, by: common.teamB.players[0], reason: "개인 기록 확인이 필요합니다.", createdAt: "2026-06-08T12:00:00.000Z" }],
  };
}

function makeLifecycleMatch(index, teams, userById) {
  const base = makeConfirmedMatch(2000 + index, teams, userById);
  const statusByIndex = ["contract", "agreed", "agreed", "agreed", "approval", "disputed"];
  const status = statusByIndex[index] ?? "contract";
  const offsets = [1440, -10, -40, -55, -45, -35];
  const schedule = makeRelativeDemoDateTime(offsets[index] ?? 1440);
  const start = makeRelativeDemoDateTime(index === 2 ? -35 : index >= 3 ? -50 : 0);
  const end = makeRelativeDemoDateTime(index === 3 ? -8 : index >= 4 ? -10 : 0);
  const submitted = makeRelativeDemoDateTime(index >= 4 ? -6 : -4);
  const result = index >= 4
    ? {
        ...base.result,
        submittedBy: base.teamA.players[0],
        statSubmissions: makeDemoStatSubmissions(base.teamA.players, base.teamB.players, submitted.iso),
        submittedAt: submitted.iso,
        updatedAt: submitted.iso,
      }
    : null;

  return {
    ...base,
    id: `ml${padNumber(index + 1, 3)}`,
    title: `${["확정방", "경기준비", "경기시작", "경기종료", "결과승인", "이의신청"][index]} · ${base.teamA.name} vs ${base.teamB.name}`,
    scheduledDate: schedule.scheduledDate,
    scheduledTime: schedule.scheduledTime,
    scheduledAt: schedule.scheduledAt,
    status,
    teamA: { ...base.teamA, score: result?.scoreA ?? 0 },
    teamB: { ...base.teamB, score: result?.scoreB ?? 0 },
    agreements: status === "contract"
      ? { teamA: base.teamA.players.slice(0, 2), teamB: base.teamB.players.slice(0, 1) }
      : { teamA: base.teamA.players, teamB: base.teamB.players },
    approvals: status === "approval"
      ? { teamA: base.teamA.players.slice(0, 2), teamB: base.teamB.players.slice(0, 2) }
      : status === "disputed"
        ? { teamA: base.teamA.players.slice(0, 1), teamB: base.teamB.players.slice(0, 1) }
        : { teamA: [], teamB: [] },
    disputes: status === "disputed"
      ? [{ id: `life-dispute-${index}`, by: base.teamB.players[0], reason: "점수와 개인 기록 재확인", createdAt: submitted.iso }]
      : [],
    result,
    startedAt: index === 2 || index >= 3 ? start.iso : null,
    endedAt: index >= 3 ? end.iso : null,
    confirmedAt: null,
    ratingResult: null,
    teamRatingResult: null,
  };
}

function buildDemoMatches(baseMatches, teams, users) {
  const demoTeams = teams.filter((team) => team.id.startsWith("td"));
  const userById = Object.fromEntries(users.map((user) => [user.id, user]));
  const confirmed = Array.from({ length: 1000 }, (_item, index) => makeConfirmedMatch(index, demoTeams, userById));
  const active = Array.from({ length: 36 }, (_item, index) => makeActiveMatch(index, demoTeams, userById));
  const lifecycle = Array.from({ length: 6 }, (_item, index) => makeLifecycleMatch(index, demoTeams, userById));
  return [...baseMatches, ...lifecycle, ...active, ...confirmed];
}

function makeRecruitingPost(index, teams, users) {
  const type = cycle(["need_player", "find_team", "need_team"], index);
  const team = teams.filter((item) => item.id.startsWith("td"))[index % 20];
  const player = users[(index * 7 + 11) % users.length];
  const region = type === "find_team" ? player.region : team.region;
  const court = COURTS.find((item) => item.region === region)?.name ?? cycle(COURTS, index).name;
  const ranked = index % 4 !== 0;
  const applicantTeam = teams.filter((item) => item.id.startsWith("td"))[(index * 5 + 3) % 20];
  const applicantUser = users[(index * 9 + 17) % users.length];
  const schedule = getDemoQueueSlot(index + 4);
  const mode = cycle(MATCH_MODES, index).id;
  const sideCapacity = getDemoModeSize(mode);
  const hostJoinMode = type === "find_team" ? "player" : "team";
  const hostPlayerIds = hostJoinMode === "team" ? getTeamDemoPlayerIds(team, sideCapacity) : [];
  const hostSize = hostJoinMode === "team" ? hostPlayerIds.length : 1;
  const createdAt = `2026-06-${String(15 + Math.floor(index / 8)).padStart(2, "0")}T${String(9 + (index % 10)).padStart(2, "0")}:00:00.000Z`;
  const applicantCreatedAt = `2026-06-${String(15 + Math.floor(index / 8)).padStart(2, "0")}T${String(10 + (index % 9)).padStart(2, "0")}:10:00.000Z`;
  const applicantStatus = index % 3 === 0 ? "ready" : "waiting";
  const applicant = type === "need_player"
    ? makeDemoApplicant({
        kind: "player",
        playerId: applicantUser.id,
        side: "teamB",
        status: applicantStatus,
        reserve: index % 7 === 0,
        position: applicantUser.position,
        createdAt: applicantCreatedAt,
      })
    : makeDemoApplicant({
        kind: "team",
        teamId: applicantTeam.id,
        playerId: applicantTeam.members[0].userId,
        side: "teamB",
        status: applicantStatus,
        reserve: index % 7 === 0,
        playerIds: getTeamDemoPlayerIds(applicantTeam, sideCapacity),
        createdAt: applicantCreatedAt,
      });
  const title = type === "need_player"
    ? `${team.name} ${ranked ? "정규전" : "친선전"} 팀원 구해요`
    : type === "find_team"
      ? `${player.name} ${region} ${ranked ? "정규전" : "친선전"} 팀 구해요`
      : `${team.name} 상대팀 구해요`;

  return {
    id: `qd${padNumber(index + 1, 3)}`,
    type,
    title,
    region,
    court,
    mode,
    ...schedule,
    timingType,
    ranked,
    spots: Math.max(1, sideCapacity * 2 - hostSize),
    teamId: type === "find_team" ? null : team.id,
    targetTeamId: null,
    refereeId: "",
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    hostJoinMode,
    hostSide: "teamA",
    hostReady: index % 4 === 0,
    sideCapacity,
    playerIds: hostPlayerIds,
    position: type === "need_team" ? "상관없음" : cycle(PLAYER_POSITIONS, index),
    playerId: type === "find_team" ? player.id : hostPlayerIds[0] ?? team.members[0].userId,
    memo: type === "need_player"
      ? "포지션이 맞으면 경기방으로 초대합니다. 과반 동의 후 진행합니다."
      : type === "find_team"
        ? "혼자 참여 가능합니다. 빠르게 뛸 팀 찾습니다."
        : "비슷한 MMR 팀이면 바로 매치 잡습니다.",
    status: index % 11 === 0 ? "closed" : "open",
    applicants: [applicant],
    roomState: makeDefaultRoomState([
      {
        id: `chat-qd${padNumber(index + 1, 3)}-1`,
        userId: type === "find_team" ? player.id : team.members[0].userId,
        body: "모집방을 열었습니다. 참여 전에 경기 조건을 확인해 주세요.",
        createdAt,
      },
    ]),
    createdAt,
  };
}

function getDemoRoomTeams(teams = []) {
  return teams.filter((team) => (team.members?.length ?? 0) >= 3);
}

function getDemoRotatedTeamPlayerIds(team = {}, capacity = 5, offset = 0) {
  const ids = (team.members ?? []).map((member) => member.userId).filter(Boolean);
  if (!ids.length) return [];
  const rotated = ids.map((_id, index) => ids[(index + offset) % ids.length]);
  return rotated.slice(0, Math.min(capacity, rotated.length));
}

function getDemoReserveIds(team = {}, activeIds = [], limit = 2) {
  const active = new Set(activeIds);
  return (team.members ?? [])
    .map((member) => member.userId)
    .filter((playerId) => playerId && !active.has(playerId))
    .slice(0, limit);
}

function getDemoRoomSchedule(index, visibility, timingType = "scheduled") {
  if (timingType === "instant") {
    return { scheduledDate: "", scheduledTime: "", scheduledAt: "즉시" };
  }
  const date = new Date(`${DEMO_TODAY}T00:00:00`);
  const slotIndex = visibility === "public" ? index % 15 : index % 90;
  date.setDate(date.getDate() + Math.floor(slotIndex / DEMO_QUEUE_TIMES.length));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const scheduledDate = `${year}-${month}-${day}`;
  const scheduledTime = DEMO_QUEUE_TIMES[slotIndex % DEMO_QUEUE_TIMES.length];
  return { scheduledDate, scheduledTime, scheduledAt: `${scheduledDate} ${scheduledTime}` };
}

function getDemoRoomRatingScale(ranked, mmrRangeMode) {
  if (!ranked) return 1;
  if (mmrRangeMode === "wide") return 0.7;
  if (mmrRangeMode === "standard") return 0.9;
  return 1;
}

function makeDemoRoomRules(index, ranked, mmrRangeMode) {
  const ratingScale = getDemoRoomRatingScale(ranked, mmrRangeMode);
  return {
    targetScore: cycle([11, 15, 21], index),
    timeLimit: cycle([10, 12, 15], index),
    winByTwo: index % 4 !== 0,
    ball: "7호 공",
    attackRule: "득점 후 공수 교대",
    foulRule: "콜한 쪽 기준 중단",
    mmrRangeMode,
    ratingScale,
  };
}

function makeDemoRoomInvitation({ index, targetUserId, fromUserId, teamId = null, side = "teamB", reserve = false, status = "pending" }) {
  return {
    id: `inv-demo-${padNumber(index + 1)}-${targetUserId}-${reserve ? "r" : "a"}`,
    targetUserId,
    fromUserId,
    teamId,
    side,
    reserve,
    status,
    createdAt: makeDemoTimestamp(DEMO_TODAY, "09:00", index),
    updatedAt: makeDemoTimestamp(DEMO_TODAY, "09:00", index),
  };
}

function makeDemoRoomState({ index, ownerId, mmrRangeMode, timingType, approvalModeA, approvalModeB, partyReserves = {}, invitations = [], chatMessages = [] }) {
  return {
    ...makeDefaultRoomState(chatMessages),
    ownerId,
    mmrRangeMode,
    timingType,
    ruleRevision: 1,
    approvalModeA,
    approvalModeB,
    partyReserves,
    invitations,
  };
}

function makeDemoRoomApplicant({ team, player, side = "teamB", status = "waiting", reserve = false, playerIds = [], createdAt }) {
  if (team) {
    return makeDemoApplicant({
      kind: "team",
      teamId: team.id,
      playerId: playerIds[0] ?? team.members?.[0]?.userId,
      side,
      status,
      reserve,
      playerIds,
      createdAt,
    });
  }
  return makeDemoApplicant({
    kind: "player",
    playerId: player.id,
    side,
    status,
    reserve,
    position: player.position,
    createdAt,
  });
}

function makeRecruitingRoomPost(index, teams, users) {
  const roomTeams = getDemoRoomTeams(teams);
  const hostTeam = roomTeams[index % roomTeams.length];
  let opponentTeam = roomTeams[(index * 7 + 3) % roomTeams.length];
  if (opponentTeam.id === hostTeam.id) opponentTeam = roomTeams[(index + 5) % roomTeams.length];
  const mode = cycle(["1v1", "2v2", "3v3", "5v5"], index);
  const sideCapacity = getDemoModeSize(mode);
  const visibility = "public";
  const teamPartyRoom = index % 3 !== 1;
  const hostJoinMode = teamPartyRoom ? "team" : "player";
  const timingType = visibility === "private" && index % 17 === 0 ? "instant" : "scheduled";
  const schedule = getDemoRoomSchedule(index, visibility, timingType);
  const ranked = index % 5 !== 0;
  const mmrRangeMode = cycle(["narrow", "standard", "wide"], index);
  const ratingScale = getDemoRoomRatingScale(ranked, mmrRangeMode);
  const rules = makeDemoRoomRules(index, ranked, mmrRangeMode);
  const approvalModeA = index % 6 === 0 ? "all" : "leader";
  const approvalModeB = index % 5 === 0 ? "all" : "leader";
  const createdAt = makeDemoTimestamp(DEMO_TODAY, "08:00", index * 3);
  const hostActiveTarget = visibility === "private" && hostJoinMode === "team"
    ? sideCapacity
    : Math.max(1, Math.min(sideCapacity, sideCapacity - (index % Math.min(3, sideCapacity))));
  const hostPlayerIds = hostJoinMode === "team" ? getDemoRotatedTeamPlayerIds(hostTeam, hostActiveTarget, 0) : [];
  const hostReserveIds = hostJoinMode === "team" ? getDemoReserveIds(hostTeam, hostPlayerIds, 2) : [];
  const owner = hostJoinMode === "team"
    ? users.find((user) => user.id === hostPlayerIds[0]) ?? users[0]
    : users[(index * 11 + 5) % users.length];
  const region = hostJoinMode === "team" ? hostTeam.region : owner.region;
  const court = COURTS.find((item) => item.region === region)?.name ?? hostTeam.homeCourt ?? cycle(COURTS, index).name;
  const applicants = [];
  const partyReserves = {};
  if (hostReserveIds.length) partyReserves.host = hostReserveIds;

  if (visibility === "private" && hostJoinMode === "team") {
    const opponentPlayers = getDemoRotatedTeamPlayerIds(opponentTeam, sideCapacity, index % 2);
    const opponentReserves = getDemoReserveIds(opponentTeam, opponentPlayers, 2);
    applicants.push(makeDemoRoomApplicant({
      team: opponentTeam,
      side: "teamB",
      status: index % 3 === 0 ? "ready" : "waiting",
      playerIds: opponentPlayers,
      createdAt,
    }));
    if (opponentReserves.length) partyReserves[`team:${opponentTeam.id}`] = opponentReserves;
  } else {
    const firstApplicantSide = "teamB";
    const teamApplicant = index % 2 === 0;
    if (teamApplicant) {
      const applicantCapacity = Math.max(1, Math.min(sideCapacity, index % 7 === 0 ? sideCapacity : sideCapacity - 1));
      const applicantPlayers = getDemoRotatedTeamPlayerIds(opponentTeam, applicantCapacity, index % 3);
      const applicantReserves = getDemoReserveIds(opponentTeam, applicantPlayers, 2);
      applicants.push(makeDemoRoomApplicant({
        team: opponentTeam,
        side: firstApplicantSide,
        status: index % 4 === 0 ? "waiting" : "ready",
        reserve: index % 19 === 0,
        playerIds: applicantPlayers,
        createdAt,
      }));
      if (applicantReserves.length) partyReserves[`team:${opponentTeam.id}`] = applicantReserves;
    } else {
      const takenIds = new Set([owner.id, ...hostPlayerIds]);
      const applicantUser = users.find((user) => !takenIds.has(user.id) && user.region === region) ?? users[(index * 13 + 7) % users.length];
      applicants.push(makeDemoRoomApplicant({
        player: applicantUser,
        side: firstApplicantSide,
        status: index % 4 === 0 ? "waiting" : "ready",
        reserve: index % 11 === 0,
        createdAt,
      }));
    }

    if (hostJoinMode === "team" && hostPlayerIds.length < sideCapacity) {
      const sameTeamPlayer = hostTeam.members.map((member) => member.userId).find((playerId) => !hostPlayerIds.includes(playerId));
      const sameTeamUser = users.find((user) => user.id === sameTeamPlayer);
      if (sameTeamUser && index % 8 === 0) {
        applicants.push(makeDemoRoomApplicant({
          player: sameTeamUser,
          side: "teamA",
          status: "ready",
          createdAt,
        }));
      }
    }
  }

  const activeHostSize = hostJoinMode === "team" ? hostPlayerIds.length : 1;
  const activeApplicantSize = applicants
    .filter((applicant) => !applicant.reserve)
    .reduce((sum, applicant) => sum + (applicant.kind === "team" ? applicant.playerIds.length : 1), 0);
  const participantIds = new Set([
    owner.id,
    ...hostPlayerIds,
    ...hostReserveIds,
    ...applicants.flatMap((applicant) => [applicant.playerId, ...(applicant.playerIds ?? [])]),
    ...Object.values(partyReserves).flat(),
  ].filter(Boolean));
  const inviteTarget = users.find((user) => !participantIds.has(user.id) && (index % 9 === 0 ? user.id === "u1" : true));
  const invitations = [];
  if (inviteTarget && index % 5 === 0) {
    invitations.push(makeDemoRoomInvitation({
      index,
      targetUserId: inviteTarget.id,
      fromUserId: owner.id,
      teamId: teamPartyRoom && hostTeam.members.some((member) => member.userId === inviteTarget.id) ? hostTeam.id : null,
      side: index % 2 === 0 ? "teamB" : "teamA",
      reserve: index % 10 === 0,
    }));
  }

  const roomState = makeDemoRoomState({
    index,
    ownerId: owner.id,
    mmrRangeMode,
    timingType,
    approvalModeA,
    approvalModeB,
    partyReserves,
    invitations,
    chatMessages: [
      {
        id: `chat-qr${padNumber(index + 1)}-1`,
        userId: owner.id,
        body: "경기방을 열었습니다. 참여 전에 경기 조건을 확인해 주세요.",
        createdAt,
      },
    ],
  });
  const status = index > 0 && index % 31 === 0 ? "cancelled" : index > 0 && index % 37 === 0 ? "closed" : "open";

  return {
    id: `qr${padNumber(index + 1)}`,
    type: hostJoinMode === "team" ? "need_player" : "find_team",
    title: `${region} ${ranked ? "정규전" : "친선전"} ${mode} ${visibility === "private" ? "비공개방" : "공개방"}${teamPartyRoom ? " · 팀 파티 포함" : " · 개인 매칭"}`,
    region,
    court,
    mode,
    ...schedule,
    timingType,
    ranked,
    official: ranked && index % 4 !== 0,
    preRegistered: timingType !== "instant",
    mmrRangeMode,
    ratingScale,
    rules,
    stakes: index % 6 === 0 ? "구장 예약비 현장 정산" : "",
    courtReserved: index % 5 === 0,
    courtFee: index % 5 === 0 ? `${(index % 4) + 1}만원` : "",
    spots: Math.max(0, sideCapacity * 2 - activeHostSize - activeApplicantSize),
    teamId: hostJoinMode === "team" ? hostTeam.id : null,
    targetTeamId: visibility === "private" && hostJoinMode === "team" ? opponentTeam.id : null,
    refereeId: "",
    refereeTrustMin: REFEREE_TRUST_MIN,
    statEntryMinutes: STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: DISPUTE_WINDOW_MINUTES,
    ownerId: owner.id,
    hostJoinMode,
    hostSide: "teamA",
    hostReady: index % 7 !== 0,
    visibility,
    roomState,
    sideCapacity,
    playerIds: hostPlayerIds,
    position: hostJoinMode === "player" ? owner.position ?? "PG" : "상관없음",
    playerId: owner.id,
    memo: `룰 확인 후 진행. ${index % 5 === 0 ? "구장 예약 내역은 채팅으로 공유." : "코트 상황에 따라 시작 시간 조정."}`,
    status,
    cancelledAt: status === "cancelled" ? makeDemoTimestamp(DEMO_TODAY, "11:00", index) : null,
    applicants,
    createdAt,
  };
}

function buildDemoRecruitingRooms(teams, users) {
  return Array.from({ length: 100 }, (_item, index) => makeRecruitingRoomPost(index, teams, users));
}

function buildDemoReports(matches, users) {
  return Array.from({ length: 12 }, (_item, index) => {
    const match = matches.find((item) => item.id === `ma${padNumber((index % 36) + 1, 3)}`) ?? matches[index];
    return {
      id: `rd${padNumber(index + 1, 3)}`,
      type: "match",
      targetId: match.id,
      by: users[(index * 11) % users.length].id,
      reason: index % 2 ? "리바운드 기록 재확인이 필요합니다." : "어시스트 기록 확인 요청입니다.",
      status: index % 5 === 0 ? "resolved" : "open",
      createdAt: "2026-06-08T11:00:00.000Z",
    };
  });
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function normalizeDemoUserHashtag(user = {}) {
  const source = user.hashtag ?? user.handle ?? user.id;
  const legacyBrandHandle = String(source ?? "").match(/^[@#]?rankball(\d+)$/i);
  const hashtag = toHashtag(legacyBrandHandle ? `boxtier${legacyBrandHandle[1]}` : source, user.id);
  return {
    ...user,
    handle: hashtag,
    hashtag,
  };
}

function withCanonicalUserHashtags(state) {
  return {
    ...state,
    users: (state.users ?? []).map(normalizeDemoUserHashtag),
  };
}

function withDemoLeague(state) {
  const users = buildDemoUsers(state.users);
  const teams = buildDemoTeams(state.teams, users);
  const matches = buildDemoMatches(state.matches, teams, users);
  const recruitingPosts = buildDemoRecruitingRooms(teams, users);
  const reports = [...state.reports, ...buildDemoReports(matches, users)];
  const recruitingIds = new Set(recruitingPosts.map((post) => post.id));
  const notifications = state.notifications.filter((notification) => (
    !notification.recruitingPostId || recruitingIds.has(notification.recruitingPostId)
  ));

  return {
    ...state,
    users: uniqueById(users),
    teams: uniqueById(teams),
    matches: uniqueById(matches),
    recruitingPosts: uniqueById(recruitingPosts),
    notifications: uniqueById(notifications),
    reports: uniqueById(reports),
    settings: {
      ...state.settings,
      favoriteTeamIds: [...new Set([...(state.settings?.favoriteTeamIds ?? []), "td01", "td02", "td03", "td04"])],
      favoriteCourtIds: [...new Set(state.settings?.favoriteCourtIds ?? [])],
    },
  };
}

function withDemoRefereeQualifications(state) {
  const demoReferees = [
    { userId: "u1", grade: "official", matchCount: 26, reportCount: 0, thumbsUp: 41 },
    { userId: "u11", grade: "gold", matchCount: 18, reportCount: 1, thumbsUp: 24 },
  ];
  const refereeIds = new Set(demoReferees.map((item) => item.userId));
  const refereeAppointmentsToAdd = demoReferees.map((item) => ({
    id: `demo-referee-${item.userId}`,
    role: "referee",
    grade: item.grade,
    userId: item.userId,
    status: "active",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2030-12-31T23:59:59.000Z",
    appointedBy: "u1",
    reason: "데모 심판 테스트 계정",
    createdAt: "2026-06-17T09:00:00.000Z",
  }));
  const refereeAppointments = state.settings?.refereeAppointments ?? [];
  const existingRefereeAppointmentIds = new Set(refereeAppointments.map((appointment) => appointment.id));
  const existingRefereeAppointmentUserIds = new Set(refereeAppointments.map((appointment) => appointment.userId));

  return {
    ...state,
    users: (state.users ?? []).map((user) => {
      if (!refereeIds.has(user.id)) return user;
      const demoReferee = demoReferees.find((item) => item.userId === user.id);
      return {
        ...user,
        refereeGrade: user.refereeGrade ?? demoReferee.grade,
        refereeProfile: {
          grade: demoReferee.grade,
          status: "active",
          matchCount: demoReferee.matchCount,
          reportCount: demoReferee.reportCount,
          thumbsUp: demoReferee.thumbsUp,
          ...(user.refereeProfile ?? {}),
        },
      };
    }),
    settings: {
      ...(state.settings ?? {}),
      refereeAppointments: [
        ...refereeAppointmentsToAdd.filter((appointment) => (
          !existingRefereeAppointmentIds.has(appointment.id) &&
          !existingRefereeAppointmentUserIds.has(appointment.userId)
        )),
        ...refereeAppointments,
      ],
    },
  };
}

export const sourceDemoState = withCanonicalUserHashtags(withDemoRefereeQualifications(withDemoLeague(baseState)));
export const initialState = withCanonicalUserHashtags(withDemoRefereeQualifications(demoFlowState ?? sourceDemoState));
