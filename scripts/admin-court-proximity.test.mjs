import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("30m 근접 구장은 자동 그룹화하고 실제 코트 수로 초과 행을 비활성화한다", async () => {
  const migration = await read("supabase/migrations/20260722234500_court_proximity_grouping.sql");

  assert.match(migration, /rankball_court_distance_m/);
  assert.match(migration, /<= 30\.0/);
  assert.match(migration, /rankball_admin_auto_group_nearby_courts/);
  assert.match(migration, /rankball_admin_verify_nearby_court_count/);
  assert.match(migration, /p_actual_count is null or p_actual_count < 1/);
  assert.doesNotMatch(migration, /p_actual_count\s*>/);
  assert.match(migration, /proximity_excess = ranked\.unit_no > p_actual_count/);
  assert.match(migration, /else 'disabled'/);
  assert.match(migration, /admin_review_scenario = case when ranked\.unit_no > p_actual_count then 'duplicate'/);
  assert.match(migration, /jsonb_build_object\('facilityName', safe_facility\)/);
  assert.match(migration, /jsonb_build_object\('courtUnit', null\)/);
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\.approved_courts\b/i);
});

test("관리 API는 근접 검사와 숫자 검증을 별도 operation으로 제공한다", async () => {
  const api = await read("server/api/admin/courts.js");

  assert.match(api, /operation === "proximity"/);
  assert.match(api, /operation === "verifyCount"/);
  assert.match(api, /rankball_admin_auto_group_nearby_courts/);
  assert.match(api, /rankball_admin_verify_nearby_court_count/);
  assert.match(api, /Number\.isSafeInteger\(actualCount\)/);
});

test("검수 카드는 예 아니오 대신 상한 없는 숫자 입력과 초과 예고를 표시한다", async () => {
  const panel = await read("src/components/admin/CourtDatabasePanel.jsx");

  assert.match(panel, /이 장소에는 실제 코트가 몇 개 있나요\?/);
  assert.match(panel, /type="number"/);
  assert.match(panel, /min="1"/);
  assert.doesNotMatch(panel, /max="6"/);
  assert.match(panel, /초과 .*개 행 중복 비활성화/);
  assert.match(panel, /코트 수 확정/);
});
