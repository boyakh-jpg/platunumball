import test from "node:test";
import assert from "node:assert/strict";

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
