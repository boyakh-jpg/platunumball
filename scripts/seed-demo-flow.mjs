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
  resolveMatchDispute,
  runAutomaticStateMaintenance,
  sendRecruitingChat,
  setRecruitingApplicantPlacement,
  setRecruitingPartyPlayerPlacement,
  setRecruitingReady,
  setRecruitingRoomTeam,
  setRecruitingSlotPosition,
  setRecruitingTeamPartyRoster,
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
const checkOnly = process.argv.includes("--check");

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
  const mode = index % 2 ? "3v3" : "5v5";
  const sideCapacity = mode === "3v3" ? 3 : 5;
  const teamA = state.teams.find((team) => team.id === teamAId);
  const teamB = state.teams.find((team) => team.id === teamBId);
  const beforeIds = new Set(state.matches.map((match) => match.id));
  let nextState = withUser(state, "u1", (scoped) => createMatch(scoped, {
    title: `과거 기록 ${index}`,
    recordType: "match_record",
    recordComposition: "team",
    mode,
    court: index % 2 ? "성수 브릿지파크" : "한강 노을코트",
    scheduledDate: todayPlus(0),
    scheduledTime: "00:00",
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
    const historicalMatch = {
      ...match,
      teamA: {
        ...match.teamA,
        name: teamA?.name ?? "A사이드",
        teamId: teamAId,
        players: teamRoster(teamA, sideCapacity),
      },
      teamB: {
        ...match.teamB,
        name: teamB?.name ?? "B사이드",
        teamId: teamBId,
        players: teamRoster(teamB, sideCapacity),
      },
      rules: {
        ...(match.rules ?? {}),
        recordType: "match",
      },
    };
    const result = createResult(historicalMatch, 21, 14 + (index % 6));
    const endedAt = isoFor(pastDate, scheduledTime, 14);
    const submittedAt = isoFor(pastDate, scheduledTime, 25);
    return {
      ...historicalMatch,
      title: `기록방 데모 ${index} · ${historicalMatch.teamA.name} vs ${historicalMatch.teamB.name}`,
      scheduledDate: pastDate,
      scheduledTime,
      scheduledAt: `${pastDate} ${scheduledTime}`,
      status: "confirmed",
      ranked: index % 3 !== 0,
      official: index % 4 === 0,
      preRegistered: true,
      teamA: { ...historicalMatch.teamA, score: result.scoreA },
      teamB: { ...historicalMatch.teamB, score: result.scoreB },
      agreements: { teamA: historicalMatch.teamA.players, teamB: historicalMatch.teamB.players },
      approvals: { teamA: historicalMatch.teamA.players, teamB: historicalMatch.teamB.players },
      result: {
        ...result,
        submittedBy: historicalMatch.teamA.players[0],
        submittedAt,
        updatedAt: submittedAt,
      },
      endedAt,
      confirmedAt: submittedAt,
      ratingResult: getMatchPlayerIds(historicalMatch).map((playerId) => ({
        playerId,
        integratedDelta: historicalMatch.teamA.players.includes(playerId) ? 8 : -7,
        modeDelta: historicalMatch.teamA.players.includes(playerId) ? 10 : -9,
        result: historicalMatch.teamA.players.includes(playerId) ? "win" : "loss",
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

function uniqueById(items = []) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function trustedUserByIndex(state, index, minTrust = 75) {
  const users = state.users.filter((user) => Number(user.trustScore ?? 0) >= minTrust);
  return users[index % users.length]?.id ?? userByIndex(state, index);
}

function ensureTrustedPartyLeader(state, team = {}, playerIds = [], minTrust = 75) {
  const trustById = new Map(state.users.map((user) => [user.id, Number(user.trustScore ?? 0)]));
  const teamIds = (team.members ?? []).map((member) => member.userId);
  const captainId = (team.members ?? []).find((member) => member.role === "captain")?.userId ?? "";
  const leaderId = captainId
    || playerIds.find((playerId) => (trustById.get(playerId) ?? 0) >= minTrust)
    || teamIds.find((playerId) => (trustById.get(playerId) ?? 0) >= minTrust)
    || playerIds[0]
    || "";
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
      const opponentCaptainId = (opponentTeam.members ?? []).find((member) => member.role === "captain")?.userId ?? "";
      const opponentPlayers = [
        opponentCaptainId,
        ...teamRoster(opponentTeam, capacity + 2, seed + other),
      ]
        .filter((playerId, index, rows) => playerId && rows.indexOf(playerId) === index && !hostSet.has(playerId))
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
      ranked: false,
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
    nextState = withUser(nextState, hostPlayers[0], (scoped) => setRecruitingRoomTeam(scoped, room.postId, "teamA", hostTeam.id));
    nextState = withUser(nextState, hostPlayers[0], (scoped) => setRecruitingRoomTeam(scoped, room.postId, "teamB", opponentTeam.id));
    nextState = withUser(nextState, hostPlayers[0], (scoped) => setRecruitingTeamPartyRoster(scoped, room.postId, "host", {
      teamId: hostTeam.id,
      playerIds: hostPlayers,
      reservePlayerIds: hostReserves,
    }));
    let bulkPost = getPost(nextState, room.postId);
    const bulkInvite = bulkPost.roomState.invitations.find((invitation) => invitation.targetUserId === opponentPlayers[0]);
    assertFlow(Boolean(bulkInvite), `확정 데모 B사이드 파티장 초대 ${index + 1}`, {});
    nextState = withUser(nextState, opponentPlayers[0], (scoped) => acceptRecruitingInvitation(scoped, room.postId, bulkInvite.id));
    nextState = withUser(nextState, opponentPlayers[0], (scoped) => setRecruitingTeamPartyRoster(scoped, room.postId, `team:${opponentTeam.id}`, {
      teamId: opponentTeam.id,
      playerIds: opponentPlayers,
      reservePlayerIds: opponentReserves,
    }));
    nextState = withUser(nextState, opponentPlayers[0], (scoped) => setRecruitingReady(scoped, room.postId, true));
    nextState = withUser(nextState, hostPlayers[0], (scoped) => confirmRecruitingMatch(scoped, room.postId));
    const createdMatchId = findNewId(beforeIds, nextState.matches);
    const confirmPost = getPost(nextState, room.postId);
    const confirmLobby = getRecruitingLobby(confirmPost, nextState);
    assertFlow(Boolean(createdMatchId), `확정 데모 생성 ${index + 1}`, {
      hostTeamId: hostTeam.id,
      opponentTeamId: opponentTeam.id,
      hostPlayers,
      opponentPlayers,
      applicants: confirmPost?.applicants,
      partyLeaders: confirmPost?.roomState?.partyLeaders,
      partyReserves: confirmPost?.roomState?.partyReserves,
      lobby: {
        canConfirm: confirmLobby.canConfirm,
        ready: confirmLobby.ready,
        teamA: confirmLobby.sides.teamA.confirmationProjectedPlayers,
        teamB: confirmLobby.sides.teamB.confirmationProjectedPlayers,
      },
      notification: nextState.notifications?.[0],
    });
  }

  for (let index = 0; index < 40; index += 1) {
    const modeMeta = MODE_ROTATION[(index + 1) % MODE_ROTATION.length];
    const visibility = "public";
    const hostJoinMode = index % 3 === 0 ? "team" : "player";
    const teams = teamsWithSize(nextState, modeMeta.capacity);
    const eligibleHostTeams = hostJoinMode === "team"
      ? teams.filter((team) => {
          const captainId = (team.members ?? []).find((member) => member.role === "captain")?.userId ?? "";
          return Number(nextState.users.find((user) => user.id === captainId)?.trustScore ?? 0) >= 75;
        })
      : teams;
    const hostTeam = eligibleHostTeams[(index + 3) % eligibleHostTeams.length];
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
      mmrRangeMode: hostJoinMode === "team" ? "wide" : "narrow",
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

const INTEGRITY_NOW = "2026-06-17T09:00:00.000Z";
const INTEGRITY_RESOLVED_AT = "2026-06-18T10:30:00.000Z";

function makeIntegrityReport({
  id,
  type,
  targetId,
  by,
  reportedUserIds = [],
  reason,
  status = "open",
  createdAt = INTEGRITY_NOW,
  resolvedBy = null,
  resolvedAt = null,
  resolution = null,
}) {
  return {
    id,
    type,
    targetId,
    by,
    reportedUserIds,
    reason,
    status,
    createdAt,
    ...(resolvedBy ? { resolvedBy } : {}),
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

function makeIntegrityCourtRequest({
  id,
  status = "reported",
  requestedBy,
  name,
  hashtag,
  region,
  type = "야외",
  addressText,
  locationNote,
  courtKind = "street_hoop",
  surfaceType = "urethane",
  courtLayout = "full",
  lighting = true,
  paid = false,
}) {
  return {
    id,
    status,
    requestedBy,
    requestedByTrustScore: 74,
    name,
    baseName: name.replace(/^[^ ]+ /, ""),
    hashtag,
    region,
    type,
    addressText,
    roadAddress: addressText,
    jibunAddress: "",
    zonecode: "",
    detailAddress: "",
    locationNote,
    lat: null,
    lng: null,
    courtKind,
    surfaceType,
    courtLayout,
    lighting,
    paid,
    createdAt: INTEGRITY_NOW,
    updatedAt: INTEGRITY_NOW,
  };
}

function addIntegrityScenarioSeeds(state) {
  const userPatches = {
    u31: { birthYear: 2014, ageGroup: "junior", ageGroupCheckedSeason: "2026-h1", onboardingComplete: true, handleLockedAt: INTEGRITY_NOW, birthYearLockedAt: INTEGRITY_NOW },
    u32: { birthYear: 2006, ageGroup: "open", ageGroupCheckedSeason: "2026-h1", onboardingComplete: true, handleLockedAt: INTEGRITY_NOW, birthYearLockedAt: INTEGRITY_NOW, trustScore: 58 },
    u33: { birthYear: 2012, ageGroup: "junior", ageGroupCheckedSeason: "2026-h1", onboardingComplete: true, handleLockedAt: INTEGRITY_NOW, birthYearLockedAt: INTEGRITY_NOW },
    u34: { birthYear: 2007, ageGroup: "rising", ageGroupCheckedSeason: "2026-h1", onboardingComplete: true, handleLockedAt: INTEGRITY_NOW, birthYearLockedAt: INTEGRITY_NOW },
    u35: { birthYear: 2003, ageGroup: "open", ageGroupCheckedSeason: "2026-h1", onboardingComplete: true, handleLockedAt: INTEGRITY_NOW, birthYearLockedAt: INTEGRITY_NOW, trustScore: 52 },
    u36: { birthYear: 2008, ageGroup: "rising", ageGroupCheckedSeason: "2026-h1", onboardingComplete: true, handleLockedAt: INTEGRITY_NOW, birthYearLockedAt: INTEGRITY_NOW },
  };
  const users = state.users.map((user) => ({
    ...user,
    ...(userPatches[user.id] ?? {}),
  }));
  const fallbackMatches = state.matches ?? [];
  const ageDisputeMatchId = fallbackMatches[2]?.id ?? fallbackMatches[0]?.id ?? "";
  const fakeScoreMatchId = fallbackMatches[3]?.id ?? fallbackMatches[0]?.id ?? "";
  const manipulationMatchId = fallbackMatches[5]?.id ?? fallbackMatches[0]?.id ?? "";
  const matches = fallbackMatches.map((match) => {
    if (match.id !== ageDisputeMatchId) return match;
    return {
      ...match,
      title: `나이 이의 확인 · ${match.teamA?.name ?? "A"} vs ${match.teamB?.name ?? "B"}`,
      status: "disputed",
      disputes: [
        ...(match.disputes ?? []),
        { id: "dispute_age_fraud_match", by: "u6", reason: "나이 속임 신고로 결과 보류", createdAt: INTEGRITY_NOW },
      ],
      disputeDraftResult: match.result ?? null,
      disputeDraftUpdatedAt: INTEGRITY_NOW,
    };
  });
  const courtRequests = [
    makeIntegrityCourtRequest({
      id: "cr_reported_court_wrong_location",
      requestedBy: "u41",
      name: "망원동 라인아웃 골대",
      hashtag: "#courtm1",
      region: "마포",
      addressText: "서울특별시 마포구 망원동 205-5",
      locationNote: "신고: 실제 핀과 주소가 다르다는 제보",
    }),
    makeIntegrityCourtRequest({
      id: "cr_reported_court_closed",
      requestedBy: "u42",
      name: "성수동 브릿지 폐쇄코트",
      hashtag: "#courtcl",
      region: "성수",
      addressText: "서울특별시 성동구 성수동1가 685-1",
      locationNote: "신고: 공사로 폐쇄된 코트",
    }),
    makeIntegrityCourtRequest({
      id: "cr_reported_court_unsafe",
      requestedBy: "u43",
      name: "서초동 미끄럼 코트",
      hashtag: "#courtu1",
      region: "서초",
      addressText: "서울특별시 서초구 서초동 1320",
      locationNote: "신고: 바닥 미끄러움과 골대 흔들림",
      surfaceType: "asphalt",
    }),
    makeIntegrityCourtRequest({
      id: "cr_reported_court_lighting",
      requestedBy: "u44",
      name: "잠실동 그림자 코트",
      hashtag: "#courtlt",
      region: "잠실",
      addressText: "서울특별시 송파구 잠실동 10",
      locationNote: "신고: 야간 조명 불량",
      lighting: false,
    }),
    makeIntegrityCourtRequest({
      id: "cr_reported_court_duplicate",
      requestedBy: "u45",
      name: "반포동 중복 골대",
      hashtag: "#courtdp",
      region: "서초",
      addressText: "서울특별시 서초구 반포동 115-5",
      locationNote: "신고: 기존 반포 선셋파크와 중복 의심",
    }),
    makeIntegrityCourtRequest({
      id: "cr_reported_court_resolved",
      status: "approved",
      requestedBy: "u46",
      name: "연남동 검증 코트",
      hashtag: "#courtok",
      region: "마포",
      addressText: "서울특별시 마포구 연남동 250-9",
      locationNote: "관리자 검증 완료",
    }),
    makeIntegrityCourtRequest({
      id: "cr_reported_court_rejected",
      status: "pending",
      requestedBy: "u47",
      name: "구로동 오인 신고 코트",
      hashtag: "#courtno",
      region: "구로",
      addressText: "서울특별시 구로구 구로동 222-31",
      locationNote: "신고 기각 시나리오",
    }),
  ];
  const reports = [
    makeIntegrityReport({ id: "r_reported_court_wrong_location", type: "court_request", targetId: "cr_reported_court_wrong_location", by: "u2", reportedUserIds: ["u41"], reason: "허위 구장 등록" }),
    makeIntegrityReport({ id: "r_reported_court_closed", type: "court_request", targetId: "cr_reported_court_closed", by: "u3", reportedUserIds: ["u42"], reason: "허위 구장 등록" }),
    makeIntegrityReport({ id: "r_reported_court_unsafe", type: "court_request", targetId: "cr_reported_court_unsafe", by: "u4", reportedUserIds: ["u43"], reason: "허위 구장 등록" }),
    makeIntegrityReport({ id: "r_reported_court_broken_hoop", type: "court_request", targetId: "cr_reported_court_unsafe", by: "u5", reportedUserIds: ["u43"], reason: "허위 구장 등록" }),
    makeIntegrityReport({ id: "r_reported_court_bad_lighting", type: "court_request", targetId: "cr_reported_court_lighting", by: "u6", reportedUserIds: ["u44"], reason: "허위 구장 등록" }),
    makeIntegrityReport({ id: "r_reported_court_duplicate", type: "court_request", targetId: "cr_reported_court_duplicate", by: "u7", reportedUserIds: ["u45"], reason: "허위 구장 등록" }),
    makeIntegrityReport({
      id: "r_reported_court_resolved",
      type: "court_request",
      targetId: "cr_reported_court_resolved",
      by: "u8",
      reportedUserIds: ["u46"],
      reason: "허위 구장 등록",
      status: "resolved",
      resolvedBy: "u1",
      resolvedAt: INTEGRITY_RESOLVED_AT,
      resolution: { actionType: "validReport", feedback: "위치 정보를 관리자 기준으로 정정했습니다.", reason: "주소 확인 완료" },
    }),
    makeIntegrityReport({
      id: "r_reported_court_rejected",
      type: "court_request",
      targetId: "cr_reported_court_rejected",
      by: "u9",
      reportedUserIds: ["u47"],
      reason: "허위 구장 등록",
      status: "dismissed",
      resolvedBy: "u1",
      resolvedAt: INTEGRITY_RESOLVED_AT,
      resolution: { actionType: "dismissReport", feedback: "확인 결과 신고가 기각되었습니다.", reason: "주소와 현장 정보 일치" },
    }),
    makeIntegrityReport({ id: "r_age_fraud_u13_to_open", type: "player", targetId: "u32", by: "u10", reportedUserIds: ["u32"], reason: "나이 속임" }),
    makeIntegrityReport({ id: "r_age_fraud_u20_to_open", type: "player", targetId: "u35", by: "u11", reportedUserIds: ["u35"], reason: "나이 속임", status: "resolved", resolvedBy: "u1", resolvedAt: INTEGRITY_RESOLVED_AT, resolution: { actionType: "suspendTarget", feedback: "나이 정보 위반이 확인되어 제재되었습니다.", reason: "연령군 위반 확인", targetUserId: "u35", durationDays: 14 } }),
    makeIntegrityReport({ id: "r_age_fraud_match_dispute", type: "match", targetId: ageDisputeMatchId, by: "u6", reportedUserIds: ["u32"], reason: "나이 속임" }),
    makeIntegrityReport({ id: "r_identity_mismatch", type: "player", targetId: "u36", by: "u12", reportedUserIds: ["u36"], reason: "대리 참여" }),
    makeIntegrityReport({ id: "r_duplicate_account_suspicion", type: "player", targetId: "u34", by: "u13", reportedUserIds: ["u34"], reason: "기타 운영 확인 필요" }),
    makeIntegrityReport({ id: "r_player_no_show", type: "player", targetId: "u31", by: "u14", reportedUserIds: ["u31"], reason: "무단 불참" }),
    makeIntegrityReport({ id: "r_fake_score", type: "match", targetId: fakeScoreMatchId, by: "u15", reportedUserIds: ["u32"], reason: "허위 경기 결과" }),
    makeIntegrityReport({ id: "r_abusive_chat", type: "player", targetId: "u33", by: "u16", reportedUserIds: ["u33"], reason: "폭언/위협" }),
    makeIntegrityReport({ id: "r_referee_no_show", type: "player", targetId: "u11", by: "u17", reportedUserIds: ["u11"], reason: "무단 불참" }),
    makeIntegrityReport({ id: "r_team_eligibility_violation", type: "match", targetId: manipulationMatchId, by: "u18", reportedUserIds: ["u34"], reason: "대리 참여" }),
    makeIntegrityReport({ id: "r_unauthorized_score_entry", type: "match", targetId: fakeScoreMatchId, by: "u19", reportedUserIds: ["u35"], reason: "기록 조작" }),
    makeIntegrityReport({ id: "r_suspicious_ranking_manipulation", type: "player", targetId: "u35", by: "u20", reportedUserIds: ["u35"], reason: "티어/MMR 조작 의심" }),
  ].filter((report) => report.targetId);
  const notifications = [
    {
      id: "n_admin_resolved_age_fraud",
      targetUserId: "u11",
      title: "신고 처리 결과",
      body: "나이 속임 신고가 인정되어 대상 제재가 적용되었습니다.",
      tone: "report",
      type: "report_action",
      reportId: "r_age_fraud_u20_to_open",
      createdAt: INTEGRITY_RESOLVED_AT,
    },
    {
      id: "n_reported_court_resolved",
      targetUserId: "u8",
      title: "구장 신고 처리 결과",
      body: "구장 위치 신고가 인정되어 관리자 검증 상태로 처리되었습니다.",
      tone: "report",
      type: "report_action",
      reportId: "r_reported_court_resolved",
      createdAt: INTEGRITY_RESOLVED_AT,
    },
  ];
  const adminDisciplinaryActions = [
    {
      id: "ad_low_trust_after_confirmed_fraud",
      userId: "u35",
      type: "suspension",
      actionType: "suspendTarget",
      sourceReportId: "r_age_fraud_u20_to_open",
      reason: "나이 속임 확정",
      startsAt: INTEGRITY_RESOLVED_AT,
      endsAt: "2026-07-02T10:30:00.000Z",
      durationDays: 14,
      createdAt: INTEGRITY_RESOLVED_AT,
      createdBy: "u1",
      status: "active",
    },
  ];
  const adminAuditLog = [
    {
      id: "aa_admin_resolved_age_fraud",
      type: "report_action",
      status: "committed",
      reportId: "r_age_fraud_u20_to_open",
      targetUserId: "u35",
      actionType: "suspendTarget",
      reason: "나이 속임 확정",
      feedback: "나이 정보 위반이 확인되어 제재되었습니다.",
      createdAt: INTEGRITY_RESOLVED_AT,
      createdBy: "u1",
    },
  ];

  return {
    ...state,
    users,
    matches,
    reports: uniqueById([...reports, ...(state.reports ?? [])]),
    notifications: uniqueById([...notifications, ...(state.notifications ?? [])]),
    settings: {
      ...(state.settings ?? {}),
      courtRequests: uniqueById([...courtRequests, ...(state.settings?.courtRequests ?? [])]),
      adminDisciplinaryActions: uniqueById([...adminDisciplinaryActions, ...(state.settings?.adminDisciplinaryActions ?? [])]),
      adminAuditLog: uniqueById([...adminAuditLog, ...(state.settings?.adminAuditLog ?? [])]),
    },
  };
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
  mmrRangeMode: "wide",
  official: true,
  preRegistered: false,
  playerIds: ["u1", "u2", "u3"],
  reservePlayerIds: ["u4", "u5"],
  opponentPlayerIds: ["u6", "u7", "u8"],
  opponentLeaderId: "u6",
  opponentReservePlayerIds: ["u9", "u10"],
  refereeId: "u11",
  court: "한강 노을코트",
  rules: { targetScore: 21, timeLimit: 12, ball: "7호 공" },
  memo: "비공개 팀전 라이프사이클 검증",
});
state = room.state;
const lifecyclePostId = room.postId;
state = withUser(state, "u1", (scoped) => setRecruitingRoomTeam(scoped, lifecyclePostId, "teamA", "t1"));
state = withUser(state, "u1", (scoped) => setRecruitingRoomTeam(scoped, lifecyclePostId, "teamB", "t2"));
let lifecyclePost = getPost(state, lifecyclePostId);
state = withUser(state, "u1", (scoped) => setRecruitingTeamPartyRoster(scoped, lifecyclePostId, "host", {
  teamId: "t1",
  playerIds: ["u1", "u2", "u3"],
  reservePlayerIds: ["u4", "u5"],
}));
lifecyclePost = getPost(state, lifecyclePostId);
let lifecycleInvite = lifecyclePost.roomState.invitations.find((invitation) => invitation.targetUserId === "u6");
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
lifecycleInvite = lifecyclePost.roomState.invitations.find((invitation) => invitation.targetUserId === "u6");
state = withUser(state, "u6", (scoped) => acceptRecruitingInvitation(scoped, lifecyclePostId, lifecycleInvite.id));
let lifecyclePostAfterLeaderAccept = getPost(state, lifecyclePostId);
let lifecycleLobby = getRecruitingLobby(lifecyclePostAfterLeaderAccept, state);
let lifecycleTeamBEntry = lifecycleLobby.entries.find((entry) => entry.id === "team:t2");
assertFlow(lifecycleTeamBEntry?.players?.length === 1 && lifecycleTeamBEntry.players.includes("u6") && !lifecycleLobby.canConfirm, "비공개 팀전 즉시: B 팀장 수락 직후 단독 입장", {
  teamA: lifecycleLobby.sides.teamA.confirmationProjectedFilled,
  teamB: lifecycleLobby.sides.teamB.confirmationProjectedFilled,
  canConfirm: lifecycleLobby.canConfirm,
  entry: lifecycleTeamBEntry,
});
state = withUser(state, "u6", (scoped) => setRecruitingTeamPartyRoster(scoped, lifecyclePostId, lifecycleTeamBEntry.id, {
  teamId: "t2",
  playerIds: ["u6", "u7", "u8"],
  reservePlayerIds: ["u9", "u10"],
}));
lifecyclePostAfterLeaderAccept = getPost(state, lifecyclePostId);
lifecycleLobby = getRecruitingLobby(lifecyclePostAfterLeaderAccept, state);
lifecycleTeamBEntry = lifecycleLobby.entries.find((entry) => entry.id === "team:t2");
assertFlow(lifecycleTeamBEntry?.players?.length === 3 && lifecycleTeamBEntry?.reserves?.length === 2 && lifecycleLobby.canConfirm, "비공개 팀전 즉시: 양 팀 roster 충족 후 확정 가능", {
  teamA: lifecycleLobby.sides.teamA.confirmationProjectedFilled,
  teamB: lifecycleLobby.sides.teamB.confirmationProjectedFilled,
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

assertFlow(getMatchSideLeaderId(getMatch(state, lifecycleMatchId), state.teams, "teamB") === "u6", "비공개 팀전: 팀장이 B사이드장", {
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
assertFlow(getMatch(state, lifecycleMatchId).rules.targetScore !== 15, "즉시 경기준비방: 방장 룰 수정 불가", {
  targetScore: getMatch(state, lifecycleMatchId).rules.targetScore,
});

state = withUser(state, "u11", (scoped) => updateMatchRoomRules(scoped, lifecycleMatchId, {
  targetScore: 15,
  timeLimit: 10,
  memo: "현장 합의로 15점 10분",
  stakes: "구장 예약비 현장 정산",
}));
assertFlow(getMatch(state, lifecycleMatchId).rules.targetScore !== 15, "즉시 경기준비방: 심판도 룰 수정 불가", {
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

const lifecycleDisputeId = getMatch(state, lifecycleMatchId).disputes?.find((dispute) => dispute.status === "open")?.id;
assertFlow(Boolean(lifecycleDisputeId), "열린 이의신청 식별", {
  disputes: getMatch(state, lifecycleMatchId).disputes,
});

state = withUser(state, "u6", (scoped) => resolveMatchDispute(scoped, lifecycleMatchId, lifecycleDisputeId, "rejected"));
assertFlow(getMatch(state, lifecycleMatchId).status === "disputed", "참가자는 이의 판정 불가", {
  status: getMatch(state, lifecycleMatchId).status,
});

state = withUser(state, "u11", (scoped) => resolveMatchDispute(scoped, lifecycleMatchId, lifecycleDisputeId, "rejected"));
assertFlow(getMatch(state, lifecycleMatchId).status === "disputed", "심판 경기 심판은 이의 판정 불가", {
  status: getMatch(state, lifecycleMatchId).status,
});

state = withUser(state, "u1", (scoped) => resolveMatchDispute(scoped, lifecycleMatchId, lifecycleDisputeId, "rejected"));
assertFlow(getMatch(state, lifecycleMatchId).status === "approval", "방장 이의 판정 후 최종 승인 대기", {
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
  refereeWanted: true,
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
state = withUser(state, "u1", (scoped) => setRecruitingRoomTeam(scoped, publicTeamInvitePostId, "teamA", "t1"));
state = withUser(state, "u7", (scoped) => interestRecruitingPost(scoped, publicTeamInvitePostId, {
  joinMode: "player",
  side: "teamB",
}));
let publicTeamInvitePost = getPost(state, publicTeamInvitePostId);
let publicTeamInviteLobby = getRecruitingLobby(publicTeamInvitePost, state);
assertFlow(
  !publicTeamInviteLobby.entries.some((entry) => entry.kind === "player" && entry.playerId === "u7"),
  "공개 팀전: 개인 참여 차단",
  {
    entries: publicTeamInviteLobby.entries,
    notification: state.notifications?.[0],
  },
);
state = withUser(state, "u6", (scoped) => interestRecruitingPost(scoped, publicTeamInvitePostId, {
  joinMode: "team",
  teamId: "t2",
  side: "teamB",
  playerIds: ["u6"],
  reservePlayerIds: [],
}));
publicTeamInvitePost = getPost(state, publicTeamInvitePostId);
publicTeamInviteLobby = getRecruitingLobby(publicTeamInvitePost, state);
assertFlow(
  publicTeamInvitePost.roomState.partyLeaders["team:t2"] === "u6" &&
    publicTeamInviteLobby.sides.teamB.players.includes("u6") &&
    publicTeamInviteLobby.sides.teamB.players.length === 1 &&
    publicTeamInvitePost.roomState.invitations.length === 0,
  "공개 팀전: 팀 대표만 먼저 입장하고 개인 초대는 만들지 않음",
  {
    leader: publicTeamInvitePost.roomState.partyLeaders["team:t2"],
    teamB: publicTeamInviteLobby.sides.teamB.players,
    invitations: publicTeamInvitePost.roomState.invitations,
  },
);
state = withUser(state, "u6", (scoped) => setRecruitingTeamPartyRoster(scoped, publicTeamInvitePostId, "team:t2", {
  playerIds: ["u6", "u7"],
  reservePlayerIds: ["u8", "u9"],
}));
publicTeamInvitePost = getPost(state, publicTeamInvitePostId);
publicTeamInviteLobby = getRecruitingLobby(publicTeamInvitePost, state);
assertFlow(
  publicTeamInviteLobby.sides.teamB.players.includes("u6") &&
    publicTeamInviteLobby.sides.teamB.players.includes("u7") &&
    publicTeamInviteLobby.sides.teamB.reserveCandidates.some((candidate) => candidate.playerId === "u8") &&
    publicTeamInviteLobby.sides.teamB.reserveCandidates.some((candidate) => candidate.playerId === "u9") &&
    publicTeamInvitePost.roomState.invitations.length === 0,
  "공개 팀전: 사이드장이 방 안에서 출전·후보 명단 직접 확정",
  {
    teamB: publicTeamInviteLobby.sides.teamB.players,
    reserves: publicTeamInviteLobby.sides.teamB.reserveCandidates,
    invitations: publicTeamInvitePost.roomState.invitations,
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
state = withUser(state, "u1", (scoped) => setRecruitingRoomTeam(scoped, refereeAbsentPostId, "teamA", "t1"));
state = withUser(state, "u1", (scoped) => setRecruitingRoomTeam(scoped, refereeAbsentPostId, "teamB", "t2"));
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
assertFlow(getMatch(state, refereeAbsentMatchId).attendance.teamA.includes("u1"), "심판 미출석 전환 후 방장 본인 출석 저장", {
  attendance: getMatch(state, refereeAbsentMatchId).attendance,
});
state = withUser(state, "u1", (scoped) => checkInMatchPlayer(scoped, refereeAbsentMatchId, "teamB", "u6"));
state = withUser(state, "u1", (scoped) => startMatch(scoped, refereeAbsentMatchId));
assertFlow(getMatchRoomPhase(getMatch(state, refereeAbsentMatchId)).phase === "live", "심판 미출석 인정 후 방장 시작", {
  phase: getMatchRoomPhase(getMatch(state, refereeAbsentMatchId)),
});
assertFlow(getMatch(state, refereeAbsentMatchId).attendance.teamA.includes("u1"), "심판 미출석 전환 후 방장 시작 시 본인 출석 자동기록", {
  attendance: getMatch(state, refereeAbsentMatchId).attendance,
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
state = withUser(state, "u2", (scoped) => setRecruitingRoomTeam(scoped, partyPostId, "teamA", "t3"));
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
state = withUser(state, "u2", (scoped) => inviteRecruitingPlayers(scoped, partyPostId, { side: "teamA", reserve: true, teamId: "t3", playerIds: ["u5"] }));
partyLobby = getRecruitingLobby(getPost(state, partyPostId), state);
assertFlow(
  partyLobby.entries.some((entry) => (entry.reserves ?? []).includes("u5")) &&
    getPost(state, partyPostId).roomState.invitations.every((invitation) => invitation.targetUserId !== "u5"),
  "팀 전용 방: 사이드장이 후보를 직접 소집하고 초대 row는 만들지 않음",
  {},
);
state = withUser(state, "u1", (scoped) => detachRecruitingPartyPlayer(scoped, partyPostId, partyEntry.id, "u1", { side: "teamA", reserve: false }));
partyLobby = getRecruitingLobby(getPost(state, partyPostId), state);
assertFlow(
  partyLobby.entries.some((entry) => entry.kind === "team" && (entry.players ?? []).includes("u1"))
    && !partyLobby.entries.some((entry) => entry.kind === "player" && entry.playerId === "u1"),
  "팀전: 파티 나가기 차단",
  {},
);
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
state = addIntegrityScenarioSeeds(state);
report.integrityScenarios = [
  { name: "reported_court_wrong_location", ids: ["cr_reported_court_wrong_location", "r_reported_court_wrong_location"], expected: "court_request report open; admin court queue shows warning" },
  { name: "reported_court_closed", ids: ["cr_reported_court_closed", "r_reported_court_closed"], expected: "court_request report open; admin court queue shows warning" },
  { name: "reported_court_unsafe", ids: ["cr_reported_court_unsafe", "r_reported_court_unsafe", "r_reported_court_broken_hoop"], expected: "multiple users can report the same court request" },
  { name: "age_fraud_u13_to_open", ids: ["u32", "r_age_fraud_u13_to_open"], expected: "player report open; ranking unchanged until admin action" },
  { name: "age_fraud_u20_to_open", ids: ["u35", "r_age_fraud_u20_to_open"], expected: "resolved player report with disciplinary action" },
  { name: "age_verification_pending", ids: [], expected: "backend gap: no verification_status column" },
  { name: "age_verification_rejected", ids: [], expected: "backend gap: no verification_status column" },
  { name: "age_fraud_match_dispute", ids: [state.matches[2]?.id, "r_age_fraud_match_dispute"], expected: "match status disputed; final result not directly mutated" },
  { name: "admin_resolved_age_fraud", ids: ["aa_admin_resolved_age_fraud", "n_admin_resolved_age_fraud"], expected: "reporter feedback notification and audit row are present" },
  { name: "low_trust_after_confirmed_fraud", ids: ["u35", "ad_low_trust_after_confirmed_fraud"], expected: "low trust plus active suspension row" },
  { name: "blocked_user_wrong_division", ids: [], expected: "backend gap: join-time age eligibility block is not enforced yet" },
];
report.integrityGaps = [
  "approved_courts has no hidden/disabled moderation status; only court_requests can be reported with current UI/server action.",
  "reports uses type/user_id, not target_type/reporter_id.",
  "profiles has birth_year and age_group, but no claimed_birth_year, verified_birth_year, or verification_status.",
  "CreateMatch blocks the creator outside selected age groups, but recruiting join/apply does not enforce age eligibility yet.",
  "Fraud reports do not automatically change ranking; completed-match fraud is represented as a disputed match/report.",
];
assertFlow(
  state.reports.some((item) => item.id === "r_age_fraud_match_dispute") &&
    state.settings?.courtRequests?.some((item) => item.id === "cr_reported_court_wrong_location") &&
    state.settings?.adminDisciplinaryActions?.some((item) => item.id === "ad_low_trust_after_confirmed_fraud"),
  "abuse/integrity 시나리오 seed",
  {
    reports: state.reports.length,
    courtRequests: state.settings?.courtRequests?.length ?? 0,
    disciplinaryActions: state.settings?.adminDisciplinaryActions?.length ?? 0,
  },
);
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

if (!checkOnly) {
  await mkdir(outDir, { recursive: true });
  await writeFile(stateOut, JSON.stringify(state, null, 2), "utf8");
  await writeFile(reportOut, JSON.stringify(report, null, 2), "utf8");
  await writeFile(
    generatedStateOut,
    `// Generated by \`npm run seed:demo-flow\`.\nexport const demoFlowState = ${JSON.stringify(state)};\n`,
    "utf8",
  );
}

console.log(JSON.stringify({
  ok: true,
  checkOnly,
  storageKey: STORAGE_KEY,
  statePath: checkOnly ? null : stateOut.pathname,
  reportPath: checkOnly ? null : reportOut.pathname,
  generatedStatePath: checkOnly ? null : generatedStateOut.pathname,
  summary: report.summary,
  checks: report.checks.length,
}, null, 2));
