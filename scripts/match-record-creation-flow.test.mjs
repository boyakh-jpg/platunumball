import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatch,
  setMatchRecordParticipants,
  setMatchRecordTeamRoster,
} from "../src/data/repository.js";

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
  assert.deepEqual(configured.rules.recordApproverIds, { teamA: ["u1"], teamB: ["u4"] });
  assert.equal(configured.rules.recordSetupReady, false);

  const afterA = setMatchRecordTeamRoster(selected, match.id, "teamA", {
    playerIds: ["u1", "u2", "u3"],
    reservePlayerIds: [],
  });
  assert.equal(afterA.matches[0].rules.rosterReady.teamA, true);
  assert.equal(afterA.matches[0].rules.recordSetupReady, false);

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
  assert.deepEqual(configured.reservePlayers, { teamA: [], teamB: [] });
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
  assert.deepEqual(match.rules.recordSummary.teamAPlayers, ["선수1"]);
  assert.deepEqual(match.rules.recordSummary.teamBPlayers, []);
});
