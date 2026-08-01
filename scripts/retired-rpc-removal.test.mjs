import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalFunctionLintSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260801003000_fix_canonical_function_lint.sql",
  ),
  "utf8",
);
const roomRuleVolatilitySource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260801004000_fix_room_rule_patch_volatility.sql",
  ),
  "utf8",
);
const internalLegacyHelperGrantSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260801009000_harden_internal_legacy_helpers.sql",
  ),
  "utf8",
);
const remainingInternalHelperGrantSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260801010000_harden_remaining_internal_helpers.sql",
  ),
  "utf8",
);
const schemaHealthRequirementsSource = await readFile(
  path.join(rootDir, "server", "api", "system", "schemaHealthRequirements.js"),
  "utf8",
);
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
const remainingOverloadMigrationSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260730013000_remove_remaining_unused_rpc_overloads.sql",
  ),
  "utf8",
);
const internalHelperGrantMigrationSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260730014000_harden_internal_room_update_helpers.sql",
  ),
  "utf8",
);
const internalWrapperRemovalSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260730016000_remove_internal_legacy_rpc_wrappers.sql",
  ),
  "utf8",
);
const matchRecordParticipantsSource = await readFile(
  path.join(
    rootDir,
    "supabase",
    "migrations",
    "20260730017000_match_record_participants_operation.sql",
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

function normalizeExecutableSql(source) {
  return source
    .replace(/--[^\r\n]*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

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
const removedUnusedOverloadSignatures = [
  ["rankball_approve_court_request", "text, integer, text"],
  ["rankball_invite_team_member", "text, text, text, text"],
  ["rankball_save_profile_icon_settings", "text, text, text, text, boolean, text"],
  ["rankball_match_terminal_action_pre_cancel_policy", "text, text, text"],
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

test("remaining unused overloads are dependency-checked and retired by exact signature", () => {
  removedUnusedOverloadSignatures.forEach(([functionName, signature]) => {
    const escapedSignature = signature
      .split(", ")
      .map((typeName) => typeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("\\s*,\\s*");
    assert.match(
      remainingOverloadMigrationSource,
      new RegExp(
        `drop function if exists public\\.${functionName}\\(\\s*${escapedSignature}\\s*\\)`,
        "u",
      ),
    );
  });

  [
    "rankball_approve_court_request_legacy_3arg",
    "rankball_invite_team_member_4",
    "rankball_save_profile_icon_settings_6",
    "rankball_match_terminal_action_pre_cancel_policy_legacy_3arg",
  ].forEach((contractName) => {
    assert.match(
      remainingOverloadMigrationSource,
      new RegExp(`${contractName}[\\s\\S]*?'retired',\\s*false`, "u"),
    );
  });
  assert.match(
    remainingOverloadMigrationSource,
    /'rankball_approve_court_request'[\s\S]*?text,integer,text,jsonb\)'[\s\S]*?'active',\s*true/u,
  );
  assert.match(remainingOverloadMigrationSource, /from pg_depend dependency/u);
  assert.match(remainingOverloadMigrationSource, /pg_get_functiondef\(proc\.oid\)/u);
  assert.match(
    remainingOverloadMigrationSource,
    /current_profile\.avatar_background_enabled/u,
  );
  assert.match(
    remainingOverloadMigrationSource,
    /rankball_match_terminal_action_pre_cancel_reason\(text,text,text,text\)/u,
  );

  const executableSql = remainingOverloadMigrationSource.replace(/--[^\r\n]*/gu, "");
  assert.doesNotMatch(executableSql, /\bcascade\b/iu);
  assert.doesNotMatch(
    executableSql,
    /\b(?:delete\s+from|truncate|drop\s+table)\b/iu,
  );
  assert.doesNotMatch(
    remainingOverloadMigrationSource,
    /drop function if exists public\.rankball_match_finalize_locked\(\s*text\s*,\s*text\s*,\s*text\s*\)/u,
  );
});

test("current room-update wrappers own deny-only internal helpers", () => {
  [
    "rankball_match_room_update_action_pre_change_deadline",
    "rankball_recruiting_room_update_action_pre_change_deadline",
  ].forEach((functionName) => {
    assert.match(
      internalHelperGrantMigrationSource,
      new RegExp(
        `revoke all on function public\\.${functionName}\\(\\s*text\\s*,\\s*text\\s*,\\s*jsonb\\s*\\)\\s*from public, anon, authenticated, service_role`,
        "u",
      ),
    );
    assert.match(
      internalHelperGrantMigrationSource,
      new RegExp(`'rpc_grant:internal_helper:' \\|\\| helper\\.name`, "u"),
    );
  });
  assert.match(
    internalHelperGrantMigrationSource,
    /pg_get_functiondef\(recruiting_wrapper\)/u,
  );
  assert.match(
    internalHelperGrantMigrationSource,
    /pg_get_functiondef\(match_wrapper\)/u,
  );

  const executableSql = internalHelperGrantMigrationSource.replace(/--[^\r\n]*/gu, "");
  assert.doesNotMatch(executableSql, /\bcascade\b/iu);
  assert.doesNotMatch(
    executableSql,
    /\b(?:delete\s+from|truncate|drop\s+(?:table|function))\b/iu,
  );
});

test("wrapper-only legacy helpers are owner-only and schema health watches them", () => {
  [
    "rankball_match_dispute_action_pre_points_bound",
    "rankball_cleanup_simulation_artifacts_legacy",
    "rankball_match_generate_pickup_assignment_pre_rating_scale_split",
  ].forEach((functionName) => {
    assert.match(
      internalLegacyHelperGrantSource,
      new RegExp(
        `revoke all on function public\\.${functionName}\\([^;]*?\\)\\s+from public, anon, authenticated, service_role`,
        "u",
      ),
    );
    assert.match(
      internalLegacyHelperGrantSource,
      new RegExp(`'rpc_grant:internal_helper:' \\|\\| helper\\.name[\\s\\S]*?'${functionName}'`, "u"),
    );
  });
  assert.doesNotMatch(
    internalLegacyHelperGrantSource.replace(/--[^\r\n]*/gu, ""),
    /\b(?:delete\s+from|truncate|drop\s+(?:table|function))\b/iu,
  );
});

test("remaining wrapper helper chains are owner-only and grant health watches them", () => {
  [
    "rankball_match_dispute_action_pre_score_policy",
    "rankball_match_generate_pickup_assignment_pre_reroll",
    "rankball_match_result_action_pre_turnovers",
    "rankball_match_room_update_action_pre_edit_once",
    "rankball_match_schedule_response_action_pre_deadline",
    "rankball_match_start_action_guarded_pre_change_deadline",
    "rankball_match_start_action_pre_server_time",
    "rankball_match_terminal_action_pre_cancel_reason",
    "rankball_recruiting_room_update_action_pre_edit_once",
    "rankball_recruiting_schedule_response_action_pre_deadline",
  ].forEach((functionName) => {
    assert.match(remainingInternalHelperGrantSource, new RegExp(functionName, "u"));
  });
  assert.match(
    remainingInternalHelperGrantSource,
    /revoke all on function %s from public, anon, authenticated, service_role/u,
  );
  assert.match(
    remainingInternalHelperGrantSource,
    /'rpc_grant:internal_helper:' \|\| helper\.name/u,
  );
  assert.doesNotMatch(
    remainingInternalHelperGrantSource.replace(/--[^\r\n]*/gu, ""),
    /\b(?:delete\s+from|truncate|drop\s+(?:table|function))\b/iu,
  );
});

test("schema health covers critical runtime tables with bounded column probes", () => {
  [
    "admin_appointments",
    "admin_disciplinary_actions",
    "affiliations",
    "court_facility_info",
    "court_requests",
    "court_reviews",
    "match_clock_events",
    "match_clock_sessions",
    "rankball_admin_court_change_history",
    "rankball_admin_court_database",
    "referee_appointments",
    "referee_exam_attempts",
    "referee_requests",
    "reports",
    "team_invitations",
    "tournament_teams",
    "tournaments",
  ].forEach((tableName) => {
    assert.match(schemaHealthRequirementsSource, new RegExp(`^  ${tableName}: \\[`, "mu"));
  });
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
  const nextCorrectionMarker = "-- approved_courts is the only live court source.";
  const nextCorrectionIndex = schemaSource.indexOf(
    nextCorrectionMarker,
    correctionIndex,
  );
  assert.notEqual(nextCorrectionIndex, -1);
  const correctionSource = schemaSource.slice(
    correctionIndex,
    nextCorrectionIndex,
  );
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

  removedUnusedOverloadSignatures.forEach(([functionName, signature]) => {
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
      `unused overload is recreated after final drop: ${functionName}`,
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

test("schema snapshot final tail matches the remaining-overload migration", () => {
  const tailMarker = "-- Final remaining unused RPC overload retirement.";
  const tailIndex = schemaSource.lastIndexOf(tailMarker);
  assert.notEqual(tailIndex, -1);
  const nextTailMarker = "-- Final internal room-update helper grant hardening.";
  const nextTailIndex = schemaSource.indexOf(nextTailMarker, tailIndex);
  assert.notEqual(nextTailIndex, -1);
  const snapshotTail = schemaSource.slice(
    tailIndex + tailMarker.length,
    nextTailIndex,
  );
  assert.equal(
    normalizeExecutableSql(snapshotTail),
    normalizeExecutableSql(remainingOverloadMigrationSource),
  );
});

test("schema snapshot final tail matches internal helper grant hardening", () => {
  const tailMarker = "-- Final internal room-update helper grant hardening.";
  const tailIndex = schemaSource.lastIndexOf(tailMarker);
  assert.notEqual(tailIndex, -1);
  const nextTailMarker = "-- approved_courts is the only live court source.";
  const nextTailIndex = schemaSource.indexOf(nextTailMarker, tailIndex);
  assert.notEqual(nextTailIndex, -1);
  const snapshotTail = schemaSource.slice(
    tailIndex + tailMarker.length,
    nextTailIndex,
  );
  assert.equal(
    normalizeExecutableSql(snapshotTail),
    normalizeExecutableSql(internalHelperGrantMigrationSource),
  );
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
  assert.match(
    serverSource,
    /\.rpc\(\s*["']rankball_approve_court_request["'][^]*?approval_payload:/u,
  );
  assert.match(
    serverSource,
    /\.rpc\(\s*["']rankball_invite_team_member["'][^]*?p_role:/u,
  );
  assert.match(
    serverSource,
    /\.rpc\(\s*["']rankball_save_profile_icon_settings["'][^]*?p_background_enabled:/u,
  );
  assert.doesNotMatch(
    serverSource,
    /\.rpc\(\s*["']rankball_(?:match|recruiting)_room_update_action_pre_change_deadline["']/u,
  );
});

test("internal legacy wrappers are inlined and dropped by exact signature", () => {
  assert.match(
    internalWrapperRemovalSource,
    /return public\.rankball_match_live_finalize_action\(\s*p_actor_profile_id,\s*safe_match_id,\s*coalesce\(/u,
  );
  [
    "rankball_match_auto_finalize_action_pre_record_window",
    "rankball_match_resolve_dispute_action_pre_score_policy",
    "rankball_review_void_match_report",
  ].forEach((functionName) => {
    assert.match(
      internalWrapperRemovalSource,
      new RegExp(
        `${functionName}[^]*?replace\\(function_definition, legacy_call, live_call\\)`,
        "u",
      ),
    );
  });
  assert.match(
    internalWrapperRemovalSource,
    /internal_finalizer_legacy_call_remains/u,
  );
  assert.match(
    internalWrapperRemovalSource,
    /drop function if exists public\.rankball_match_finalize_locked\(\s*text,\s*text,\s*text\s*\)/u,
  );
  assert.match(
    internalWrapperRemovalSource,
    /drop function if exists public\.rankball_tournament_match_roster_action_legacy\(\s*text,\s*text,\s*jsonb\s*\)/u,
  );
  assert.match(internalWrapperRemovalSource, /bench_capacity[\s\S]*'\^\[0-3\]\$'/u);
  assert.match(internalWrapperRemovalSource, /teamRosterSnapshot/u);
  assert.match(internalWrapperRemovalSource, /internal_legacy_rpc_dependency/u);
  assert.doesNotMatch(
    internalWrapperRemovalSource.replace(/--[^\r\n]*/gu, ""),
    /\bcascade\b/iu,
  );
  assert.match(logicDocSource, /3인자 `rankball_match_finalize_locked`[^]*exact signature로 제거/u);
  assert.match(storageDocSource, /drops the three-argument overload without `CASCADE`/u);
});

test("schema snapshot tails match the internal-wrapper and repaired participant reducer", () => {
  const wrapperMarker = "-- Final internal legacy RPC wrapper removal.";
  const participantMarker = "-- Final match-record participant operation reducer.";
  const wrapperIndex = schemaSource.lastIndexOf(wrapperMarker);
  const participantIndex = schemaSource.lastIndexOf(participantMarker);
  assert.notEqual(wrapperIndex, -1);
  assert.notEqual(participantIndex, -1);
  assert.ok(wrapperIndex < participantIndex);
  assert.equal(
    normalizeExecutableSql(
      schemaSource.slice(wrapperIndex + wrapperMarker.length, participantIndex),
    ),
    normalizeExecutableSql(internalWrapperRemovalSource),
  );
  const repairedParticipantSource = [
    ["team_a_id text;", "selected_team_a_id text;"],
    ["team_b_id text;", "selected_team_b_id text;"],
    ["team_a_id :=", "selected_team_a_id :="],
    ["team_b_id :=", "selected_team_b_id :="],
    ["team_a_id is null", "selected_team_a_id is null"],
    ["team_b_id is null", "selected_team_b_id is null"],
    ["team_a_id = team_b_id", "selected_team_a_id = selected_team_b_id"],
    ["team.id = team_a_id", "team.id = selected_team_a_id"],
    ["team.id = team_b_id", "team.id = selected_team_b_id"],
    ["member.team_id = team_a_id", "member.team_id = selected_team_a_id"],
    ["member.team_id = team_b_id", "member.team_id = selected_team_b_id"],
    ["safe_match_id, team_a_id, team_a_captain_id", "safe_match_id, selected_team_a_id, team_a_captain_id"],
    ["safe_match_id, team_b_id, team_b_captain_id", "safe_match_id, selected_team_b_id, team_b_captain_id"],
    ["then team_a_id", "then selected_team_a_id"],
    ["then team_b_id", "then selected_team_b_id"],
  ].reduce(
    (source, [before, after]) => source.replaceAll(before, after),
    matchRecordParticipantsSource,
  );
  assert.equal(
    normalizeExecutableSql(schemaSource.slice(participantIndex + participantMarker.length)),
    normalizeExecutableSql(repairedParticipantSource),
  );
});

test("canonical DB functions keep executable dispute and tournament contracts", () => {
  assert.match(
    canonicalFunctionLintSource,
    /count\(\*\) from jsonb_object_keys\(requested_stats\)/u,
  );
  assert.match(
    canonicalFunctionLintSource,
    /replace\(function_definition, old_fragment, new_fragment\)/u,
  );
  assert.match(
    canonicalFunctionLintSource,
    /tournament_row\.status = 'draft'[^]*tournament_row\.sanction_status/u,
  );
  [
    "rankball_apply_room_rule_patch_pre_qr_attendance",
    "rankball_apply_room_rule_patch_pre_room_equipment",
    "rankball_apply_room_rule_patch_pre_duration_limit",
    "rankball_import_safe_date",
    "rankball_scheduled_at_kst",
  ].forEach((functionName) => {
    assert.match(
      canonicalFunctionLintSource,
      new RegExp(`alter function public\\.${functionName}\\([^;]+\\) stable`, "u"),
    );
  });
  assert.match(
    roomRuleVolatilitySource,
    /alter function public\.rankball_apply_room_rule_patch\(jsonb, jsonb, text\) stable/u,
  );
});
