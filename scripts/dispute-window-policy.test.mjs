import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("DB dispute window policy accepts only 10, 15, and 20 minutes", async () => {
  const migration = await readSource("supabase/migrations/20260722225000_dispute_window_policy.sql");

  assert.match(migration, /rankball_normalize_dispute_minutes\(p_value integer default null\)/);
  assert.match(migration, /case when p_value in \(10, 15, 20\) then p_value else 15 end/);
  assert.match(migration, /alter column dispute_minutes set default 15/g);
  assert.match(migration, /check \(dispute_minutes in \(10, 15, 20\)\)/g);
  assert.match(migration, /update public\.matches[\s\S]*rankball_normalize_dispute_minutes\(dispute_minutes\)/);
  assert.match(migration, /update public\.recruiting_posts[\s\S]*rankball_normalize_dispute_minutes\(dispute_minutes\)/);
});

test("all authoritative dispute deadline and persistence paths share the DB normalizer", async () => {
  const migration = await readSource("supabase/migrations/20260722225000_dispute_window_policy.sql");

  [
    "rankball_persist_match_snapshot",
    "rankball_persist_recruiting_snapshot",
    "rankball_create_tournament_match_locked_unguarded",
    "rankball_match_dispute_action",
    "rankball_match_result_action_roster_unguarded",
    "rankball_match_auto_finalize_action",
  ].forEach((functionName) => assert.match(migration, new RegExp(functionName)));

  assert.match(migration, /rankball_matches_normalize_dispute_window/);
  assert.match(migration, /rankball_recruiting_normalize_dispute_window/);
  assert.match(migration, /new\.dispute_minutes := public\.rankball_normalize_dispute_minutes/);
  assert.match(migration, /new\.objection_window := new\.dispute_minutes::text \|\| '분'/);
});

test("schema and schema health expose the same dispute window invariant", async () => {
  const [schema, schemaHealth] = await Promise.all([
    readSource("supabase/schema.sql"),
    readSource("server/api/system/schema-health.js"),
  ]);

  assert.match(schema, /dispute_minutes integer not null default 15/);
  assert.doesNotMatch(schema, /dispute_minutes integer not null default 30/);
  assert.match(schema, /rankball_normalize_dispute_minutes/);
  assert.match(schema, /matches_dispute_minutes_range/);
  assert.match(schema, /recruiting_posts_dispute_minutes_range/);
  assert.match(schema, /rankball_dispute_window_health/);

  assert.match(schemaHealth, /name: "rankball_dispute_window_health"/);
  assert.match(schemaHealth, /checkDisputeWindowPolicy/);
  assert.match(schemaHealth, /failedDisputeWindowCount/);
  assert.match(schemaHealth, /disputeWindowCheck\.ok/);
});

test("parallel dispute queue remains item-based", async () => {
  const parallelQueue = await readSource("supabase/migrations/20260722120000_parallel_match_dispute_queue.sql");

  assert.match(parallelQueue, /match_disputes_one_open_per_user_idx/);
  assert.match(parallelQueue, /rankball_match_resolve_dispute_action/);
  assert.match(parallelQueue, /select count\(\*\)::integer into open_count/);
  assert.match(parallelQueue, /if open_count > 0 then/);
});
