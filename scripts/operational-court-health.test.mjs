import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("synthetic c1..c12 courts stay deleted from current data", async () => {
  const [directoryCleanup, logic, dataModel, constantsSource, courtDetail, mockDataSource, practiceSource] = await Promise.all([
    readSource("supabase/migrations/20260722210000_court_database_admin_and_canonical_names.sql"),
    readSource("docs/logic-and-terminology.md"),
    readSource("docs/data-storage-model.md"),
    readSource("shared/lib/constants.js"),
    readSource("server/api/courts/detail.js"),
    Promise.all([
      readSource("src/lib/mockData.js"),
      readSource("src/lib/mockData/baseState.js"),
      readSource("src/lib/mockData/baseStateHelpers.js"),
      readSource("src/lib/mockData/stateFinalizers.js"),
    ]).then((sources) => sources.join("\n")),
    readSource("src/lib/practiceMatch.js"),
  ]);

  assert.match(directoryCleanup, /where id in \('c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'\)/i);
  assert.match(directoryCleanup, /delete from public\.approved_courts[\s\S]*rankball_removed_demo_courts/i);
  assert.match(logic, /`c1\.\.c12`[\s\S]*`deletedBuiltInCourtResidue`/);
  assert.match(dataModel, /`c1\.\.c12`는 canonical 구장 ID가 아니다/);
  assert.match(constantsSource, /export const COURTS = Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(constantsSource, /\bid:\s*["']c(?:[1-9]|1[0-2])["']/);
  assert.doesNotMatch(courtDetail, /\bCOURTS\b|builtInCourt/);
  assert.match(courtDetail, /if \(!approvedCourtRow\)/);
  assert.doesNotMatch(courtDetail, /\.from\(["']courts["']\)|fromLegacyCourt/);
  assert.match(mockDataSource, /id:\s*"practice-court"/);
  assert.match(mockDataSource, /DELETED_SYNTHETIC_COURT_IDS/);
  assert.match(practiceSource, /id:\s*`\$\{PRACTICE_ID_PREFIX\}court`/);
});

test("legacy courts is a read-only archive and approved_courts is the live source", async () => {
  const [migration, adminSource, loadersSource, favoritesSource, schemaHealthSource] = await Promise.all([
    readSource("supabase/migrations/20260730015000_archive_legacy_courts_source.sql"),
    readSource("server/api/_supabaseAdmin.js"),
    readSource("src/data/repository/remote/loaders.js"),
    readSource("server/api/favorites/sync.js"),
    readSource("server/api/system/schema-health.js"),
  ]);

  assert.match(migration, /legacy_court_without_approved_row/);
  assert.match(migration, /references public\.approved_courts\(id\)[\s\S]*on delete set null not valid/i);
  assert.match(migration, /drop trigger if exists rankball_courts_feed_dependency_refresh on public\.courts/i);
  assert.match(migration, /Read-only legacy court archive/);
  assert.match(migration, /live_function_still_reads_legacy_courts/);
  assert.doesNotMatch(migration, /\b(?:delete\s+from|truncate\s+table|drop\s+table)\s+public\.courts\b/i);
  assert.doesNotMatch(
    migration,
    /insert\s+into\s+public\.approved_courts[\s\S]{0,300}select[\s\S]{0,300}from\s+public\.courts/i,
  );
  assert.doesNotMatch(adminSource, /\.from\(["']courts["']\)/);
  assert.doesNotMatch(loadersSource, /fetchRowsByIds\(["']courts["']|fetchOptionalRows\(["']courts["']/);
  assert.doesNotMatch(favoritesSource, /\.from\(["']courts["']\)/);
  assert.doesNotMatch(schemaHealthSource, /rankball_courts_feed_dependency_refresh/);
});

test("demo runtime strips deleted synthetic court references", async () => {
  const [{ COURTS }, { initialState, sourceDemoState }] = await Promise.all([
    import("../src/lib/constants.js"),
    import("../src/lib/mockData.js"),
  ]);
  const isDeletedSyntheticCourtId = (value) => /^c(?:[1-9]|1[0-2])$/.test(String(value ?? ""));
  const collectCourtIds = (state) => [
    ...(state.settings?.favoriteCourtIds ?? []),
    ...(state.settings?.approvedCourts ?? []).map((court) => court.id),
    ...(state.matches ?? []).map((match) => match.courtId),
    ...(state.recruitingPosts ?? []).map((post) => post.courtId),
    ...(state.tournaments ?? []).map((tournament) => tournament.courtId),
  ];

  assert.deepEqual(COURTS, []);
  assert.equal(collectCourtIds(sourceDemoState).some(isDeletedSyntheticCourtId), false);
  assert.equal(collectCourtIds(initialState).some(isDeletedSyntheticCourtId), false);
});

test("operational health rejects deleted synthetic court rows and references", async () => {
  const migration = await readSource("supabase/migrations/20260729161000_align_builtin_court_operational_health.sql");
  const newCheckStart = migration.indexOf("new_check constant text");
  const newCheckEnd = migration.indexOf("$contract$;", newCheckStart);
  const newCheck = migration.slice(newCheckStart, newCheckEnd);

  assert.match(migration, /rankball_operational_data_health/);
  assert.match(migration, /builtInCourtMissingApprovedRow/);
  assert.match(newCheck, /deletedBuiltInCourtResidue/);
  assert.match(newCheck, /from public\.approved_courts court[\s\S]*from public\.courts court/i);
  assert.match(newCheck, /from public\.matches match_row[\s\S]*from public\.recruiting_posts post[\s\S]*from public\.tournaments tournament[\s\S]*from public\.court_reviews review/i);
  assert.match(migration, /rankball_operational_data_health_unexpected_builtin_court_check/);
  assert.match(migration, /replace\(function_definition, E'\\r\\n', E'\\n'\)/);
  assert.match(migration, /grant execute on function public\.rankball_operational_data_health\(\)[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /\binsert\s+into\s+public\.approved_courts\b/i);
  assert.doesNotMatch(newCheck, /greatest\(0,\s*12\s*-\s*count/);
  assert.doesNotMatch(migration, /\b(?:delete|update|truncate)\s+(?:from\s+)?public\.(?:approved_courts|courts)\b/i);
  assert.doesNotMatch(migration, /\balter\s+table\b/i);
});

test("court review writes refresh only affected court metrics", async () => {
  const migration = await readSource("supabase/migrations/20260803130000_scope_court_review_metric_refresh.sql");

  assert.match(migration, /rankball_refresh_court_metrics_after_review/);
  assert.match(migration, /rankball_resolve_approved_court_id\(old\.court_id, old\.court_name\)/);
  assert.match(migration, /rankball_resolve_approved_court_id\(new\.court_id, new\.court_name\)/);
  assert.match(migration, /rankball_refresh_court_metrics\(new_court_id\)/);
  assert.doesNotMatch(migration, /rankball_refresh_all_court_metrics/);
});
