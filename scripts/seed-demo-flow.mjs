import { mkdir, writeFile } from "node:fs/promises";
import { sourceDemoState as initialState } from "../src/lib/mockData.js";
import { STORAGE_KEY } from "../src/lib/constants.js";
import {
  acceptRecruitingInvitation,
  cancelRecruitingParticipation,
  checkInMatchPlayer,
  confirmMatchRefereeAbsence,
  confirmRecruitingMatch,
  createMatch,
  createRecruitingPost,
  detachRecruitingPartyPlayer,
  disputeMatch,
  endMatch,
  interestRecruitingPost,
  inviteRecruitingPlayers,
  joinRecruitingSideParty,
  removeMatchRoomPlayer,
  requestMatchRefereeAbsence,
  resumeMatchApproval,
  runAutomaticStateMaintenance,
  sendRecruitingChat,
  setRecruitingApplicantPlacement,
  setRecruitingPartyPlayerPlacement,
  setRecruitingReady,
  setRecruitingSlotPosition,
  startMatch,
  submitMatchResult,
  submitMatchThumbs,
  updateMatchRoomRules,
  updateRecruitingRoomRules,
} from "../src/data/repository.js";
import { getMatchPlayerIds, getMatchReservePlayerIds, getMatchRoomPhase, getMatchSideLeaderId } from "../src/lib/matchUtils.js";
import { getRecruitingApplicantKey, getRecruitingLobby } from "../src/lib/recruiting.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const outDir = new URL("../tmp/", import.meta.url);
const stateOut = new URL("rankball-demo-state.json", outDir);
const reportOut = new URL("rankball-flow-report.json", outDir);
const generatedStateOut = new URL("../src/lib/demoFlowState.js", import.meta.url);

const report = {
  storageKey: STORAGE_KEY,
  checks: [],
  ids: {},
};

function assertFlow(condition, label, detail = {}) {
  report.checks.push({ label, ok: Boolean(condition), detail });
  if (!condition) {
    throw new Error(`${label}: ${JSON.stringify(detail)}`);
  }
}

function todayPlus(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function isoFor(dateValue, timeValue, minuteOffset = 0) {
  const date = new Date(`${dateValue}T${timeValue}:00`);
  date.setMinutes(date.getMinutes() + minuteOffset);
  return date.toISOString();
}

function withUser(state, userId, action) {
  return action({ ...state, currentUserId: userId });
}

function findNewId(beforeIds, rows) {
  return rows.find((row) => !beforeIds.has(row.id))?.id ?? "";
}

function createRoom(state, userId, draft) {
  const beforeIds = new Set((state.recruitingPosts ?? []).map((post) => post.id));
  const nextState = withUser(state, userId, (scoped) => createRecruitingPost(scoped, draft));
  const id = findNewId(beforeIds, nextState.recruitingPosts ?? []);
  assertFlow(Boolean(id), `방 생성: ${draft.title}`, { userId, lastNotification: nextState.notifications?.[0] });
  return { state: nextState, postId: id };
}

function getPost(state, postId) {
  return state.recruitingPosts.find((post) => post.id === postId);
}

function getMatch(state, matchId) {
  return state.matches.find((match) => match.id === matchId);
}

const COURT_ROTATION = [
  "한강 노을코트",
  "성수 브릿지파크",
  "잠실 실내체육관 보조코트",
  "홍대 스트릿돔",
  "뚝섬 리버사이드",
  "반포 선셋파크",
  "연남 레일파크",
];
const MODE_ROTATION = [
  { mode: "1v1", capacity: 1 },
  { mode: "2v2", capacity: 2 },
  { mode: "3v3", capacity: 3 },
  { mode: "5v5", capacity: 5 },
];
const CONFIRMED_MODE_ROTATION = MODE_ROTATION.filter((item) => item.capacity <= 3);

function createResult(match, scoreA = 21, scoreB = 15) {
  const makeSideStats = (players, score) => {
    const base = Math.floor(score / players.length);
    let extra = score % players.length;
    return Object.fromEntries(players.map((playerId, index) => {
      const points = base + (extra > 0 ? 1 : 0);
      extra -= extra > 0 ? 1 : 0;
      return [playerId, {
        points,
        rebounds: 2 + (index % 3),
        assists: 1 + (index % 2),
        steals: index % 2,
        blocks: index % 3 === 0 ? 1 : 0,
        fouls: index % 2,
      }];
    }));
  };
  return {
    scoreA,
    scoreB,
    playerStats: {
      ...makeSideStats(match.teamA.players, scoreA),
      ...makeSideStats(match.teamB.players, scoreB),
    },
  };
}

function patchMatch(state, matchId, patcher) {
  return {
    ...state,
    matches: state.matches.map((match) => (match.id === matchId ? patcher(match) : match)),
  };
}

function addPastMatch(state, index, teamAId, teamBId, daysAgo) {
  const scheduledDate = todayPlus(2);
  const beforeIds = new Set(state.matches.map((match) => match.id));
  let nextState = withUser(state, "u1", (scoped) => createMatch(scoped, {
    title: `과거 기록 ${index}`,
    mode: index % 2 ? "3v3" : "5v5",
    court: index % 2 ? "성수 브릿지파크" : "한강 노을코트",
    teamAId,
    teamBId,
    scheduledDate,
    scheduledTime: "19:00",
    ranked: index % 3 !== 0,
    official: index % 4 === 0,
    preRegistered: true,
    targetScore: 21,
    timeLimit: 12,
    winByTwo: true,
  }));
  const matchId = findNewId(beforeIds, nextState.matches);
  const pastDate = todayPlus(-daysAgo);
  const scheduledTime = index % 2 ? "20:00" : "18:30";
  nextState = patchMatch(nextState, matchId, (match) => {
    const result = createResult(match, 21, 14 + (index % 6));
    const endedAt = isoFor(pastDate, scheduledTime, 14);
    const submittedAt = isoFor(pastDate, scheduledTime, 25);
    return {
      ...match,
      title: `기록방 데모 ${index} · ${match.teamA.name} vs ${match.teamB.name}`,
      scheduledDate: pastDate,
      scheduledTime,
      scheduledAt: `${pastDate} ${scheduledTime}`,
      status: "confirmed",
      teamA: { ...match.teamA, score: result.scoreA },
      teamB: { ...match.teamB, score: result.scoreB },
      agreements: { teamA: match.teamA.players, teamB: match.teamB.players },
      approvals: { teamA: match.teamA.players, teamB: match.teamB.players },
      result: {
        ...result,
        submittedBy: match.teamA.players[0],
        submittedAt,
        updatedAt: submittedAt,
      },
      endedAt,
      confirmedAt: submittedAt,
      ratingResult: getMatchPlayerIds(match).map((playerId) => ({
        playerId,
        integratedDelta: match.teamA.players.includes(playerId) ? 8 : -7,
        modeDelta: match.teamA.players.includes(playerId) ? 10 : -9,
        result: match.teamA.players.includes(playerId) ? "win" : "loss",
      })),
      teamRatingResult: { teamA: 9, teamB: -8 },
    };
  });
  assertFlow(Boolean(matchId), `과거 경기 생성 ${index}`, { matchId });
  return nextState;
}

function buildBaseState() {
  return {
    ...clone(initialState),
    currentUserId: "u1",
    matches: [],
    recruitingPosts: [],
    tournaments: [],
    notifications: [],
    reports: [],
  };
}

function teamRoster(team = {}, count = 5, offset = 0) {
  const ids = (team.members ?? []).map((member) => member.userId);
  if (!ids.length) return [];
  return Array.from({ length: Math.min(count, ids.length) }, (_, index) => ids[(offset + index) % ids.length]);
}

function teamsWithSize(state, size = 5) {
  return state.teams.filter((team) => (team.members ?? []).length >= size);
}

function userByIndex(state, index) {
  return state.users[index % state.users.length]?.id ?? "u1";
}

function trustedUserByIndex(state, index, minTrust = 75) {
  const users = state.users.filter((user) => Number(user.trustScore ?? 0) >= minTrust);
  return users[index % users.length]?.id ?? userByIndex(state, index);
}

function ensureTrustedPartyLeader(state, team = {}, playerIds = [], minTrust = 75) {
  const trustById = new Map(state.users.map((user) => [user.id, Number(user.trustScore ?? 0)]));
  const teamIds = (team.members ?? []).map((member) => member.userId);
  const leaderId = playerIds.find((playerId) => (trustById.get(playerId) ?? 0) >= minTrust)
    ?? teamIds.find((playerId) => (trustById.get(playerId) ?? 0) >= minTrust)
    ?? playerIds[0]
    ?? "";
  if (!leaderId) return playerIds;
  return [leaderId, ...playerIds.filter((playerId) => playerId !== leaderId)].slice(0, playerIds.length);
}

function pickDisjointTeamPair(state, capacity = 5, seed = 0) {
  const teams = teamsWithSize(state, capacity + 1);
  for (let attempt = 0; attempt < teams.length * teams.length; attempt += 1) {
    const hostTeam = teams[(seed + attempt) % teams.length];
    const hostPlayers = teamRoster(hostTeam, capacity, seed + attempt);
    const hostSet = new Set(hostPlayers);
    for (let other = 1; other < teams.length; other += 1) {
      const opponentTeam = teams[(seed + attempt + other) % teams.length];
      if (opponentTeam.id === hostTeam.id) continue;
      const opponentPlayers = teamRoster(opponentTeam, capacity + 2, seed + other)
        .filter((playerId) => !hostSet.has(playerId))
        .slice(0, capacity);
      if (opponentPlayers.length >= capacity) {
        return { hostTeam, opponentTeam, hostPlayers, opponentPlayers };
      }
    }
  }
  throw new Error(`disjoint team pair not found: ${capacity}`);
}

function addBulkDemoContent(state) {
  let nextState = state;

  for (let index = 7; index <= 36; index += 1) {
    const teams = teamsWithSize(nextState, 5);
    const teamA = teams[index % teams.length];
    const teamB = teams[(index + 5) % teams.length];
    nextState = addPastMatch(nextState, index, teamA.id, teamB.id, 8 + index);
  }

  for (let index = 0; index < 24; index += 1) {
    const modeMeta = CONFIRMED_MODE_ROTATION[index % CONFIRMED_MODE_ROTATION.length];
    const { hostTeam, opponentTeam, hostPlayers: pickedHostPlayers, opponentPlayers } = pickDisjointTeamPair(nextState, modeMeta.capacity, index);
    const hostPlayers = ensureTrustedPartyLeader(nextState, hostTeam, pickedHostPlayers, index % 5 === 0 ? 80 : 70);
    const hostReserves = teamRoster(hostTeam, 2, index + modeMeta.capacity).filter((id) => !hostPlayers.includes(id));
    const opponentReserves = teamRoster(opponentTeam, 2, index + modeMeta.capacity + 1).filter((id) => !opponentPlayers.includes(id));
    const timingType = index % 4 === 0 ? "instant" : "scheduled";
    const beforeIds = new Set(nextState.matches.map((match) => match.id));
    const room = createRoom(nextState, hostPlayers[0], {
      title: `FLOW 확정 준비 ${index + 1} ${modeMeta.mode}`,
      visibility: "private",
      hostJoinMode: "team",
      teamId: hostTeam.id,
      opponentTeamId: opponentTeam.id,
      mode: modeMeta.mode,
      sideCapacity: modeMeta.capacity,
      timingType,
      scheduledDate: timingType === "instant" ? "" : todayPlus((index % 20) + 1),
      scheduledTime: `${String(10 + (index % 10)).padStart(2, "0")}:00`,
      ranked: index % 3 !== 0,
      official: index % 5 === 0,
      preRegistered: true,
      playerIds: hostPlayers,
      reservePlayerIds: hostReserves,
      opponentPlayerIds: opponentPlayers,
      opponentReservePlayerIds: opponentReserves,
      court: COURT_ROTATION[index % COURT_ROTATION.length],
      rules: { targetScore: 21, timeLimit: 12, ball: "7호 공" },
      memo: "방 생성 플로우로 만든 확정 데모",
    });
    nextState = room.state;
    nextState = withUser(nextState, opponentPlayers[0], (scoped) => setRecruitingReady(scoped, room.postId, true));
    nextState = withUser(nextState, hostPlayers[0], (scoped) => confirmRecruitingMatch(scoped, room.postId));
    assertFlow(Boolean(findNewId(beforeIds, nextState.matches)), `확정 데모 생성 ${index + 1}`, {});
  }

  for (let index = 0; index < 40; index += 1) {
    const modeMeta = MODE_ROTATION[(index + 1) % MODE_ROTATION.length];
    const visibility = "public";
    const hostJoinMode = index % 3 === 0 ? "team" : "player";
    const teams = teamsWithSize(nextState, modeMeta.capacity);
    const hostTeam = teams[(index + 3) % teams.length];
    let hostPlayers = teamRoster(hostTeam, Math.max(1, Math.min(modeMeta.capacity, index % 2 ? 1 : modeMeta.capacity)), index);
    if (hostJoinMode === "team") {
      hostPlayers = ensureTrustedPartyLeader(nextState, hostTeam, hostPlayers, visibility === "public" ? 75 : 70);
    }
    const ownerId = hostJoinMode === "team" ? hostPlayers[0] : trustedUserByIndex(nextState, index + 24, visibility === "public" ? 75 : 70);
    const room = createRoom(nextState, ownerId, {
      title: `FLOW 모집 중 ${index + 1} ${modeMeta.mode}`,
      visibility,
      hostJoinMode,
      teamId: hostJoinMode === "team" ? hostTeam.id : undefined,
      mode: modeMeta.mode,
      sideCapacity: modeMeta.capacity,
      timingType: "scheduled",
      scheduledDate: todayPlus((index % 5) + 1),
      scheduledTime: `${String(12 + (index % 8)).padStart(2, "0")}:30`,
      ranked: index % 4 !== 0,
      official: false,
      preRegistered: true,
      playerIds: hostJoinMode === "team" ? hostPlayers : [],
      reservePlayerIds: hostJoinMode === "team" ? teamRoster(hostTeam, 2, index + modeMeta.capacity).filter((id) => !hostPlayers.includes(id)) : [],
      court: COURT_ROTATION[(index + 2) % COURT_ROTATION.length],
      rules: { targetScore: 21, timeLimit: 12, ball: "7호 공" },
      memo: "목록/달력/필터 검증용 모집방",
    });
    nextState = room.state;

    const participantCount = Math.min(modeMeta.capacity + 2, 4);
    for (let offset = 0; offset < participantCount; offset += 1) {
      const userId = userByIndex(nextState, index * 3 + offset + 33);
      if (userId === ownerId) continue;
      nextState = withUser(nextState, userId, (scoped) => interestRecruitingPost(scoped, room.postId, {
        joinMode: "player",
        side: offset % 2 === 0 ? "teamA" : "teamB",
        reserve: offset >= modeMeta.capacity,
        position: ["PG", "SG", "SF", "PF", "C"][offset % 5],
      }));
    }
  }

  return nextState;
}

let state = buildBaseState();

for (let index = 1; index <= 6; index += 1) {
  const teamAId = index % 2 ? "t1" : "td03";
  const teamBId = index % 2 ? "t2" : "td04";
  state = addPastMatch(state, index, teamAId, teamBId, 7 + index * 3);
}

let room;

room = createRoom(state, "u1", {
  title: "FLOW 비공개 팀전 3v3",
  visibility: "private",
  hostJoinMode: "team",
  teamId: "t1",
  opponentTeamId: "t2",
  mode: "3v3",
  sideCapacity: 3,
  timingType: "instant",
  ranked: true,
  official: true,
  preRegistered: false,
  playerIds: ["u1", "u2", "u3"],
  reservePlayerIds: ["u4", "u5"],
  opponentPlayerIds: ["u6", "u7", "u8"],
  opponentLeaderId: "u7",
  opponentReservePlayerIds: ["u9", "u10"],
  refereeId: "u11",
  court: "한강 노을코트",
  rules: { targetScore: 21, timeLimit: 12, ball: "7호 공" },
  memo: "비공개 팀전 라이프사이클 검증",
});
state = room.state;
const lifecyclePostId = room.postId;
let lifecyclePost = getPost(state, lifecyclePostId);
let lifecycleInvite = lifecyclePost.roomState.invitations.find((invitation) => invitation.targetUserId === "u7");
assertFlow(Boolean(lifecycleInvite), "비공개 팀전 즉시: B 파티장 초대장 발송", {
  targetUserId: lifecycleInvite?.targetUserId,
  scheduledAt: lifecyclePost.scheduledAt,
});
let lifecycleRefereeInvite = lifecyclePost.roomState.invitations.find((invitation) => invitation.role === "referee" && invitation.targetUserId === "u11");
assertFlow(Boolean(lifecycleRefereeInvite), "비공개 심판 초대 발송", {
  targetUserId: lifecycleRefereeInvite?.targetUserId,
  role: lifecycleRefereeInvite?.role,
});
state = withUser(state, "u11", (scoped) => acceptRecruitingInvitation(scoped, lifecyclePostId, lifecycleRefereeInvite.id));
lifecyclePost = getPost(state, lifecyclePostId);
assertFlow(lifecyclePost.refereeId === "u11", "비공개 심판 초대 수락", {
  refereeId: lifecyclePost.refereeId,
});
lifecycleInvite = lifecyclePost.roomState.invitations.find((invitation) => invitation.targetUserId === "u7");
state = withUser(state, "u7", (scoped) => acceptRecruitingInvitation(scoped, lifecyclePostId, lifecycleInvite.id));
let lifecycleLobby = getRecruitingLobby(getPost(state, lifecyclePostId), state);
assertFlow(lifecycleLobby.canConfirm, "비공개 팀전 즉시: B 파티장 수락 후 확정 가능", {
  teamA: lifecycleLobby.sides.teamA.confirmationProjectedFilled,
  teamB: lifecycleLobby.sides.teamB.confirmationProjectedFilled,
  ready: lifecycleLobby.ready,
  confirmationFillReady: lifecycleLobby.confirmationFillReady,
  entries: lifecycleLobby.entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    side: entry.side,
    status: entry.status,
    players: entry.players,
  })),
});

const beforeLifecycleMatchIds = new Set(state.matches.map((match) => match.id));
state = withUser(state, "u1", (scoped) => confirmRecruitingMatch(scoped, lifecyclePostId));
const lifecycleMatchId = findNewId(beforeLifecycleMatchIds, state.matches);
report.ids.lifecycleMatchId = lifecycleMatchId;
assertFlow(getMatchRoomPhase(getMatch(state, lifecycleMatchId)).phase === "checkin", "확정 후 경기준비방", {
  phase: getMatchRoomPhase(getMatch(state, lifecycleMatchId)),
});

assertFlow(getMatchSideLeaderId(getMatch(state, lifecycleMatchId), state.teams, "teamB") === "u7", "비공개 팀전: 초대 수락자가 B사이드장", {
  leaderId: getMatchSideLeaderId(getMatch(state, lifecycleMatchId), state.teams, "teamB"),
});

assertFlow(getMatch(state, lifecycleMatchId).refereeId === "u11", "수락된 심판만 확정 경기로 이동", {
  refereeId: getMatch(state, lifecycleMatchId).refereeId,
});

state = withUser(state, "u1", (scoped) => updateMatchRoomRules(scoped, lifecycleMatchId, {
  targetScore: 15,
  timeLimit: 10,
  memo: "현장 합의로 15점 10분",
  stakes: "구장 예약비 현장 정산",
}));
assertFlow(getMatch(state, lifecycleMatchId).rules.targetScore !== 15, "심판 배정 경기준비방: 방장 룰 수정 불가", {
  targetScore: getMatch(state, lifecycleMatchId).rules.targetScore,
});

state = withUser(state, "u11", (scoped) => updateMatchRoomRules(scoped, lifecycleMatchId, {
  targetScore: 15,
  timeLimit: 10,
  memo: "현장 합의로 15점 10분",
  stakes: "구장 예약비 현장 정산",
}));
assertFlow(getMatch(state, lifecycleMatchId).rules.targetScore === 15, "심판 배정 경기준비방: 심판 룰 수정", {
  targetScore: getMatch(state, lifecycleMatchId).rules.targetScore,
});

state = withUser(state, "u6", (scoped) => startMatch(scoped, lifecycleMatchId));
assertFlow(!getMatch(state, lifecycleMatchId).startedAt, "상대 파티장은 경기 시작 불가", {});

for (const sideName of ["teamA", "teamB"]) {
  for (const playerId of getMatch(state, lifecycleMatchId)[sideName].players) {
    state = withUser(state, "u1", (scoped) => checkInMatchPlayer(scoped, lifecycleMatchId, sideName, playerId));
  }
}
assertFlow(
  getMatch(state, lifecycleMatchId).attendance.teamA.length === 0 &&
    getMatch(state, lifecycleMatchId).attendance.teamB.length === 0,
  "심판 배정 경기준비방: 방장 출석체크 불가",
  { attendance: getMatch(state, lifecycleMatchId).attendance },
);

for (const sideName of ["teamA", "teamB"]) {
  const attendanceTargets = [
    ...getMatch(state, lifecycleMatchId)[sideName].players,
    ...getMatchReservePlayerIds(getMatch(state, lifecycleMatchId), sideName),
  ];
  for (const playerId of attendanceTargets) {
    state = withUser(state, "u11", (scoped) => checkInMatchPlayer(scoped, lifecycleMatchId, sideName, playerId));
  }
}
assertFlow(
  getMatch(state, lifecycleMatchId).attendance.teamA.length === getMatch(state, lifecycleMatchId).teamA.players.length + getMatchReservePlayerIds(getMatch(state, lifecycleMatchId), "teamA").length &&
    getMatch(state, lifecycleMatchId).attendance.teamB.length === getMatch(state, lifecycleMatchId).teamB.players.length + getMatchReservePlayerIds(getMatch(state, lifecycleMatchId), "teamB").length,
  "심판 배정 경기준비방: 출전+후보 전원 출석체크",
  { attendance: getMatch(state, lifecycleMatchId).attendance },
);

state = withUser(state, "u1", (scoped) => startMatch(scoped, lifecycleMatchId));
assertFlow(getMatchRoomPhase(getMatch(state, lifecycleMatchId)).phase === "checkin", "심판 배정 경기준비방: 방장 시작 불가", {
  phase: getMatchRoomPhase(getMatch(state, lifecycleMatchId)),
});

state = withUser(state, "u11", (scoped) => startMatch(scoped, lifecycleMatchId));
assertFlow(getMatchRoomPhase(getMatch(state, lifecycleMatchId)).phase === "live", "심판 경기 시작", {
  phase: getMatchRoomPhase(getMatch(state, lifecycleMatchId)),
});

state = withUser(state, "u1", (scoped) => endMatch(scoped, lifecycleMatchId));
assertFlow(getMatchRoomPhase(getMatch(state, lifecycleMatchId)).phase === "live", "심판 배정 경기: 방장 종료 불가", {
  phase: getMatchRoomPhase(getMatch(state, lifecycleMatchId)),
});

state = withUser(state, "u11", (scoped) => endMatch(scoped, lifecycleMatchId));
assertFlow(getMatchRoomPhase(getMatch(state, lifecycleMatchId)).phase === "postgame", "심판 경기 종료", {
  phase: getMatchRoomPhase(getMatch(state, lifecycleMatchId)),
});

state = withUser(state, "u11", (scoped) => submitMatchResult(scoped, lifecycleMatchId, createResult(getMatch(state, lifecycleMatchId), 15, 11)));
assertFlow(getMatchRoomPhase(getMatch(state, lifecycleMatchId)).phase === "dispute", "심판 기록 후 이의신청방", {
  status: getMatch(state, lifecycleMatchId).status,
});

state = withUser(state, "u6", (scoped) => disputeMatch(scoped, lifecycleMatchId, "점수 재확인 요청"));
assertFlow(getMatch(state, lifecycleMatchId).status === "disputed", "참가자 이의신청 접수", {
  disputes: getMatch(state, lifecycleMatchId).disputes?.length,
});

state = withUser(state, "u6", (scoped) => resumeMatchApproval(scoped, lifecycleMatchId));
assertFlow(getMatch(state, lifecycleMatchId).status === "disputed", "참가자는 이의 확정 불가", {
  status: getMatch(state, lifecycleMatchId).status,
});

state = withUser(state, "u11", (scoped) => resumeMatchApproval(scoped, lifecycleMatchId));
assertFlow(getMatchRoomPhase(getMatch(state, lifecycleMatchId)).phase === "record", "심판 이의 확정 후 기록방", {
  status: getMatch(state, lifecycleMatchId).status,
});

state = withUser(state, "u1", (scoped) => submitMatchThumbs(scoped, lifecycleMatchId, ["u6", "u7"]));

room = createRoom(state, "u12", {
  title: "FLOW 공개 심판 직접참여 2v2",
  visibility: "public",
  hostJoinMode: "player",
  mode: "2v2",
  sideCapacity: 2,
  timingType: "scheduled",
  scheduledDate: todayPlus(1),
  scheduledTime: "18:30",
  ranked: false,
  official: false,
  preRegistered: true,
  court: "반포 선셋파크",
});
state = room.state;
const refereeJoinPostId = room.postId;
state = withUser(state, "u11", (scoped) => interestRecruitingPost(scoped, refereeJoinPostId, { joinMode: "referee" }));
let refereeJoinPost = getPost(state, refereeJoinPostId);
let refereeJoinLobby = getRecruitingLobby(refereeJoinPost, state);
assertFlow(refereeJoinPost.refereeId === "u11", "공개방 심판 직접참여", {
  refereeId: refereeJoinPost.refereeId,
});
assertFlow(!refereeJoinLobby.entries.some((entry) => (entry.players ?? []).includes("u11") || (entry.reserves ?? []).includes("u11")), "공개방 심판은 슬롯을 쓰지 않음", {
  entries: refereeJoinLobby.entries,
});

room = createRoom(state, "u1", {
  title: "FLOW 공개 팀전 초대 2v2",
  visibility: "public",
  hostJoinMode: "team",
  teamOnly: true,
  teamId: "t1",
  mode: "2v2",
  sideCapacity: 2,
  timingType: "scheduled",
  scheduledDate: todayPlus(1),
  scheduledTime: "19:00",
  ranked: false,
  official: false,
  preRegistered: true,
  playerIds: ["u1", "u2"],
  court: "반포 선셋파크",
});
state = room.state;
const publicTeamInvitePostId = room.postId;
state = withUser(state, "u7", (scoped) => interestRecruitingPost(scoped, publicTeamInvitePostId, {
  joinMode: "team",
  teamId: "t2",
  side: "teamB",
  playerIds: ["u7", "u6"],
  reservePlayerIds: ["u8"],
}));
let publicTeamInvitePost = getPost(state, publicTeamInvitePostId);
let publicTeamInviteLobby = getRecruitingLobby(publicTeamInvitePost, state);
assertFlow(
  publicTeamInvitePost.roomState.partyLeaders["team:t2"] === "u7" &&
    publicTeamInviteLobby.sides.teamB.players.includes("u7") &&
    !publicTeamInviteLobby.sides.teamB.players.includes("u6"),
  "공개 팀전: 참여자가 사이드장, 나머지는 초대 대기",
  {
    leader: publicTeamInvitePost.roomState.partyLeaders["team:t2"],
    teamB: publicTeamInviteLobby.sides.teamB.players,
    invitations: publicTeamInvitePost.roomState.invitations,
  },
);
const publicTeamActiveInvite = publicTeamInvitePost.roomState.invitations.find((invitation) => invitation.targetUserId === "u6" && invitation.reserve === false);
const publicTeamReserveInvite = publicTeamInvitePost.roomState.invitations.find((invitation) => invitation.targetUserId === "u8" && invitation.reserve === true);
assertFlow(Boolean(publicTeamActiveInvite && publicTeamReserveInvite), "공개 팀전: 선택 팀원 초대장 발송", {
  activeInvite: publicTeamActiveInvite,
  reserveInvite: publicTeamReserveInvite,
});
state = withUser(state, "u6", (scoped) => acceptRecruitingInvitation(scoped, publicTeamInvitePostId, publicTeamActiveInvite.id));
state = withUser(state, "u8", (scoped) => acceptRecruitingInvitation(scoped, publicTeamInvitePostId, publicTeamReserveInvite.id));
publicTeamInvitePost = getPost(state, publicTeamInvitePostId);
publicTeamInviteLobby = getRecruitingLobby(publicTeamInvitePost, state);
assertFlow(
  publicTeamInviteLobby.sides.teamB.players.includes("u6") &&
    publicTeamInviteLobby.sides.teamB.reserveCandidates.some((candidate) => candidate.playerId === "u8"),
  "공개 팀전: 초대 수락 후 팀 파티 합류",
  {
    teamB: publicTeamInviteLobby.sides.teamB.players,
    reserves: publicTeamInviteLobby.sides.teamB.reserveCandidates,
  },
);

room = createRoom(state, "u1", {
  title: "FLOW 심판 미출석 전환 1v1",
  visibility: "private",
  hostJoinMode: "team",
  teamId: "t1",
  opponentTeamId: "t2",
  mode: "1v1",
  sideCapacity: 1,
  timingType: "instant",
  ranked: false,
  official: false,
  preRegistered: true,
  playerIds: ["u1"],
  opponentPlayerIds: ["u6"],
  opponentLeaderId: "u6",
  refereeId: "u11",
  court: "성수 브릿지파크",
});
state = room.state;
const refereeAbsentPostId = room.postId;
let refereeAbsentPost = getPost(state, refereeAbsentPostId);
const refereeAbsentInvite = refereeAbsentPost.roomState.invitations.find((invitation) => invitation.role === "referee" && invitation.targetUserId === "u11");
const refereeAbsentOpponentInvite = refereeAbsentPost.roomState.invitations.find((invitation) => invitation.targetUserId === "u6");
state = withUser(state, "u11", (scoped) => acceptRecruitingInvitation(scoped, refereeAbsentPostId, refereeAbsentInvite.id));
state = withUser(state, "u6", (scoped) => acceptRecruitingInvitation(scoped, refereeAbsentPostId, refereeAbsentOpponentInvite.id));
const beforeAbsentMatchIds = new Set(state.matches.map((match) => match.id));
state = withUser(state, "u1", (scoped) => confirmRecruitingMatch(scoped, refereeAbsentPostId));
const refereeAbsentMatchId = findNewId(beforeAbsentMatchIds, state.matches);
assertFlow(getMatch(state, refereeAbsentMatchId).refereeId === "u11", "미출석 전환 전 심판 배정", {
  refereeId: getMatch(state, refereeAbsentMatchId).refereeId,
});
state = withUser(state, "u1", (scoped) => requestMatchRefereeAbsence(scoped, refereeAbsentMatchId));
assertFlow(getMatch(state, refereeAbsentMatchId).refereeAbsenceRequest?.status === "pending", "방장 심판 미출석 요청", {
  request: getMatch(state, refereeAbsentMatchId).refereeAbsenceRequest,
});
state = withUser(state, "u6", (scoped) => confirmMatchRefereeAbsence(scoped, refereeAbsentMatchId));
assertFlow(!getMatch(state, refereeAbsentMatchId).refereeId && getMatch(state, refereeAbsentMatchId).formerRefereeId === "u11", "상대 사이드장 심판 미출석 인정", {
  refereeId: getMatch(state, refereeAbsentMatchId).refereeId,
  formerRefereeId: getMatch(state, refereeAbsentMatchId).formerRefereeId,
});
state = withUser(state, "u1", (scoped) => checkInMatchPlayer(scoped, refereeAbsentMatchId, "teamA", "u1"));
state = withUser(state, "u1", (scoped) => checkInMatchPlayer(scoped, refereeAbsentMatchId, "teamB", "u6"));
state = withUser(state, "u1", (scoped) => startMatch(scoped, refereeAbsentMatchId));
assertFlow(getMatchRoomPhase(getMatch(state, refereeAbsentMatchId)).phase === "live", "심판 미출석 인정 후 방장 시작", {
  phase: getMatchRoomPhase(getMatch(state, refereeAbsentMatchId)),
});

room = createRoom(state, "u12", {
  title: "FLOW 후보 자동승격 3v3",
  visibility: "private",
  hostJoinMode: "player",
  mode: "3v3",
  sideCapacity: 3,
  timingType: "instant",
  ranked: false,
  official: false,
  preRegistered: false,
  court: "성수 브릿지파크",
});
state = room.state;
const promotePostId = room.postId;
state = withUser(state, "u13", (scoped) => interestRecruitingPost(scoped, promotePostId, { joinMode: "player", side: "teamA", reserve: false, position: "SG" }));
assertFlow(!getRecruitingLobby(getPost(state, promotePostId), state).entries.some((entry) => entry.playerId === "u13"), "비공개 개인전: 직접 참여 차단", {
  notification: state.notifications?.[0],
});
const promoteInviteApplications = [
  ["u13", { joinMode: "player", side: "teamA", reserve: false, position: "SG" }],
  ["u14", { joinMode: "player", side: "teamA", reserve: true, position: "SF" }],
  ["u15", { joinMode: "player", side: "teamA", reserve: true, position: "PF" }],
  ["u16", { joinMode: "player", side: "teamB", reserve: false, position: "PG" }],
  ["u17", { joinMode: "player", side: "teamB", reserve: true, position: "SG" }],
  ["u18", { joinMode: "player", side: "teamB", reserve: true, position: "SF" }],
];
promoteInviteApplications.forEach(([userId, application]) => {
  state = withUser(state, "u12", (scoped) => inviteRecruitingPlayers(scoped, promotePostId, {
    side: application.side,
    reserve: application.reserve,
    playerIds: [userId],
  }));
  const invitation = getPost(state, promotePostId).roomState.invitations.find((item) => item.targetUserId === userId);
  assertFlow(Boolean(invitation), "비공개 개인전: 초대장 발송", { userId, application });
  state = withUser(state, userId, (scoped) => acceptRecruitingInvitation(scoped, promotePostId, invitation.id));
});
const promoteLobby = getRecruitingLobby(getPost(state, promotePostId), state);
assertFlow(promoteLobby.canConfirm, "후보가 빈 출전 슬롯을 채우면 확정 가능", {
  teamA: promoteLobby.sides.teamA.confirmationProjectedPlayers,
  teamB: promoteLobby.sides.teamB.confirmationProjectedPlayers,
});
const beforePromoteMatchIds = new Set(state.matches.map((match) => match.id));
state = withUser(state, "u12", (scoped) => confirmRecruitingMatch(scoped, promotePostId));
const promoteMatchId = findNewId(beforePromoteMatchIds, state.matches);
const promoteMatch = getMatch(state, promoteMatchId);
assertFlow(
  promoteMatch.teamA.players.length === 3 &&
    promoteMatch.teamB.players.length === 3 &&
    promoteMatch.reservePlayers.teamA.length === 1 &&
    promoteMatch.reservePlayers.teamB.length === 0,
  "후보 왼쪽 순서 자동 출전 승격",
  {
    teamA: promoteMatch.teamA.players,
    teamB: promoteMatch.teamB.players,
    reserves: promoteMatch.reservePlayers,
    promoted: promoteMatch.promotedReserveIds,
  },
);
const checkinReserveId = promoteMatch.reservePlayers.teamA[0];
const absentActiveId = promoteMatch.teamA.players.find((playerId) => playerId !== "u12");
state = withUser(state, "u12", (scoped) => checkInMatchPlayer(scoped, promoteMatchId, "teamA", checkinReserveId));
state = withUser(state, "u12", (scoped) => removeMatchRoomPlayer(scoped, promoteMatchId, absentActiveId));
const promoteCheckinMatch = getMatch(state, promoteMatchId);
assertFlow(
  promoteCheckinMatch.teamA.players.includes(checkinReserveId) &&
    !promoteCheckinMatch.teamA.players.includes(absentActiveId) &&
    !getMatchReservePlayerIds(promoteCheckinMatch, "teamA").includes(checkinReserveId),
  "경기준비방: 미출석 강퇴 후 출석 후보 자동출전",
  {
    absentActiveId,
    checkinReserveId,
    teamA: promoteCheckinMatch.teamA.players,
    reserves: getMatchReservePlayerIds(promoteCheckinMatch, "teamA"),
    attendance: promoteCheckinMatch.attendance.teamA,
  },
);
const personalRoomLeaderBeforeKick = getMatchSideLeaderId(getMatch(state, promoteMatchId), state.teams, "teamB");
state = withUser(state, "u12", (scoped) => removeMatchRoomPlayer(scoped, promoteMatchId, personalRoomLeaderBeforeKick));
const personalRoomLeaderAfterKickMatch = getMatch(state, promoteMatchId);
const personalRoomLeaderAfterKick = getMatchSideLeaderId(personalRoomLeaderAfterKickMatch, state.teams, "teamB");
assertFlow(
  Boolean(personalRoomLeaderBeforeKick) &&
    personalRoomLeaderAfterKick &&
    personalRoomLeaderAfterKick !== personalRoomLeaderBeforeKick &&
    personalRoomLeaderAfterKickMatch.teamB.players.includes(personalRoomLeaderAfterKick),
  "비공개 개인전: 사이드장 강퇴 후 다음 출전자가 사이드장",
  {
    before: personalRoomLeaderBeforeKick,
    after: personalRoomLeaderAfterKick,
    teamB: personalRoomLeaderAfterKickMatch.teamB.players,
  },
);

room = createRoom(state, "u2", {
  title: "FLOW 공개 파티 조작 3v3",
  visibility: "public",
  hostJoinMode: "team",
  teamId: "t3",
  mode: "3v3",
  sideCapacity: 3,
  scheduledDate: todayPlus(1),
  scheduledTime: "19:30",
  ranked: false,
  official: false,
  preRegistered: true,
  playerIds: ["u2"],
  court: "홍대 스트릿돔",
});
state = room.state;
const partyPostId = room.postId;
state = withUser(state, "u1", (scoped) => interestRecruitingPost(scoped, partyPostId, { joinMode: "player", side: "teamA", reserve: false, position: "PG" }));
state = withUser(state, "u1", (scoped) => joinRecruitingSideParty(scoped, partyPostId, "t3", "teamA"));
let partyLobby = getRecruitingLobby(getPost(state, partyPostId), state);
let partyEntry = partyLobby.sides.teamA.entries.find((entry) => getRecruitingApplicantKey(entry) === "team:t3" || entry.team?.id === "t3");
assertFlow(Boolean(partyEntry?.players?.includes("u1")), "같은 사이드 같은 팀: 파티 합류", {
  entry: partyEntry,
});
state = withUser(state, "u1", (scoped) => setRecruitingSlotPosition(scoped, partyPostId, "u1", "C"));
assertFlow(getPost(state, partyPostId).roomState.slotPositions.u1 === "C", "내슬롯관리: 포지션 변경", {
  slotPositions: getPost(state, partyPostId).roomState.slotPositions,
});
state = withUser(state, "u1", (scoped) => setRecruitingPartyPlayerPlacement(scoped, partyPostId, partyEntry.id, "u1", { side: "teamA", reserve: true }));
partyLobby = getRecruitingLobby(getPost(state, partyPostId), state);
partyEntry = partyLobby.entries.find((entry) => entry.id === partyEntry.id);
assertFlow(partyEntry.reserves.includes("u1"), "내슬롯관리: 파티원을 후보로 이동", {
  reserves: partyEntry.reserves,
});
state = withUser(state, "u1", (scoped) => setRecruitingPartyPlayerPlacement(scoped, partyPostId, partyEntry.id, "u1", { side: "teamA", reserve: false }));
state = withUser(state, "u1", (scoped) => inviteRecruitingPlayers(scoped, partyPostId, { side: "teamA", reserve: true, teamId: "t3", playerIds: ["u5"] }));
const u5Invite = getPost(state, partyPostId).roomState.invitations.find((invitation) => invitation.targetUserId === "u5");
assertFlow(Boolean(u5Invite), "참여자가 후보 초대장 발송", { invitation: u5Invite });
state = withUser(state, "u5", (scoped) => acceptRecruitingInvitation(scoped, partyPostId, u5Invite.id));
partyLobby = getRecruitingLobby(getPost(state, partyPostId), state);
assertFlow(partyLobby.entries.some((entry) => (entry.reserves ?? []).includes("u5")), "후보 초대 수락", {});
state = withUser(state, "u1", (scoped) => detachRecruitingPartyPlayer(scoped, partyPostId, partyEntry.id, "u1", { side: "teamA", reserve: false }));
partyLobby = getRecruitingLobby(getPost(state, partyPostId), state);
assertFlow(partyLobby.entries.some((entry) => entry.kind === "player" && entry.playerId === "u1"), "파티 나가기 후 개인 참여 전환", {});
state = withUser(state, "u5", (scoped) => cancelRecruitingParticipation(scoped, partyPostId));
partyLobby = getRecruitingLobby(getPost(state, partyPostId), state);
assertFlow(!partyLobby.entries.some((entry) => (entry.reserves ?? []).includes("u5") || (entry.players ?? []).includes("u5")), "참여 취소 시 슬롯 비움", {});
state = withUser(state, "u1", (scoped) => sendRecruitingChat(scoped, partyPostId, "파티/후보 플로우 확인"));
assertFlow(getPost(state, partyPostId).roomState.chatMessages.length >= 1, "방 채팅 저장", {
  count: getPost(state, partyPostId).roomState.chatMessages.length,
});

room = createRoom(state, "u19", {
  title: "FLOW 개인 슬롯 이동 2v2",
  visibility: "public",
  hostJoinMode: "player",
  mode: "2v2",
  sideCapacity: 2,
  scheduledDate: todayPlus(2),
  scheduledTime: "18:00",
  ranked: false,
  official: false,
  preRegistered: true,
  court: "연남 레일파크",
});
state = room.state;
const slotPostId = room.postId;
state = withUser(state, "u20", (scoped) => interestRecruitingPost(scoped, slotPostId, { joinMode: "player", side: "teamA", reserve: false, position: "C" }));
state = withUser(state, "u19", (scoped) => updateRecruitingRoomRules(scoped, slotPostId, { sideCapacity: 3, targetScore: 15, timeLimit: 10 }));
state = withUser(state, "u20", (scoped) => setRecruitingReady(scoped, slotPostId, true));
state = withUser(state, "u20", (scoped) => setRecruitingApplicantPlacement(scoped, slotPostId, "u20", { side: "teamB", reserve: true }));
let slotLobby = getRecruitingLobby(getPost(state, slotPostId), state);
assertFlow(slotLobby.sides.teamB.reserveCandidates.some((candidate) => candidate.playerId === "u20"), "내슬롯관리: 개인 후보 이동", {});
state = withUser(state, "u20", (scoped) => setRecruitingApplicantPlacement(scoped, slotPostId, "u20", { side: "teamB", reserve: false }));
slotLobby = getRecruitingLobby(getPost(state, slotPostId), state);
assertFlow(slotLobby.sides.teamB.players.includes("u20"), "내슬롯관리: 개인 B 출전 이동", {
  teamB: slotLobby.sides.teamB.players,
});

state = addBulkDemoContent(state);
state = runAutomaticStateMaintenance(state);
report.summary = {
  users: state.users.length,
  teams: state.teams.length,
  matches: state.matches.length,
  recruitingPosts: state.recruitingPosts.length,
  openRecruitingPosts: state.recruitingPosts.filter((post) => post.status === "open").length,
  phases: state.matches.reduce((acc, match) => {
    const phase = getMatchRoomPhase(match).phase;
    acc[phase] = (acc[phase] ?? 0) + 1;
    return acc;
  }, {}),
};

await mkdir(outDir, { recursive: true });
await writeFile(stateOut, JSON.stringify(state, null, 2), "utf8");
await writeFile(reportOut, JSON.stringify(report, null, 2), "utf8");
await writeFile(
  generatedStateOut,
  `// Generated by \`npm run seed:demo-flow\`.\nexport const demoFlowState = ${JSON.stringify(state)};\n`,
  "utf8",
);

console.log(JSON.stringify({
  ok: true,
  storageKey: STORAGE_KEY,
  statePath: stateOut.pathname,
  reportPath: reportOut.pathname,
  generatedStatePath: generatedStateOut.pathname,
  summary: report.summary,
  checks: report.checks.length,
}, null, 2));
