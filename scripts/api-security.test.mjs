import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  APP_DATA_ACTION_SOURCE_PATHS,
  CREATE_MATCH_PAGE_SOURCE_PATHS,
  SETTINGS_PAGE_SOURCE_PATHS,
  readSourceGroup,
} from "./management-source-groups.mjs";
import apiHandler, { API_ROUTES } from "../api/index.js";
import {
  allowRequestMethod,
  bearerTokenMatches,
} from "../server/api/_supabaseAdmin.js";
import {
  findSensitiveQueryKey,
  getStrictBearerToken,
  parseBearerAuthorization,
} from "../server/api/_requestSecurity.js";
import {
  createDiscordOAuthProof,
  createDiscordOAuthStateTicket,
  verifyDiscordOAuthProof,
  verifyDiscordOAuthStateTicket,
} from "../server/api/auth/_discordOAuthProof.js";
import { getDiscordOAuthStateCookiePath } from "../server/api/auth/_discordOAuthCookies.js";
import { normalizeDiscordOAuthErrorCode } from "../server/api/auth/discord/callback.js";
import { getPublicAppUrl, getPublicAppWebUrl } from "../server/api/_publicAppUrl.js";
import {
  isActiveReportInsertConflict,
  normalizeCourtCorrection,
} from "../server/api/reports/submit.js";
import {
  getAdminReviewErrorStatus,
  normalizeAdminReviewInput,
} from "../server/api/admin/review-action.js";
import { isActiveReferee } from "../server/lib/refereeEligibilityPolicy.js";
import {
  getPublicRosterIds,
  projectPublicRecruitingRoomState,
  resolveRequestedRecruitingResult,
} from "../server/api/landing/stats.js";
import { createPublicMatchState } from "../server/api/matches/detail.js";
import { projectPublicMatch } from "../server/lib/stateVisibility.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");
const readSources = (...paths) => Promise.all(paths.map(readSource)).then((sources) => sources.join("\n"));

async function readSourceTree(relativeDirectory) {
  const sources = [];
  const walk = async (directoryUrl) => {
    const entries = await readdir(directoryUrl, { withFileTypes: true });
    for (const entry of entries) {
      const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
      if (entry.isDirectory()) await walk(entryUrl);
      else if (/\.(?:js|jsx|mjs)$/i.test(entry.name)) sources.push(await readFile(entryUrl, "utf8"));
    }
  };
  await walk(new URL(`${relativeDirectory.replace(/\/?$/, "/")}`, root));
  return sources.join("\n");
}

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createRefereeEligibilitySupabase({ profile = null, appointments = [] } = {}) {
  return {
    from(table) {
      const result = table === "profiles"
        ? { data: profile, error: null }
        : { data: appointments, error: null };
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(result);
        },
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

async function invokeApi({ path = "search", method = "POST", query = {}, headers = {} } = {}) {
  const queryString = new URLSearchParams(query).toString();
  const response = createResponse();
  await apiHandler({
    method,
    url: `/api/${path}${queryString ? `?${queryString}` : ""}`,
    query: { path, ...query },
    headers,
  }, response);
  return response;
}

test("공용 method guard는 route별 허용 method와 405 응답을 보존한다", () => {
  const postOnlyResponse = createResponse();
  assert.equal(allowRequestMethod({ method: "GET" }, postOnlyResponse), false);
  assert.equal(postOnlyResponse.headers.allow, "POST");
  assert.equal(postOnlyResponse.statusCode, 405);
  assert.deepEqual(postOnlyResponse.payload, { error: "method_not_allowed" });

  const multiMethodResponse = createResponse();
  assert.equal(allowRequestMethod({ method: "PATCH" }, multiMethodResponse, ["GET", "POST"]), false);
  assert.equal(multiMethodResponse.headers.allow, "GET, POST");

  const acceptedResponse = createResponse();
  assert.equal(allowRequestMethod({ method: "POST" }, acceptedResponse), true);
  assert.equal(acceptedResponse.statusCode, 200);
});

test("API routes use deny-by-default method and credential policies", async () => {
  const validAuthModes = new Set(["user", "admin", "internal", "signedWebhook", "oauthCallback", "alphaTest", "publicRead"]);
  assert.ok(API_ROUTES.size > 40);
  for (const [path, route] of API_ROUTES) {
    assert.match(path, /^\/[a-z0-9/-]+$/);
    assert.ok(typeof route.handler === "function");
    assert.ok(route.methods.length > 0);
    assert.ok(route.methods.every((method) => ["GET", "POST"].includes(method)));
    assert.ok(validAuthModes.has(route.auth));

    const handlerSource = route.handler.toString();
    if (route.auth === "user") assert.match(handlerSource, /getAuthenticatedContext/);
    if (route.auth === "admin") assert.match(handlerSource, /requireAdminContext/);
    if (route.auth === "internal") {
      assert.match(
        handlerSource,
        /assert(?:WorkerAccess|BridgeAccess|Access|SystemSecretAccess)\(request(?:,|\))/,
      );
    }
    if (route.auth === "signedWebhook") assert.match(handlerSource, /verify(?:Discord|Instagram)Signature/);
    if (route.auth === "alphaTest") assert.match(handlerSource, /assertAlphaTestLoginEnabled/);
  }
  assert.deepEqual(
    [...API_ROUTES].filter(([, route]) => route.auth === "oauthCallback").map(([path]) => path),
    ["/auth/discord/callback", "/discord/callback"],
  );
  const systemRequestSource = await readSource("server/api/system/_systemRequest.js");
  const internalSources = await Promise.all([
    "server/api/discord/dm-worker.js",
    "server/api/discord/room-chat.js",
    "server/api/system/cleanup-sim.js",
    "server/api/system/feed-audit.js",
    "server/api/system/maintenance.js",
    "server/api/system/schema-health.js",
  ].map(async (sourcePath) => {
    const source = sourcePath === "server/api/discord/dm-worker.js"
      ? await readSources(sourcePath, "server/api/discord/dmWorkerDiscord.js")
      : await readSource(sourcePath);
    return sourcePath === "server/api/system/feed-audit.js"
      || sourcePath === "server/api/system/schema-health.js"
      ? `${source}\n${systemRequestSource}`
      : source;
  }));
  internalSources.forEach((source) => assert.match(source, /bearerTokenMatches\(request,/));
});

test("React Router stays on SPA APIs and does not enable vulnerable RSC actions", async () => {
  const clientSource = await readSourceTree("src");
  assert.doesNotMatch(
    clientSource,
    /react-server|RSCHydratedRouter|RSCStaticRouter|matchRSCServerRequest|unstable_[A-Za-z0-9_]*RSC/u,
  );
});

test("Discord DM 링크는 공개 프로필에 숫자 ID를 싣지 않는다", async () => {
  const route = API_ROUTES.get("/profile/discord-dm");
  const source = await readSource("server/api/profile/discord-dm.js");

  assert.equal(route?.auth, "publicRead");
  assert.deepEqual(route?.methods, ["GET"]);
  assert.match(source, /isDiscordSnowflake/);
  assert.match(source, /https:\/\/discord\.com\/users\//);
  assert.doesNotMatch(source, /sendJson\(response,\s*200/);

  const response = createResponse();
  await route.handler({
    method: "GET",
    query: { profileId: "../private" },
    headers: {},
  }, response);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, { error: "invalid_profile_id" });
});

test("production schema health cannot seed privileged demo actors", async () => {
  const source = await readSource("server/api/system/schema-health.js");
  assert.doesNotMatch(source, /RANKBALL_ALLOW_PRODUCTION_TEST_SEED/);
  assert.doesNotMatch(source, /ap_region_rankball_001|regionManagerProfileId/);
  assert.match(source, /production_test_seed_disabled/);
});

test("public landing exposes aggregate counts and a roster-only public room projection", async () => {
  const route = API_ROUTES.get("/landing/stats");
  const source = await readSource("server/api/landing/stats.js");

  assert.equal(route?.auth, "publicRead");
  assert.deepEqual(route?.methods, ["GET"]);
  assert.match(source, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(source, /\.eq\("status", "open"\)[\s\S]*?\.eq\("visibility", "public"\)/);
  assert.match(source, /\.eq\("status", "confirmed"\)[\s\S]*?\.eq\("visibility", "public"\)/);
  assert.match(source, /\.is\("deleted_at", null\)/);
  assert.match(source, /const PUBLIC_RECRUITING_COLUMNS = "id,type,title,status,visibility,[^"]*player_id,player_ids,[^"]*"/);
  assert.match(source, /from\("recruiting_posts"\)[\s\S]*?\.select\(PUBLIC_RECRUITING_COLUMNS\)[\s\S]*?\.limit\(recruitingLimit\)/);
  assert.match(source, /\.select\(PUBLIC_RECRUITING_COLUMNS\)[\s\S]*?\.eq\("id", requestedPostId\)[\s\S]*?\.limit\(1\)/);
  assert.match(source, /party_reserves:room_state->partyReserves/);
  assert.doesNotMatch(source, /\.select\("[^"]*(?:^|,)room_state(?:,|$)[^"]*"\)/);
  assert.doesNotMatch(source, /from\("recruiting_applications"\)/);
  assert.match(source, /request\.query\?\.recruitingRegion/);
  assert.match(source, /\.ilike\("region", `%\$\{recruitingRegion\}%`\)/);
  assert.match(source, /Math\.min\(limit, REMOTE_CLIENT_RECRUITING_LIMIT\)/);
  assert.match(source, /select\("id,title,team_a_id,team_b_id,score_a,score_b"\)[\s\S]*?\.limit\(3\)/);
  assert.match(source, /from\("teams"\)\.select\(TEAM_COLUMNS\)/);
  assert.match(source, /sendJson\(response, 200, \{ ok: true, stats, feed \}\)/);
  assert.doesNotMatch(source, /getAuthenticatedContext|select\("\*"\)/);
  assert.doesNotMatch(source, /\.select\("[^"]*(?:memo|evidence|chat_messages)[^"]*"\)/);

  const publicRoomState = projectPublicRecruitingRoomState({
    timingType: "instant",
    partyReserves: { host: ["player-2"] },
    slotPositions: { "player-2": "SG" },
    chatMessages: [{ body: "비공개" }],
    invitations: [{ targetUserId: "private-player" }],
    kickLog: [{ playerId: "private-player" }],
    scheduleProposal: { requiredIds: ["private-player"] },
  }, "player-1");
  assert.deepEqual(publicRoomState.partyReserves, { host: ["player-2"] });
  assert.deepEqual(publicRoomState.slotPositions, { "player-2": "SG" });
  assert.equal(publicRoomState.matchRosterProjection, true);
  assert.equal(publicRoomState.ownerId, "player-1");
  ["chatMessages", "invitations", "kickLog", "scheduleProposal"].forEach((key) => {
    assert.equal(Object.hasOwn(publicRoomState, key), false);
  });

  const rosterIds = getPublicRosterIds({
    player_id: "host",
    referee_id: "referee",
    player_ids: ["starter"],
    party_reserves: { host: ["reserve"] },
    pinned_reserve_players: { host: ["pinned"] },
    applications: [{ player_id: "pending" }],
  });
  assert.deepEqual(new Set(rosterIds), new Set(["host", "referee", "starter", "reserve", "pinned"]));
  assert.equal(rosterIds.includes("pending"), false);

  assert.equal(resolveRequestedRecruitingResult("", null), null);
  assert.deepEqual(resolveRequestedRecruitingResult("room-1", null), { status: "not_found", post: null });
  assert.deepEqual(resolveRequestedRecruitingResult("room-1", { id: "room-1", visibility: "private", status: "open" }), {
    status: "not_found",
    post: null,
  });
  assert.deepEqual(resolveRequestedRecruitingResult("room-1", { id: "room-1", visibility: "public", status: "confirmed" }), {
    status: "closed",
    post: null,
  });
  const openRoom = { id: "room-1", visibility: "public", status: "open" };
  assert.deepEqual(resolveRequestedRecruitingResult("room-1", openRoom, openRoom), {
    status: "open",
    post: openRoom,
  });
});

test("public match detail projects only public match, user, and team-member fields", () => {
  const match = projectPublicMatch({
    id: "match-1",
    status: "confirmed",
    visibility: "private",
    rules: { recordType: "normal" },
    teamA: { teamId: "team-1", players: ["player-1"] },
    teamB: { teamId: "team-2", players: [] },
    scoreA: 60,
    scoreB: 58,
    recruitingPostId: "private-room",
    attendance: { token: "private-attendance" },
    parties: [{ id: "private-party" }],
    memo: "private memo",
    evidence: [{ key: "private" }],
  });
  const state = createPublicMatchState({
    users: [{
      id: "player-1",
      name: "공개 선수",
      handle: "public-player",
      email: "private@example.com",
      discordId: "private-discord",
    }],
    teams: [{
      id: "team-1",
      name: "공개 팀",
      members: [{ userId: "player-1", role: "player", invitationCode: "private-code" }],
    }],
    matches: [{ id: "other-match" }],
    recruitingPosts: [{ id: "private-room" }],
    notifications: [{ id: "private-notification" }],
  }, match);

  assert.equal(match.visibility, "private");
  assert.equal(Object.hasOwn(match, "memo"), false);
  assert.equal(Object.hasOwn(match, "evidence"), false);
  assert.equal(Object.hasOwn(match, "recruitingPostId"), false);
  assert.equal(Object.hasOwn(match, "attendance"), false);
  assert.equal(Object.hasOwn(match, "parties"), false);
  assert.equal(Object.hasOwn(match, "scoreA"), false);
  assert.equal(Object.hasOwn(match, "scoreB"), false);
  assert.deepEqual(state.matches, [match]);
  assert.equal(state.users[0].name, "공개 선수");
  assert.equal(Object.hasOwn(state.users[0], "email"), false);
  assert.equal(Object.hasOwn(state.users[0], "discordId"), false);
  assert.deepEqual(state.teams[0].members, [{ userId: "player-1", role: "player" }]);
  assert.deepEqual(state.recruitingPosts, []);
  assert.deepEqual(state.notifications, []);
});

test("Discord delivery cron uses Vault and stays separate from system maintenance", async () => {
  const workerSource = await readSources(
    "server/api/discord/dm-worker.js",
    "server/api/discord/dmWorkerDiscord.js",
  );
  const cronSource = await readSource("supabase/migrations/20260729140000_supabase_discord_dm_cron.sql");

  assert.doesNotMatch(workerSource, /runSystemMaintenance/);
  assert.match(cronSource, /rankball-discord-dm-worker/);
  assert.match(cronSource, /'\* \* \* \* \*'/);
  assert.match(cronSource, /vault\.decrypted_secrets/);
  assert.match(cronSource, /rankball_cron_secret/);
  assert.match(cronSource, /Authorization/);
  assert.doesNotMatch(cronSource, /CRON_SECRET=/);
});

test("Discord invitations link to the app without decision buttons", async () => {
  const [syncSource, clientSource, interactionSource] = await Promise.all([
    readSource("server/api/discord/sync-deliveries.js"),
    readSource("src/lib/discord.js"),
    readSource("server/api/discord/interactions.js"),
  ]);

  assert.doesNotMatch(syncSource, /getDiscordInviteCustomId|label: "(?:수락|거절)"/u);
  assert.doesNotMatch(clientSource, /getDiscordInviteCustomId|label: "(?:수락|거절)"/u);
  assert.match(syncSource, /actions: \[\]/u);
  assert.match(clientSource, /actions: \[\]/u);
  assert.match(interactionSource, /\/app\/recruiting\?post=/u);
  assert.doesNotMatch(interactionSource, /rankball_recruiting_management_action|loadAuthoritativeState/u);
});

test("credentials are rejected from every URL query", async () => {
  [
    "access_token",
    "refresh-token",
    "Authorization",
    "api_key",
    "clientSecret",
    "service_role_key",
    "signature",
    "password",
  ].forEach((key) => assert.equal(findSensitiveQueryKey({ [key]: "redacted" }), key));
  assert.equal(findSensitiveQueryKey({ code: "oauth-code", state: "oauth-state", q: "검색" }), "");
  assert.equal(findSensitiveQueryKey({ "hub.verify_token": "redacted" }, ["hub.verify_token"]), "");
  assert.equal(findSensitiveQueryKey({ token: "redacted" }, ["hub.verify_token"]), "token");

  const response = await invokeApi({ query: { access_token: "redacted" } });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, { error: "credentials_not_allowed_in_url" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  const unknownRoute = await invokeApi({ path: "unknown", query: { csrf_token: "redacted" } });
  assert.equal(unknownRoute.statusCode, 400);
  assert.deepEqual(unknownRoute.payload, { error: "credentials_not_allowed_in_url" });
});

test("report review actions keep sanctions behind verified targets and level 50", async () => {
  const [reviewSource, submitSource, settingsSource, hookSource, searchSource, simulationSource] = await Promise.all([
    readSource("server/api/admin/review-action.js"),
    readSources(
      "server/api/reports/submit.js",
      "server/api/reports/submitCourtTeamPolicy.js",
    ),
    readSourceGroup(readSource, SETTINGS_PAGE_SOURCE_PATHS),
    readSourceGroup(readSource, APP_DATA_ACTION_SOURCE_PATHS),
    readSource("server/api/search.js"),
    readSource("scripts/simulate-backend-flow.mjs"),
  ]);
  assert.match(reviewSource, /HIGH_IMPACT_ACTIONS\.has\(actionType\) && adminLevel < 50/);
  assert.match(reviewSource, /ALLOWED_ACTIONS\.has\(actionType\)/);
  assert.match(reviewSource, /verifiedTargetIds\.includes\(targetUserId\)/);
  assert.match(reviewSource, /referee_target_mismatch/);
  assert.match(reviewSource, /ADMIN_REVIEW_TEXT_MAX_LENGTH/);
  assert.match(submitSource, /verifiedPayload: \{ sourceMatchId: verifiedSourceMatchId \}/);
  assert.match(submitSource, /\.eq\("id", requestedMatchId\)/);
  assert.match(submitSource, /report\.sourceMatchId \?\? report\.payload\?\.sourceMatchId/);
  assert.match(settingsSource, /app\.actions\.reportPlayer\(targetUserId, selectedReportMatchId/);
  assert.match(settingsSource, /if \(row\.userId === app\.currentUserId\) return/);
  assert.match(settingsSource, /remoteSearchType=\{reportRemoteSearchTypes\}/);
  assert.match(settingsSource, /onChange=\{changeReportTargetQuery\}/);
  assert.match(settingsSource, /canRequestVoidMatchRestore\(match, app\.currentUserId\)/);
  assert.match(settingsSource, /reportMemo\.trim\(\)\.length >= 10/);
  assert.match(settingsSource, /`\$\{VOID_MATCH_RESTORE_REPORT_REASON\}: \$\{memo\}`/);
  assert.match(searchSource, /court_review: \["court_review"\]/);
  assert.match(searchSource, /court_request: \["court_request"\]/);
  assert.match(searchSource, /\.from\("court_requests"\)[\s\S]{0,220}\.in\("status", \["pending", "reported"\]\)[\s\S]{0,100}\.neq\("requested_by", profileId\)/);
  assert.match(searchSource, /searchCourtReviews\(context\.supabase, context\.profileId/);
  assert.match(searchSource, /searchCourtRequests\(context\.supabase, context\.profileId/);
  assert.match(submitSource, /cannot_report_own_team_name/);
  assert.match(submitSource, /cannot_report_own_affiliation_name/);
  assert.match(hookSource, /result\.ok === false \|\| result\.duplicate === true/);
  assert.match(simulationSource, /sourceMatchId: basicScenario\.matchId/);
  assert.match(simulationSource, /sourceMatchId,\s+reason: `simulation shared match report/);
});

test("referee search supports qualified discovery on focus only", async () => {
  const [searchSource, pickerSource, createMatchSource] = await Promise.all([
    readSource("server/api/search.js"),
    readSource("src/components/common/SearchPicker.jsx"),
    readSourceGroup(readSource, CREATE_MATCH_PAGE_SOURCE_PATHS),
  ]);
  assert.match(searchSource, /const refereeDiscovery = forceSearch && queryLength === 0 && types\.length === 1 && types\[0\] === "referee";/);
  const refereeSearchSource = searchSource.slice(
    searchSource.indexOf("async function searchReferees"),
    searchSource.indexOf("async function searchAffiliations"),
  );
  assert.ok(
    refereeSearchSource.indexOf('.from("referee_appointments")') < refereeSearchSource.indexOf('.from("public_profiles")'),
  );
  assert.doesNotMatch(refereeSearchSource, /TEST_REFEREE_LOGIN_IDS|test_login_id/);
  assert.doesNotMatch(refereeSearchSource, /\.gte\("trust_score", REFEREE_ACTIVE_TRUST_MIN\)/);
  assert.doesNotMatch(refereeSearchSource, /Number\(profile\.trust_score \?\? 0\) >= REFEREE_ACTIVE_TRUST_MIN/);
  assert.match(refereeSearchSource, /\.in\("id", appointmentProfileIds\)/);
  assert.match(pickerSource, /const canRemoteSearch = canSearch \|\| \(remoteSearchOnFocus && focused\);/);
  assert.match(pickerSource, /setRemoteRetrySequence\(\(current\) => current \+ 1\)/);
  assert.match(pickerSource, /remoteRetrySequence, remoteSearchContextKey/);
  assert.match(pickerSource, /remoteError \? "검색 결과를 불러오지 못했습니다\." : emptyText/);
  assert.match(createMatchSource, /remoteSearchOnFocus=\{remoteDirectoryEnabled\}/);
  assert.match(createMatchSource, /mapRemoteItem=\{\(user\) => activePlayerIds\.has\(user\.id\) \? null : user\}/);
});

test("anonymous users cannot read raw directory tables", async () => {
  const migrationSource = await readSource("supabase/migrations/20260805180000_revoke_anonymous_directory_tables.sql");
  assert.match(migrationSource, /revoke select on table public\.teams, public\.team_members, public\.affiliations\s+from public, anon;/);
  assert.match(migrationSource, /grant select on table public\.teams, public\.team_members, public\.affiliations\s+to authenticated;/);
  assert.doesNotMatch(migrationSource, /delete\s+from|truncate\s+table|drop\s+table/i);
});

test("referee entry trust and active trust stay separated without test-account exceptions", async () => {
  const [appointmentSource, localAppointmentSource, migrationSource, eligibilityMigrationSource, hardeningMigrationSource] = await Promise.all([
    readSource("server/api/admin/appointment-action.js"),
    readSource("src/data/repository/admin/appointment.js"),
    readSource("supabase/migrations/20260730213000_referee_trust_lifecycle.sql"),
    readSource("supabase/migrations/20260730230000_align_alpha_referee_creation_eligibility.sql"),
    readSource("supabase/migrations/20260805173000_remove_alpha_referee_exceptions.sql"),
  ]);
  assert.match(appointmentSource, /actionType === "appointReferee"/);
  assert.match(appointmentSource, /trust_score \?\? 0\) < REFEREE_TRUST_MIN/);
  assert.match(localAppointmentSource, /targetUser\.trustScore \?\? 0\) < REFEREE_TRUST_MIN/);
  assert.match(migrationSource, /coalesce\(profile\.trust_score, 0\) >= 70/);
  assert.match(migrationSource, /referee_entry_trust_too_low/);
  assert.match(migrationSource, /rankball_referee_active_trust_guard/);
  assert.match(migrationSource, /referee_trust_below_70/);
  assert.match(migrationSource, /rankball_tournament_referee_authorized/);
  assert.match(migrationSource, /payload->>'autoRevoked' = 'true'/);
  assert.match(migrationSource, /recruiting_referee_fixed_trust_shape_changed/);
  assert.match(migrationSource, /recruiting_referee_stored_trust_shape_changed/);
  assert.doesNotMatch(migrationSource, /delete\s+from|truncate\s+table|drop\s+table/i);
  assert.match(eligibilityMigrationSource, /rankball_referee_assignment_eligible/);
  assert.match(eligibilityMigrationSource, /appointment\.grade in \('candidate', 'silver', 'gold', 'platinum', 'official'\)/);
  assert.match(eligibilityMigrationSource, /recruiting_referee_trust_shape_changed/);
  assert.match(eligibilityMigrationSource, /alphaTestException/);
  assert.doesNotMatch(eligibilityMigrationSource, /delete\s+from|truncate\s+table|drop\s+table/i);
  assert.match(hardeningMigrationSource, /rankball_referee_assignment_eligible/);
  assert.match(hardeningMigrationSource, /coalesce\(new\.trust_score, 0\) < 70/);
  assert.match(hardeningMigrationSource, /set search_path = ''/);
  assert.doesNotMatch(hardeningMigrationSource, /test_login_id|rankball-001|rankball-011|alphaTestException/);
  assert.doesNotMatch(hardeningMigrationSource, /delete\s+from|truncate\s+table|drop\s+table/i);
});

test("server referee eligibility requires an active appointment for test and regular profiles", async () => {
  assert.equal(await isActiveReferee(createRefereeEligibilitySupabase({
    profile: { id: "alpha-referee", trust_score: 10, test_login_id: "rankball-001" },
  }), "alpha-referee"), false);
  assert.equal(await isActiveReferee(createRefereeEligibilitySupabase({
    profile: { id: "regular-referee", trust_score: 70, test_login_id: null },
    appointments: [{
      user_id: "regular-referee",
      role: "referee",
      grade: "candidate",
      status: "active",
      starts_at: "2026-01-01T00:00:00.000Z",
      ends_at: "2099-01-01T00:00:00.000Z",
    }],
  }), "regular-referee"), true);
  assert.equal(await isActiveReferee(createRefereeEligibilitySupabase({
    profile: { id: "low-trust-referee", trust_score: 69, test_login_id: null },
    appointments: [{
      user_id: "low-trust-referee",
      role: "referee",
      grade: "candidate",
      status: "active",
    }],
  }), "low-trust-referee"), true);
  assert.equal(await isActiveReferee(createRefereeEligibilitySupabase({
    profile: { id: "expired-referee", trust_score: 90, test_login_id: null },
    appointments: [{
      user_id: "expired-referee",
      role: "referee",
      grade: "candidate",
      status: "active",
      ends_at: "2026-01-01T00:00:00.000Z",
    }],
  }), "expired-referee"), false);
});

test("report insert conflicts and admin review input fail safely", async () => {
  assert.equal(isActiveReportInsertConflict({ code: "23505", message: "duplicate key" }), true);
  assert.equal(isActiveReportInsertConflict({ code: "PGRST000", message: "active_report_duplicate" }), true);
  assert.equal(isActiveReportInsertConflict({ code: "PGRST000", message: "connection failed" }), false);

  assert.deepEqual(normalizeAdminReviewInput({
    actionType: "validReport",
    reason: "현장 정보 확인",
    feedback: "신고 내용을 확인해 반영했습니다.",
  }), {
    actionType: "validReport",
    reason: "현장 정보 확인",
    feedback: "신고 내용을 확인해 반영했습니다.",
  });
  assert.equal(normalizeAdminReviewInput({
    actionType: "markCourtDuplicate",
    reason: "중복 구장 현장 확인",
    feedback: "중복 구장으로 확인되어 노출에서 제외했습니다.",
  }).actionType, "markCourtDuplicate");
  assert.throws(() => normalizeAdminReviewInput({
    actionType: "unknownAction",
    reason: "현장 정보 확인",
    feedback: "신고 내용을 확인했습니다.",
  }), /invalid_admin_review_action/);
  assert.throws(() => normalizeAdminReviewInput({
    actionType: "validReport",
    reason: "현장 정보 확인",
    feedback: "가".repeat(501),
  }), /admin_review_detail_invalid/);
  assert.equal(getAdminReviewErrorStatus({ code: "23505", message: "report_already_processed" }), 409);
  assert.equal(getAdminReviewErrorStatus({ code: "42501" }), 403);
  assert.equal(getAdminReviewErrorStatus({ code: "P0002" }), 404);
  assert.equal(getAdminReviewErrorStatus({ code: "XX000" }), 500);

  const submitSource = await readSources(
    "server/api/reports/submit.js",
    "server/api/reports/submitCourtTeamPolicy.js",
  );
  const reviewSource = await readSource("server/api/admin/review-action.js");
  assert.match(reviewSource, /rankball_resolve_duplicate_court_report/);
  assert.match(submitSource, /\.from\("notifications"\)[\s\S]{0,80}\.insert\(notificationRows\)/);
  assert.doesNotMatch(submitSource, /\.upsert\(notificationRows/);
  assert.match(submitSource, /notificationSyncPending/);
});

test("protected API routes require one strict Authorization bearer", async () => {
  assert.deepEqual(parseBearerAuthorization({ headers: {} }), { token: "", error: "missing_bearer_token" });
  assert.equal(getStrictBearerToken({ headers: { authorization: "Bearer abc" } }), "");
  assert.equal(getStrictBearerToken({ headers: { authorization: `Bearer ${"a".repeat(32)},Bearer ${"b".repeat(32)}` } }), "");
  assert.equal(getStrictBearerToken({ headers: { authorization: ` Bearer ${"a".repeat(32)}` } }), "");
  assert.equal(getStrictBearerToken({ headers: { authorization: `Bearer ${"a".repeat(32)}` } }), "a".repeat(32));
  assert.equal(
    bearerTokenMatches({ headers: { authorization: `Bearer ${"a".repeat(32)}` } }, "a".repeat(32)),
    true,
  );
  assert.equal(
    bearerTokenMatches({ headers: { authorization: `Bearer ${"a".repeat(32)}` } }, "b".repeat(32)),
    false,
  );

  const missing = await invokeApi({ path: "profile/me" });
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.payload.error, "missing_bearer_token");
  assert.equal(missing.headers["www-authenticate"], "Bearer");

  const malformed = await invokeApi({ path: "profile/me", headers: { authorization: "Bearer short" } });
  assert.equal(malformed.statusCode, 401);
  assert.equal(malformed.payload.error, "invalid_bearer_token");

  const wrongMethod = await invokeApi({ path: "profile/me", method: "GET" });
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.allow, "POST");
});

test("OAuth state and identity proofs are signed, expiring, and profile-bound", () => {
  const previousSecret = process.env.DISCORD_OAUTH_PROOF_SECRET;
  process.env.DISCORD_OAUTH_PROOF_SECRET = "test-only-proof-secret-that-is-not-production";
  try {
    const { state, ticket } = createDiscordOAuthStateTicket("profile-a");
    assert.deepEqual(verifyDiscordOAuthStateTicket(ticket, state), { appProfileId: "profile-a" });
    assert.equal(verifyDiscordOAuthStateTicket(`${ticket}x`, state), null);
    assert.equal(verifyDiscordOAuthStateTicket(ticket, `${state}x`), null);

    const discordUser = { id: "12345678901234567", username: "rankball", global_name: "RankBall", avatar: "avatar" };
    const proof = createDiscordOAuthProof(discordUser, state, "profile-a");
    assert.equal(verifyDiscordOAuthProof(proof, { expectedProfileId: "profile-a", expectedState: state })?.id, discordUser.id);
    assert.throws(
      () => verifyDiscordOAuthProof(proof, { expectedProfileId: "profile-b", expectedState: state }),
      /discord_oauth_profile_mismatch/,
    );
    assert.equal(verifyDiscordOAuthProof(proof, { expectedProfileId: "profile-a", expectedState: `${state}x` }), null);
  } finally {
    if (previousSecret === undefined) delete process.env.DISCORD_OAUTH_PROOF_SECRET;
    else process.env.DISCORD_OAUTH_PROOF_SECRET = previousSecret;
  }
});

test("OAuth proof and service-role credentials never enter client URLs or source", async () => {
  const [callbackSource, discordClientSource, profileSource, supabaseAdminSource, clientSource] = await Promise.all([
    readSource("server/api/auth/discord/callback.js"),
    readSource("src/lib/discord.js"),
    readSource("server/api/profile/upsert.js"),
    readSources(
      "server/api/_supabaseAdmin.js",
      "server/api/_supabaseAuth.js",
    ),
    readSourceTree("src"),
  ]);
  assert.doesNotMatch(callbackSource, /discordConnection|encodeBase64UrlJson/);
  assert.doesNotMatch(discordClientSource, /searchParams\.get\("discord(?:Connection|State)"\)/);
  assert.match(discordClientSource, /\/api\/auth\/discord\/complete/);
  assert.doesNotMatch(profileSource, /oauthAccessToken|discordConnection\?\.accessToken/);
  assert.match(profileSource, /if \(!existing\?\.id\)[\s\S]{0,180}discord_oauth_profile_required/);
  assert.doesNotMatch(clientSource, /SUPABASE_SERVICE_ROLE_KEY|DISCORD_CLIENT_SECRET|CLOUDFLARE_API_TOKEN/);
  assert.match(supabaseAdminSource, /createHash\("sha256"\)/);
  assert.doesNotMatch(supabaseAdminSource, /authUserCache\.get\(token\)|authUserCache\.set\(token/);
});

test("public app redirects reject untrusted Host values and external paths", () => {
  const previousValues = {
    VITE_PUBLIC_APP_URL: process.env.VITE_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    VERCEL_URL: process.env.VERCEL_URL,
  };
  delete process.env.VITE_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.PUBLIC_APP_URL;
  process.env.VERCEL_URL = "boxtier-preview.vercel.app";
  try {
    assert.equal(getPublicAppUrl({ headers: { host: "evil.example" } }), "");
    assert.equal(getPublicAppUrl({ headers: { host: "boxtier-preview.vercel.app" } }), "https://boxtier-preview.vercel.app");
    assert.equal(getPublicAppWebUrl("//evil.example", { headers: { host: "boxtier-preview.vercel.app" } }), "");
    assert.equal(
      getPublicAppWebUrl("/app/matches", { headers: { host: "boxtier-preview.vercel.app" } }),
      "https://boxtier-preview.vercel.app/app/matches",
    );
  } finally {
    Object.entries(previousValues).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
});

test("authenticated court lookups use POST JSON instead of URL query", async () => {
  const [clientSource, addressServerSource, placeServerSource, requestGuardSource] = await Promise.all([
    readSource("src/lib/naverAddress.js"),
    readSource("server/api/courts/address-search.js"),
    readSource("server/api/courts/place-search.js"),
    readSources(
      "server/api/_supabaseAdmin.js",
      "server/api/_supabaseAuth.js",
    ),
  ]);
  assert.match(clientSource, /fetch\("\/api\/courts\/address-search", \{[\s\S]{0,180}method: "POST"/);
  assert.match(clientSource, /body: JSON\.stringify\(\{ q: searchQuery \}\)/);
  assert.doesNotMatch(clientSource, /address-search\?q=/);
  assert.match(clientSource, /fetch\("\/api\/courts\/place-search", \{[\s\S]{0,180}method: "POST"/);
  assert.doesNotMatch(clientSource, /place-search\?/);
  [addressServerSource, placeServerSource].forEach((serverSource) => {
    assert.match(serverSource, /allowRequestMethod\(request, response\)/);
    assert.doesNotMatch(serverSource, /request\.headers\.host|searchParams\.get\("q"\)/);
  });
  assert.match(requestGuardSource, /allowRequestMethod\(request, response, allowedMethods = \["POST"\]\)/);
  assert.match(placeServerSource, /from\("approved_courts"\)/);
  assert.match(placeServerSource, /from\("court_requests"\)/);
  assert.match(addressServerSource, /openapi\.naver\.com\/v1\/search\/local\.json/);
  assert.match(addressServerSource, /NAVER_SEARCH_CLIENT_ID/);
  assert.match(addressServerSource, /addresses\.length \? addresses : searchNaverLocal\(query\)/);
  assert.match(clientSource, /if \(clientResults\.length\) return clientResults/);
  assert.doesNotMatch(placeServerSource, /openapi\.naver\.com\/v1\/search\/local|NAVER_SEARCH_CLIENT_ID|NAVER_SEARCH_CLIENT_SECRET/);
});

test("court correction reports accept bounded public data only", () => {
  assert.deepEqual(normalizeCourtCorrection({
    field: "name",
    proposedValue: "새 시설명 농구장",
    evidenceUrl: "https://example.com/court",
  }), {
    field: "name",
    attribute: null,
    proposedValue: "새 시설명 농구장",
    note: null,
    evidenceUrl: "https://example.com/court",
  });
  assert.deepEqual(normalizeCourtCorrection({
    field: "access",
    attribute: "publicAccess",
    proposedValue: "public",
    note: "현장 안내판 확인",
  }), {
    field: "access",
    attribute: "publicAccess",
    proposedValue: "public",
    note: "현장 안내판 확인",
    evidenceUrl: null,
  });
  assert.throws(() => normalizeCourtCorrection({ field: "unknown", proposedValue: "수정 내용" }), /invalid_court_correction/);
  assert.throws(() => normalizeCourtCorrection({ field: "name", proposedValue: "짧음" }), /invalid_court_correction/);
  assert.throws(() => normalizeCourtCorrection({ field: "court", attribute: "publicAccess", proposedValue: "public" }), /invalid_court_correction/);
  assert.throws(() => normalizeCourtCorrection({ field: "access", attribute: "publicAccess", proposedValue: "yes" }), /invalid_court_correction/);
  assert.throws(() => normalizeCourtCorrection({ field: "name", proposedValue: "정상 수정 내용", evidenceUrl: "javascript:alert(1)" }), /invalid_court_correction_url/);
});

test("structured court corrections use an atomic admin commit", async () => {
  const reviewSource = await readSource("server/api/admin/review-action.js");
  const migration = await readSource("supabase/migrations/20260728160000_apply_structured_court_correction.sql");
  assert.match(reviewSource, /rpc\("rankball_apply_court_correction_report"/);
  assert.match(migration, /from public\.reports[\s\S]*for update;/);
  assert.match(migration, /public\.rankball_admin_update_court_with_auto_unit\(/);
  assert.match(migration, /public\.rankball_commit_admin_review_action\(/);
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i);
});

test("future public database objects are deny-by-default", async () => {
  const migrationSource = await readSource("supabase/migrations/20260721143000_api_default_privilege_hardening.sql");
  assert.match(migrationSource, /alter default privileges for role postgres in schema public/);
  assert.match(migrationSource, /alter default privileges for role supabase_admin in schema public/);
  assert.match(migrationSource, /revoke all on tables from anon, authenticated, service_role/);
  assert.match(migrationSource, /revoke execute on functions from public, anon, authenticated, service_role/);
  assert.match(migrationSource, /revoke all on sequences from anon, authenticated, service_role/);
  assert.doesNotMatch(migrationSource, /drop table|truncate table|delete from/i);
});

test("Discord OAuth state cookie follows only supported callback paths", () => {
  assert.equal(
    getDiscordOAuthStateCookiePath("https://boxtier.kr/api/discord/callback"),
    "/api/discord/callback",
  );
  assert.equal(
    getDiscordOAuthStateCookiePath("https://boxtier.kr/api/auth/discord/callback"),
    "/api/auth/discord/callback",
  );
  assert.equal(
    getDiscordOAuthStateCookiePath("https://boxtier.kr/api/other/callback"),
    "/api/auth/discord/callback",
  );
});

test("Discord OAuth logs only bounded provider error codes", () => {
  assert.equal(normalizeDiscordOAuthErrorCode("invalid_client"), "invalid_client");
  assert.equal(normalizeDiscordOAuthErrorCode("secret leaked"), "unknown");
  assert.equal(normalizeDiscordOAuthErrorCode("x".repeat(65)), "unknown");
});

test("Discord OAuth requests use the required API user agent", async () => {
  const callbackSource = await readSource("server/api/auth/discord/callback.js");
  assert.equal(callbackSource.match(/"User-Agent": DISCORD_USER_AGENT/g)?.length, 2);
  assert.match(callbackSource, /DiscordBot \(https:\/\/boxtier\.kr, 1\.0\)/);
  assert.equal(callbackSource.match(/process\.env\.DISCORD_(?:CLIENT_ID|CLIENT_SECRET|REDIRECT_URI) \|\| ""\)\.trim\(\)/g)?.length, 3);
});

test("referee exam attempts preserve the first start and first terminal grading", async () => {
  const [source, migrationSource] = await Promise.all([
    readSource("server/api/referee/sync.js"),
    readSource("supabase/migrations/20260803012000_serialize_referee_requests.sql"),
  ]);
  assert.match(source, /\.from\("referee_exam_attempts"\)\s*\.insert\(row\)/);
  assert.doesNotMatch(source, /\.from\("referee_exam_attempts"\)\s*\.upsert\(row/);
  assert.match(source, /\.update\(row\)[\s\S]{0,180}\.eq\("status", "started"\)[\s\S]{0,120}\.maybeSingle\(\)/);
  assert.match(source, /exam_attempt_state_conflict/);
  assert.match(source, /\.from\("referee_requests"\)\s*\.insert\(row\)/);
  assert.doesNotMatch(source, /\.from\("referee_requests"\)\s*\.upsert\(row/);
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(migrationSource, /referee_request_pending_exists/);
  assert.doesNotMatch(migrationSource, /delete\s+from|truncate\s+table|drop\s+table/i);
});

test("retired favorite targets can still be removed", async () => {
  const source = await readSource("server/api/favorites/sync.js");
  assert.match(source, /if \(active\) \{\s+await assertTargetExists\(context, targetType, targetId\)/u);
  assert.doesNotMatch(source, /await assertTargetExists\(context, targetType, targetId\);\s+if \(active\)/u);
});

test("legacy favorite constraint accepts referee targets", async () => {
  const source = await readSource("supabase/migrations/20260802012000_allow_referee_favorites.sql");
  assert.match(source, /drop constraint if exists favorites_target_type_check/u);
  assert.match(source, /target_type in \('player', 'team', 'court', 'referee'\)/u);
  assert.doesNotMatch(source, /delete from|truncate table|drop table/iu);
});

test("settings and referee writes do not report derived cleanup as a failed canonical save", async () => {
  const [settingsSource, refereeSource, refereeControllerSource] = await Promise.all([
    readSource("server/api/settings/sync.js"),
    readSource("server/api/referee/sync.js"),
    readSource("src/pages/useSettingsRefereeController.js"),
  ]);
  assert.match(settingsSource, /console\.warn\("Queued Discord delivery cleanup failed after settings save\."/u);
  assert.doesNotMatch(settingsSource, /if \(cancelError\) throw cancelError/u);
  assert.match(refereeSource, /\.eq\("requested_by", context\.profileId\)[\s\S]*?\.eq\("status", "pending"\)/u);
  assert.match(refereeSource, /duplicate: true/u);
  assert.doesNotMatch(refereeSource, /if \(notificationError\) throw notificationError/u);
  assert.match(refereeControllerSource, /if \(hasPendingRefereeRequest\)/u);
});
