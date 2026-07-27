import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  acknowledgeMatchRoomRules,
  acknowledgeRecruitingRoomRules,
  cancelMatch,
  closeRecruitingPost,
  respondRecruitingScheduleProposal,
  updateMatchRoomRules,
  updateRecruitingRoomRules,
} from "../src/data/repository.js";
import { getRoomRemakeDraft, getRoomRemakeWarningCopy } from "../src/lib/matchCreationPolicies.js";

const COURT = {
  id: "court-room-update",
  name: "방 수정 테스트 농구장",
  region: "서울특별시 마포구",
  status: "active",
};
const PLAYER_IDS = ["host", "a2", "a3", "b1", "b2", "b3", "ra", "rb", "ref", "party-leader"];

function getKstScheduleHoursFromNow(hours) {
  const date = new Date(Date.now() + hours * 3_600_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    timingType: "scheduled",
    scheduledDate: `${parts.year}-${parts.month}-${parts.day}`,
    scheduledTime: `${parts.hour}:${parts.minute}`,
    scheduledAt: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
  };
}

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
    timingType: "scheduled",
    scheduledDate: "2099-07-25",
    scheduledTime: "20:00",
    scheduledAt: "2099-07-25 20:00",
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
  ballProvider: "venue",
  vestsProvided: true,
  attackRule: "공격권 교대",
  foulRule: "파울 즉시 중단",
  meetingPoint: "체육관 1층 출입구",
  meetBeforeMinutes: 20,
  mmrRangeMode: "normal",
  stakes: "수정 약속",
  memo: "수정 메모",
};

for (const kind of ["public-player", "public-team", "private-team"]) {
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
    assert.equal(updated.rules.ballProvider, "venue");
    assert.equal(updated.rules.vestsProvided, true);
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

test("pickup room resize validates the unified participant pool and rebalances temporary placements", () => {
  const post = {
    ...makeRecruitingPost("pickup"),
    applicants: [
      { id: "a2", playerId: "a2", kind: "player", side: "teamA", reserve: false, status: "waiting", playerIds: [] },
      { id: "a3", playerId: "a3", kind: "player", side: "teamA", reserve: true, status: "ready", playerIds: [] },
      { id: "b1", playerId: "b1", kind: "player", side: "teamB", reserve: false, status: "waiting", playerIds: [] },
      { id: "b2", playerId: "b2", kind: "player", side: "teamB", reserve: false, status: "ready", playerIds: [] },
      { id: "b3", playerId: "b3", kind: "player", side: "teamB", reserve: true, status: "ready", playerIds: [] },
    ],
    roomState: {
      ...makeRecruitingPost("pickup").roomState,
      pinnedReservePlayers: { teamA: ["a3"], teamB: ["b3"] },
    },
  };
  const beforeIds = post.applicants.map((application) => application.playerId).sort();
  const beforeStatuses = post.applicants.map((application) => application.status);

  const resized = updateRecruitingRoomRules(makeRecruitingState(post), post.id, {
    ...COMPLETE_PATCH,
    sideCapacity: 3,
    benchCapacity: 0,
  });
  const updated = resized.recruitingPosts[0];

  assert.notEqual(updated, post);
  assert.equal(updated.mode, "3v3");
  assert.equal(updated.benchCapacity, 0);
  assert.equal(updated.rules.sideCapacity, 3);
  assert.equal(updated.rules.benchCapacity, 0);
  assert.equal(updated.rules.onCourtCount, 3);
  assert.equal(updated.rules.starterCount, 3);
  assert.equal(updated.rules.teamCapacity, 3);
  assert.equal(updated.rules.participantCapacity, 6);
  assert.equal(updated.rules.waitingPlayerCapacity, 0);
  assert.deepEqual(updated.applicants.map((application) => application.playerId).sort(), beforeIds);
  assert.deepEqual(updated.applicants.map((application) => application.status), beforeStatuses);
  assert.equal(updated.applicants.some((application) => application.reserve), false);
  assert.deepEqual(updated.roomState.pinnedReservePlayers, {});
  assert.equal(updated.applicants.filter((application) => application.side === "teamA").length, 2);
  assert.equal(updated.applicants.filter((application) => application.side === "teamB").length, 3);

  const tooSmall = updateRecruitingRoomRules(makeRecruitingState(post), post.id, {
    ...COMPLETE_PATCH,
    sideCapacity: 2,
    benchCapacity: 0,
  });
  assert.equal(tooSmall.recruitingPosts[0], post);
  assert.match(tooSmall.notifications[0].body, /현재 참가자가 6명/);
});

function makeMatch({ refereeId = null } = {}) {
  return {
    id: "match-room-update",
    title: "확정 경기 방 수정",
    createdBy: "host",
    refereeId,
    refereeTrustMin: 90,
    status: "agreed",
    timingType: "scheduled",
    scheduledDate: "2099-07-25",
    scheduledTime: "20:00",
    scheduledAt: "2099-07-25 20:00",
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

test("confirmed match edit keeps roster, attendance, and participation agreements", () => {
  const match = makeMatch();
  const next = updateMatchRoomRules(makeMatchState(match), match.id, COMPLETE_PATCH);
  const updated = next.matches[0];

  assert.deepEqual(updated.teamA.players, match.teamA.players);
  assert.deepEqual(updated.teamB.players, match.teamB.players);
  assert.deepEqual(updated.reservePlayers, match.reservePlayers);
  assert.deepEqual(updated.agreements, match.agreements);
  assert.deepEqual(updated.attendance, match.attendance);
  assert.ok(updated.rules.ruleAcknowledgementRequiredIds.includes("a2"));
  assert.deepEqual(updated.rules.ruleAcknowledgedIds, ["host"]);
  assert.equal(updated.rules.periodMinutes, 9);
  assert.equal(updated.rules.timeLimit, 18);
  assert.equal(updated.rules.ballProvider, "venue");
  assert.equal(updated.rules.vestsProvided, true);
  assert.equal(updated.stakes, "수정 약속");

  assert.equal(updateMatchRoomRules(makeMatchState(match), match.id, { ...COMPLETE_PATCH, sideCapacity: 2 }).matches[0], match);
  assert.equal(updateMatchRoomRules(makeMatchState(match), match.id, { ...COMPLETE_PATCH, benchCapacity: 0 }).matches[0], match);
});

test("room changes require acknowledgement and schedule rejection keeps the old schedule", () => {
  const post = {
    ...makeRecruitingPost("public-player"),
    scheduledDate: "2099-07-25",
    scheduledTime: "20:00",
    scheduledAt: "2099-07-25 20:00",
  };
  const changed = updateRecruitingRoomRules(makeRecruitingState(post), post.id, {
    periodMinutes: 10,
  });
  const changedPost = changed.recruitingPosts[0];
  assert.ok(changedPost.roomState.ruleAcknowledgementRequiredIds.includes("a2"));
  assert.deepEqual(changedPost.roomState.ruleAcknowledgedIds, ["host"]);

  const acknowledged = acknowledgeRecruitingRoomRules(
    { ...changed, currentUserId: "a2" },
    post.id,
    changedPost.roomState.ruleRevision,
  );
  assert.ok(acknowledged.recruitingPosts[0].roomState.ruleAcknowledgedIds.includes("a2"));

  const proposed = updateRecruitingRoomRules(makeRecruitingState(post), post.id, {
    timingType: "scheduled",
    scheduledDate: "2099-07-26",
    scheduledTime: "21:00",
  });
  const proposal = proposed.recruitingPosts[0].roomState.scheduleProposal;
  assert.equal(proposal.status, "pending");
  assert.equal(proposed.recruitingPosts[0].roomState.roomEditCount, 1);
  assert.equal(proposed.recruitingPosts[0].scheduledDate, "2099-07-25");

  const rejected = respondRecruitingScheduleProposal(
    { ...proposed, currentUserId: "a2" },
    post.id,
    proposal.id,
    "reject",
  );
  assert.equal(rejected.recruitingPosts[0].roomState.scheduleProposal.status, "rejected");
  assert.equal(rejected.recruitingPosts[0].roomState.roomEditCount, 1);
  assert.equal(rejected.recruitingPosts[0].timingType, "scheduled");
  assert.equal(rejected.recruitingPosts[0].scheduledDate, "2099-07-25");
});

test("room edit can be accepted only once for recruiting and confirmed match rooms", () => {
  const post = makeRecruitingPost("public-player");
  const firstRecruitingEdit = updateRecruitingRoomRules(makeRecruitingState(post), post.id, {
    periodMinutes: 10,
  });
  assert.equal(firstRecruitingEdit.recruitingPosts[0].roomState.roomEditCount, 1);
  const secondRecruitingEdit = updateRecruitingRoomRules(firstRecruitingEdit, post.id, {
    periodMinutes: 11,
  });
  assert.equal(secondRecruitingEdit.recruitingPosts[0].rules.periodMinutes, 10);
  assert.match(secondRecruitingEdit.notifications[0].body, /한 번만/);

  const match = makeMatch();
  const firstMatchEdit = updateMatchRoomRules(makeMatchState(match), match.id, {
    periodMinutes: 10,
  });
  assert.equal(firstMatchEdit.matches[0].rules.roomEditCount, 1);
  const secondMatchEdit = updateMatchRoomRules(firstMatchEdit, match.id, {
    periodMinutes: 11,
  });
  assert.equal(secondMatchEdit.matches[0].rules.periodMinutes, 10);
  assert.match(secondMatchEdit.notifications[0].body, /한 번만/);
});

test("room cancellation locks at two hours and waives trust after a rejected edit", () => {
  const threeHours = getKstScheduleHoursFromNow(3);
  const penalizedPost = { ...makeRecruitingPost("public-player"), ...threeHours };
  const penalized = closeRecruitingPost(makeRecruitingState(penalizedPost), penalizedPost.id);
  assert.equal(penalized.recruitingPosts[0].status, "closed");
  assert.equal(penalized.users.find((user) => user.id === "host").trustScore, 95);

  const waivedPost = {
    ...makeRecruitingPost("public-player"),
    ...threeHours,
    roomState: {
      ...makeRecruitingPost("public-player").roomState,
      roomEditCount: 1,
      scheduleProposal: { id: "schedule-rejected", status: "rejected" },
    },
  };
  const waived = closeRecruitingPost(makeRecruitingState(waivedPost), waivedPost.id);
  assert.equal(waived.recruitingPosts[0].status, "closed");
  assert.equal(waived.users.find((user) => user.id === "host").trustScore, 100);

  const lockedMatch = { ...makeMatch(), ...getKstScheduleHoursFromNow(1) };
  const locked = cancelMatch(makeMatchState(lockedMatch), lockedMatch.id);
  assert.equal(locked.matches[0].status, "agreed");
  assert.match(locked.notifications[0].body, /2시간 전/);
});

test("cancelled room remake copies configuration but clears lifecycle and participant state", () => {
  const source = {
    ...makeRecruitingPost("private-team"),
    status: "closed",
    roomState: {
      ...makeRecruitingPost("private-team").roomState,
      roomEditCount: 1,
      remakeSequence: 1,
      cancelledAt: "2099-07-24T00:00:00.000Z",
      invitations: [{ id: "invite-old", targetUserId: "b1" }],
    },
  };
  const remake = getRoomRemakeDraft(source);

  assert.equal(remake.title, source.title);
  assert.equal(remake.mode, "3v3");
  assert.equal(remake.visibility, "private");
  assert.equal(remake.teamAId, "team-a");
  assert.equal(remake.teamBId, "team-b");
  assert.equal(remake.courtId, COURT.id);
  assert.equal(remake.scheduledDate, "");
  assert.equal(remake.scheduledTime, "");
  assert.deepEqual(remake.playerIds, []);
  assert.deepEqual(remake.opponentPlayerIds, []);
  assert.equal(remake.opponentLeaderId, "");
  assert.equal("roomState" in remake, false);
  assert.equal("applicants" in remake, false);
  assert.equal(remake.remakeExpectedCount, 2);
  assert.match(getRoomRemakeWarningCopy(remake.remakeExpectedCount), /연속 2회/);
  assert.match(getRoomRemakeWarningCopy(3), /신뢰도가 조정될 수 있습니다/);

  const pickupRemake = getRoomRemakeDraft(makeRecruitingPost("pickup"));
  assert.equal(pickupRemake.formationMode, "pickup");
  assert.equal(pickupRemake.hostJoinMode, "player");
  assert.equal(pickupRemake.teamAId, undefined);
  assert.equal(pickupRemake.teamBId, undefined);
});

test("match rule acknowledgement records only the current revision", () => {
  const match = makeMatch();
  const changed = updateMatchRoomRules(makeMatchState(match), match.id, { periodMinutes: 10 });
  const revision = changed.matches[0].rules.ruleRevision;
  const stale = acknowledgeMatchRoomRules({ ...changed, currentUserId: "a2" }, match.id, revision - 1);
  assert.deepEqual(stale.matches[0].rules.ruleAcknowledgedIds, ["host"]);
  const acknowledged = acknowledgeMatchRoomRules({ ...changed, currentUserId: "a2" }, match.id, revision);
  assert.ok(acknowledged.matches[0].rules.ruleAcknowledgedIds.includes("a2"));
});

test("room edit permission allows the host before check-in and blocks other participants", () => {
  const noRefereeMatch = makeMatch();
  assert.notEqual(updateMatchRoomRules(makeMatchState(noRefereeMatch, "host"), noRefereeMatch.id, COMPLETE_PATCH).matches[0], noRefereeMatch);

  const refereeMatch = makeMatch({ refereeId: "ref" });
  for (const blockedId of ["ref", "a2", "party-leader", "ra"]) {
    assert.equal(updateMatchRoomRules(makeMatchState(refereeMatch, blockedId), refereeMatch.id, COMPLETE_PATCH).matches[0], refereeMatch);
  }
});

test("server routes room edits to dedicated authoritative RPCs", () => {
  const recruitingServer = readFileSync(new URL("../server/api/recruiting/sync-post.js", import.meta.url), "utf8");
  const matchServer = readFileSync(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260724090000_room_update_authority.sql", import.meta.url), "utf8");
  const pickupResizeMigration = readFileSync(new URL("../supabase/migrations/20260724132500_pickup_room_resize.sql", import.meta.url), "utf8");
  const pickupCapacityRuleMigration = readFileSync(new URL("../supabase/migrations/20260724141500_sync_pickup_capacity_rules.sql", import.meta.url), "utf8");
  const changeApprovalMigration = readFileSync(new URL("../supabase/migrations/20260724153000_room_change_approval.sql", import.meta.url), "utf8");
  const pickupAssignmentMigration = readFileSync(new URL("../supabase/migrations/20260724153500_pickup_assignment_modes.sql", import.meta.url), "utf8");
  const pickupRerollMigration = readFileSync(new URL("../supabase/migrations/20260724160000_pickup_assignment_reroll_policy.sql", import.meta.url), "utf8");
  const pickupConfirmationGuardMigration = readFileSync(new URL("../supabase/migrations/20260725024500_guard_pickup_assignment_confirmation.sql", import.meta.url), "utf8");
  const pickupHostAnchorMigration = readFileSync(new URL("../supabase/migrations/20260728100000_anchor_pickup_host_to_team_a.sql", import.meta.url), "utf8");
  const pickupSwapConfirmationGuard = pickupConfirmationGuardMigration.match(
    /create or replace function public\.rankball_match_swap_pickup_players[\s\S]*?revoke all on function public\.rankball_match_swap_pickup_players/,
  )?.[0] ?? "";
  const roomEditOnceMigration = readFileSync(new URL("../supabase/migrations/20260724155000_room_edit_once.sql", import.meta.url), "utf8");
  const roomChangeDeadlineMigration = readFileSync(new URL("../supabase/migrations/20260724161000_room_change_deadlines.sql", import.meta.url), "utf8");
  const roomCancelPolicyMigration = readFileSync(new URL("../supabase/migrations/20260724162000_room_cancel_policy.sql", import.meta.url), "utf8");
  const cancelledScheduleMigration = readFileSync(new URL("../supabase/migrations/20260724163000_cancelled_room_schedule_feed.sql", import.meta.url), "utf8");
  const scheduledAtTypeFixMigration = readFileSync(new URL("../supabase/migrations/20260724164000_fix_room_policy_scheduled_at_types.sql", import.meta.url), "utf8");
  const roomRemakeMigration = readFileSync(new URL("../supabase/migrations/20260724170000_room_remake_tracking.sql", import.meta.url), "utf8");
  const roomRemakeGrantMigration = readFileSync(new URL("../supabase/migrations/20260725010500_fix_room_remake_service_role_grant.sql", import.meta.url), "utf8");
  const createMatchPage = readFileSync(new URL("../src/pages/CreateMatch.jsx", import.meta.url), "utf8");
  const adminUserPanel = readFileSync(new URL("../src/components/admin/UserOperationsPanel.jsx", import.meta.url), "utf8");
  const recruitingPage = readFileSync(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8");
  const matchesPage = readFileSync(new URL("../src/pages/Matches.jsx", import.meta.url), "utf8");
  const matchListServer = readFileSync(new URL("../server/api/matches/list.js", import.meta.url), "utf8");
  const recruitingListServer = readFileSync(new URL("../server/api/recruiting/list.js", import.meta.url), "utf8");

  assert.match(recruitingServer, /rankball_recruiting_room_update_action/);
  assert.match(matchServer, /rankball_match_room_update_action/);
  assert.match(migration, /recruiting_bench_capacity_below_roster/);
  assert.match(migration, /match_bench_capacity_below_roster/);
  assert.match(migration, /participantsRetained/);
  assert.match(migration, /delete from public\.match_agreements/);
  assert.match(migration, /grant execute on function public\.rankball_recruiting_room_update_action/);
  assert.match(migration, /grant execute on function public\.rankball_match_room_update_action/);
  assert.match(pickupResizeMigration, /pickup_participant_capacity_below_pool/);
  assert.match(pickupResizeMigration, /rankball_recruiting_room_update_action_pre_pickup_resize/);
  assert.match(pickupResizeMigration, /row_number\(\) over/);
  assert.match(pickupCapacityRuleMigration, /rankball_sync_pickup_capacity_rules/);
  assert.match(pickupCapacityRuleMigration, /'participantCapacity', \(new\.side_capacity \+ new\.bench_capacity\) \* 2/);
  assert.match(pickupCapacityRuleMigration, /'waitingPlayerCapacity', new\.bench_capacity \* 2/);
  assert.match(changeApprovalMigration, /rankball_recruiting_schedule_response_action/);
  assert.match(changeApprovalMigration, /rankball_match_rule_ack_action/);
  assert.match(changeApprovalMigration, /match_rule_acknowledgement_pending/);
  assert.match(pickupAssignmentMigration, /rankball_match_generate_pickup_assignment/);
  assert.match(pickupAssignmentMigration, /pickupTeamAssignmentMode/);
  assert.match(pickupRerollMigration, /pickup_reroll_limit_reached/);
  assert.match(pickupRerollMigration, /pickupRerollUserIds/);
  assert.match(pickupRerollMigration, /'ratingScale', rating_scale/);
  assert.match(pickupRerollMigration, /'chatMessages'/);
  assert.match(pickupHostAnchorMigration, /host_on_team_b/);
  assert.match(pickupHostAnchorMigration, /rankball_swap_match_side_json\(assignment_result\)/);
  assert.match(pickupHostAnchorMigration, /'hostAnchoredTo', 'teamA'/);
  assert.doesNotMatch(pickupHostAnchorMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(pickupConfirmationGuardMigration, /rules->>'sideAssignmentStatus', ''\) <> 'draft'/);
  assert.match(pickupConfirmationGuardMigration, /rules->>'sideAssignmentRevision', ''\) !~ '\^\[1-9\]\[0-9\]\*\$'/);
  assert.match(pickupConfirmationGuardMigration, /pickup_side_assignment_draft_required/);
  assert.match(pickupConfirmationGuardMigration, /grant execute on function public\.rankball_match_confirm_pickup_assignment\(text, text, text, integer\) to service_role/);
  assert.match(pickupSwapConfirmationGuard, /rules->>'sideAssignmentStatus', ''\) <> 'draft'/);
  assert.match(pickupSwapConfirmationGuard, /rules->>'sideAssignmentRevision', ''\) !~ '\^\[1-9\]\[0-9\]\*\$'/);
  assert.match(pickupSwapConfirmationGuard, /jsonb_build_object\('sideAssignmentStatus', 'draft'\)/);
  assert.match(pickupSwapConfirmationGuard, /'sideAssignmentStatus', 'draft'\s*\n\s*\);/);
  assert.match(pickupConfirmationGuardMigration, /grant execute on function public\.rankball_match_swap_pickup_players\(text, text, text, text\) to service_role/);
  assert.doesNotMatch(pickupConfirmationGuardMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(roomEditOnceMigration, /room_edit_limit_reached/);
  assert.match(roomEditOnceMigration, /'roomEditCount', 1/);
  assert.match(roomEditOnceMigration, /rankball_recruiting_room_update_action_pre_edit_once/);
  assert.match(roomEditOnceMigration, /rankball_match_room_update_action_pre_edit_once/);
  assert.match(roomChangeDeadlineMigration, /room_edit_window_closed/);
  assert.match(roomChangeDeadlineMigration, /consentDeadlineAt/);
  assert.match(roomChangeDeadlineMigration, /rankball_match_expire_room_change/);
  assert.match(roomChangeDeadlineMigration, /nullif\(current_post\.scheduled_at, ''\)::timestamptz/);
  assert.match(roomChangeDeadlineMigration, /nullif\(current_match\.scheduled_at, ''\)::timestamptz/);
  assert.match(roomCancelPolicyMigration, /room_cancel_locked/);
  assert.match(roomCancelPolicyMigration, /cancelPenaltyWaived/);
  assert.match(roomCancelPolicyMigration, /nullif\(current_post\.scheduled_at, ''\)::timestamptz/);
  assert.match(roomCancelPolicyMigration, /nullif\(current_match\.scheduled_at, ''\)::timestamptz/);
  assert.match(cancelledScheduleMigration, /user_room_feed_inactive_profile_status_idx/);
  assert.match(scheduledAtTypeFixMigration, /pg_get_functiondef/);
  assert.match(scheduledAtTypeFixMigration, /nullif\(current_post\.scheduled_at/);
  assert.match(scheduledAtTypeFixMigration, /nullif\(current_match\.scheduled_at/);
  assert.match(roomRemakeMigration, /create table if not exists public\.room_remake_events/);
  assert.match(roomRemakeMigration, /room_remake_owner_required/);
  assert.match(roomRemakeMigration, /when next_sequence >= 3 then 'review'/);
  assert.match(roomRemakeMigration, /rankball_admin_room_remake_stats/);
  assert.match(roomRemakeMigration, /room_remake_warning/);
  assert.match(roomRemakeGrantMigration, /grant select on table public\.room_remake_events[\s\S]*to service_role/);
  assert.match(recruitingPage, /참가자가 있으면 규칙 변경은 각 참가자의 확인이 필요합니다/);
  assert.match(recruitingPage, /같은 설정으로 다시 만들기/);
  assert.match(recruitingPage, /remakeSourceMatchId/);
  assert.match(createMatchPage, /getRoomRemakeWarningCopy/);
  assert.match(createMatchPage, /remakeSourceId, remakeSourceMatchId/);
  assert.match(adminUserPanel, /반복 다시 만들기 경고문 채우기/);
  assert.match(recruitingPage, /scheduleChangePending/);
  assert.match(recruitingPage, /getRoomEditDraft\(roomPost, sourceMatch\)/);
  assert.match(matchesPage, /id: "cancelled"/);
  assert.match(matchListServer, /includeCancelledSchedule/);
  assert.match(matchListServer, /const feedStatus = String\(row\?\.status/);
  assert.match(matchListServer, /\.\.\.\(feedStatus \? \{ status: feedStatus \} : \{\}\)/);
  assert.match(matchListServer, /fetchMatchFeedPage[\s\S]*?\.select\("entity_id,sort_at,relation,status"\)[\s\S]*?\.eq\("is_active", true\)/);
  assert.match(matchListServer, /fetchClosedNoticeMatchFeedPage[\s\S]*?\.select\("entity_id,sort_at,relation,status"\)[\s\S]*?\.eq\("is_active", false\)/);
  assert.match(matchListServer, /card\.closedNotice === true/);
  assert.match(recruitingListServer, /includeClosed/);
});
