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
  const validAuthModes = new Set(["user", "admin", "internal", "signedWebhook", "oauthCallback"]);
  assert.ok(API_ROUTES.size > 40);
  for (const [path, route] of API_ROUTES) {
    assert.match(path, /^\/[a-z0-9/-]+$/);
    assert.ok(typeof route.handler === "function");
    assert.ok(route.methods.length > 0);
    assert.ok(route.methods.every((method) => ["GET", "POST"].includes(method)));
    assert.ok(validAuthModes.has(route.auth));

    const handlerSource = route.handler.toString();
    if (["user", "admin"].includes(route.auth)) assert.match(handlerSource, /getAuthenticatedContext/);
    if (route.auth === "admin") assert.match(handlerSource, /getAdminLevel/);
    if (route.auth === "internal") assert.match(handlerSource, /assert(?:WorkerAccess|BridgeAccess|Access)\(request\)/);
    if (route.auth === "signedWebhook") assert.match(handlerSource, /verifyDiscordSignature/);
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
  const [reviewSource, submitSource, settingsSource, hookSource, searchSource] = await Promise.all([
    readSource("server/api/admin/review-action.js"),
    readSource("server/api/reports/submit.js"),
    readSource("src/pages/Settings.jsx"),
    readSource("src/hooks/useAppData.js"),
    readSource("server/api/search.js"),
  ]);
  assert.match(reviewSource, /HIGH_IMPACT_ACTIONS\.has\(actionType\) && adminLevel < 50/);
  assert.match(reviewSource, /verifiedTargetIds\.includes\(targetUserId\)/);
  assert.match(reviewSource, /referee_target_mismatch/);
  assert.match(reviewSource, /reason\.length < 4 \|\| feedback\.length < 4/);
  assert.match(submitSource, /verifiedPayload: \{ sourceMatchId: verifiedSourceMatchId \}/);
  assert.match(submitSource, /\.eq\("id", requestedMatchId\)/);
  assert.match(submitSource, /report\.sourceMatchId \?\? report\.payload\?\.sourceMatchId/);
  assert.match(settingsSource, /app\.actions\.reportPlayer\(targetUserId, selectedReportMatchId/);
  assert.match(settingsSource, /if \(row\.userId === app\.currentUserId\) return/);
  assert.match(settingsSource, /remoteSearchType=\{reportRemoteSearchTypes\}/);
  assert.match(searchSource, /court_review: \["court_review"\]/);
  assert.match(searchSource, /searchCourtReviews\(context\.supabase, context\.profileId/);
  assert.match(hookSource, /result\.ok === false \|\| result\.duplicate === true/);
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
  process.env.VERCEL_URL = "rankball-preview.vercel.app";
  try {
    assert.equal(getPublicAppUrl({ headers: { host: "evil.example" } }), "");
    assert.equal(getPublicAppUrl({ headers: { host: "rankball-preview.vercel.app" } }), "https://rankball-preview.vercel.app");
    assert.equal(getPublicAppWebUrl("//evil.example", { headers: { host: "rankball-preview.vercel.app" } }), "");
    assert.equal(
      getPublicAppWebUrl("/app/matches", { headers: { host: "rankball-preview.vercel.app" } }),
      "https://rankball-preview.vercel.app/app/matches",
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

test("future public database objects are deny-by-default", async () => {
  const migrationSource = await readSource("supabase/migrations/20260721143000_api_default_privilege_hardening.sql");
  assert.match(migrationSource, /alter default privileges for role postgres in schema public/);
  assert.match(migrationSource, /alter default privileges for role supabase_admin in schema public/);
  assert.match(migrationSource, /revoke all on tables from anon, authenticated, service_role/);
  assert.match(migrationSource, /revoke execute on functions from public, anon, authenticated, service_role/);
  assert.match(migrationSource, /revoke all on sequences from anon, authenticated, service_role/);
  assert.doesNotMatch(migrationSource, /drop table|truncate table|delete from/i);
});
