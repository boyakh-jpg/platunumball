import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APP_DATA_ACTION_SOURCE_PATHS,
  APP_DATA_ORCHESTRATOR_SOURCE_PATHS,
  HOME_PAGE_SOURCE_PATHS,
  MATCHES_PAGE_SOURCE_PATHS,
  MATCH_ROOM_SOURCE_PATHS,
  RECRUITING_PAGE_SOURCE_PATHS,
  TOURNAMENT_DETAIL_SOURCE_PATHS,
  readSourceGroup,
} from "./management-source-groups.mjs";
import { isMatchRoomChatLocked } from "../src/lib/matchUtils.js";
import { isSyntheticMatchRoomId } from "../src/lib/recruiting.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");
const readSources = (...paths) => Promise.all(paths.map(readSource)).then((sources) => sources.join("\n"));

test("recruiting detail is initial-only and synthetic rooms never reach its API", async () => {
  const [recruitingSource, matchesSource, hookSource] = await Promise.all([
    readSourceGroup(readSource, RECRUITING_PAGE_SOURCE_PATHS),
    readSourceGroup(readSource, MATCHES_PAGE_SOURCE_PATHS),
    Promise.all([
      readSourceGroup(readSource, APP_DATA_ORCHESTRATOR_SOURCE_PATHS),
      readSourceGroup(readSource, APP_DATA_ACTION_SOURCE_PATHS),
    ]).then((sources) => sources.join("\n")),
  ]);
  assert.doesNotMatch(recruitingSource, /RECRUITING_ROOM_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(matchesSource, /RECRUITING_ROOM_REFRESH_INTERVAL_MS/);
  assert.equal((recruitingSource.match(/setInterval/g) ?? []).length, 1);
  assert.match(recruitingSource, /getMatchRoomPhase\(sourceMatch\)\.phase !== "checkin"[\s\S]*document\.hidden[\s\S]*loadMatchDetailRef\.current\?\.\(sourceMatch\.id\)[\s\S]*setInterval\(refreshAttendance, 3000\)/);
  assert.doesNotMatch(recruitingSource, /setInterval\([^)]*loadRecruitingPostDetail/);
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
    readSources(
      "src/pages/Admin.jsx",
      "src/pages/adminPageModel.js",
      "src/pages/AdminPageParts.jsx",
      "src/pages/useAdminPageController.jsx",
      "src/pages/AdminPageView.jsx",
    ),
    readSource("src/hooks/appData/bootstrap.js"),
  ]);
  assert.doesNotMatch(adminSource, /loadAdminContext/);
  assert.doesNotMatch(adminSource, /loadDirectory/);
  assert.doesNotMatch(adminSource, /\[app\.actions\]/);
  assert.match(adminSource, /limit: ADMIN_DEFAULT_PAGE_LIMIT/);
  assert.match(hookSource, /pathname === "\/app\/admin"[\s\S]{0,160}profileOnly: true/);
});

test("match rows and child tables stay behind bounded related IDs", async () => {
  const [listSource, migrationSource] = await Promise.all([
    readSources(
      "server/api/matches/_listQueries.js",
      "server/api/matches/_listLoader.js",
    ),
    readSource("supabase/migrations/20260721123000_postgrest_match_candidate_scope.sql"),
  ]);
  assert.doesNotMatch(listSource, /MATCH_CANDIDATE_MAX_LIMIT|MATCH_CANDIDATE_LIMIT_FACTOR/);
  assert.doesNotMatch(listSource, /\.limit\((?:500|600)\)|Math\.min\((?:500|600)/);
  assert.match(listSource, /rankball_related_active_match_list/);
  assert.match(listSource, /MATCH_RELATED_FALLBACK_MAX_LIMIT = 80/);
  assert.match(listSource, /ACTIVE_MATCH_EXCLUDED_STATUS_VALUES/);
  assert.match(listSource, /ACTIVE_MATCH_EXCLUDED_STATUS_VALUES\.join/);
  assert.match(
    listSource,
    /!feedCardIds\.has\(id\)[\s\S]{0,160}captainTournamentMatchIds\.has\(id\)[\s\S]{0,160}memberTeamMatchIds\.has\(id\)/,
  );

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

test("home team bootstrap is route-independent and remains bounded", async () => {
  const [homeSource, profileSource, hookSource, homePageSource, hoverSource, adminSource] = await Promise.all([
    readSource("server/api/home/load.js"),
    readSource("server/api/profile/me.js"),
    readSources(
      "src/hooks/appData/remoteMerge.js",
      "src/hooks/appData/bootstrap.js",
    ),
    readSourceGroup(readSource, HOME_PAGE_SOURCE_PATHS),
    readSource("src/components/team/TeamHoverCard.jsx"),
    readSource("server/api/_supabaseAdmin.js"),
  ]);

  assert.match(homeSource, /includeFavorites: true/);
  assert.match(homeSource, /includeTeams: true/);
  assert.match(homeSource, /loadOptionalHomeSection\("match"/);
  assert.match(homeSource, /\.limit\(HOME_RIVAL_TEAM_LIMIT \+ MAX_TEAM_MEMBERSHIPS\)/);
  assert.match(homeSource, /\.limit\(HOME_REGION_PLAYER_LIMIT\)/);
  assert.match(homeSource, /\.select\("team_id"\)/);
  assert.match(homeSource, /regionalPlayerIds: regionPlayerResult\.playerIds/);
  assert.match(homeSource, /rivalTeamIds/);
  assert.match(homeSource, /filter\(\(row\) => row\.id !== profileId\)\.map/);
  assert.match(profileSource, /ownMembersOnly \? \{ membersPartial: true \} : \{\}/);
  assert.match(hookSource, /teams: mergeTeamsById\(state\.teams, remoteState\.teams\)/);
  assert.match(hookSource, /const partialMembers = new Map/);
  assert.match(hookSource, /members: existingIsPartial[\s\S]{0,120}\[\.\.\.partialMembers\.values\(\)\]/);
  assert.match(hookSource, /homeSummary: remoteState\.homeSummary \?\? mergedState\.homeSummary/);
  assert.match(hookSource, /loadBackendStateWithHomeRetry/);
  assert.match(hookSource, /getHomeLoadFailureCount\(retryResult\) < getHomeLoadFailureCount\(firstResult\)/);
  assert.match(hookSource, /includeFavorites: options\.endpoint === "homeLoad"/);
  assert.match(hookSource, /includeTeams: options\.endpoint === "homeLoad"/);
  assert.match(homePageSource, /homeSummary\?\.ownTeamIds/);
  assert.match(homePageSource, /homeSummary\?\.regionalPlayerIds/);
  assert.match(homePageSource, /!myTeamIds\.includes\(team\.id\)/);
  assert.match(homePageSource, /\.slice\(0, HOME_RIVAL_TEAM_LIMIT\)/);
  assert.match(hoverSource, /team\.membersPartial === true \? "확인 필요"/);
  assert.match(adminSource, /\.filter\("referee_ids", "cs", JSON\.stringify\(\[profileId\]\)\)/);
  assert.doesNotMatch(adminSource, /\.contains\("referee_ids", \[profileId\]\)/);
});

test("direct detail routes request their own authoritative payload", async () => {
  const [hookSource, playerSource, teamSource, courtSource, matchRoomSource, tournamentSource, notificationSource, matchesSource, recruitingSource] = await Promise.all([
    readSource("src/hooks/appData/bootstrap.js"),
    readSource("src/pages/PlayerDetail.jsx"),
    readSource("src/pages/TeamDetail.jsx"),
    readSource("src/pages/CourtDetail.jsx"),
    readSourceGroup(readSource, MATCH_ROOM_SOURCE_PATHS),
    readSourceGroup(readSource, TOURNAMENT_DETAIL_SOURCE_PATHS),
    readSource("src/pages/Notifications.jsx"),
    readSourceGroup(readSource, MATCHES_PAGE_SOURCE_PATHS),
    readSourceGroup(readSource, RECRUITING_PAGE_SOURCE_PATHS),
  ]);

  assert.match(hookSource, /teamDetailMatch[\s\S]{0,220}endpoint: "teamDetail"/);
  assert.match(playerSource, /loadDirectory\?\.\(\)/);
  assert.match(teamSource, /loadDirectory\?\.\(\{ force: true \}\)/);
  assert.match(courtSource, /loadCourtDetail\?\.\(courtId\)/);
  assert.match(matchRoomSource, /loadMatchDetail\?\.\(matchId\)/);
  assert.match(tournamentSource, /loadTournament\?\.\(tournamentId\)/);
  assert.match(notificationSource, /loadNotifications\?\.\(\)/);
  assert.match(matchesSource, /loadMatchDetail\?\.\(matchId\)/);
  assert.match(recruitingSource, /loadRecruitingPost\?\.\(roomPostId\)/);
});
