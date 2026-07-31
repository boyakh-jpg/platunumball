import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  getDbScheduleParts,
  projectMatchPersistenceParts,
} from "../shared/lib/matchPersistence.js";
import {
  toSeedMatchRow,
  toSeedPlayerStatRows,
} from "../src/data/repository.js";
import {
  toAuthoritativeMatchRow,
  toAuthoritativePlayerStatRows,
} from "../server/api/matches/sync-match.js";
import { getSidePlayerRows } from "../server/lib/matchSnapshotRows.js";
import { validateMatchRosterEligibility } from "../server/lib/matchSnapshotValidation.js";
import { validateLockedMatchCore } from "../server/lib/matchSyncPolicy.js";
import { fromRemoteMatch } from "../shared/lib/matchMappers.js";

function makeRosterSupabase({ profileIds = [], memberships = [] } = {}) {
  return {
    from(table) {
      const filters = {};
      const builder = {
        select() { return builder; },
        in(column, values) {
          filters[column] = values;
          return builder;
        },
        then(resolve, reject) {
          const data = table === "profiles"
            ? profileIds.filter((id) => filters.id.includes(id)).map((id) => ({ id }))
            : memberships.filter((row) => (
              filters.team_id.includes(row.team_id) && filters.user_id.includes(row.user_id)
            ));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
import { toClientMatch } from "../server/api/matches/_listProjection.js";

function makeMatchFixture() {
  return {
    id: "match-persistence-fixture",
    title: "사후 경기",
    mode: "2v2",
    courtId: "court-real",
    court: "실제 구장",
    visibility: "public",
    status: "confirmed",
    ranked: false,
    createdBy: "room-creator",
    createdAt: "2026-08-01T08:00:00.000Z",
    scheduledDate: "2026-08-01",
    scheduledTime: "19:30",
    startedAt: "2026-08-01T09:00:00.000Z",
    endedAt: "2026-08-01T12:00:00.000Z",
    teamA: {
      teamId: null,
      players: ["owner"],
    },
    teamB: {
      teamId: null,
      players: [],
    },
    rules: {
      recordType: "match_record",
      timingType: "scheduled",
      visibility: "private",
      benchCapacity: 2,
      statRecorders: { teamA: "retired-recorder" },
      dualScoreRecorderSide: "teamA",
      playedPlayerIds: { teamA: ["stale-rules-player"], teamB: [] },
      mmrExcludedPlayerIds: ["stale-rules-exclusion"],
    },
    playedPlayerIds: {
      teamA: ["owner", "anonymous-linked-slot"],
      teamB: ["anonymous-opponent-slot"],
    },
    reservePlayers: {
      teamA: ["reserve-a"],
      teamB: ["reserve-b"],
    },
    mmrExcludedPlayerIds: ["owner", "anonymous-linked-slot", "anonymous-opponent-slot"],
    anonymousPlayers: {
      "anonymous-linked-slot": {
        id: "anonymous-linked-slot",
        name: "실제선수",
        position: "SG",
        linkedProfileId: "linked-profile",
      },
      "anonymous-opponent-slot": {
        id: "anonymous-opponent-slot",
        name: "상대",
        position: "PF",
      },
    },
    result: {
      scoreA: 21,
      scoreB: 17,
      playerStats: {
        owner: {
          points: 9,
          rebounds: 4,
          assists: 3,
          steals: 2,
          blocks: 1,
          turnovers: 5,
          fouls: 2,
        },
        "anonymous-linked-slot": {
          points: 12,
        },
      },
      statSubmissions: {
        owner: {
          by: "assigned-referee",
          source: "referee",
        },
      },
    },
  };
}

test("shared match persistence projection keeps roster identity and removes only retired recorder rules", () => {
  const match = makeMatchFixture();
  const projected = projectMatchPersistenceParts(match);

  assert.deepEqual(projected.playedPlayerIds, match.playedPlayerIds);
  assert.deepEqual(projected.reservePlayers, match.reservePlayers);
  assert.deepEqual(projected.mmrExcludedPlayerIds, match.mmrExcludedPlayerIds);
  assert.equal(
    projected.anonymousPlayers["anonymous-linked-slot"].linkedProfileId,
    "linked-profile",
  );
  assert.ok(!projected.playedPlayerIds.teamA.includes("linked-profile"));
  assert.equal(Object.hasOwn(projected.rules, "statRecorders"), false);
  assert.equal(Object.hasOwn(projected.rules, "dualScoreRecorderSide"), false);
  assert.equal(match.rules.statRecorders.teamA, "retired-recorder");
});

test("seed and authoritative match rows keep their intentional actor and match_record time boundaries", () => {
  const match = makeMatchFixture();
  const seedRow = toSeedMatchRow(match, "seed-fallback-actor");
  const authoritativeRow = toAuthoritativeMatchRow(match, "api-actor");

  for (const row of [seedRow, authoritativeRow]) {
    assert.deepEqual(row.played_player_ids, match.playedPlayerIds);
    assert.deepEqual(row.reserve_players, match.reservePlayers);
    assert.equal(
      row.anonymous_players["anonymous-linked-slot"].linkedProfileId,
      "linked-profile",
    );
    assert.deepEqual(row.stat_recorders, {});
    assert.equal(Object.hasOwn(row.rules, "statRecorders"), false);
    assert.equal(Object.hasOwn(row.rules, "dualScoreRecorderSide"), false);
    assert.deepEqual(
      [row.scheduled_date, row.scheduled_time, row.scheduled_at],
      ["2026-08-01", "19:30", "2026-08-01 19:30"],
    );
  }

  assert.equal(seedRow.created_by, "owner");
  assert.equal(authoritativeRow.created_by, "room-creator");

  assert.equal(seedRow.started_at, "2026-08-01T09:00:00.000Z");
  assert.equal(seedRow.ended_at, "2026-08-01T12:00:00.000Z");
  assert.equal(authoritativeRow.started_at, "2026-08-01T10:30:00.000Z");
  assert.equal(authoritativeRow.ended_at, "2026-08-01T11:00:00.000Z");

  assert.deepEqual(seedRow.rules.playedPlayerIds, {
    teamA: ["stale-rules-player"],
    teamB: [],
  });
  assert.deepEqual(authoritativeRow.rules.playedPlayerIds, match.playedPlayerIds);
  assert.deepEqual(
    authoritativeRow.rules.mmrExcludedPlayerIds,
    match.mmrExcludedPlayerIds,
  );
});

test("seed and authoritative stat rows share recorder attribution and every stat field", () => {
  const match = makeMatchFixture();
  const seedRows = toSeedPlayerStatRows(match);
  const authoritativeRows = toAuthoritativePlayerStatRows(match);
  const seedOwner = seedRows.find((row) => row.user_id === "owner");
  const authoritativeOwner = authoritativeRows.find((row) => row.user_id === "owner");
  const seedLinkedSlot = seedRows.find((row) => row.user_id === "anonymous-linked-slot");
  const authoritativeLinkedSlot = authoritativeRows.find((row) => row.user_id === "anonymous-linked-slot");
  const commonFields = [
    "match_id",
    "user_id",
    "recorded_by",
    "record_source",
    "points",
    "rebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
    "fouls",
  ];

  assert.deepEqual(
    Object.fromEntries(commonFields.map((field) => [field, seedOwner[field]])),
    Object.fromEntries(commonFields.map((field) => [field, authoritativeOwner[field]])),
  );
  assert.equal(seedOwner.recorded_by, "assigned-referee");
  assert.equal(seedOwner.record_source, "referee");
  assert.equal(seedOwner.turnovers, 5);
  assert.equal(authoritativeOwner.turnovers, 5);

  assert.equal(seedLinkedSlot.recorded_by, null);
  assert.equal(authoritativeLinkedSlot.recorded_by, null);
  assert.equal(seedLinkedSlot.record_source, "player");
  assert.equal(authoritativeLinkedSlot.record_source, "player");
});

test("shared schedule projection preserves instant and scheduled DB shapes", () => {
  assert.deepEqual(getDbScheduleParts({ scheduledAt: "2026-08-01 19:30" }), {
    timingType: "scheduled",
    scheduledDate: "2026-08-01",
    scheduledTime: "19:30",
    scheduledAt: "2026-08-01 19:30",
  });
  assert.deepEqual(getDbScheduleParts({
    scheduledDate: "2026-08-01",
    scheduledTime: "19:30:45",
    rules: { timingType: "instant" },
  }), {
    timingType: "instant",
    scheduledDate: null,
    scheduledTime: null,
    scheduledAt: null,
  });
});

test("legacy mixed recruiting player team provenance survives the match player round trip", () => {
  const match = {
    id: "legacy-mixed-match",
    title: "legacy mixed",
    mode: "3v3",
    timingType: "instant",
    teamA: { teamId: null, players: ["solo-a"], playerTeams: {} },
    teamB: {
      teamId: null,
      players: ["party-b1", "party-b2", "solo-b"],
      playerTeams: { "party-b1": "team-b", "party-b2": "team-b" },
    },
    rules: { timingType: "instant" },
  };
  const matchRow = toAuthoritativeMatchRow(match, "solo-a");
  const playerRows = getSidePlayerRows(match);

  assert.equal(matchRow.team_a_id, null);
  assert.equal(matchRow.team_b_id, null);
  assert.deepEqual(
    Object.fromEntries(playerRows.map((row) => [row.user_id, row.team_id])),
    { "solo-a": null, "party-b1": "team-b", "party-b2": "team-b", "solo-b": null },
  );

  const reloaded = fromRemoteMatch(matchRow, {
    playersByMatch: new Map([[match.id, playerRows]]),
    resultsByMatch: {},
    statsByMatch: new Map(),
    disputesByMatch: new Map(),
    agreementsByMatch: new Map(),
    approvalsByMatch: new Map(),
    teamById: { "team-b": { id: "team-b", name: "B 파티" } },
    courtById: {},
  });

  assert.equal(reloaded.teamA.teamId, null);
  assert.equal(reloaded.teamB.teamId, null);
  assert.deepEqual(reloaded.teamA.playerTeams, {});
  assert.deepEqual(reloaded.teamB.playerTeams, { "party-b1": "team-b", "party-b2": "team-b" });

  const teamOnlyRows = getSidePlayerRows({
    id: "team-only-match",
    teamA: { teamId: "team-a", players: ["team-a1", "team-a2"], playerTeams: {} },
    teamB: { teamId: "team-b", players: ["team-b1"], playerTeams: {} },
  });
  assert.deepEqual(teamOnlyRows.map((row) => row.team_id), ["team-a", "team-a", "team-b"]);
});

test("per-player team provenance must stay inside its side roster and match current membership", async () => {
  const supabase = makeRosterSupabase({
    profileIds: ["solo-a", "party-b1", "solo-b"],
    memberships: [{ team_id: "team-b", user_id: "party-b1" }],
  });
  const match = {
    teamA: { players: ["solo-a"], teamId: null, playerTeams: {} },
    teamB: {
      players: ["party-b1", "solo-b"],
      teamId: null,
      playerTeams: { "party-b1": "team-b" },
    },
    reservePlayers: { teamA: [], teamB: [] },
    playedPlayerIds: { teamA: [], teamB: [] },
  };

  await validateMatchRosterEligibility(supabase, match);
  await assert.rejects(
    validateMatchRosterEligibility(supabase, {
      ...match,
      teamB: { ...match.teamB, playerTeams: { "outside-player": "team-b" } },
    }),
    { message: "match_player_team_outside_roster", statusCode: 403 },
  );
  await assert.rejects(
    validateMatchRosterEligibility(supabase, {
      ...match,
      teamB: { ...match.teamB, playerTeams: { "solo-b": "team-b" } },
    }),
    { message: "match_team_roster_not_member", statusCode: 403 },
  );
});

test("roster-locked actions cannot rewrite persisted per-player team provenance", () => {
  const existingMatch = { visibility: "public" };
  const existingPlayers = [
    { user_id: "solo-a", side: "teamA", slot_order: 0, team_id: null },
    { user_id: "party-b1", side: "teamB", slot_order: 0, team_id: "team-b" },
  ];
  const nextMatch = {
    visibility: "public",
    teamA: { players: ["solo-a"], teamId: null, playerTeams: {} },
    teamB: { players: ["party-b1"], teamId: null, playerTeams: { "party-b1": "team-b" } },
  };

  validateLockedMatchCore(existingMatch, existingPlayers, nextMatch, "startMatch");
  assert.throws(
    () => validateLockedMatchCore(existingMatch, existingPlayers, {
      ...nextMatch,
      teamB: { ...nextMatch.teamB, playerTeams: { "party-b1": "other-team" } },
    }, "startMatch"),
    { message: "match_player_team_locked", statusCode: 403 },
  );
});

test("match list projection restores mixed player teams", () => {
  const row = {
    id: "legacy-mixed-list-match",
    title: "legacy mixed list",
    mode: "3v3",
    team_a_id: null,
    team_b_id: null,
    rules: {},
  };
  const playerRows = [
    { match_id: row.id, side: "teamA", user_id: "solo-a", team_id: null, slot_order: 0 },
    { match_id: row.id, side: "teamB", user_id: "party-b1", team_id: "team-b", slot_order: 0 },
    { match_id: row.id, side: "teamB", user_id: "party-b2", team_id: "team-b", slot_order: 1 },
  ];

  const match = toClientMatch(row, new Map([[row.id, playerRows]]));

  assert.deepEqual(match.teamA.playerTeams, {});
  assert.deepEqual(match.teamB.playerTeams, {
    "party-b1": "team-b",
    "party-b2": "team-b",
  });
});

test("match list loader hydrates teams referenced only by player rows", async () => {
  const source = await readFile(new URL("../server/api/matches/_listLoader.js", import.meta.url), "utf8");

  assert.match(source, /playersByMatch\.get\(row\.id\).*\.map\(\(player\) => player\.team_id\)/s);
});
