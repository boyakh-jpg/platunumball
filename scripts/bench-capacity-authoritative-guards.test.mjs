import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RECRUITING_PAGE_SOURCE_PATHS,
  REPOSITORY_ROOM_RULES_SOURCE_PATHS,
  readSourceGroupSync,
} from "./management-source-groups.mjs";
import { createRecruitingPost } from "../src/data/repository.js";

const migrationSource = readFileSync(new URL("../supabase/migrations/20260722225600_bench_capacity_authoritative_guards.sql", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const repositorySource = readSourceGroupSync(
  (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
  REPOSITORY_ROOM_RULES_SOURCE_PATHS,
);
const recruitingSource = readSourceGroupSync(
  (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
  RECRUITING_PAGE_SOURCE_PATHS,
);

test("authoritative reducers use shape-guard patches and dynamic bench capacity", () => {
  for (const signature of [
    "rankball_match_room_action_unguarded(text,text,text,jsonb)",
    "rankball_recruiting_management_action_unguarded(text,jsonb)",
    "rankball_recruiting_management_action(text,jsonb)",
    "rankball_recruiting_management_action_pre_summon(text,jsonb)",
    "rankball_recruiting_side_party_join_action(text,text,text,text,text)",
    "rankball_tournament_match_roster_action_legacy(text,text,jsonb)",
    "rankball_tournament_operation_action(text,jsonb)",
    "rankball_create_tournament_match_locked_unguarded(text,text,text,integer,integer,text)",
  ]) assert.match(migrationSource, new RegExp(signature.replace(/[()]/g, "\\$&")));

  assert.match(migrationSource, /pg_get_functiondef\(target_function\)/);
  assert.match(migrationSource, /current_post\.bench_capacity/);
  assert.match(migrationSource, /post_row\.bench_capacity/);
  assert.match(migrationSource, /limit bench_capacity/);
  assert.match(migrationSource, /matches_supported_mode_check/);
  assert.match(migrationSource, /mode = '4v4'.*recordType.*'solo'/s);
  assert.match(schemaSource, /match_room_bench_declaration_shape_changed/);
  assert.match(schemaSource, /recruiting_posts_supported_mode_check/);
  assert.match(schemaSource, /matches_supported_mode_check/);
});

test("general recruiting cannot create or edit a 4v4 room", () => {
  const state = Object.freeze({ marker: "unchanged" });
  assert.equal(createRecruitingPost(state, { mode: "4v4", sideCapacity: 4 }), state);
  assert.match(repositorySource, /if \(!isSupportedMatchMode\(nextMode\)\) return state;/);
  assert.doesNotMatch(recruitingSource, /\[1, 2, 3, 4, 5\]\.map/);
  assert.match(recruitingSource, /MATCH_MODES\.map\(\(\{ id, size \}\)/);
});
