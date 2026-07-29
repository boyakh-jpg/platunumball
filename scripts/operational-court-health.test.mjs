import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("synthetic c1..c12 courts stay deleted from current data", async () => {
  const [directoryCleanup, logic] = await Promise.all([
    readSource("supabase/migrations/20260722210000_court_database_admin_and_canonical_names.sql"),
    readSource("docs/logic-and-terminology.md"),
  ]);

  assert.match(directoryCleanup, /where id in \('c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'\)/i);
  assert.match(directoryCleanup, /delete from public\.approved_courts[\s\S]*rankball_removed_demo_courts/i);
  assert.match(logic, /`c1\.\.c12`[\s\S]*`deletedBuiltInCourtResidue`/);
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
