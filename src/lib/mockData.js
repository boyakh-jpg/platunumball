import { COURTS, MATCH_MODES, PLAYER_POSITIONS, REGIONS } from "./constants.js";

const baseState = {
  currentUserId: "u1",
  users: [
    {
      id: "u1",
      name: "민준",
      handle: "@minjun",
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
      handle: "@seoyun",
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
      handle: "@jihoo",
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
      handle: "@taeo",
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
      handle: "@harin",
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
      handle: "@doyun",
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
      handle: "@naeun",
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
      handle: "@hyunwoo",
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
      handle: "@yuna",
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
      handle: "@sion",
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
        { userId: "u3", role: "guest" },
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
        { userId: "u5", role: "regular" },
        { userId: "u10", role: "regular" },
        { userId: "u1", role: "mercenary" },
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
        { userId: "u8", role: "captain" },
        { userId: "u9", role: "regular" },
        { userId: "u2", role: "candidate" },
        { userId: "u6", role: "regular" },
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
        { userId: "u10", role: "captain" },
        { userId: "u4", role: "regular" },
        { userId: "u7", role: "candidate" },
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
        { userId: "u3", role: "captain" },
        { userId: "u1", role: "regular" },
        { userId: "u6", role: "guest" },
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
        { userId: "u5", role: "captain" },
        { userId: "u2", role: "regular" },
        { userId: "u9", role: "mercenary" },
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
        { userId: "u6", role: "captain" },
        { userId: "u8", role: "regular" },
        { userId: "u4", role: "candidate" },
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
        { userId: "u7", role: "captain" },
        { userId: "u10", role: "regular" },
        { userId: "u3", role: "regular" },
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
        { userId: "u1", role: "captain" },
        { userId: "u8", role: "regular" },
        { userId: "u9", role: "guest" },
      ],
    },
  ],
  affiliations: [
    { id: "a1", type: "region", name: "마포", score: 1420, wins: 38, losses: 24 },
    { id: "a2", type: "region", name: "성수", score: 1362, wins: 32, losses: 27 },
    { id: "a3", type: "school", name: "연희대", score: 1398, wins: 21, losses: 13 },
    { id: "a4", type: "company", name: "스틸픽", score: 1298, wins: 17, losses: 16 },
    { id: "a5", type: "club", name: "노을농구회", score: 1448, wins: 29, losses: 18 },
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
        "주장 확인 옵션이 있으면 양팀 주장 승인도 필요합니다.",
      ],
    },
  ],
  matches: [
    {
      id: "m1",
      title: "토요 5v5 공식전",
      mode: "5v5",
      court: "한강 노을코트",
      scheduledDate: "2026-05-31",
      scheduledTime: "20:30",
      scheduledAt: "2026-05-31 20:30",
      status: "contract",
      official: true,
      preRegistered: true,
      rules: { targetScore: 21, timeLimit: 12, winByTwo: true, ball: "7호 공" },
      memo: "승자팀 다음 경기 우선권. 금전 거래 없이 약속만 기록합니다.",
      stakes: "승자팀 다음 경기 우선권. 금전 거래 없이 약속만 기록합니다.",
      ranked: true,
      objectionWindow: "24시간",
      evidence: [
        { id: "captain", label: "양팀 주장 확인" },
        { id: "scoreboard_photo", label: "스코어보드 사진" },
      ],
      teamA: { name: "Noeul Kings", teamId: "t1", players: ["u1", "u2", "u3", "u4", "u5"], score: 0 },
      teamB: { name: "Bridge Ballers", teamId: "t2", players: ["u6", "u7", "u8", "u9", "u10"], score: 0 },
      agreements: { teamA: [], teamB: [] },
      approvals: { teamA: [], teamB: [] },
      disputes: [],
      result: null,
      ratingResult: null,
      createdAt: "2026-05-31T10:00:00.000Z",
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
      rules: { targetScore: 15, timeLimit: 10, winByTwo: false, ball: "7호 공" },
      memo: "빠른 입력 테스트용 기록",
      stakes: "리벤지 매치. 패자는 다음 판 물/음료 준비.",
      evidence: [{ id: "captain", label: "양팀 주장 확인" }],
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
        submittedAt: "2026-05-30T12:20:00.000Z",
      },
      ratingResult: [
        { playerId: "u1", integratedDelta: 12.2, modeDelta: 15.8, result: "win" },
        { playerId: "u6", integratedDelta: -10.6, modeDelta: -13.9, result: "loss" },
      ],
      createdAt: "2026-05-30T11:10:00.000Z",
      confirmedAt: "2026-05-30T12:25:00.000Z",
    },
  ],
  notifications: [
    { id: "n1", title: "경기 전 동의 대기", body: "토요 5v5 공식전의 경기 전 동의를 기다리고 있습니다.", tone: "match", matchId: "m1" },
    { id: "n2", title: "3연승", body: "민준의 통합 티어가 Platinum에 가까워지고 있어요.", tone: "tier" },
  ],
  recruitingPosts: [
    {
      id: "q1",
      type: "need_player",
      title: "Noeul Kings 5v5 용병 1명",
      region: "마포",
      court: "한강 노을코트",
      mode: "5v5",
      ranked: true,
      spots: 1,
      teamId: "t1",
      position: "PF",
      playerId: "u1",
      memo: "리바운드 같이 잡아줄 포워드/센터면 좋아요.",
      status: "open",
      applicants: [{ kind: "player", playerId: "u8", createdAt: "2026-05-31T09:44:00.000Z" }],
      createdAt: "2026-05-31T09:30:00.000Z",
    },
    {
      id: "q2",
      type: "find_team",
      title: "성수 친선 3v3 팀 구해요",
      region: "성수",
      court: "성수 브릿지파크",
      mode: "3v3",
      ranked: false,
      spots: 1,
      teamId: null,
      position: "SG",
      playerId: "u9",
      memo: "티어 상관없이 빠르게 두세 판 뛸 팀 찾습니다.",
      status: "open",
      applicants: [{ kind: "team", teamId: "t2", playerId: "u2", createdAt: "2026-05-31T08:55:00.000Z" }],
      createdAt: "2026-05-31T08:40:00.000Z",
    },
    {
      id: "q3",
      type: "need_player",
      title: "잠실 5v5 공식전 가드 대타",
      region: "잠실",
      court: "잠실 실내체육관 보조코트",
      mode: "5v5",
      ranked: true,
      spots: 1,
      teamId: "t5",
      position: "PG",
      playerId: "u4",
      memo: "볼 운반 가능한 가드면 포지션 크게 안 봅니다.",
      status: "open",
      applicants: [{ kind: "player", playerId: "u2", createdAt: "2026-05-31T08:05:00.000Z" }],
      createdAt: "2026-05-31T07:55:00.000Z",
    },
    {
      id: "q4",
      type: "need_team",
      title: "마포 정규전 5v5 상대팀 구해요",
      region: "마포",
      court: "홍대 스트릿돔",
      mode: "5v5",
      ranked: true,
      spots: 1,
      teamId: "t1",
      position: "상관없음",
      playerId: "u1",
      memo: "비슷한 티어 팀이면 바로 경기방 만들고 양팀 동의로 진행해요.",
      status: "open",
      applicants: [{ kind: "team", teamId: "t3", playerId: "u3", createdAt: "2026-05-31T10:10:00.000Z" }],
      createdAt: "2026-05-31T10:00:00.000Z",
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
    favoriteTeamIds: ["t1", "t2", "t5"],
    favoriteCourtIds: ["c1", "c2", "c3"],
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
  return {
    id: `u${index}`,
    name,
    handle: `@rankball${padNumber(index)}`,
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
  const scheduledDate = `2026-${String(5 + Math.floor((matchIndex % 92) / 31)).padStart(2, "0")}-${String((matchIndex % 28) + 1).padStart(2, "0")}`;
  const scheduledTime = `${String(10 + (matchIndex % 11)).padStart(2, "0")}:${matchIndex % 2 ? "30" : "00"}`;
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
    evidence: [{ id: "scoreboard_photo", label: "스코어보드 사진" }, { id: "captain", label: "양팀 주장 확인" }],
    teamA: { name: teamA.name, teamId: teamA.id, players: playersA, score: scoreA },
    teamB: { name: teamB.name, teamId: teamB.id, players: playersB, score: scoreB },
    agreements: { teamA: playersA, teamB: playersB },
    approvals: { teamA: playersA, teamB: playersB },
    disputes: [],
    result: {
      scoreA,
      scoreB,
      playerStats,
      submittedAt: `${scheduledDate}T${scheduledTime}:00.000Z`,
    },
    ratingResult: [...playersA, ...playersB].map((playerId, playerIndex) => {
      const teamAWinner = playersA.includes(playerId) ? aWon : !aWon;
      const delta = (teamAWinner ? 7 : -7) + ((matchIndex + playerIndex) % 5) * (teamAWinner ? 1 : -1);
      return { playerId, integratedDelta: delta, modeDelta: Math.round(delta * 1.2), result: teamAWinner ? "win" : "loss" };
    }),
    teamRatingResult: { teamA: aWon ? 11 : -9, teamB: aWon ? -9 : 11 },
    createdAt: `${scheduledDate}T${scheduledTime}:00.000Z`,
    confirmedAt: `${scheduledDate}T${scheduledTime}:00.000Z`,
  };
}

function makeActiveMatch(activeIndex, teams, userById) {
  const base = makeConfirmedMatch(1000 + activeIndex, teams, userById);
  const status = cycle(["contract", "agreed", "approval", "disputed"], activeIndex);
  const common = {
    ...base,
    id: `ma${padNumber(activeIndex + 1, 3)}`,
    title: `${status === "contract" ? "동의 대기" : status === "agreed" ? "진행 예정" : status === "approval" ? "결과 승인" : "이의 확인"} · ${base.teamA.name} vs ${base.teamB.name}`,
    scheduledDate: `2026-06-${String(10 + (activeIndex % 18)).padStart(2, "0")}`,
    scheduledTime: `${String(18 + (activeIndex % 4)).padStart(2, "0")}:00`,
    scheduledAt: `2026-06-${String(10 + (activeIndex % 18)).padStart(2, "0")} ${String(18 + (activeIndex % 4)).padStart(2, "0")}:00`,
    status,
    confirmedAt: null,
    ratingResult: null,
    teamRatingResult: null,
  };

  if (status === "contract") {
    return {
      ...common,
      teamA: { ...common.teamA, score: 0 },
      teamB: { ...common.teamB, score: 0 },
      agreements: { teamA: common.teamA.players.slice(0, 2), teamB: common.teamB.players.slice(0, 1) },
      approvals: { teamA: [], teamB: [] },
      result: null,
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

function buildDemoMatches(baseMatches, teams, users) {
  const demoTeams = teams.filter((team) => team.id.startsWith("td"));
  const userById = Object.fromEntries(users.map((user) => [user.id, user]));
  const confirmed = Array.from({ length: 1000 }, (_item, index) => makeConfirmedMatch(index, demoTeams, userById));
  const active = Array.from({ length: 36 }, (_item, index) => makeActiveMatch(index, demoTeams, userById));
  return [...baseMatches, ...active, ...confirmed];
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
    mode: cycle(MATCH_MODES, index).id,
    ranked,
    spots: type === "need_player" ? 1 + (index % 2) : 1,
    teamId: type === "find_team" ? null : team.id,
    position: type === "need_team" ? "상관없음" : cycle(PLAYER_POSITIONS, index),
    playerId: type === "find_team" ? player.id : team.members[0].userId,
    memo: type === "need_player"
      ? "포지션 맞으면 바로 경기방 초대합니다. 과반 동의 후 진행해요."
      : type === "find_team"
        ? "혼자 참여 가능합니다. 빠르게 뛸 팀 찾습니다."
        : "비슷한 MMR 팀이면 바로 매치 잡습니다.",
    status: index % 11 === 0 ? "closed" : "open",
    applicants: type === "need_player"
      ? [{ kind: "player", playerId: applicantUser.id, createdAt: "2026-06-01T10:00:00.000Z" }]
      : [{ kind: "team", teamId: applicantTeam.id, playerId: applicantTeam.members[0].userId, createdAt: "2026-06-01T10:00:00.000Z" }],
    createdAt: `2026-06-${String(1 + (index % 7)).padStart(2, "0")}T${String(9 + (index % 10)).padStart(2, "0")}:00:00.000Z`,
  };
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

function withDemoLeague(state) {
  const users = buildDemoUsers(state.users);
  const teams = buildDemoTeams(state.teams, users);
  const matches = buildDemoMatches(state.matches, teams, users);
  const recruitingPosts = [
    ...state.recruitingPosts,
    ...Array.from({ length: 60 }, (_item, index) => makeRecruitingPost(index, teams, users)),
  ];
  const reports = [...state.reports, ...buildDemoReports(matches, users)];

  return {
    ...state,
    users: uniqueById(users),
    teams: uniqueById(teams),
    matches: uniqueById(matches),
    recruitingPosts: uniqueById(recruitingPosts),
    reports: uniqueById(reports),
    settings: {
      ...state.settings,
      favoriteTeamIds: [...new Set([...(state.settings?.favoriteTeamIds ?? []), "td01", "td02", "td03", "td04"])],
      favoriteCourtIds: [...new Set(state.settings?.favoriteCourtIds ?? [])],
    },
  };
}

export const initialState = withDemoLeague(baseState);
