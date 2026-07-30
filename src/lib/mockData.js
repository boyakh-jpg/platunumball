import {
  DISPUTE_WINDOW_MINUTES,
  MATCH_MODES,
  PLAYER_POSITIONS,
  REFEREE_TRUST_MIN,
  REGIONS,
  STAT_ENTRY_WINDOW_MINUTES,
} from "./constants.js";
import { demoFlowState } from "./demoFlowState.js";
import {
  DEMO_NOW,
  DEMO_PRACTICE_COURT,
  DEMO_QUEUE_TIMES,
  DEMO_TODAY,
  DELETED_SYNTHETIC_COURT_IDS,
  baseState,
  getDemoModeSize,
  getDemoQueueSlot,
  getTeamDemoPlayerIds,
  makeDefaultRoomState,
  makeDemoApplicant,
  makeDemoStatSubmissions,
  makeDemoTimestamp,
  makeRelativeDemoDateTime,
  makeTrustFeedback,
} from "./mockData/baseState.js";
import {
  uniqueById,
  withCanonicalUserHashtags,
  withDemoRefereeQualifications,
  withoutDeletedSyntheticCourts,
} from "./mockData/stateFinalizers.js";

// P-DEMO-CLEANUP: seed/local-dev only. Production app must not import this module.
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
  const court = DEMO_PRACTICE_COURT;

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
  const court = teamA.homeCourt ?? DEMO_PRACTICE_COURT.name;

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
  const court = team.homeCourt ?? DEMO_PRACTICE_COURT.name;
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
  const court = hostTeam.homeCourt ?? DEMO_PRACTICE_COURT.name;
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
      favoriteCourtIds: [...new Set(state.settings?.favoriteCourtIds ?? [])]
        .filter((courtId) => !DELETED_SYNTHETIC_COURT_IDS.has(courtId)),
    },
  };
}

export const sourceDemoState = withoutDeletedSyntheticCourts(
  withCanonicalUserHashtags(withDemoRefereeQualifications(withDemoLeague(baseState))),
);
export const initialState = withoutDeletedSyntheticCourts(
  withCanonicalUserHashtags(withDemoRefereeQualifications(demoFlowState ?? sourceDemoState)),
);
