import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  migrationSource,
  repairMigrationSource,
  schemaSource,
  matchSqlActionsSource,
  matchSyncPolicySource,
  matchSyncHandlerSource,
  authoritativeStateSource,
  repositoryAdapterSource,
  clientActionsSource,
  clientOperationsSource,
  optimisticReducerSource,
  simulationSource,
  logicDocSource,
  storageDocSource,
] = await Promise.all([
  readFile(new URL("../supabase/migrations/20260730017000_match_record_participants_operation.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260730190000_fix_match_record_participant_team_ids.sql", import.meta.url), "utf8"),
  readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  readFile(new URL("../server/lib/matchSqlCoreActions.js", import.meta.url), "utf8"),
  readFile(new URL("../server/lib/matchSyncPolicy.js", import.meta.url), "utf8"),
  readFile(new URL("../server/lib/matchSyncHandler.js", import.meta.url), "utf8"),
  readFile(new URL("../server/api/_authoritativeState.js", import.meta.url), "utf8"),
  readFile(new URL("../server/lib/repositoryAdapter.js", import.meta.url), "utf8"),
  readFile(new URL("../src/hooks/appData/actions/recruitingActions.js", import.meta.url), "utf8"),
  readFile(new URL("../src/hooks/appData/serverOperations.js", import.meta.url), "utf8"),
  readFile(new URL("../src/data/repository/matches/recordParticipants.js", import.meta.url), "utf8"),
  readFile(new URL("./simulate-backend-flow.mjs", import.meta.url), "utf8"),
  readFile(new URL("../docs/logic-and-terminology.md", import.meta.url), "utf8"),
  readFile(new URL("../docs/data-storage-model.md", import.meta.url), "utf8"),
]);

test("match-record participant setup is one locked service-only SQL reducer", () => {
  assert.match(
    migrationSource,
    /create or replace function public\.rankball_match_record_participants_action\(\s*p_actor_profile_id text,\s*p_match_id text,\s*p_payload jsonb/u,
  );
  assert.match(migrationSource, /rankball_assert_match_actor_active\(safe_actor_id\)/u);
  assert.match(migrationSource, /pg_advisory_xact_lock\(hashtext\('rankball:match'\)/u);
  assert.match(migrationSource, /where id = safe_match_id\s*for update/u);
  assert.match(migrationSource, /match_record_host_required/u);
  assert.match(migrationSource, /match_record_composition_invalid/u);
  assert.match(migrationSource, /match_record_roster_exact_capacity_required/u);
  assert.match(migrationSource, /match_record_team_captain_required/u);
  assert.match(migrationSource, /match_roster_cross_side_duplicate/u);
  assert.match(migrationSource, /delete from public\.match_players\s*where match_id = safe_match_id/u);
  assert.match(migrationSource, /delete from public\.match_agreements\s*where match_id = safe_match_id/u);
  assert.match(migrationSource, /delete from public\.match_approvals\s*where match_id = safe_match_id/u);
  assert.match(migrationSource, /'match_record_setup'/u);
  assert.match(migrationSource, /'sqlReducer', true/u);
  assert.match(
    migrationSource,
    /'general',\s*'rankball_match_record_participants_action'[\s\S]*'active',\s*true/u,
  );
  assert.match(
    migrationSource,
    /revoke all on function public\.rankball_match_record_participants_action\([\s\S]*from public, anon, authenticated/u,
  );
  assert.match(
    migrationSource,
    /grant execute on function public\.rankball_match_record_participants_action\([\s\S]*to service_role/u,
  );
  assert.doesNotMatch(migrationSource.replace(/--[^\r\n]*/gu, ""), /\bcascade\b/iu);
  assert.doesNotMatch(migrationSource, /\b(?:drop table|truncate)\b/iu);
});

test("match-record team selection avoids PL/pgSQL team id shadowing", () => {
  assert.match(repairMigrationSource, /pg_get_functiondef\(function_signature\)/u);
  assert.match(repairMigrationSource, /selected_team_a_id/u);
  assert.match(repairMigrationSource, /selected_team_b_id/u);
  assert.match(repairMigrationSource, /\[\[:space:\]\]\*team_a_id text;/u);
  assert.match(repairMigrationSource, /\[\[:space:\]\]\*selected_team_a_id text;/u);
  assert.match(repairMigrationSource, /match_record_participant_team_id_repair_incomplete/u);
  assert.doesNotMatch(repairMigrationSource, /\b(?:drop table|truncate|delete from)\b/iu);

  const functionStart = schemaSource.indexOf(
    "create or replace function public.rankball_match_record_participants_action",
  );
  const functionEnd = schemaSource.indexOf(
    "insert into public.rankball_rpc_contract_registry",
    functionStart,
  );
  const functionSource = schemaSource.slice(functionStart, functionEnd);
  assert.match(functionSource, /selected_team_a_id text;/u);
  assert.match(functionSource, /selected_team_b_id text;/u);
  assert.doesNotMatch(functionSource, /\bteam_[ab]_id text;/u);
});

test("server routes setup operation directly to SQL without full-state replay", () => {
  assert.match(
    matchSqlActionsSource,
    /operation\.action === "setMatchRecordParticipants"[\s\S]*\.rpc\("rankball_match_record_participants_action"[\s\S]*p_payload: operation\.setup \?\? \{\}/u,
  );
  assert.match(
    matchSyncPolicySource,
    /SQL_REDUCER_MATCH_ACTIONS = new Set\(\[[\s\S]*"setMatchRecordParticipants"/u,
  );
  assert.match(
    matchSyncPolicySource,
    /canUseSqlMatchActionWithoutSnapshot[\s\S]*"setMatchRecordParticipants"/u,
  );
  assert.doesNotMatch(matchSyncPolicySource, /REPLAY_ONLY_MATCH_ACTIONS/u);
  assert.doesNotMatch(
    matchSyncPolicySource,
    /shouldReplayMatchOperation[\s\S]{0,250}setMatchRecordParticipants/u,
  );
  assert.doesNotMatch(
    matchSyncHandlerSource,
    /MATCH_RECORD_SETUP_ACTION|operation\.action === "setMatchRecordParticipants"/u,
  );
  assert.doesNotMatch(
    authoritativeStateSource,
    /case "setMatchRecordParticipants"|setMatchRecordParticipants,/u,
  );
  assert.doesNotMatch(repositoryAdapterSource, /setMatchRecordParticipants,/u);
});

test("client operation and optimistic reducer remain while production snapshots stay distinct", () => {
  assert.match(
    clientActionsSource,
    /action: "setMatchRecordParticipants", setup/u,
  );
  assert.match(
    clientOperationsSource,
    /MATCH_OPERATION_ONLY_ACTIONS = new Set\(\[[\s\S]*"setMatchRecordParticipants"/u,
  );
  assert.match(
    optimisticReducerSource,
    /export function setMatchRecordParticipants\(state, matchId, setup = \{\}\)/u,
  );
  assert.match(
    simulationSource,
    /team match record participant setup SQL reducer not used/u,
  );
  assert.match(
    simulationSource,
    /individual match record participant setup SQL reducer not used/u,
  );
  assert.match(logicDocSource, /서버는 `setMatchRecordParticipants`[^]*전체 경기 snapshot을 덮어쓰지 않는다/u);
  assert.match(logicDocSource, /`teamRosterSnapshot`[^]*`match_record_archives`/u);
  assert.match(storageDocSource, /server no longer replays this mutation in JS or writes a full match snapshot/u);
  assert.match(storageDocSource, /competitive MMR snapshots[^]*immutable record archives/u);
});
