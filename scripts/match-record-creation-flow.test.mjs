import test from "node:test";
import assert from "node:assert/strict";
import {
  approveMatch,
  cancelMatch,
  createMatch,
  finalizeMatchByAuthority,
  incrementMatchScore,
  setMatchRecordParticipants,
  setMatchRecordTeamRoster,
} from "../src/data/repository.js";
import { getMatchBenchPolicyError, validateMatchCreateCourt } from "../server/api/matches/sync-match.js";
import {
  getMatchCancelCopy,
  getMatchRecordCompositionLabel,
  getMatchRecordSetupStatus,
} from "../src/lib/matchUtils.js";

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
  let nextState = state;
  while (true) {
    const match = nextState.matches.find((item) => item.id === matchId);
    const scoreA = Number(match?.result?.scoreA ?? match?.teamA?.score ?? 0);
    const scoreB = Number(match?.result?.scoreB ?? match?.teamB?.score ?? 0);
    if (scoreA === targetScoreA && scoreB === targetScoreB) return nextState;
    const deltaA = Math.min(3, targetScoreA - scoreA);
    const deltaB = Math.min(3, targetScoreB - scoreB);
    nextState = incrementMatchScore(
      { ...nextState, currentUserId: "u1" },
      matchId,
      deltaA,
      deltaB,
      {
        expectedRevisionA: Number(match?.result?.scoreRevisionA ?? 0),
        expectedRevisionB: Number(match?.result?.scoreRevisionB ?? 0),
      },
    );
  }
}

test("postgame records allow an unknown court while normal matches still require one", () => {
  assert.doesNotThrow(() => validateMatchCreateCourt({ rules: { recordType: "match_record" } }));
  assert.doesNotThrow(() => validateMatchCreateCourt({ rules: { recordType: "solo" } }));
  assert.throws(() => validateMatchCreateCourt({ rules: { recordType: "match" } }), /missing_match_court/);
});

test("match-record roster policy errors return client-safe status codes", () => {
  assert.deepEqual(getMatchBenchPolicyError({ message: "match_record_reserve_not_allowed" }), {
    statusCode: 400,
    message: "match_record_reserve_not_allowed",
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
  const selected = setMatchRecordParticipants(created, match.id, {
    composition: "team",
    teamAId: "team-a",
    teamBId: "team-b",
  });
  let configured = selected.matches[0];
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
  assert.equal(scoreState.matches[0].status, "agreed");
  assert.deepEqual(scoreState.matches[0].result.playerStats, {});

  const participantAttempt = approveMatch({ ...scoreState, currentUserId: "u4" }, match.id, "teamB", "u4");
  assert.equal(participantAttempt.matches[0], scoreState.matches[0]);

  const confirmedState = finalizeMatchByAuthority({ ...scoreState, currentUserId: "u1" }, match.id);
  assert.equal(confirmedState.matches[0].status, "confirmed");
  assert.equal(confirmedState.matches[0].finalizedBy, "u1");
});

test("match-record cancellation uses record terminology while scheduled matches keep match terminology", () => {
  const created = createMatch(makeState(), makeRecordDraft("individual"));
  const match = created.matches[0];
  const cancelled = cancelMatch(created, match.id);

  assert.equal(cancelled.matches[0].status, "cancelled");
  assert.equal(cancelled.notifications[0].title, "기록 취소");
  assert.match(cancelled.notifications[0].body, /기록이 취소됐습니다/);
  assert.equal(getMatchCancelCopy(match).actionLabel, "기록 취소");
  assert.equal(getMatchCancelCopy({ title: "예정 경기", rules: { recordType: "match" } }).actionLabel, "경기 취소");
});

test("individual match record uses one self final approval for participation and result", () => {
  const created = createMatch(makeState(), makeRecordDraft("individual"));
  const matchId = created.matches[0].id;
  let state = setMatchRecordParticipants(created, matchId, {
    composition: "individual",
    teamAPlayerIds: ["u1", "u2", "u3"],
    teamBPlayerIds: ["u4", "u5", "u6"],
  });
  state = setPostgameScore(state, matchId, 21, 12);

  const submitted = state.matches.find((match) => match.id === matchId);
  assert.equal(submitted.status, "agreed");
  assert.deepEqual(submitted.result.playerStats, {});

  const nonHostAttempt = finalizeMatchByAuthority({ ...state, currentUserId: "u2" }, matchId);
  assert.equal(nonHostAttempt.matches[0], state.matches[0]);

  state = finalizeMatchByAuthority({ ...state, currentUserId: "u1" }, matchId);
  const confirmed = state.matches.find((match) => match.id === matchId);
  assert.equal(confirmed.status, "confirmed");
  assert.ok(confirmed.confirmedAt);
  assert.equal(confirmed.finalizedBy, "u1");
  assert.deepEqual(confirmed.rules.participantAcceptedIds, []);
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
  assert.equal(match.rules.recordEntryMode, "quick");
  assert.equal(match.visibility, "private");
  assert.equal(match.rules.visibility, "private");
  assert.deepEqual(match.rules.recordSummary.teamAPlayers, ["선수1"]);
  assert.deepEqual(match.rules.recordSummary.teamBPlayers, []);

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
