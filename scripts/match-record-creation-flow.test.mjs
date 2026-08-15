import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approveMatch,
  cancelMatch,
  createMatch,
  finalizeMatchByAuthority,
  runAutomaticStateMaintenance,
  setMatchRecordParticipants,
  setMatchRecordTeamRoster,
  submitMatchResult,
} from "../src/data/repository.js";
import { getMatchBenchPolicyError, validateMatchCreateCourt } from "../server/api/matches/sync-match.js";
import { getSqlMatchReloadPredicate } from "../server/lib/matchSqlActions.js";
import { getModeClockPreset } from "../src/lib/matchCreationPolicies.js";
import {
  doMatchTimeRangesOverlap,
  getActualMatchPlayerIds,
  getMatchCancelCopy,
  getMatchOverlapConflict,
  getMatchRecordCompositionLabel,
  getMatchRecordEndedAt,
  getMatchRecordSetupStatus,
  normalizeActualMatchTimeRange,
} from "../src/lib/matchUtils.js";
import { isMatchRecordParticipantSetupRequired } from "../src/lib/roomFlow.js";

const matchListSource = readFileSync(new URL("../server/api/matches/_listQueries.js", import.meta.url), "utf8");
const batchScoreAndReserveMigration = readFileSync(
  new URL("../supabase/migrations/20260729170000_match_record_batch_score_and_reserves.sql", import.meta.url),
  "utf8",
);

const recordDate = new Date(Date.now() - 60_000);
const recordParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).formatToParts(recordDate).map((part) => [part.type, part.value]));
const scheduledDate = `${recordParts.year}-${recordParts.month}-${recordParts.day}`;
const scheduledTime = `${recordParts.hour}:${recordParts.minute}`;

test("match record roster reload waits for the exact saved active and reserve roster", () => {
  const predicate = getSqlMatchReloadPredicate({
    action: "setMatchRecordTeamRoster",
    sideName: "teamA",
    roster: {
      playerIds: ["u1", "u2", "u3"],
      reservePlayerIds: ["u4"],
    },
  });
  assert.equal(predicate({
    teamA: { players: ["u1", "u2", "u3"] },
    reservePlayers: { teamA: ["u4"] },
    rules: { rosterReady: { teamA: true } },
  }), true);
  assert.equal(predicate({
    teamA: { players: ["u1", "u2", "u3"] },
    reservePlayers: { teamA: ["u4", "u5"] },
    rules: { rosterReady: { teamA: true } },
  }), false);
});

function getKstScheduleAt(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    scheduledDate: `${parts.year}-${parts.month}-${parts.day}`,
    scheduledTime: `${parts.hour}:${parts.minute}`,
  };
}

const users = Array.from({ length: 6 }, (_, index) => ({
  id: `u${index + 1}`,
  name: `선수${index + 1}`,
  anonymous: false,
  trustScore: 100,
  ratings: { integrated: 1200, "3v3": 1200 },
}));

const teams = [
  {
    id: "team-a",
    name: "A팀",
    mmr: 1200,
    members: users.slice(0, 3).map((user, index) => ({ userId: user.id, role: index === 0 ? "captain" : "member" })),
  },
  {
    id: "team-b",
    name: "B팀",
    mmr: 1200,
    members: users.slice(3, 6).map((user, index) => ({ userId: user.id, role: index === 0 ? "captain" : "member" })),
  },
];

function makeState() {
  return {
    currentUserId: "u1",
    users,
    teams,
    matches: [],
    notifications: [],
    affiliations: [],
    settings: {},
    approvedCourts: [],
    courts: [],
  };
}

function makeRecordDraft(composition) {
  return {
    id: `record-${composition}`,
    title: `${composition} 경기 기록`,
    recordType: "match_record",
    recordComposition: composition,
    visibility: "private",
    mode: "3v3",
    scheduledDate,
    scheduledTime,
    courtId: "",
    court: "",
  };
}

function setPostgameScore(state, matchId, targetScoreA, targetScoreB) {
  return submitMatchResult(
    { ...state, currentUserId: "u1" },
    matchId,
    { scoreA: targetScoreA, scoreB: targetScoreB, playerStats: {} },
  );
}

function approveAllMatchRecordParticipants(state, matchId, excludedIds = []) {
  const excluded = new Set(excludedIds);
  let nextState = state;
  for (const sideName of ["teamA", "teamB"]) {
    const match = nextState.matches.find((item) => item.id === matchId);
    for (const playerId of match.rules.recordApproverIds[sideName]) {
      if (excluded.has(playerId)) continue;
      nextState = approveMatch(
        { ...nextState, currentUserId: playerId },
        matchId,
        sideName,
        playerId,
      );
    }
  }
  return nextState;
}

test("postgame records allow an unknown court while normal matches still require one", () => {
  assert.doesNotThrow(() => validateMatchCreateCourt({ rules: { recordType: "match_record" } }));
  assert.doesNotThrow(() => validateMatchCreateCourt({ rules: { recordType: "solo" } }));
  assert.throws(() => validateMatchCreateCourt({ rules: { recordType: "match" } }), /missing_match_court/);
});

test("match and personal records preserve canonical match rules", () => {
  const threeOnThreePreset = getModeClockPreset("3v3", "score21");
  const threeOnThree = createMatch(makeState(), {
    ...makeRecordDraft("individual"),
    ...threeOnThreePreset,
  });
  const match3 = threeOnThree.matches[0];
  assert.equal(match3.rules.ruleSet, "fiba_3x3");
  assert.equal(match3.rules.periodCount, 1);
  assert.equal(match3.rules.periodMinutes, 10);

  const fiveOnFive = createMatch(makeState(), {
    ...makeRecordDraft("individual"),
    id: "record-5v5",
    mode: "5v5",
  });
  const match5 = fiveOnFive.matches[0];
  assert.equal(match5.rules.ruleSet, "standard");
  assert.equal(match5.rules.periodCount, 4);
  assert.equal(match5.rules.periodMinutes, 10);

  const personal = createMatch(makeState(), {
    ...makeRecordDraft("individual"),
    id: "personal-3x3",
    recordType: "solo",
    recordEntryMode: "quick",
    soloScoreFor: 21,
    soloScoreAgainst: 18,
    ...threeOnThreePreset,
  });
  const personalMatch = personal.matches[0];
  assert.equal(personalMatch.rules.ruleSet, "fiba_3x3");
  assert.equal(personalMatch.rules.periodCount, 1);
  assert.equal(personalMatch.rules.periodMinutes, 10);
});

test("match-record roster policy errors return client-safe status codes", () => {
  assert.deepEqual(getMatchBenchPolicyError({ message: "match_record_reserve_capacity_exceeded" }), {
    statusCode: 400,
    message: "match_record_reserve_capacity_exceeded",
  });
  assert.deepEqual(getMatchBenchPolicyError({ message: "match_record_roster_exact_capacity_required" }), {
    statusCode: 400,
    message: "match_record_roster_invalid",
  });
  assert.deepEqual(getMatchBenchPolicyError({ message: "match_room_edit_locked" }), {
    statusCode: 409,
    message: "match_room_edit_locked",
  });
});

test("personal and shared records reject future and over-24-hour end times", () => {
  const future = getKstScheduleAt(new Date(Date.now() + 60 * 60 * 1000));
  const expired = getKstScheduleAt(new Date(Date.now() - 25 * 60 * 60 * 1000));
  const futureShared = createMatch(makeState(), { ...makeRecordDraft("individual"), ...future });
  const expiredPersonal = createMatch(makeState(), {
    ...makeRecordDraft("individual"),
    ...expired,
    id: "personal-expired",
    recordType: "solo",
    recordEntryMode: "quick",
    soloScoreFor: 11,
    soloScoreAgainst: 8,
  });

  assert.equal(futureShared.matches.length, 0);
  assert.match(futureShared.notifications[0].body, /끝난 뒤/);
  assert.equal(expiredPersonal.matches.length, 0);
  assert.match(expiredPersonal.notifications[0].body, /24시간/);
});

test("individual match record is empty at creation and requires exact A/B participants in the room", () => {
  const created = createMatch(makeState(), makeRecordDraft("individual"));
  const match = created.matches[0];
  assert.deepEqual(match.teamA.players, ["u1"]);
  assert.deepEqual(match.teamB.players, []);
  assert.equal(match.rules.recordSetupReady, false);
  assert.deepEqual(match.rules.recordApproverIds, { teamA: [], teamB: [] });

  const incomplete = setMatchRecordParticipants(created, match.id, {
    composition: "individual",
    teamAPlayerIds: ["u1", "u2", "u3"],
    teamBPlayerIds: ["u4", "u5"],
  });
  assert.equal(incomplete, created);

  const configured = setMatchRecordParticipants(created, match.id, {
    composition: "individual",
    teamAPlayerIds: ["u1", "u2", "u3"],
    teamBPlayerIds: ["u4", "u5", "u6"],
  });
  const configuredMatch = configured.matches[0];
  assert.equal(configuredMatch.rules.recordSetupReady, true);
  assert.deepEqual(configuredMatch.rules.recordApproverIds.teamA, ["u1", "u2", "u3"]);
  assert.deepEqual(configuredMatch.rules.recordApproverIds.teamB, ["u4", "u5", "u6"]);
  assert.deepEqual(configuredMatch.reservePlayers, { teamA: [], teamB: [] });
  assert.equal(getMatchRecordCompositionLabel(configuredMatch), "개인 구성");
  assert.deepEqual(getMatchRecordSetupStatus(configuredMatch), { stage: "complete", label: "참가자 확정", tone: "green" });
});

test("only the host can configure participants and duplicate or unknown players cannot fill a side", () => {
  const created = createMatch(makeState(), makeRecordDraft("individual"));
  const match = created.matches[0];
  const validSetup = {
    composition: "individual",
    teamAPlayerIds: ["u1", "u2", "u3"],
    teamBPlayerIds: ["u4", "u5", "u6"],
  };

  const nonHost = setMatchRecordParticipants({ ...created, currentUserId: "u2" }, match.id, validSetup);
  assert.equal(nonHost.matches[0], match);

  const duplicate = setMatchRecordParticipants(created, match.id, {
    ...validSetup,
    teamBPlayerIds: ["u3", "u4", "u5"],
  });
  assert.equal(duplicate.matches[0], match);

  const unknown = setMatchRecordParticipants(created, match.id, {
    ...validSetup,
    teamBPlayerIds: ["u4", "u5", "missing-user"],
  });
  assert.equal(unknown.matches[0], match);
});

test("match record rejects mixed composition at creation and setup", () => {
  const rejected = createMatch(makeState(), makeRecordDraft("mixed"));
  assert.equal(rejected.matches.length, 0);
  assert.match(rejected.notifications[0].body, /구성 방식/);

  const created = createMatch(makeState(), makeRecordDraft("individual"));
  const unchanged = setMatchRecordParticipants(created, created.matches[0].id, {
    composition: "mixed",
    teamAPlayerIds: ["u1", "u2", "u3"],
    teamBPlayerIds: ["u4", "u5", "u6"],
  });
  assert.equal(unchanged, created);
});

test("team match record selects teams first, then each captain fixes an exact roster", () => {
  const created = createMatch(makeState(), makeRecordDraft("team"));
  const match = created.matches[0];
  assert.equal(isMatchRecordParticipantSetupRequired(match), true);
  const selected = setMatchRecordParticipants(created, match.id, {
    composition: "team",
    teamAId: "team-a",
    teamBId: "team-b",
  });
  let configured = selected.matches[0];
  assert.equal(isMatchRecordParticipantSetupRequired(configured), false);
  assert.deepEqual(configured.teamA.players, ["u1"]);
  assert.deepEqual(configured.teamB.players, ["u4"]);
  assert.deepEqual(configured.rules.recordApproverIds, { teamA: [], teamB: [] });
  assert.equal(configured.rules.recordSetupReady, false);
  assert.equal(getMatchRecordCompositionLabel(configured), "팀 구성");
  assert.deepEqual(getMatchRecordSetupStatus(configured), { stage: "rosters", label: "명단 확정 대기", tone: "orange" });

  const regularMemberAttempt = setMatchRecordTeamRoster({ ...selected, currentUserId: "u2" }, match.id, "teamA", {
    playerIds: ["u1", "u2", "u3"],
    reservePlayerIds: [],
  });
  assert.equal(regularMemberAttempt.matches[0], configured);

  const captainMissingAttempt = setMatchRecordTeamRoster(selected, match.id, "teamA", {
    playerIds: ["u2", "u3", "u2"],
    reservePlayerIds: [],
  });
  assert.equal(captainMissingAttempt.matches[0], configured);

  const afterA = setMatchRecordTeamRoster(selected, match.id, "teamA", {
    playerIds: ["u1", "u2", "u3"],
    reservePlayerIds: [],
  });
  assert.equal(afterA.matches[0].rules.rosterReady.teamA, true);
  assert.equal(afterA.matches[0].rules.recordSetupReady, false);
  assert.deepEqual(afterA.matches[0].rules.recordApproverIds.teamA, ["u1", "u2", "u3"]);
  assert.deepEqual(getMatchRecordSetupStatus(afterA.matches[0]), { stage: "rosters", label: "1/2팀 명단 확정", tone: "orange" });

  const afterB = setMatchRecordTeamRoster({ ...afterA, currentUserId: "u4" }, match.id, "teamB", {
    playerIds: ["u4", "u5", "u6"],
    reservePlayerIds: [],
  });
  configured = afterB.matches[0];
  assert.equal(configured.rules.recordSetupReady, true);
  assert.deepEqual(configured.playedPlayerIds, {
    teamA: ["u1", "u2", "u3"],
    teamB: ["u4", "u5", "u6"],
  });
  assert.deepEqual(configured.rules.recordApprovalMode, { teamA: "all", teamB: "all" });
  assert.deepEqual(configured.rules.recordApproverIds, {
    teamA: ["u1", "u2", "u3"],
    teamB: ["u4", "u5", "u6"],
  });
  assert.deepEqual(configured.reservePlayers, { teamA: [], teamB: [] });
  assert.deepEqual(getMatchRecordSetupStatus(configured), { stage: "complete", label: "명단 확정 완료", tone: "green" });

  const scoreState = setPostgameScore(afterB, match.id, 21, 12);
  assert.equal(scoreState.matches[0].status, "approval");
  assert.deepEqual(scoreState.matches[0].result.playerStats, {});

  const proxyAttempt = approveMatch(
    { ...scoreState, currentUserId: "u1" },
    match.id,
    "teamB",
    "u4",
  );
  assert.equal(proxyAttempt.matches[0], scoreState.matches[0]);
  assert.equal(
    finalizeMatchByAuthority({ ...scoreState, currentUserId: "u1" }, match.id).matches[0],
    scoreState.matches[0],
  );

  const participantApproval = approveMatch(
    { ...scoreState, currentUserId: "u4" },
    match.id,
    "teamB",
    "u4",
  );
  assert.deepEqual(participantApproval.matches[0].approvals.teamB, ["u4"]);
  assert.deepEqual(participantApproval.matches[0].rules.participantAcceptedIds, ["u4"]);

  const thresholdState = approveAllMatchRecordParticipants(participantApproval, match.id, ["u4", "u5", "u6"]);
  assert.equal(thresholdState.matches[0].status, "approval");
  assert.deepEqual(
    [...thresholdState.matches[0].rules.participantAcceptedIds].sort(),
    ["u1", "u2", "u3", "u4"],
  );
  const submittedAtMs = Date.parse(thresholdState.matches[0].result.submittedAt);
  const confirmedState = runAutomaticStateMaintenance(
    thresholdState,
    new Date(submittedAtMs + 24 * 60 * 60 * 1000),
  );
  assert.equal(confirmedState.matches[0].status, "confirmed");
  assert.deepEqual(
    [...confirmedState.matches[0].rules.participantAcceptedIds].sort(),
    ["u1", "u2", "u3", "u4"],
  );
  assert.deepEqual(confirmedState.matches[0].mmrExcludedPlayerIds.sort(), ["u5", "u6"]);
  assert.equal(confirmedState.matches[0].rules.teamRatingDisabled, true);
});

test("team match record keeps reserves outside approval and MMR participants", () => {
  const reserveUser = {
    id: "u7",
    name: "후보선수",
    anonymous: false,
    trustScore: 100,
    ratings: { integrated: 1200, "3v3": 1200 },
  };
  const reserveState = {
    ...makeState(),
    users: [...users, reserveUser],
    teams: teams.map((team) => (
      team.id === "team-a"
        ? { ...team, members: [...team.members, { userId: reserveUser.id, role: "member" }] }
        : team
    )),
  };
  const created = createMatch(reserveState, makeRecordDraft("team"));
  const matchId = created.matches[0].id;
  const selected = setMatchRecordParticipants(created, matchId, {
    composition: "team",
    teamAId: "team-a",
    teamBId: "team-b",
  });
  const configured = setMatchRecordTeamRoster(selected, matchId, "teamA", {
    playerIds: ["u1", "u2", "u3"],
    reservePlayerIds: ["u7"],
  });
  const match = configured.matches[0];

  assert.deepEqual(match.reservePlayers.teamA, ["u7"]);
  assert.deepEqual(match.rules.recordApproverIds.teamA, ["u1", "u2", "u3"]);
  assert.ok(!getActualMatchPlayerIds(match).includes("u7"));
  assert.match(batchScoreAndReserveMigration, /requested_reserve_count > 3/);
  assert.match(batchScoreAndReserveMigration, /jsonb_build_object\(safe_side, requested_active\)/);
  assert.match(batchScoreAndReserveMigration, /jsonb_build_object\(safe_side, requested_reserve\)/);
  assert.match(batchScoreAndReserveMigration, /match_record_host_required/);
  assert.doesNotMatch(
    batchScoreAndReserveMigration,
    /drop\s+table|truncate\s+table|delete\s+from\s+public\.(?:matches|match_approvals)/i,
  );
});

test("match-record cancellation uses record terminology while scheduled matches keep match terminology", () => {
  const created = createMatch(makeState(), makeRecordDraft("individual"));
  const match = created.matches[0];
  const cancelled = cancelMatch(created, match.id, "잘못 만든 기록이라 취소합니다.");

  assert.equal(cancelled.matches[0].status, "cancelled");
  assert.equal(cancelled.notifications[0].title, "기록 취소");
  assert.match(cancelled.notifications[0].body, /기록이 취소됐습니다/);
  assert.equal(getMatchCancelCopy(match).actionLabel, "기록 취소");
  assert.equal(getMatchCancelCopy({ title: "예정 경기", rules: { recordType: "match" } }).actionLabel, "경기 취소");
});

test("individual match record requires each actual participant to confirm their own participation and result", () => {
  const created = createMatch(makeState(), makeRecordDraft("individual"));
  const matchId = created.matches[0].id;
  let state = setMatchRecordParticipants(created, matchId, {
    composition: "individual",
    teamAPlayerIds: ["u1", "u2", "u3"],
    teamBPlayerIds: ["u4", "u5", "u6"],
  });
  state = setPostgameScore(state, matchId, 21, 12);

  const submitted = state.matches.find((match) => match.id === matchId);
  assert.equal(submitted.status, "approval");
  assert.deepEqual(submitted.result.playerStats, {});

  const nonHostAttempt = finalizeMatchByAuthority({ ...state, currentUserId: "u2" }, matchId);
  assert.equal(nonHostAttempt.matches[0], state.matches[0]);

  const hostAttempt = finalizeMatchByAuthority({ ...state, currentUserId: "u1" }, matchId);
  assert.equal(hostAttempt.matches[0], state.matches[0]);

  const proxyAttempt = approveMatch(
    { ...state, currentUserId: "u1" },
    matchId,
    "teamB",
    "u4",
  );
  assert.equal(proxyAttempt.matches[0], state.matches[0]);

  state = approveAllMatchRecordParticipants(state, matchId, ["u5", "u6"]);
  assert.equal(state.matches.find((match) => match.id === matchId).status, "approval");
  const submittedAtMs = Date.parse(state.matches.find((match) => match.id === matchId).result.submittedAt);
  state = runAutomaticStateMaintenance(state, new Date(submittedAtMs + 24 * 60 * 60 * 1000));
  const confirmed = state.matches.find((match) => match.id === matchId);
  assert.equal(confirmed.status, "confirmed");
  assert.ok(confirmed.confirmedAt);
  assert.deepEqual(
    [...confirmed.rules.participantAcceptedIds].sort(),
    ["u1", "u2", "u3", "u4"],
  );
  assert.strictEqual(
    approveMatch(state, matchId, "teamA", "u1"),
    state,
  );
});

test("personal quick record ignores stale names and creates no approval room", () => {
  const recorded = createMatch(makeState(), {
    id: "personal-quick",
    title: "빠른 내 기록",
    recordType: "solo",
    recordEntryMode: "quick",
    mode: "3v3",
    scheduledDate,
    scheduledTime,
    soloScoreFor: 11,
    soloScoreAgainst: 8,
    soloTeamAPlayersText: "선수2",
    soloTeamBPlayersText: "선수4",
  });
  const match = recorded.matches[0];
  assert.equal(match.status, "confirmed");
  assert.deepEqual(match.teamA.players, ["u1"]);
  assert.deepEqual(match.teamB.players, []);
  assert.equal(match.playedPlayerIds.teamA.length, 3);
  assert.equal(match.playedPlayerIds.teamB.length, 3);
  assert.equal(Object.keys(match.anonymousPlayers).length, 5);
  assert.equal(match.rules.recordEntryMode, "quick");
  assert.equal(match.visibility, "private");
  assert.equal(match.rules.visibility, "private");
  assert.equal(match.rules.recordSummary.teamAPlayers.length, 3);
  assert.equal(match.rules.recordSummary.teamBPlayers.length, 3);
  assert.equal(match.rules.recordSummary.teamAPlayers[0], "선수1");

  const publicRecord = createMatch(makeState(), {
    id: "personal-public",
    title: "공개 내 기록",
    recordType: "solo",
    recordEntryMode: "quick",
    visibility: "public",
    mode: "1v1",
    scheduledDate,
    scheduledTime,
    soloScoreFor: 9,
    soloScoreAgainst: 7,
  }).matches[0];
  assert.equal(publicRecord.visibility, "public");
  assert.equal(publicRecord.rules.visibility, "public");
});

test("play list keeps match_record participants without reviving recorder authority", () => {
  assert.match(
    matchListSource,
    /fetchPlayMatchPage[\s\S]*from\("user_room_feed"\)[\s\S]*\.in\("status", \["agreed", "approval", "disputed"\]\)[\s\S]*\.range\(0, rowLimit - 1\)/u,
  );
  assert.match(matchListSource, /if \(!isMissingUserRoomFeed\(error\)\) throw error;[\s\S]*fetchCurrentUserMatchCandidateIds/u);
  assert.doesNotMatch(matchListSource, /rankball_recorder_match_list/u);
});

test("match_record 시간은 시작 기준 30분이며 자정 경계를 다음 날로 넘긴다", () => {
  const startedAt = "2026-07-28T14:50:00.000Z";
  assert.equal(getMatchRecordEndedAt(startedAt)?.toISOString(), "2026-07-28T15:20:00.000Z");
  assert.deepEqual(
    normalizeActualMatchTimeRange({
      rules: { recordType: "match_record" },
      startedAt,
      endedAt: "2026-07-28T23:59:59.000Z",
    }),
    {
      startedAt: new Date(startedAt),
      endedAt: new Date("2026-07-28T15:20:00.000Z"),
    },
  );
  assert.equal(
    getMatchRecordEndedAt("2026-07-28T14:50:00.000Z")?.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
    "2026-07-29",
  );
});

test("과거 match_record의 시작 누락은 조회와 중복 검사에서만 종료 30분 전으로 추정한다", () => {
  const legacy = {
    rules: { recordType: "match_record" },
    endedAt: "2026-07-28T12:30:00.000Z",
  };
  const range = normalizeActualMatchTimeRange(legacy);
  assert.equal(range?.startedAt.toISOString(), "2026-07-28T12:00:00.000Z");
  assert.equal(range?.endedAt.toISOString(), "2026-07-28T12:30:00.000Z");
  assert.equal(legacy.startedAt, undefined);
});

test("선수별 구간 중복은 엄격한 반개구간으로 판정한다", () => {
  const base = {
    id: "base",
    status: "confirmed",
    startedAt: "2026-07-28T10:00:00.000Z",
    endedAt: "2026-07-28T10:30:00.000Z",
    teamA: { players: ["u1"] },
    teamB: { players: ["u2"] },
    reservePlayers: { teamA: ["u3"], teamB: [] },
  };
  const touching = {
    ...base,
    id: "touching",
    startedAt: "2026-07-28T10:30:00.000Z",
    endedAt: "2026-07-28T11:00:00.000Z",
  };
  const overlapping = {
    ...base,
    id: "overlapping",
    startedAt: "2026-07-28T10:29:59.000Z",
    endedAt: "2026-07-28T11:00:00.000Z",
  };
  assert.equal(doMatchTimeRangesOverlap(base, touching), false);
  assert.equal(doMatchTimeRangesOverlap(base, overlapping), true);
  assert.deepEqual(getActualMatchPlayerIds(base), ["u1", "u2"]);
  assert.equal(getMatchOverlapConflict(touching, [base]), null);
  assert.equal(getMatchOverlapConflict(overlapping, [base])?.id, "base");
});

test("다른 출전선수·후보 전용·취소·무효·personal_record는 공식 중복을 만들지 않는다", () => {
  const candidate = {
    id: "candidate",
    status: "agreed",
    startedAt: "2026-07-28T10:00:00.000Z",
    endedAt: "2026-07-28T10:30:00.000Z",
    teamA: { players: ["u1"] },
    teamB: { players: ["u2"] },
  };
  const sameTime = {
    ...candidate,
    id: "other",
    teamA: { players: ["u4"] },
    teamB: { players: ["u5"] },
  };
  const reserveOnly = {
    ...sameTime,
    id: "reserve-only",
    teamA: { players: ["u4"] },
    reservePlayers: { teamA: ["u1"], teamB: [] },
  };
  const cancelled = { ...candidate, id: "cancelled", status: "cancelled" };
  const voided = { ...candidate, id: "voided", status: "void" };
  const personal = { ...candidate, id: "personal", rules: { recordType: "solo" } };
  assert.equal(getMatchOverlapConflict(candidate, [sameTime, reserveOnly, cancelled, voided, personal]), null);
});

test("live 경기와 match_record의 동일 실제 출전선수 중복만 차단한다", () => {
  const live = {
    id: "live",
    status: "confirmed",
    startedAt: "2026-07-28T10:10:00.000Z",
    endedAt: "2026-07-28T10:40:00.000Z",
    playedPlayerIds: { teamA: ["u1"], teamB: ["u2"] },
    teamA: { players: [] },
    teamB: { players: [] },
  };
  const record = {
    id: "record",
    status: "agreed",
    rules: { recordType: "match_record" },
    startedAt: "2026-07-28T10:00:00.000Z",
    endedAt: "2026-07-28T10:30:00.000Z",
    playedPlayerIds: { teamA: ["u1"], teamB: ["u3"] },
    teamA: { players: [] },
    teamB: { players: [] },
  };
  assert.equal(getMatchOverlapConflict(record, [live])?.id, "live");
});
