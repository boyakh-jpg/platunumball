import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import apiHandler, { API_ROUTES } from "../api/index.js";
import {
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
import { getPublicAppUrl, getPublicAppWebUrl } from "../server/api/_publicAppUrl.js";
import {
  isActiveReportInsertConflict,
  normalizeCourtCorrection,
} from "../server/api/reports/submit.js";
import {
  getAdminReviewErrorStatus,
  normalizeAdminReviewInput,
} from "../server/api/admin/review-action.js";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

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

test("API routes use deny-by-default method and credential policies", async () => {
  const validAuthModes = new Set(["user", "admin", "internal", "signedWebhook", "oauthCallback", "alphaTest"]);
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
    if (route.auth === "internal") assert.match(handlerSource, /assert(?:WorkerAccess|BridgeAccess|Access)\(request\)/);
    if (route.auth === "signedWebhook") assert.match(handlerSource, /verifyDiscordSignature/);
    if (route.auth === "alphaTest") assert.match(handlerSource, /assertAlphaTestLoginEnabled/);
  }
  assert.deepEqual(
    [...API_ROUTES].filter(([, route]) => route.auth === "oauthCallback").map(([path]) => path),
    ["/auth/discord/callback"],
  );
  const internalSources = await Promise.all([
    "server/api/discord/dm-worker.js",
    "server/api/discord/room-chat.js",
    "server/api/system/cleanup-sim.js",
    "server/api/system/feed-audit.js",
    "server/api/system/maintenance.js",
    "server/api/system/schema-health.js",
  ].map(readSource));
  internalSources.forEach((source) => assert.match(source, /bearerTokenMatches\(request,/));
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
    readSource("server/api/reports/submit.js"),
    readSource("src/pages/Settings.jsx"),
    readSource("src/hooks/useAppData.js"),
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
    readSource("src/pages/CreateMatch.jsx"),
  ]);
  assert.match(searchSource, /const refereeDiscovery = forceSearch && queryLength === 0 && types\.length === 1 && types\[0\] === "referee";/);
  const refereeSearchSource = searchSource.slice(
    searchSource.indexOf("async function searchReferees"),
    searchSource.indexOf("async function searchAffiliations"),
  );
  assert.ok(
    refereeSearchSource.indexOf('.from("referee_appointments")') < refereeSearchSource.indexOf('.from("public_profiles")'),
  );
  assert.match(refereeSearchSource, /\.from\("profiles"\)[\s\S]*?\.in\("test_login_id", TEST_REFEREE_LOGIN_IDS\)/);
  assert.match(refereeSearchSource, /\.in\("id", appointmentProfileIds\)/);
  assert.match(pickerSource, /const canRemoteSearch = canSearch \|\| \(remoteSearchOnFocus && focused\);/);
  assert.match(createMatchSource, /remoteSearchOnFocus=\{remoteDirectoryEnabled\}/);
  assert.match(createMatchSource, /mapRemoteItem=\{\(user\) => activePlayerIds\.has\(user\.id\) \? null : user\}/);
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

  const submitSource = await readSource("server/api/reports/submit.js");
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

  const missing = await invokeApi();
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.payload.error, "missing_bearer_token");
  assert.equal(missing.headers["www-authenticate"], "Bearer");

  const malformed = await invokeApi({ headers: { authorization: "Bearer short" } });
  assert.equal(malformed.statusCode, 401);
  assert.equal(malformed.payload.error, "invalid_bearer_token");

  const wrongMethod = await invokeApi({ method: "GET" });
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
    readSource("server/api/_supabaseAdmin.js"),
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
  const [clientSource, addressServerSource, placeServerSource] = await Promise.all([
    readSource("src/lib/naverAddress.js"),
    readSource("server/api/courts/address-search.js"),
    readSource("server/api/courts/place-search.js"),
  ]);
  assert.match(clientSource, /fetch\("\/api\/courts\/address-search", \{[\s\S]{0,180}method: "POST"/);
  assert.match(clientSource, /body: JSON\.stringify\(\{ q: searchQuery \}\)/);
  assert.doesNotMatch(clientSource, /address-search\?q=/);
  assert.match(clientSource, /fetch\("\/api\/courts\/place-search", \{[\s\S]{0,180}method: "POST"/);
  assert.doesNotMatch(clientSource, /place-search\?/);
  [addressServerSource, placeServerSource].forEach((serverSource) => {
    assert.match(serverSource, /request\.method !== "POST"/);
    assert.doesNotMatch(serverSource, /request\.headers\.host|searchParams\.get\("q"\)/);
  });
  assert.match(placeServerSource, /from\("approved_courts"\)/);
  assert.match(placeServerSource, /from\("court_requests"\)/);
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
