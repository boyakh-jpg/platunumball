import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BENCH_CAPACITY_OPTIONS,
  DEFAULT_BENCH_CAPACITY,
  MAX_BENCH_CAPACITY,
  isValidBenchCapacity,
  normalizeBenchCapacity,
} from "../src/lib/constants.js";
import {
  getRecruitingBenchCapacity,
  getRecruitingSideCapacity,
  normalizeRecruitingPost,
} from "../src/lib/recruiting.js";
import { getRecruitingBenchPolicyError, validateRecruitingPostShape } from "../server/api/recruiting/sync-post.js";
import { getMatchBenchPolicyError, validateMatchShape } from "../server/api/matches/sync-match.js";

const migrationSource = readFileSync(new URL("../supabase/migrations/20260722225500_bench_capacity_policy.sql", import.meta.url), "utf8");
const capacityThreeMigrationSource = readFileSync(new URL("../supabase/migrations/20260722225700_bench_capacity_three.sql", import.meta.url), "utf8");
const safeReserveBooleanMigrationSource = readFileSync(new URL("../supabase/migrations/20260729172000_safe_recruiting_reserve_boolean.sql", import.meta.url), "utf8");
const matchRecordBenchMigrationSource = readFileSync(new URL("../supabase/migrations/20260730170000_match_record_bench_capacity_alignment.sql", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const matchMapperSource = readFileSync(new URL("../shared/lib/matchMappers.js", import.meta.url), "utf8");

function assertPolicyError(run, message, statusCode) {
  assert.throws(run, (error) => {
    assert.equal(error.message, message);
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}

test("bench capacity accepts only 0..3 and old missing or invalid values fall back to 2", () => {
  assert.equal(MAX_BENCH_CAPACITY, 3);
  assert.deepEqual(BENCH_CAPACITY_OPTIONS, [0, 1, 2, 3]);
  for (const value of [0, 1, 2, 3, "0", "1", "2", "3"]) assert.equal(isValidBenchCapacity(value), true);
  for (const value of [-1, 4, 1.5, "", "invalid", null, undefined]) {
    assert.equal(normalizeBenchCapacity(value), DEFAULT_BENCH_CAPACITY);
  }
  assert.equal(getRecruitingBenchCapacity({}), 2);
  assert.equal(getRecruitingBenchCapacity({ benchCapacity: "invalid" }), 2);
  assert.equal(normalizeRecruitingPost({ rules: {} }).rules.benchCapacity, 2);
  assert.equal(normalizeRecruitingPost({ benchCapacity: 0 }).rules.benchCapacity, 0);
});

test("1v1, 2v2, 3v3 and 5v5 keep their on-court capacity independently of bench capacity", () => {
  for (const [mode, expected] of [["1v1", 1], ["2v2", 2], ["3v3", 3], ["5v5", 5]]) {
    assert.equal(getRecruitingSideCapacity({ mode, benchCapacity: 0 }), expected);
    assert.equal(getRecruitingSideCapacity({ mode, benchCapacity: 3 }), expected);
  }
});

test("recruiting server rejects reserve placement when bench capacity is 0", () => {
  const post = {
    mode: "3v3",
    visibility: "private",
    hostJoinMode: "team",
    hostSide: "teamA",
    teamId: "team-a",
    playerId: "player-a",
    playerIds: ["player-a"],
    benchCapacity: 0,
    roomState: { partyReserves: { host: ["reserve-a"] } },
  };
  assertPolicyError(() => validateRecruitingPostShape(post), "recruiting_reserve_full", 409);
  assert.doesNotThrow(() => validateRecruitingPostShape({ ...post, roomState: {}, benchCapacity: 0 }));
  assertPolicyError(
    () => validateRecruitingPostShape({ ...post, roomState: {}, benchCapacity: 4 }),
    "invalid_bench_capacity",
    400,
  );
});

test("database bench policy failures keep stable recruiting API statuses", () => {
  assert.deepEqual(getRecruitingBenchPolicyError({ message: "invalid_bench_capacity" }), {
    statusCode: 400,
    message: "invalid_bench_capacity",
  });
  assert.deepEqual(getRecruitingBenchPolicyError({ details: "constraint: recruiting_reserve_full" }), {
    statusCode: 409,
    message: "recruiting_reserve_full",
  });
  assert.deepEqual(getRecruitingBenchPolicyError({ message: "room_edit_limit_reached" }), {
    statusCode: 409,
    message: "room_edit_limit_reached",
  });
  assert.equal(getRecruitingBenchPolicyError({ message: "unrelated" }), null);
});

test("database bench policy failures keep stable match API statuses", () => {
  assert.deepEqual(getMatchBenchPolicyError({ message: "invalid_bench_capacity" }), {
    statusCode: 400,
    message: "invalid_bench_capacity",
  });
  assert.deepEqual(getMatchBenchPolicyError({ details: "constraint: match_reserve_full" }), {
    statusCode: 409,
    message: "match_reserve_full",
  });
  assert.deepEqual(getMatchBenchPolicyError({ hint: "match_reserve_exceeds_bench_capacity" }), {
    statusCode: 409,
    message: "match_reserve_exceeds_bench_capacity",
  });
  assert.deepEqual(getMatchBenchPolicyError({ message: "room_edit_limit_reached" }), {
    statusCode: 409,
    message: "room_edit_limit_reached",
  });
  assert.equal(getMatchBenchPolicyError({ message: "unrelated" }), null);
});

test("recruiting server defaults old rows to 2 reserves and rejects the third", () => {
  const post = {
    mode: "5v5",
    visibility: "private",
    hostJoinMode: "team",
    hostSide: "teamA",
    teamId: "team-a",
    playerId: "player-a",
    playerIds: ["player-a"],
  };
  assert.doesNotThrow(() => validateRecruitingPostShape({
    ...post,
    roomState: { partyReserves: { host: ["reserve-a", "reserve-b"] } },
  }));
  assert.throws(() => validateRecruitingPostShape({
    ...post,
    roomState: { partyReserves: { host: ["reserve-a", "reserve-b", "reserve-c"] } },
  }), /recruiting_reserve_full/);
});

test("recruiting server accepts exactly 3 reserves and rejects the fourth", () => {
  const post = {
    mode: "5v5",
    visibility: "private",
    hostJoinMode: "team",
    hostSide: "teamA",
    teamId: "team-a",
    playerId: "player-a",
    playerIds: ["player-a"],
    benchCapacity: 3,
  };
  assert.doesNotThrow(() => validateRecruitingPostShape({
    ...post,
    roomState: { partyReserves: { host: ["reserve-a", "reserve-b", "reserve-c"] } },
  }));
  assertPolicyError(() => validateRecruitingPostShape({
    ...post,
    roomState: { partyReserves: { host: ["reserve-a", "reserve-b", "reserve-c", "reserve-d"] } },
  }), "recruiting_reserve_full", 409);
});

test("match server enforces the same per-side bench capacity", () => {
  const match = {
    mode: "1v1",
    teamA: { players: ["player-a"] },
    teamB: { players: ["player-b"] },
    reservePlayers: { teamA: ["reserve-a"], teamB: [] },
    benchCapacity: 0,
  };
  assert.throws(() => validateMatchShape(match), /team_a_exceeds_bench_capacity/);
  assert.doesNotThrow(() => validateMatchShape({
    ...match,
    benchCapacity: undefined,
    reservePlayers: { teamA: ["reserve-a", "reserve-b"], teamB: [] },
  }));
  assert.doesNotThrow(() => validateMatchShape({
    ...match,
    benchCapacity: 3,
    reservePlayers: { teamA: ["reserve-a", "reserve-b", "reserve-c"], teamB: [] },
  }));
  assertPolicyError(() => validateMatchShape({ ...match, benchCapacity: 4 }), "invalid_bench_capacity", 400);
});

test("migration preserves existing 0/1 rules before synchronizing the new column", () => {
  const columnBackfill = migrationSource.indexOf("set bench_capacity = case");
  const rulesBackfill = migrationSource.indexOf("set rules = jsonb_set");
  assert.ok(columnBackfill >= 0);
  assert.ok(rulesBackfill > columnBackfill);
  assert.match(migrationSource, /update public\.matches[\s\S]*?where coalesce\(rules->>'benchCapacity', ''\) !~ '\^\[0-2\]\$';/);
});

test("database policy uses safe booleans, private trigger helpers and dynamic RPC capacity", () => {
  for (const source of [migrationSource, schemaSource]) {
    assert.doesNotMatch(source, /\(invitation->>'reserve'\)::boolean/);
    assert.match(source, /revoke all on function public\.rankball_recruiting_side_bench_count\(text, text\) from public, anon, authenticated, service_role;/);
    assert.match(source, />= current_post\.bench_capacity/);
    assert.match(source, /> current_post\.bench_capacity/);
  }
});

test("current recruiting management RPC migration replaces unsafe reserve boolean casts", () => {
  assert.match(safeReserveBooleanMigrationSource, /unsafe_payload_cast text := '\(payload->>''reserve''\)::' \|\| 'boolean';/);
  assert.match(safeReserveBooleanMigrationSource, /unsafe_invitation_cast text := '\(invitation->>''reserve''\)::' \|\| 'boolean';/);
  assert.match(safeReserveBooleanMigrationSource, /lower\(coalesce\(payload->>''reserve'', ''false''\)\) in/);
  assert.match(safeReserveBooleanMigrationSource, /lower\(coalesce\(invitation->>''reserve'', ''false''\)\) in/);
  assert.match(safeReserveBooleanMigrationSource, /recruiting_reserve_boolean_cast_remains/);
  assert.doesNotMatch(schemaSource, /\((?:payload|invitation)->>'reserve'\)::boolean/);
});

test("schema snapshot and both slim feed branches preserve bench capacity", () => {
  assert.match(schemaSource, /bench_capacity smallint not null default 2/);
  assert.match(schemaSource, /recruiting_posts_bench_capacity_check check \(bench_capacity between 0 and 3\)/);
  assert.match(schemaSource, /create or replace function public\.rankball_normalize_recruiting_bench_capacity\(\)/);
  assert.match(schemaSource, /create constraint trigger validate_recruiting_application_bench_capacity/);
  assert.match(schemaSource, /'benchCapacity', post_row\.bench_capacity/);
  assert.match(schemaSource, /'benchCapacity', case[\s\S]*?match_row\.rules->>'benchCapacity'/);
  assert.match(migrationSource, /slim_match_feed_mode_shape_changed/);
  assert.match(schemaSource, /slim_match_feed_mode_shape_changed/);
  assert.match(matchMapperSource, /normalizeBenchCapacity\(row\.benchCapacity \?\? row\.rules\?\.benchCapacity\)/);
});

test("follow-up migration expands every active validator from 0..2 to 0..3", () => {
  assert.match(capacityThreeMigrationSource, /check \(bench_capacity between 0 and 3\)/);
  assert.match(capacityThreeMigrationSource, /old_count = function_record\.expected_count/);
  assert.match(capacityThreeMigrationSource, /old_count = 0 and new_count >= function_record\.expected_count/);
  assert.match(capacityThreeMigrationSource, /replace\(function_definition, old_fragment, new_fragment\)/);
  for (const [signature, expectedCount] of [
    ["rankball_match_room_action_unguarded(text,text,text,jsonb)", 2],
    ["rankball_normalize_match_bench_capacity()", 1],
    ["rankball_normalize_recruiting_bench_capacity()", 1],
    ["rankball_recruiting_management_action_unguarded(text,jsonb)", 2],
    ["rankball_refresh_match_feed_for_match(text)", 1],
    ["rankball_slim_room_feed_card(text,jsonb)", 2],
    ["rankball_tournament_match_roster_action_legacy(text,text,jsonb)", 1],
    ["rankball_tournament_operation_action(text,jsonb)", 1],
  ]) {
    const escapedSignature = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(capacityThreeMigrationSource, new RegExp(`'public\\.${escapedSignature}', ${expectedCount}\\)`));
  }
});

test("team match records keep three reserve slots in legacy and new rooms", () => {
  for (const source of [matchRecordBenchMigrationSource, schemaSource]) {
    assert.match(source, /is_team_match_record := coalesce\(new\.rules->>'recordType', ''\) = 'match_record'/);
    assert.match(source, /if is_team_match_record then\s+safe_capacity := 3;/);
  }
  assert.match(matchRecordBenchMigrationSource, /update public\.matches[\s\S]*?'recordComposition'[\s\S]*?'team'/);
});
