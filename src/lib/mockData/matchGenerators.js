import {
  DISPUTE_WINDOW_MINUTES,
  PLAYER_POSITIONS,
  REFEREE_TRUST_MIN,
  REGIONS,
  STAT_ENTRY_WINDOW_MINUTES,
} from "../constants.js";
import {
  DEMO_NOW,
  DEMO_PRACTICE_COURT,
  DEMO_TODAY,
  makeDemoStatSubmissions,
  makeDemoTimestamp,
  makeRelativeDemoDateTime,
  makeTrustFeedback,
} from "./baseState.js";

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

export function padNumber(value, size = 3) {
  return String(value).padStart(size, "0");
}

export function cycle(list, index) {
  return list[index % list.length];
}

function makeDemoUser(index) {
  const region = cycle(REGIONS, index - 1);
  const position = cycle(PLAYER_POSITIONS.slice(1), index - 1);
  const mmr = 980 + ((index * 43) % 640);
  const name = `${cycle(demoSurnames, index)}${cycle(demoGivenNames, index * 3)}`;
  const hashtag = `#player${padNumber(index)}`;
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

export function buildDemoUsers(baseUsers) {
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

export function buildDemoTeams(baseTeams, users) {
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

export function buildDemoMatches(baseMatches, teams, users) {
  const demoTeams = teams.filter((team) => team.id.startsWith("td"));
  const userById = Object.fromEntries(users.map((user) => [user.id, user]));
  const confirmed = Array.from({ length: 1000 }, (_item, index) => makeConfirmedMatch(index, demoTeams, userById));
  const active = Array.from({ length: 36 }, (_item, index) => makeActiveMatch(index, demoTeams, userById));
  const lifecycle = Array.from({ length: 6 }, (_item, index) => makeLifecycleMatch(index, demoTeams, userById));
  return [...baseMatches, ...lifecycle, ...active, ...confirmed];
}
