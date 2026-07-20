import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getAdminSection,
  getPageRequest,
  getQueueMode,
  mapDirectoryProfilePrivacy,
  normalizeFilter,
} from "./load.js";
import { buildAdminReviewModel } from "../../../src/lib/admin.js";
import {
  ADMIN_DEFAULT_PAGE_LIMIT,
  DIRECTORY_CACHE_TTL_MS,
  DIRECTORY_PICKER_PAGE_LIMIT,
  DIRECTORY_TEAM_PAGE_LIMIT,
} from "../../../src/lib/queryPolicy.js";

test("directory/admin page limits stay bounded", () => {
  assert.deepEqual(getPageRequest({}), { limit: 100, offset: 0 });
  assert.deepEqual(getPageRequest({ limit: 999, offset: -4 }), { limit: 100, offset: 0 });
  assert.deepEqual(getPageRequest({}, { admin: true }), { limit: ADMIN_DEFAULT_PAGE_LIMIT, offset: 0 });
  assert.deepEqual(getPageRequest({ limit: 999, offset: 12.8 }, { admin: true }), { limit: 60, offset: 12 });
  assert.deepEqual(getPageRequest({ limit: 999 }, { kind: "teams" }), { limit: DIRECTORY_TEAM_PAGE_LIMIT, offset: 0 });
  assert.deepEqual(getPageRequest({ limit: 999 }, { kind: "all" }), { limit: DIRECTORY_TEAM_PAGE_LIMIT, offset: 0 });
  assert.equal(DIRECTORY_PICKER_PAGE_LIMIT, 50);
  assert.equal(DIRECTORY_CACHE_TTL_MS, 30_000);
});

test("admin scope and queue values are allowlisted", () => {
  assert.equal(getAdminSection("matches"), "matches");
  assert.equal(getAdminSection("unknown"), "courts");
  assert.equal(getQueueMode("history"), "history");
  assert.equal(getQueueMode("anything"), "pending");
});

test("PostgREST filter control characters are removed", () => {
  assert.equal(normalizeFilter("  alpha,(beta)%  "), "alpha beta");
  assert.equal(normalizeFilter("x".repeat(120)).length, 80);
});

test("directory privacy defaults closed for users without scoped private rows", () => {
  const users = [{ id: "visible", name: "Visible" }, { id: "closed", name: "Closed" }];
  const result = mapDirectoryProfilePrivacy(users, [{ id: "visible", app_settings: { privacy: { regionRanking: true } } }]);
  assert.equal(result[0].privacy.regionRanking, true);
  assert.equal(result[0].privacy.teamHistory, true);
  assert.equal(result[1].privacy.regionRanking, false);
  assert.equal(result[1].privacy.teamHistory, false);
});

test("player reports remain visible in the scoped admin model", () => {
  const model = buildAdminReviewModel({
    users: [{ id: "player-1", name: "Player", region: "서울", position: "PG", trustScore: 80 }],
    teams: [],
    matches: [],
    reports: [{ id: "report-1", type: "player", targetId: "player-1", reportedUserIds: [], status: "open", createdAt: "2026-07-21T00:00:00Z" }],
    settings: {},
  });
  assert.equal(model.players.length, 1);
  assert.equal(model.players[0].reportCount, 1);
  assert.equal(model.players[0].openCount, 1);
});

test("directory loader does not call the legacy broad repository loader", async () => {
  const source = await readFile(new URL("./load.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /loadNormalizedDirectoryStateFromClient/);
  assert.match(source, /\.range\(offset, offset \+ limit\)/);
  assert.match(source, /DIRECTORY_ID_BATCH_SIZE/);
  assert.match(source, /normalizeDirectoryKind/);
  assert.match(source, /scope === "admin"/);
  assert.match(source, /includeSelfDetails = kind === "self"/);
  assert.match(source, /includeTeamMemberProfiles \|\| row\.role === "captain"/);
  assert.doesNotMatch(source, /readOptional\(/);
});

test("admin route bootstraps profile only and owns a separate state cache", async () => {
  const hookSource = await readFile(new URL("../../../src/hooks/useAppData.js", import.meta.url), "utf8");
  const adminSource = await readFile(new URL("../../../src/pages/Admin.jsx", import.meta.url), "utf8");
  const settingsSource = await readFile(new URL("../../../src/pages/Settings.jsx", import.meta.url), "utf8");
  assert.match(hookSource, /pathname === "\/app\/admin"[\s\S]{0,160}profileOnly: true/);
  assert.match(hookSource, /const \[adminState, setAdminState\] = useState\(null\)/);
  assert.match(hookSource, /latestDirectoryRequestRef\.current !== cacheKey/);
  assert.match(hookSource, /latestAdminRequestRef\.current !== cacheKey/);
  assert.ok((hookSource.match(/isSyntheticMatchRoomId/g) ?? []).length >= 3);
  assert.doesNotMatch(adminSource, /\[app\.actions\]/);
  assert.match(adminSource, /limit: ADMIN_DEFAULT_PAGE_LIMIT/);
  assert.match(settingsSource, /limit: DIRECTORY_SELF_PAGE_LIMIT/);
});
