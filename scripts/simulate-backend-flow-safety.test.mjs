import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PRODUCTION_REF = "olzxextphxpniwiiwwda";
const TEST_REF = "rankballtestproject01";
const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "simulate-backend-flow.mjs");
const scriptSource = readFileSync(scriptPath, "utf8");
const exactCleanupMigration = readFileSync(
  join(dirname(scriptPath), "../supabase/migrations/20260725013000_exact_simulation_artifact_cleanup.sql"),
  "utf8",
);
const exactCleanupHardeningMigration = readFileSync(
  join(dirname(scriptPath), "../supabase/migrations/20260725016000_harden_exact_simulation_cleanup.sql"),
  "utf8",
);
const autoFinalizeMigration = readFileSync(
  join(dirname(scriptPath), "../supabase/migrations/20260725018500_auto_finalize_missing_player_stats.sql"),
  "utf8",
);
const exactCleanupIdempotentMigration = readFileSync(
  join(dirname(scriptPath), "../supabase/migrations/20260725020000_idempotent_exact_simulation_cleanup.sql"),
  "utf8",
);
const autoFinalizeNormalizationMigration = readFileSync(
  join(dirname(scriptPath), "../supabase/migrations/20260725020500_restore_auto_finalize_dispute_normalization.sql"),
  "utf8",
);
const unifiedFinalizationMigration = readFileSync(
  join(dirname(scriptPath), "../supabase/migrations/20260728150000_unified_match_finalization_policy.sql"),
  "utf8",
);
const courtRequestQuarantineMigration = readFileSync(
  join(dirname(scriptPath), "../supabase/migrations/20260727143000_preserve_approved_court_requests_in_quarantine.sql"),
  "utf8",
);
const schemaHealthSource = readFileSync(
  join(dirname(scriptPath), "../server/api/system/schema-health.js"),
  "utf8",
);
const rpcContractRegistryMigration = readFileSync(
  join(
    dirname(scriptPath),
    "../supabase/migrations/20260729162000_align_rpc_grant_health_with_current_policy.sql",
  ),
  "utf8",
);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "rankball-sim-safety-"));

function childEnvironment(projectRef, url = `https://${projectRef}.supabase.co`) {
  return {
    SystemRoot: process.env.SystemRoot || "",
    WINDIR: process.env.WINDIR || "",
    PATH: process.env.PATH || "",
    TEMP: process.env.TEMP || "",
    TMP: process.env.TMP || "",
    SUPABASE_URL: url,
    ...(projectRef ? { SUPABASE_PROJECT_ID: projectRef } : {}),
  };
}

function runSafetyCheck(args, env) {
  const result = spawnSync(process.execPath, [scriptPath, "--safety-check-only", ...args], {
    cwd: temporaryDirectory,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  return result;
}

test.after(() => {
  assert.ok(temporaryDirectory.startsWith(tmpdir()));
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("production target is blocked without an exact CLI confirmation", () => {
  const result = runSafetyCheck([], childEnvironment(PRODUCTION_REF));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"environment":"production"/);
  assert.match(result.stderr, new RegExp(`--confirm-production=${PRODUCTION_REF}`));
});

test("production target passes a non-network safety check with exact confirmation", () => {
  const result = runSafetyCheck(
    [`--confirm-production=${PRODUCTION_REF}`],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"directSupabaseRef":"olzxextphxpniwiiwwda"/);
  assert.doesNotMatch(result.stderr, /https:\/\//);
});

test("BOXTIER production API host requires the production confirmation", () => {
  const blocked = runSafetyCheck(
    ["--base-url=https://boxtier.kr"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, new RegExp(`--confirm-production=${PRODUCTION_REF}`));
  assert.doesNotMatch(blocked.stderr, /remote API project ref is required/);

  const confirmed = runSafetyCheck(
    ["--base-url=https://boxtier.kr", `--confirm-production=${PRODUCTION_REF}`],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(confirmed.status, 0, confirmed.stderr);
  assert.match(confirmed.stderr, /"apiHost":"boxtier\.kr"/);
});

test("production target rejects a confirmation for another project", () => {
  const result = runSafetyCheck(
    ["--confirm-production=anotherprojectref"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`--confirm-production=${PRODUCTION_REF}`));
});

test("dedicated test project does not require production confirmation", () => {
  const result = runSafetyCheck([], childEnvironment(TEST_REF));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"environment":"test"/);
  assert.match(result.stderr, new RegExp(`"directSupabaseRef":"${TEST_REF}"`));
});

test("remote test API requires and accepts a matching project ref", () => {
  const result = runSafetyCheck(
    ["--base-url=https://boxtier-test.example.com", `--remote-project-ref=${TEST_REF}`],
    childEnvironment(TEST_REF),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"environment":"test"/);
  assert.match(result.stderr, /"apiHost":"boxtier-test\.example\.com"/);
});

test("unrecognized remote API host is blocked without a declared project ref", () => {
  const result = runSafetyCheck(
    ["--base-url=https://boxtier-test.example.com"],
    childEnvironment(TEST_REF),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /remote API project ref is required/);
});

test("remote and direct project ref mismatch is blocked", () => {
  const result = runSafetyCheck(
    ["--base-url=https://boxtier-test.example.com", "--remote-project-ref=anotherprojectref"],
    childEnvironment(TEST_REF),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /remote API project ref does not match/);
});

test("repeat and cleanup retry values above hard limits are blocked", () => {
  const repeatResult = runSafetyCheck(
    [`--confirm-production=${PRODUCTION_REF}`, "--repeat=2"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(repeatResult.status, 1);
  assert.match(repeatResult.stderr, /repeat exceeds hard limit 1/);

  const retryResult = runSafetyCheck(
    [`--confirm-production=${PRODUCTION_REF}`, "--max-retries=2"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(retryResult.status, 1);
  assert.match(retryResult.stderr, /max-retries exceeds hard limit 1/);
});

test("repeat cannot be disabled to fake a successful simulation", () => {
  const result = runSafetyCheck(
    [`--confirm-production=${PRODUCTION_REF}`, "--repeat=0"],
    childEnvironment(PRODUCTION_REF),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /repeat must be exactly 1/);
});

test("local Supabase target remains available without production confirmation", () => {
  const result = runSafetyCheck([], childEnvironment("", "http://127.0.0.1:54321"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /"environment":"local"/);
});

test("ranked one-on-one simulation sends the central competitive purpose", () => {
  const scenarioStart = scriptSource.indexOf("async function runOneOnOneScenario");
  const scenarioEnd = scriptSource.indexOf("async function runMatchReminderCancelScenario", scenarioStart);
  const scenarioSource = scriptSource.slice(scenarioStart, scenarioEnd);

  assert.ok(scenarioStart >= 0 && scenarioEnd > scenarioStart);
  assert.match(scenarioSource, /matchPurpose: ranked \? "competitive" : "friendly"/);
  assert.doesNotMatch(scenarioSource, /matchPurpose: "friendly"/);
});

test("no-referee dispute simulation remains score-only", () => {
  const scenarioStart = scriptSource.indexOf("async function runDisputeResumeThumbsScenario");
  const scenarioEnd = scriptSource.indexOf("async function runRecruitingActorScenario", scenarioStart);
  const scenarioSource = scriptSource.slice(scenarioStart, scenarioEnd);

  assert.ok(scenarioStart >= 0 && scenarioEnd > scenarioStart);
  assert.match(scenarioSource, /setMatchScoreByIncrements/);
  assert.match(scenarioSource, /kind: "team_scores"/);
  assert.match(scenarioSource, /requestedScoreA: 3/);
  assert.match(scenarioSource, /requestedScoreB: 15/);
  assert.match(scenarioSource, /baseRevision: Math\.max/);
  assert.match(scenarioSource, /decision: "accepted"/);
  assert.match(scenarioSource, /Object\.keys\(match\?\.result\?\.playerStats \?\? \{\}\)\.length === 0/);
  assert.doesNotMatch(scenarioSource, /makePointsOnlyResult/);
  assert.doesNotMatch(scenarioSource, /disputeDraft\.playerStats/);
});

test("one-on-one simulation records no-referee scores before ending the match", () => {
  const scenarioStart = scriptSource.indexOf("async function runOneOnOneScenario");
  const scenarioEnd = scriptSource.indexOf("async function runMatchReminderCancelScenario", scenarioStart);
  const scenarioSource = scriptSource.slice(scenarioStart, scenarioEnd);
  const liveScoreIndex = scenarioSource.search(/if \(!refereeWanted\) \{\r?\n\s+scoreWrite = await setMatchScoreByIncrements/);
  const endMatchIndex = scenarioSource.indexOf("action: \"endMatch\"");
  const refereePostgameIndex = scenarioSource.search(/if \(refereeWanted\) \{\r?\n\s+scoreWrite = await setMatchScoreByIncrements/);

  assert.ok(scenarioStart >= 0 && scenarioEnd > scenarioStart);
  assert.ok(liveScoreIndex >= 0 && liveScoreIndex < endMatchIndex);
  assert.ok(refereePostgameIndex > endMatchIndex);
});

test("simulation cleanup is exact, bounded, and guarded from user matches", () => {
  assert.match(scriptSource, /rankball_cleanup_simulation_artifacts_exact/);
  assert.doesNotMatch(scriptSource, /\.rpc\("rankball_cleanup_simulation_artifacts"\)/);
  assert.match(scriptSource, /standaloneMatchIds\.slice\(index \* 10, \(index \+ 1\) \* 10\)/);
  assert.match(scriptSource, /tournamentMatchIdsForCleanup\.slice\(index \* 10, \(index \+ 1\) \* 10\)/);
  assert.match(scriptSource, /await applyCleanupBatch\(matchBatch, \[\]\)/);
  assert.match(scriptSource, /await applyCleanupBatch\(matchBatch, \[tournamentId\]\)/);
  assert.match(scriptSource, /await applyCleanupBatch\(\[\], \[tournamentId\]\)/);
  assert.match(exactCleanupMigration, /cardinality\(safe_match_ids\) > 10/);
  assert.match(exactCleanupMigration, /simulation_cleanup_match_id_required/);
  assert.match(exactCleanupMigration, /rankball\.skip_derived_refresh/);
  assert.match(scriptSource, /trackedMatchIds\.filter\(\(matchId\) => matchId\.startsWith\("sim_m_"\)\)/);
  assert.match(exactCleanupHardeningMigration, /left join public\.matches match_row/);
  assert.match(exactCleanupHardeningMigration, /match_row\.id is null/);
  assert.match(exactCleanupHardeningMigration, /remaining_matches = 0 and remaining_tournaments = 0/);
  assert.match(exactCleanupIdempotentMigration, /match_row\.id is not null/);
  assert.match(exactCleanupIdempotentMigration, /rankball_rebuild_profile_match_summary/);
  assert.match(exactCleanupIdempotentMigration, /rankball_refresh_court_metrics/);
  assert.match(exactCleanupIdempotentMigration, /'derivedRefreshCompleted', true/);
  assert.match(scriptSource, /if \(!derivedRefreshCompleted\)/);
  assert.match(schemaHealthSource, /projectActiveRpcContractChecks/);
  assert.match(
    rpcContractRegistryMigration,
    /'rankball_cleanup_simulation_artifacts_exact'[\s\S]*'active', true/,
  );
});

test("maintenance quarantine preserves terminal court-request decisions", () => {
  assert.match(courtRequestQuarantineMigration, /request\.status not in \(''approved'', ''rejected'', ''simulation_closed''\)/);
  assert.match(courtRequestQuarantineMigration, /rankball_quarantine_simulation_artifacts_unexpected_definition/);
  assert.doesNotMatch(courtRequestQuarantineMigration, /drop\s+table|truncate\s+table|delete\s+from/i);
});

test("legacy auto-finalization stat fill is superseded by explicit referee completeness", () => {
  assert.match(autoFinalizeMigration, /'auto_finalize'/);
  assert.match(autoFinalizeMigration, /on conflict \(match_id, user_id\) do nothing/);
  assert.match(autoFinalizeMigration, /current_match\.reserve_players/);
  assert.match(autoFinalizeMigration, /rankball_match_finalize_locked\(operator_id, safe_match_id, 'autoConfirmMatch'\)/);
  assert.doesNotMatch(autoFinalizeMigration, /update public\.player_match_stats/i);
  assert.match(autoFinalizeNormalizationMigration, /rankball_normalize_dispute_minutes\(current_match\.dispute_minutes\)/);
  assert.match(unifiedFinalizationMigration, /match_approval_stats_incomplete/);
  assert.match(unifiedFinalizationMigration, /stat\.record_source in \('referee', 'dispute_operator'\)/);
  assert.doesNotMatch(unifiedFinalizationMigration, /insert into public\.player_match_stats/i);
});

test("production simulation verifies one-representative public team joins", () => {
  const tailOnlyBranch = scriptSource.match(
    /else if \(tailOnly\) \{([\s\S]*?)\n\s*\} else if \(recordPermissionsOnly\)/,
  )?.[1] ?? "";
  assert.match(tailOnlyBranch, /runPublicTeamRegionFeedScenario/);
  assert.match(tailOnlyBranch, /label: "public_team_region_feed"/);
  assert.match(scriptSource, /playerIds: \[hostId\]/);
  assert.match(scriptSource, /rejectOpponentNonCaptainRepresentative/);
  assert.match(scriptSource, /recruiting_team_captain_required/);
  assert.match(scriptSource, /joinOpponentRepresentative/);
  assert.match(scriptSource, /opponentApplication\.playerIds/);
});

test("tournament simulation satisfies referee governance before generating fixtures", () => {
  assert.match(scriptSource, /ensureSimulationRefereeEligibility\(creatorId/);
  assert.match(scriptSource, /ensureSimulationRefereeEligibility\(refereeId/);
  assert.match(scriptSource, /ensureSimulationRefereeEligibility\(refereeId, `\$\{label\}_neutral`, 7\)/);
  assert.match(scriptSource, /refereeIds: tournamentReferees\.refereeIds/);
  assert.match(scriptSource, /action: "approveTournamentReferee"/);
  assert.match(scriptSource, /action: "startCommunityTournament"/);
  assert.match(scriptSource, /const refereeId = match\.refereeId/);
  assert.match(scriptSource, /getTestLoginForProfileId\(refereeId\)/);
});

test("admin audit verification relies on exact artifact ids without a client clock bound", () => {
  const scenarioStart = scriptSource.indexOf("async function runAdminControlScenario");
  const scenarioEnd = scriptSource.indexOf("async function runProfilePrivacyScenario", scenarioStart);
  const scenarioSource = scriptSource.slice(scenarioStart, scenarioEnd);

  assert.ok(scenarioStart >= 0 && scenarioEnd > scenarioStart);
  assert.match(scenarioSource, /row\.appointment_id === appointed\.appointmentId/);
  assert.match(
    scenarioSource,
    /row\.payload\?\.disciplinaryActionId === disciplined\.disciplinaryActionId/,
  );
  assert.doesNotMatch(scenarioSource, /\.gte\("created_at"/);
  assert.doesNotMatch(scenarioSource, /Date\.now\(\) - 1000/);
});
