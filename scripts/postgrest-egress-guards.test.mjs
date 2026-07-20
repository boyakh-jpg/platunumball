import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("recruiting detail is initial-only and synthetic rooms never reach its API", async () => {
  const [recruitingSource, matchesSource, hookSource] = await Promise.all([
    readSource("src/pages/Recruiting.jsx"),
    readSource("src/pages/Matches.jsx"),
    readSource("src/hooks/useAppData.js"),
  ]);
  assert.doesNotMatch(recruitingSource, /RECRUITING_ROOM_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(matchesSource, /RECRUITING_ROOM_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(recruitingSource, /setInterval/);
  assert.doesNotMatch(matchesSource, /setInterval/);
  assert.match(recruitingSource, /startsWith\("match-room-"\)/);
  assert.ok((hookSource.match(/startsWith\("match-room-"\)/g) ?? []).length >= 2);
  assert.match(recruitingSource, /roomDetailReadyKey !== roomDetailRequestKey/);
});

test("admin bootstraps profile-only and loads one bounded section", async () => {
  const [adminSource, hookSource] = await Promise.all([
    readSource("src/pages/Admin.jsx"),
    readSource("src/hooks/useAppData.js"),
  ]);
  assert.doesNotMatch(adminSource, /loadAdminContext/);
  assert.doesNotMatch(adminSource, /loadDirectory/);
  assert.doesNotMatch(adminSource, /\[app\.actions\]/);
  assert.match(adminSource, /loadAdminSection\?\.\(\{ section, queueMode, filter: appliedQueueFilter, limit: 30, offset: 0 \}\)/);
  assert.match(hookSource, /pathname === "\/app\/admin"[\s\S]{0,160}profileOnly: true/);
});

test("match rows and child tables stay behind bounded related IDs", async () => {
  const [listSource, migrationSource] = await Promise.all([
    readSource("server/api/matches/list.js"),
    readSource("supabase/migrations/20260721123000_postgrest_match_candidate_scope.sql"),
  ]);
  assert.doesNotMatch(listSource, /MATCH_CANDIDATE_MAX_LIMIT|MATCH_CANDIDATE_LIMIT_FACTOR/);
  assert.doesNotMatch(listSource, /\.limit\((?:500|600)\)|Math\.min\((?:500|600)/);
  assert.match(listSource, /rankball_related_active_match_list/);
  assert.match(listSource, /MATCH_RELATED_FALLBACK_MAX_LIMIT = 80/);
  assert.match(listSource, /confirmed,closed,cancelled,canceled,void,voided/);

  const playerHydrateAt = listSource.indexOf("const playerRowsPromise = matchIds.length");
  const readableFilterAt = listSource.indexOf("const readableRows = matchRows.filter");
  const finalIdsAt = listSource.indexOf("const hydrationMatchIds = hydrationRows.map");
  const resultHydrateAt = listSource.indexOf("const resultRowsPromise = hydrationMatchIds.length");
  assert.ok(playerHydrateAt >= 0 && playerHydrateAt < readableFilterAt);
  assert.ok(readableFilterAt < finalIdsAt && finalIdsAt < resultHydrateAt);

  assert.match(migrationSource, /greatest\(1, least\(80,/);
  assert.match(migrationSource, /not in \('confirmed', 'closed', 'cancelled', 'canceled', 'void', 'voided'\)/);
  assert.match(migrationSource, /rules->'playedPlayerIds'/);
  assert.match(migrationSource, /rules->'reservePlayers'/);
  assert.match(migrationSource, /grant execute[\s\S]*to service_role/);
});
