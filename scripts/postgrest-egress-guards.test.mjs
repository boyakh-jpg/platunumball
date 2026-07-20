import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isMatchRoomChatLocked } from "../src/lib/matchUtils.js";
import { isSyntheticMatchRoomId } from "../src/lib/recruiting.js";

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
  assert.ok(isSyntheticMatchRoomId("match-room-smoke"));
  assert.equal(isSyntheticMatchRoomId("recruiting-post"), false);
  assert.ok((recruitingSource.match(/isSyntheticMatchRoomId/g) ?? []).length >= 2);
  assert.ok((hookSource.match(/isSyntheticMatchRoomId/g) ?? []).length >= 3);
  assert.ok(isMatchRoomChatLocked({ status: "confirmed" }));
  assert.equal(isMatchRoomChatLocked({ status: "agreed", startedAt: "2026-07-21T00:00:00Z" }), false);
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
  assert.match(adminSource, /limit: ADMIN_DEFAULT_PAGE_LIMIT/);
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
  assert.match(listSource, /ACTIVE_MATCH_EXCLUDED_STATUS_VALUES/);
  assert.match(listSource, /ACTIVE_MATCH_EXCLUDED_STATUS_VALUES\.join/);

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
