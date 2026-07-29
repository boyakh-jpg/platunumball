import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260729171000_remove_retired_match_rpc_entrypoints.sql",
  ),
  "utf8",
);
const unusedLegacyMigrationSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260730010000_remove_unused_legacy_rpc_entrypoints.sql",
  ),
  "utf8",
);
const branchRetirementSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260729170500_retire_match_action_roster_move_branch.sql",
  ),
  "utf8",
);
const finalizationSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260728150000_unified_match_finalization_policy.sql",
  ),
  "utf8",
);
const logicDocSource = await readFile(
  path.join(rootDir, "docs", "logic-and-terminology.md"),
  "utf8",
);
const storageDocSource = await readFile(
  path.join(rootDir, "docs", "data-storage-model.md"),
  "utf8",
);
const schemaSource = await readFile(
  path.join(rootDir, "supabase", "schema.sql"),
  "utf8",
);

const removedSignatures = [
  ["rankball_match_late_player_action", "text, text, text, text, jsonb, jsonb, jsonb, jsonb"],
  ["rankball_match_roster_move_action", "text, text, text, text, text, text, text"],
  ["rankball_recruiting_stat_recorder_action", "text, text, text, text"],
  ["rankball_match_resolve_dispute_action", "text, text, text, text"],
  ["rankball_match_terminal_action", "text, text, text"],
  ["rankball_match_list", "text, integer, text"],
  ["rankball_match_scorekeeper_scope_action", "text, text, text"],
  ["rankball_match_recorder_takeover_action", "text, text, text, text, text"],
  ["rankball_match_substitution_action", "text, text, text, text, text, text"],
];
const removedUnusedLegacySignatures = [
  ["rankball_current_recruiting_post_ids", "text, integer"],
  ["rankball_recruiting_ready_action", "text, text, boolean"],
  ["rankball_update_team_emblem_style", "text, text, text, boolean, text"],
];
const retiredOnlyFunctionNames = [
  "rankball_match_late_player_action",
  "rankball_match_roster_move_action",
  "rankball_recruiting_stat_recorder_action",
  "rankball_match_scorekeeper_scope_action",
  "rankball_match_recorder_takeover_action",
  "rankball_match_substitution_action",
  "rankball_current_recruiting_post_ids",
  "rankball_recruiting_ready_action",
  "rankball_update_team_emblem_style",
];

async function collectJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(absolutePath);
    return entry.isFile() && /\.(?:c|m)?js$/u.test(entry.name) ? [absolutePath] : [];
  }));
  return files.flat();
}

test("retired match entry points are dropped by exact signature without destructive data cleanup", () => {
  removedSignatures.forEach(([functionName, signature]) => {
    const escapedSignature = signature
      .split(", ")
      .map((typeName) => typeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("\\s*,\\s*");
    assert.match(
      migrationSource,
      new RegExp(
        `drop function if exists public\\.${functionName}\\(\\s*${escapedSignature}\\s*\\)`,
        "u",
      ),
    );
  });

  const executableSql = migrationSource.replace(/--[^\r\n]*/gu, "");
  assert.doesNotMatch(executableSql, /\bcascade\b/iu);
  assert.doesNotMatch(executableSql, /\b(?:delete\s+from|truncate|drop\s+table)\b/iu);
  assert.match(migrationSource, /pg_get_functiondef\(proc\.oid\)/u);
  assert.match(migrationSource, /retired_rpc_internal_dependency/u);
  assert.doesNotMatch(
    migrationSource,
    /drop function if exists public\.rankball_match_finalize_locked\(\s*text\s*,\s*text\s*,\s*text\s*\)/u,
  );
});

test("unused legacy RPC entry points are retired by exact signature", () => {
  removedUnusedLegacySignatures.forEach(([functionName, signature]) => {
    const escapedSignature = signature
      .split(", ")
      .map((typeName) => typeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("\\s*,\\s*");
    assert.match(
      unusedLegacyMigrationSource,
      new RegExp(
        `drop function if exists public\\.${functionName}\\(\\s*${escapedSignature}\\s*\\)`,
        "u",
      ),
    );
    assert.match(
      unusedLegacyMigrationSource,
      new RegExp(
        `'${functionName}'[\\s\\S]*?'public\\.${functionName}\\([^']+\\)'[\\s\\S]*?'retired',\\s*false`,
        "u",
      ),
    );
  });

  const executableSql = unusedLegacyMigrationSource.replace(/--[^\r\n]*/gu, "");
  assert.doesNotMatch(executableSql, /\bcascade\b/iu);
  assert.doesNotMatch(executableSql, /\b(?:delete\s+from|truncate|drop\s+table)\b/iu);
  assert.match(unusedLegacyMigrationSource, /pg_get_functiondef\(proc\.oid\)/u);
  assert.match(unusedLegacyMigrationSource, /unused_legacy_rpc_internal_dependency/u);
});

test("obsolete match action dispatch is removed before the roster-move entry point", () => {
  assert.match(
    branchRetirementSource,
    /public\.rankball_match_action\(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean\)/u,
  );
  assert.match(
    branchRetirementSource,
    /safe_action in \('handoffMatchRecorder', 'substituteMatchPlayer'\)[^]*?rankball_match_roster_move_action\(/u,
  );
  assert.match(
    branchRetirementSource,
    /position\(obsolete_branch in function_def\) = 0[^]*?retired_match_action_branch_shape_changed/u,
  );
  assert.match(
    branchRetirementSource,
    /patched_def := replace\(function_def, obsolete_branch, ''\);\s*execute patched_def;/u,
  );
  assert.match(
    branchRetirementSource,
    /retired_match_action_branch_still_present/u,
  );

  const executableSql = branchRetirementSource.replace(/--[^\r\n]*/gu, "");
  assert.doesNotMatch(executableSql, /\bcascade\b/iu);
  assert.doesNotMatch(
    executableSql,
    /\b(?:delete\s+from|truncate|drop\s+(?:table|function))\b/iu,
  );
});

test("removed recorder entry points remain registry tombstones and health requires absence", () => {
  [
    "rankball_match_scorekeeper_scope_action_legacy",
    "rankball_match_recorder_takeover_action_legacy",
    "rankball_match_substitution_action_legacy",
  ].forEach((contractName) => {
    assert.match(
      migrationSource,
      new RegExp(`${contractName}[\\s\\S]*?'retired',\\s*false`, "u"),
    );
  });
  [
    "latePlayerRpcRetired",
    "legacyRosterMoveRpcRetired",
    "recruitingStatRecorderRpcRetired",
    "legacyDisputeResolutionRpcRetired",
    "legacyTerminalRpcRetired",
    "legacyMatchListRpcRetired",
    "scorekeeperScopeRpcRetired",
    "takeoverRpcRetired",
    "legacySubstitutionRpcRetired",
  ].forEach((checkName) => {
    assert.match(migrationSource, new RegExp(`'${checkName}'`, "u"));
  });
  assert.match(
    migrationSource,
    /'takeoverRequestArchive',\s*to_regclass\('public\.match_recorder_takeover_requests'\) is not null/u,
  );
  assert.doesNotMatch(migrationSource, /'takeoverRpc',\s*to_regprocedure/u);
});

test("schema snapshot tail owns the final retired RPC state", () => {
  const correctionMarker = "-- Current RPC contract snapshot correction.";
  const correctionIndex = schemaSource.lastIndexOf(correctionMarker);
  assert.notEqual(correctionIndex, -1);
  const correctionSource = schemaSource.slice(correctionIndex);
  const executableCorrection = correctionSource.replace(/--[^\r\n]*/gu, "");

  assert.match(
    correctionSource,
    /create table if not exists public\.rankball_rpc_contract_registry/u,
  );
  assert.match(
    correctionSource,
    /create or replace function public\.rankball_rpc_contract_health/u,
  );
  assert.match(
    correctionSource,
    /\('general', 'rankball_match_roster_transition_action', 'rankball_match_roster_transition_action', 'public\.rankball_match_roster_transition_action\(text,text,text,text,text,text,text,text\)', 'active', true\)/u,
  );
  assert.match(
    correctionSource,
    /\('authoritative', 'rankball_match_finalize_locked', 'rankball_match_finalize_locked', 'public\.rankball_match_finalize_locked\(text,text,text,boolean\)', 'active', true\)/u,
  );
  assert.ok(
    correctionSource.indexOf("retired_match_action_branch_shape_changed")
      < correctionSource.indexOf(
        "drop function if exists public.rankball_match_roster_move_action",
      ),
    "schema must retire the stale match_action branch before dropping roster-move",
  );
  assert.doesNotMatch(executableCorrection, /\bcascade\b/iu);
  assert.doesNotMatch(
    executableCorrection,
    /\b(?:delete\s+from|truncate|drop\s+table)\b/iu,
  );

  removedSignatures.forEach(([functionName, signature]) => {
    const compactSignature = signature.replaceAll(" ", "");
    const escapedSignature = signature
      .split(", ")
      .map((typeName) => typeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("\\s*,\\s*");
    const dropPattern = new RegExp(
      `drop function if exists public\\.${functionName}\\(\\s*${escapedSignature}\\s*\\)`,
      "gu",
    );
    const dropMatches = [...schemaSource.matchAll(dropPattern)];
    assert.ok(dropMatches.length > 0, `schema drop missing: ${functionName}`);
    const finalDropIndex = dropMatches.at(-1).index;

    const finalCreateIndex = schemaSource.lastIndexOf(
      `create or replace function public.${functionName}(`,
    );
    assert.ok(
      finalDropIndex > finalCreateIndex,
      `retired RPC is recreated after final drop: ${functionName}`,
    );

    const grantPattern = new RegExp(
      `grant execute on function public\\.${functionName}\\(\\s*${escapedSignature}\\s*\\)\\s+to service_role`,
      "giu",
    );
    const grantMatches = [...schemaSource.matchAll(grantPattern)];
    const finalGrantIndex = grantMatches.at(-1)?.index ?? -1;
    assert.ok(
      finalDropIndex > finalGrantIndex,
      `service_role grant survives final drop: ${functionName}(${compactSignature})`,
    );
  });

  removedUnusedLegacySignatures.forEach(([functionName, signature]) => {
    const escapedSignature = signature
      .split(", ")
      .map((typeName) => typeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("\\s*,\\s*");
    const dropPattern = new RegExp(
      `drop function if exists public\\.${functionName}\\(\\s*${escapedSignature}\\s*\\)`,
      "gu",
    );
    const dropMatches = [...schemaSource.matchAll(dropPattern)];
    assert.ok(dropMatches.length > 0, `schema drop missing: ${functionName}`);
    const finalDropIndex = dropMatches.at(-1).index;
    const finalCreateIndex = schemaSource.lastIndexOf(
      `create or replace function public.${functionName}(`,
    );
    assert.ok(
      finalDropIndex > finalCreateIndex,
      `unused legacy RPC is recreated after final drop: ${functionName}`,
    );
    assert.match(
      correctionSource,
      new RegExp(
        `'${functionName}'[\\s\\S]*?'public\\.${functionName}\\([^']+\\)'[\\s\\S]*?'retired',\\s*false`,
        "u",
      ),
    );
  });

  [
    "latePlayerRpcRetired",
    "legacyRosterMoveRpcRetired",
    "recruitingStatRecorderRpcRetired",
    "legacyDisputeResolutionRpcRetired",
    "legacyTerminalRpcRetired",
    "legacyMatchListRpcRetired",
    "scorekeeperScopeRpcRetired",
    "takeoverRpcRetired",
    "legacySubstitutionRpcRetired",
  ].forEach((checkName) => {
    assert.match(correctionSource, new RegExp(`'${checkName}'`, "u"));
  });

  assert.doesNotMatch(
    correctionSource,
    /drop function if exists public\.rankball_match_finalize_locked\(\s*text\s*,\s*text\s*,\s*text\s*\)/u,
  );
  assert.doesNotMatch(
    correctionSource,
    /drop function if exists public\.rankball_tournament_match_roster_(?:current|legacy)/u,
  );
  assert.match(correctionSource, /select pg_notify\('pgrst', 'reload schema'\);\s*commit;\s*$/u);
});

test("runtime JavaScript has no literal call to removed RPC names", async () => {
  const serverFiles = await collectJavaScriptFiles(path.join(rootDir, "server"));
  const sources = await Promise.all(serverFiles.map((filePath) => readFile(filePath, "utf8")));
  const serverSource = sources.join("\n");

  retiredOnlyFunctionNames.forEach((functionName) => {
    assert.doesNotMatch(
      serverSource,
      new RegExp(`\\.rpc\\(\\s*["']${functionName}["']`, "u"),
      `runtime still calls retired RPC: ${functionName}`,
    );
  });
  assert.match(
    serverSource,
    /\.rpc\(\s*["']rankball_match_resolve_dispute_action["'][^]*?p_resolution_reason:/u,
  );
  assert.match(
    serverSource,
    /\.rpc\(\s*["']rankball_match_terminal_action["'][^]*?p_reason:/u,
  );
  assert.match(
    serverSource,
    /\.rpc\(\s*["']rankball_match_list["'][^]*?p_active_only:/u,
  );
});

test("three-argument finalizer stays deny-only until its internal caller is extracted", () => {
  assert.match(
    finalizationSource,
    /return public\.rankball_match_finalize_locked\(\s*p_actor_profile_id,\s*safe_match_id,\s*coalesce\(/u,
  );
  assert.match(logicDocSource, /3인자 `rankball_match_finalize_locked`[^]*내부 의존/u);
  assert.match(storageDocSource, /three-argument finalizer[^]*internal dependency/u);
});
