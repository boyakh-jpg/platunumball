import {
  DISPUTE_WINDOW_MINUTES,
  REFEREE_TRUST_MIN,
  STAT_ENTRY_WINDOW_MINUTES,
} from "../constants.js";
import {
  DEMO_PRACTICE_COURT,
  DEMO_QUEUE_TIMES,
  DEMO_TODAY,
  getDemoModeSize,
  makeDefaultRoomState,
  makeDemoApplicant,
  makeDemoTimestamp,
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

import { cycle, padNumber } from "./matchGenerators.js";


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

export function buildDemoRecruitingRooms(teams, users) {
  return Array.from({ length: 100 }, (_item, index) => makeRecruitingRoomPost(index, teams, users));
}
