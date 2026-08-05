import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canLoadProfileTeamHistory,
  getAdminSection,
  getPageRequest,
  getQueueMode,
  mapDirectoryProfilePrivacy,
  normalizeFilter,
} from "./load.js";
import { buildAdminReviewModel } from "../../../src/lib/admin.js";
import { isCourtInRegion } from "../../../src/lib/courts.js";
import {
  ADMIN_DEFAULT_PAGE_LIMIT,
  COURT_MAP_SEARCH_LIMIT,
  COURT_MAP_SEARCH_PURPOSE,
  DIRECTORY_CACHE_TTL_MS,
  DIRECTORY_PICKER_PAGE_LIMIT,
  DIRECTORY_TEAM_PAGE_LIMIT,
  normalizeDirectoryRankingSort,
} from "../../../shared/lib/queryPolicy.js";

test("directory/admin page limits stay bounded", () => {
  assert.deepEqual(getPageRequest({}), { limit: 100, offset: 0 });
  assert.deepEqual(getPageRequest({ limit: 999, offset: -4 }), { limit: 100, offset: 0 });
  assert.deepEqual(getPageRequest({}, { admin: true }), { limit: ADMIN_DEFAULT_PAGE_LIMIT, offset: 0 });
  assert.deepEqual(getPageRequest({ limit: 999, offset: 12.8 }, { admin: true }), { limit: 60, offset: 12 });
  assert.deepEqual(getPageRequest({ limit: 999 }, { kind: "teams" }), { limit: DIRECTORY_TEAM_PAGE_LIMIT, offset: 0 });
  assert.deepEqual(getPageRequest({ limit: 999 }, { kind: "all" }), { limit: DIRECTORY_TEAM_PAGE_LIMIT, offset: 0 });
  assert.equal(DIRECTORY_PICKER_PAGE_LIMIT, 50);
  assert.equal(COURT_MAP_SEARCH_LIMIT, 500);
  assert.equal(COURT_MAP_SEARCH_PURPOSE, "court_map");
  assert.equal(DIRECTORY_CACHE_TTL_MS, 30_000);
});

test("player ranking sort is allowlisted", () => {
  assert.equal(normalizeDirectoryRankingSort("integrated"), "integrated");
  assert.equal(normalizeDirectoryRankingSort("2v2"), "2v2");
  assert.equal(normalizeDirectoryRankingSort("3v3"), "3v3");
  assert.equal(normalizeDirectoryRankingSort("trust_score"), "");
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
  const result = mapDirectoryProfilePrivacy(users, [{
    id: "visible",
    app_settings: { privacy: { regionRanking: true }, representativeTeamId: "team-visible" },
  }]);
  assert.equal(result[0].privacy.regionRanking, true);
  assert.equal(result[0].privacy.teamHistory, true);
  assert.equal(result[0].privacy.communityPosts, true);
  assert.equal(result[0].privacy.communityComments, true);
  assert.equal(result[0].representativeTeamId, "team-visible");
  assert.equal(result[1].privacy.regionRanking, false);
  assert.equal(result[1].privacy.teamHistory, false);
  assert.equal(result[1].privacy.communityPosts, false);
  assert.equal(result[1].privacy.communityComments, false);
  assert.equal(result[1].representativeTeamId, undefined);
});

test("player team history scope follows the target profile privacy", () => {
  assert.equal(canLoadProfileTeamHistory("player-1", "viewer-1", []), false);
  assert.equal(canLoadProfileTeamHistory("player-1", "player-1", []), true);
  assert.equal(canLoadProfileTeamHistory("player-1", "viewer-1", [
    { id: "player-1", app_settings: {} },
  ]), true);
  assert.equal(canLoadProfileTeamHistory("player-1", "viewer-1", [
    { id: "player-1", app_settings: { privacy: { teamHistory: false } } },
  ]), false);
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

test("approved court reports remain visible in the scoped admin model", () => {
  const model = buildAdminReviewModel({
    users: [{ id: "reporter-1", name: "Reporter" }],
    teams: [],
    matches: [],
    reports: [{
      id: "court-report-1",
      type: "court",
      targetId: "approved-court-1",
      reportedUserIds: [],
      status: "open",
      createdAt: "2026-07-24T00:00:00Z",
    }],
    settings: {
      approvedCourts: [{ id: "approved-court-1", name: "신고된 구장", addressText: "서울특별시" }],
    },
  });
  assert.equal(model.courts.length, 1);
  assert.equal(model.courts[0].reportCount, 1);
  assert.equal(model.courts[0].openCount, 1);
});

test("directory loader does not call the legacy broad repository loader", async () => {
  const source = (await Promise.all([
    readFile(new URL("./load.js", import.meta.url), "utf8"),
    readFile(new URL("./loadAdminSection.js", import.meta.url), "utf8"),
  ])).join("\n");
  assert.doesNotMatch(source, /loadNormalizedDirectoryStateFromClient/);
  assert.match(source, /\.range\(offset, offset \+ limit\)/);
  assert.match(source, /DIRECTORY_ID_BATCH_SIZE/);
  assert.match(source, /normalizeDirectoryKind/);
  assert.match(source, /scope === "admin"/);
  assert.match(source, /includeSelfDetails = kind === "self"/);
  assert.match(source, /reportRowsByType\("player"\).*sourceMatchId/s);
  assert.match(source, /approved_courts"\)\.select\(APPROVED_COURT_COLUMNS\)\.eq\("status", "active"\)/);
  assert.match(source, /court_reviews"\)\.select\(COURT_REVIEW_COLUMNS\)\.eq\("status", "active"\)/);
  assert.match(source, /includeTeamMemberProfiles \|\| row\.role === "captain"/);
  assert.match(source, /normalizeDirectoryRankingSort\(body\.rankingSort\)/);
  assert.match(source, /ratings->modes->\$\{rankingSort\}/);
  assert.match(source, /if \(kind === "affiliations"\)[\s\S]*placementCompleteOnly: false,[\s\S]*rankingSort: ""/);
  assert.doesNotMatch(source, /readOptional\(/);
});

test("court map loads bounded active coordinate rows for the current district", async () => {
  const [searchSource, createControllerSource, createCourtSectionSource, pickerSource] = await Promise.all([
    readFile(new URL("../search.js", import.meta.url), "utf8"),
    readFile(new URL("../../../src/components/match/useCreateMatchBaseController.js", import.meta.url), "utf8"),
    readFile(new URL("../../../src/components/match/CreateMatchCourtRosterSection.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../../src/components/court/CourtMapPicker.jsx", import.meta.url), "utf8"),
  ]);
  const createSource = `${createControllerSource}\n${createCourtSectionSource}`;
  assert.match(searchSource, /courtMapSearch \? COURT_MAP_SEARCH_LIMIT : 25/);
  assert.match(searchSource, /request\.not\("lat", "is", null\)\.not\("lng", "is", null\)/);
  assert.match(createSource, /wizardStep !== 4 && !courtMapOpen/);
  assert.match(createSource, /context: \{ purpose: COURT_MAP_SEARCH_PURPOSE \}/);
  assert.match(createSource, /limit: COURT_MAP_SEARCH_LIMIT/);
  assert.match(createSource, /query: courtMapRegion/);
  assert.match(createSource, /loadedCourtMapRegionsRef\.current\.has\(loadKey\)/);
  assert.match(createSource, /loadedCourtMapRegionsRef\.current\.delete\(`\$\{courtMapRegion\}:map`\)/);
  assert.match(createSource, /REGION_TREE\.map\(\(region\)/);
  assert.match(createSource, /const regionValue = `\$\{region\.sido\} \$\{district\}`/);
  assert.match(searchSource, /courtMapSearch \? MAP_COURT_COLUMNS : COURT_COLUMNS/);
  assert.match(pickerSource, /isCourtInRegion\(court, currentRegion\)/);
  assert.match(pickerSource, /const focusCourts = selectedCoordinate \? \[selectedCourt\] : regionalCourts\.length \? regionalCourts : courts/);
  assert.match(pickerSource, /setStatus\(loading \? "loading" : loadError \? "error" : "empty"\)/);
  assert.match(pickerSource, /element\.textContent = isCluster \? String\(group\.items\.length\) : "1"/);
  assert.doesNotMatch(pickerSource, /courtNumberById/);
  assert.doesNotMatch(pickerSource, /element\.textContent = .*court\?\.name/);
  assert.match(createSource, /search-controls court-finder-controls/);
  assert.match(createSource, /court-map-launch-control/);
});

test("court region matching falls back to address fields when labels are incomplete", () => {
  assert.equal(isCourtInRegion({ region: "서울특별시", addressText: "서울특별시 마포구 월드컵로 1" }, "마포"), true);
  assert.equal(isCourtInRegion({ region: "강서구", roadAddress: "서울특별시 강서구 화곡로 1" }, "마포"), false);
  assert.equal(isCourtInRegion({ region: "서울특별시", roadAddress: "서울특별시 서초구 강남대로 1" }, "강남"), false);
  assert.equal(isCourtInRegion({ region: "부산광역시", sido: "부산광역시", roadAddress: "부산광역시 수영구 광안로 1" }, "부산광역시 해운대구"), false);
  assert.equal(isCourtInRegion({ sigungu: "해운대구", addressText: "부산광역시 해운대구 좌동" }, "부산광역시 해운대구"), true);
  assert.equal(isCourtInRegion({ sido: "서울특별시", sigungu: "중구", addressText: "서울특별시 중구 세종대로 1" }, "부산광역시 중구"), false);
});

test("admin route bootstraps profile only and owns a separate state cache", async () => {
  const hookSource = (await Promise.all([
    "bootstrap.js",
    "remoteMerge.js",
    "useAppDataOrchestrator.js",
    "orchestrator/runtime.js",
    "orchestrator/loaders.js",
    "orchestrator/directoryLoaders.js",
    "orchestrator/admin.js",
    "remoteMerge/state.js",
    "actions/recruitingActions.js",
    "actions/settingsActions.js",
  ].map((relativePath) => (
    readFile(new URL(`../../../src/hooks/appData/${relativePath}`, import.meta.url), "utf8")
  )))).join("\n");
  const adminSource = (await Promise.all([
    "Admin.jsx",
    "AdminPageView.jsx",
    "useAdminPageController.jsx",
  ].map((relativePath) => (
    readFile(new URL(`../../../src/pages/${relativePath}`, import.meta.url), "utf8")
  )))).join("\n");
  const settingsSource = (await Promise.all([
    "Settings.jsx",
    "useSettingsPageController.jsx",
    "useSettingsReportController.jsx",
  ].map((relativePath) => (
    readFile(new URL(`../../../src/pages/${relativePath}`, import.meta.url), "utf8")
  )))).join("\n");
  assert.match(hookSource, /pathname === "\/app\/admin"[\s\S]{0,160}profileOnly: true/);
  assert.match(hookSource, /const \[adminState, setAdminState\] = useState\(null\)/);
  assert.match(hookSource, /if \(!state \|\| options\.append !== true\) return remoteState/);
  assert.match(hookSource, /latestDirectoryRequestRef\.current !== cacheKey/);
  assert.match(hookSource, /latestAdminRequestRef\.current !== cacheKey/);
  assert.ok((hookSource.match(/isSyntheticMatchRoomId/g) ?? []).length >= 3);
  assert.doesNotMatch(adminSource, /\[app\.actions\]/);
  assert.match(adminSource, /limit: ADMIN_DEFAULT_PAGE_LIMIT/);
  assert.match(adminSource, /처리 대기\{queueMode === "pending" \? ` \$\{activeQueueTotal\}` : ""\}/);
  assert.match(adminSource, /force: true/);
  assert.match(hookSource, /counts: queueMode === "pending"/);
  assert.match(hookSource, /result\?\.error === "report_already_processed"[\s\S]{0,100}refreshAdminState/);
  assert.match(settingsSource, /limit: DIRECTORY_SELF_PAGE_LIMIT/);
});
