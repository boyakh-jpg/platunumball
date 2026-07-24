import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  updateMatchRoomRules,
  updateRecruitingRoomRules,
} from "../src/data/repository.js";

const COURT = {
  id: "court-room-update",
  name: "방 수정 테스트 농구장",
  region: "서울특별시 마포구",
  status: "active",
};
const PLAYER_IDS = ["host", "a2", "a3", "b1", "b2", "b3", "ra", "rb", "ref", "party-leader"];

function makeUsers() {
  return PLAYER_IDS.map((id) => ({
    id,
    name: id,
    trustScore: 100,
    officialReferee: id === "ref",
    ratings: { integrated: 1200 },
  }));
}

function makePlayerApplications() {
  return [
    { id: "a2", playerId: "a2", kind: "player", side: "teamA", reserve: false, status: "waiting", playerIds: [] },
    { id: "a3", playerId: "a3", kind: "player", side: "teamA", reserve: false, status: "ready", playerIds: [] },
    { id: "b1", playerId: "b1", kind: "player", side: "teamB", reserve: false, status: "waiting", playerIds: [] },
    { id: "b2", playerId: "b2", kind: "player", side: "teamB", reserve: false, status: "ready", playerIds: [] },
    { id: "b3", playerId: "b3", kind: "player", side: "teamB", reserve: false, status: "ready", playerIds: [] },
    { id: "ra", playerId: "ra", kind: "player", side: "teamA", reserve: true, status: "waiting", playerIds: [] },
    { id: "rb", playerId: "rb", kind: "player", side: "teamB", reserve: true, status: "ready", playerIds: [] },
  ];
}

function makeRecruitingPost(kind) {
  const pickup = kind === "pickup";
  const teamRoom = kind === "public-team" || kind === "private-team";
  return {
    id: `room-${kind}`,
    title: `방 수정 ${kind}`,
    status: "open",
    visibility: kind === "private-team" ? "private" : "public",
    playerId: "host",
    ownerId: "host",
    hostSide: "teamA",
    hostJoinMode: teamRoom ? "team" : "player",
    hostReady: true,
    teamOnly: teamRoom,
    teamId: teamRoom ? "team-a" : null,
    targetTeamId: kind === "private-team" ? "team-b" : null,
    playerIds: teamRoom ? ["host", "a2", "a3"] : [],
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 2,
    ranked: !pickup,
    courtId: COURT.id,
    court: COURT.name,
    region: COURT.region,
    stakes: "기존 약속",
    memo: "기존 메모",
    rules: {
      formationMode: pickup ? "pickup" : "prearranged",
      matchIntent: pickup ? "pickup" : "standard_competitive",
      sideCapacity: 3,
      benchCapacity: 2,
      meetingPoint: "정문 안내판",
      periodCount: 1,
      periodMinutes: 12,
    },
    roomState: {
      ownerId: "host",
      teamOnly: teamRoom,
      partySides: { host: "teamA" },
      partyReserves: teamRoom ? { host: ["ra"] } : {},
      mmrRangeMode: "narrow",
      ruleRevision: 1,
    },
    applicants: teamRoom
      ? [
          {
            id: "team-b-entry",
            playerId: "b1",
            playerIds: ["b1", "b2", "b3"],
            kind: "team",
            joinMode: "team",
            teamId: "team-b",
            side: "teamB",
            reserve: false,
            status: "waiting",
          },
          { id: "rb", playerId: "rb", kind: "player", side: "teamB", reserve: true, status: "ready", playerIds: [] },
        ]
      : makePlayerApplications(),
  };
}

function makeRecruitingState(post) {
  return {
    currentUserId: "host",
    users: makeUsers(),
    teams: [
      { id: "team-a", name: "A팀", members: ["host", "a2", "a3", "ra"].map((userId) => ({ userId })) },
      { id: "team-b", name: "B팀", members: ["b1", "b2", "b3", "rb"].map((userId) => ({ userId })) },
    ],
    settings: { approvedCourts: [COURT] },
    recruitingPosts: [post],
    matches: [],
    notifications: [],
  };
}

const COMPLETE_PATCH = {
  courtId: COURT.id,
  court: COURT.name,
  sideCapacity: 3,
  benchCapacity: 2,
  endCondition: "target_or_time",
  targetScore: 25,
  periodCount: 2,
  periodMinutes: 9,
  periodBreakMinutes: 3,
  halftimeMinutes: 6,
  overtimeMinutes: 4,
  clockMode: "running",
  lastPeriodStopMinutes: 1,
  winByTwo: true,
  ball: "7호 공",
  attackRule: "공격권 교대",
  foulRule: "파울 즉시 중단",
  meetingPoint: "체육관 1층 출입구",
  meetBeforeMinutes: 20,
  mmrRangeMode: "normal",
  stakes: "수정 약속",
  memo: "수정 메모",
};

for (const kind of ["public-player", "public-team", "private-team", "pickup"]) {
  test(`${kind} recruiting room keeps occupied active and reserve slots while editing`, () => {
    const post = makeRecruitingPost(kind);
    const beforeStatuses = post.applicants.map((application) => application.status);
    const next = updateRecruitingRoomRules(makeRecruitingState(post), post.id, COMPLETE_PATCH);
    const updated = next.recruitingPosts[0];

    assert.equal(updated.mode, "3v3");
    assert.equal(updated.sideCapacity, 3);
    assert.equal(updated.benchCapacity, 2);
    assert.equal(updated.rules.periodCount, 2);
    assert.equal(updated.rules.periodMinutes, 9);
    assert.equal(updated.rules.timeLimit, 18);
    assert.equal(updated.rules.meetingPoint, "체육관 1층 출입구");
    assert.equal(updated.stakes, "수정 약속");
    assert.equal(updated.memo, "수정 메모");
    assert.deepEqual(updated.applicants.map((application) => application.status), beforeStatuses);

    const activeShrink = updateRecruitingRoomRules(makeRecruitingState(post), post.id, {
      ...COMPLETE_PATCH,
      sideCapacity: 2,
    });
    assert.equal(activeShrink.recruitingPosts[0], post);

    const benchShrink = updateRecruitingRoomRules(makeRecruitingState(post), post.id, {
      ...COMPLETE_PATCH,
      benchCapacity: 0,
    });
    assert.equal(benchShrink.recruitingPosts[0], post);
  });
}

function makeMatch({ refereeId = null } = {}) {
  return {
    id: "match-room-update",
    title: "확정 경기 방 수정",
    createdBy: "host",
    refereeId,
    refereeTrustMin: 90,
    status: "agreed",
    timingType: "instant",
    mode: "3v3",
    courtId: COURT.id,
    court: COURT.name,
    teamA: { teamId: "team-a", players: ["host", "a2", "a3"], playerTeams: {} },
    teamB: { teamId: "team-b", players: ["b1", "b2", "b3"], playerTeams: {} },
    reservePlayers: { teamA: ["ra"], teamB: ["rb"] },
    agreements: { teamA: ["host", "a2", "a3", "ra"], teamB: ["b1", "b2", "b3", "rb"] },
    attendance: { teamA: ["host", "a2", "a3", "ra"], teamB: ["b1", "b2", "b3", "rb"] },
    rules: {
      sideCapacity: 3,
      benchCapacity: 2,
      meetingPoint: "정문 안내판",
      periodCount: 1,
      periodMinutes: 12,
    },
    memo: "기존 메모",
    stakes: "기존 약속",
  };
}

function makeMatchState(match, currentUserId = "host") {
  return {
    currentUserId,
    users: makeUsers(),
    teams: [
      { id: "team-a", name: "A팀", members: [{ userId: "host", role: "captain" }, { userId: "a2" }, { userId: "a3" }, { userId: "ra" }] },
      { id: "team-b", name: "B팀", members: [{ userId: "party-leader", role: "captain" }, { userId: "b1" }, { userId: "b2" }, { userId: "b3" }, { userId: "rb" }] },
    ],
    settings: { approvedCourts: [COURT], refereeAppointments: [] },
    recruitingPosts: [],
    matches: [match],
    notifications: [],
  };
}

test("confirmed match edit keeps occupied rosters and resets only pregame agreement state", () => {
  const match = makeMatch();
  const next = updateMatchRoomRules(makeMatchState(match), match.id, COMPLETE_PATCH);
  const updated = next.matches[0];

  assert.deepEqual(updated.teamA.players, match.teamA.players);
  assert.deepEqual(updated.teamB.players, match.teamB.players);
  assert.deepEqual(updated.reservePlayers, match.reservePlayers);
  assert.deepEqual(updated.agreements, { teamA: [], teamB: [] });
  assert.deepEqual(updated.attendance, { teamA: [], teamB: [] });
  assert.equal(updated.rules.periodMinutes, 9);
  assert.equal(updated.rules.timeLimit, 18);
  assert.equal(updated.stakes, "수정 약속");

  assert.equal(updateMatchRoomRules(makeMatchState(match), match.id, { ...COMPLETE_PATCH, sideCapacity: 2 }).matches[0], match);
  assert.equal(updateMatchRoomRules(makeMatchState(match), match.id, { ...COMPLETE_PATCH, benchCapacity: 0 }).matches[0], match);
});

test("room edit permission allows host and check-in referee but blocks player, party leader, and reserve", () => {
  const noRefereeMatch = makeMatch();
  assert.notEqual(updateMatchRoomRules(makeMatchState(noRefereeMatch, "host"), noRefereeMatch.id, COMPLETE_PATCH).matches[0], noRefereeMatch);

  const refereeMatch = makeMatch({ refereeId: "ref" });
  assert.notEqual(updateMatchRoomRules(makeMatchState(refereeMatch, "ref"), refereeMatch.id, COMPLETE_PATCH).matches[0], refereeMatch);
  for (const blockedId of ["a2", "party-leader", "ra"]) {
    assert.equal(updateMatchRoomRules(makeMatchState(refereeMatch, blockedId), refereeMatch.id, COMPLETE_PATCH).matches[0], refereeMatch);
  }
});

test("server routes room edits to dedicated authoritative RPCs", () => {
  const recruitingServer = readFileSync(new URL("../server/api/recruiting/sync-post.js", import.meta.url), "utf8");
  const matchServer = readFileSync(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260724090000_room_update_authority.sql", import.meta.url), "utf8");
  const recruitingPage = readFileSync(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8");

  assert.match(recruitingServer, /rankball_recruiting_room_update_action/);
  assert.match(matchServer, /rankball_match_room_update_action/);
  assert.match(migration, /recruiting_bench_capacity_below_roster/);
  assert.match(migration, /match_bench_capacity_below_roster/);
  assert.match(migration, /participantsRetained/);
  assert.match(migration, /delete from public\.match_agreements/);
  assert.match(migration, /grant execute on function public\.rankball_recruiting_room_update_action/);
  assert.match(migration, /grant execute on function public\.rankball_match_room_update_action/);
  assert.match(recruitingPage, /현재 참가 슬롯은 그대로 유지됩니다/);
  assert.match(recruitingPage, /roomEditStatus\.pending \? "저장 중"/);
});
