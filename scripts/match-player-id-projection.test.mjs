import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MATCHES_PAGE_SOURCE_PATHS } from "./management-source-groups.mjs";
import {
  collectMatchActivePlayerIds,
  flattenPlayerIdValues,
  projectMatchActivePlayerIds,
  projectMatchParticipationIds,
  projectMatchSideParticipationIds,
  projectPersistedMatchReportParticipantIds,
  uniquePlayerIds,
} from "../shared/lib/playerIds.js";
import {
  getActualMatchPlayerIds,
  getMatchPlayerIds,
  getMatchSidePlayerIds,
} from "../src/lib/matchUtils.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("player id primitive keeps first value and only removes falsy duplicates", () => {
  assert.deepEqual(uniquePlayerIds(["p1", "", null, "p1", 1, "1", false]), ["p1", 1, "1"]);
  assert.deepEqual(
    flattenPlayerIdValues({ teamA: ["p1", { nested: "p2" }], teamB: null }),
    ["p1", "p2"],
  );
});

test("active roster projection ignores played, reserve, anonymous metadata, and record summary", () => {
  const match = {
    teamA: { players: ["active-a", "shared"] },
    teamB: { players: ["active-b", "shared"] },
    reservePlayers: { teamA: ["reserve-a"], teamB: ["reserve-b"] },
    playedPlayerIds: { teamA: ["played-a"], teamB: ["played-b"] },
    anonymousPlayers: { "active-a": { name: "익명" } },
    rules: {
      recordSummary: {
        teamAPlayerIds: ["summary-a"],
        teamBPlayerIds: ["summary-b"],
      },
    },
  };

  assert.deepEqual(
    collectMatchActivePlayerIds(match),
    ["active-a", "shared", "active-b", "shared"],
  );
  assert.deepEqual(projectMatchActivePlayerIds(match), ["active-a", "shared", "active-b"]);
});

test("client participation projection includes played ids but not reserves", () => {
  const match = {
    teamA: { players: ["active-a", "anon-a"] },
    teamB: { players: ["active-b"] },
    reservePlayers: { teamA: ["reserve-a"], teamB: ["reserve-b"] },
    playedPlayerIds: { teamA: ["played-a", "active-a"], teamB: ["played-b"] },
    anonymousPlayers: { "anon-a": { name: "익명" } },
    rules: {
      playedPlayerIds: { teamA: ["rules-played-a"], teamB: ["rules-played-b"] },
      recordSummary: { teamAPlayerIds: ["summary-a"] },
    },
  };

  assert.deepEqual(
    projectMatchSideParticipationIds(match, "teamA"),
    ["active-a", "anon-a", "played-a"],
  );
  assert.deepEqual(
    projectMatchParticipationIds(match),
    ["active-a", "anon-a", "played-a", "active-b", "played-b"],
  );
  assert.deepEqual(getMatchSidePlayerIds(match, "teamA"), ["active-a", "anon-a", "played-a"]);
  assert.deepEqual(getMatchPlayerIds(match), ["active-a", "anon-a", "played-a", "active-b", "played-b"]);
  assert.deepEqual(getActualMatchPlayerIds(match), ["played-a", "active-a", "played-b", "active-b"]);
});

test("rules played ids are fallback only when the top-level snapshot is absent", () => {
  const rulesOnly = {
    teamA: { players: ["active-a"] },
    teamB: { players: [] },
    rules: { playedPlayerIds: { teamA: ["rules-played-a"], teamB: [] } },
  };
  const explicitEmpty = {
    ...rulesOnly,
    playedPlayerIds: {},
  };

  assert.deepEqual(projectMatchParticipationIds(rulesOnly), ["active-a", "rules-played-a"]);
  assert.deepEqual(projectMatchParticipationIds(explicitEmpty), ["active-a"]);
});

test("personal records never expose anonymous roster ids as actual MMR participants", () => {
  const match = {
    createdBy: "owner",
    teamA: { players: ["owner"] },
    teamB: { players: [] },
    playedPlayerIds: { teamA: ["owner", "anon-a"], teamB: ["anon-b"] },
    anonymousPlayers: {
      "anon-a": { name: "동료", linkedProfileId: "linked-a" },
      "anon-b": { name: "상대", linkedProfileId: "linked-b" },
    },
    rules: { recordType: "solo" },
  };

  assert.deepEqual(getMatchPlayerIds(match), ["owner", "anon-a", "anon-b"]);
  assert.deepEqual(getActualMatchPlayerIds(match), []);
});

test("report participant projection includes DB players, reserves, and played snapshots only", () => {
  const match = {
    reserve_players: { teamA: ["reserve-a", "shared"], teamB: ["reserve-b"] },
    played_player_ids: { teamA: ["played-a"], teamB: ["anon-b"] },
    attendance: { teamA: ["attendance-only"] },
    stat_recorders: { teamA: "recorder-only" },
    anonymous_players: { "anon-b": { name: "익명" } },
    rules: {
      reservePlayers: { teamA: ["rules-reserve-a"], teamB: [] },
      playedPlayerIds: { teamA: ["rules-played-a"], teamB: ["shared"] },
      recordSummary: { teamAPlayerIds: ["summary-a"] },
    },
  };

  assert.deepEqual(
    projectPersistedMatchReportParticipantIds(match, [
      { user_id: "active-a" },
      { user_id: " active-b " },
      { user_id: "active-a" },
    ]),
    [
      "active-a",
      "active-b",
      "reserve-a",
      "shared",
      "reserve-b",
      "played-a",
      "anon-b",
      "rules-reserve-a",
      "rules-played-a",
    ],
  );
});

test("each caller uses the projection matching its established semantics", () => {
  const matchParticipationSource = fs.readFileSync(
    path.join(root, "shared/lib/matchParticipation.js"),
    "utf8",
  );
  const matchesPageSource = MATCHES_PAGE_SOURCE_PATHS
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");
  const ratingSource = fs.readFileSync(path.join(root, "server/lib/ratingEngine.js"), "utf8");
  const listSource = fs.readFileSync(path.join(root, "server/api/matches/_listLoader.js"), "utf8");
  const notificationSource = [
    fs.readFileSync(path.join(root, "server/lib/matchNotifications.js"), "utf8"),
    fs.readFileSync(path.join(root, "server/lib/matchNotificationRows.js"), "utf8"),
  ].join("\n");
  const reportSource = [
    fs.readFileSync(path.join(root, "server/api/reports/submit.js"), "utf8"),
    fs.readFileSync(path.join(root, "server/api/reports/submitCourtTeamPolicy.js"), "utf8"),
  ].join("\n");

  assert.match(matchParticipationSource, /projectMatchParticipationIds\(match\)/);
  assert.match(matchesPageSource, /shared\/lib\/playerIds\.js/);
  assert.match(ratingSource, /shared\/lib\/playerIds\.js/);
  assert.match(listSource, /projectMatchActivePlayerIds\(match\)/);
  assert.match(notificationSource, /collectMatchActivePlayerIds\(match\)/);
  assert.match(reportSource, /projectPersistedMatchReportParticipantIds\(match, players \?\? \[\]\)/);
});
