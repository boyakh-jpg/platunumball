import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import apiHandler, { API_ROUTES } from "../api/index.js";
import {
  assertAdminLevel,
  getAdminLevel,
  isActiveAdminAppointment,
} from "../server/api/_supabaseAdmin.js";
import { getAdminCourtErrorStatus } from "../server/api/admin/courts.js";
import { getAdminUserOperationErrorStatus } from "../server/api/admin/user-operations.js";
import {
  clearDemoStorage,
  readProfileCache,
  sanitizeProfileCacheEntry,
  writeProfileCache,
} from "../src/lib/storage.js";
import { hasAdminAccess } from "../src/lib/admin.js";

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

async function invokeApi({ path = "admin/context", query = {}, headers = {} } = {}) {
  const queryString = new URLSearchParams(query).toString();
  const response = createResponse();
  await apiHandler({
    method: "POST",
    url: `/api/${path}${queryString ? `?${queryString}` : ""}`,
    query: { path, ...query },
    headers,
  }, response);
  return response;
}

function makeAdminLevelContext(profileId, resolvedLevel = 0) {
  const calls = [];
  return {
    context: {
      profileId,
      authUserId: "verified-auth-user",
      clientRequestedUserId: "foreign-admin-profile",
      supabase: {
        rpc(name, parameters) {
          calls.push([name, parameters]);
          return Promise.resolve({ data: resolvedLevel, error: null });
        },
      },
    },
    calls,
  };
}

function makeLocalStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test("admin level accepts only strict active and valid appointments", () => {
  const now = Date.parse("2026-07-25T00:00:00.000Z");
  assert.equal(isActiveAdminAppointment({ status: "active" }, now), true);
  assert.equal(isActiveAdminAppointment({ status: "approved" }, now), false);
  assert.equal(isActiveAdminAppointment({ status: "inactive" }, now), false);
  assert.equal(isActiveAdminAppointment({ status: "active", starts_at: "2026-07-26T00:00:00.000Z" }, now), false);
  assert.equal(isActiveAdminAppointment({ status: "active", ends_at: "2026-07-24T23:59:59.000Z" }, now), false);
  assert.equal(isActiveAdminAppointment({ status: "active", starts_at: "invalid" }, now), false);

  assert.doesNotThrow(() => assertAdminLevel(30, 30));
  assert.throws(
    () => assertAdminLevel(0, 30),
    (error) => error?.message === "admin_required" && error?.statusCode === 403,
  );
});

test("admin error mappers preserve explicit authentication and authorization statuses", () => {
  const unauthorized = Object.assign(new Error("missing_bearer_token"), { statusCode: 401 });
  const forbidden = Object.assign(new Error("admin_required"), { statusCode: 403 });
  assert.equal(getAdminCourtErrorStatus(unauthorized), 401);
  assert.equal(getAdminCourtErrorStatus(forbidden), 403);
  assert.equal(getAdminUserOperationErrorStatus(unauthorized), 401);
  assert.equal(getAdminUserOperationErrorStatus(forbidden), 403);
});

test("server admin lookup uses the verified profile only and ignores override-like values", async () => {
  const { context, calls } = makeAdminLevelContext("verified-profile", 30);
  const previousAuthOwners = process.env.RANKBALL_OWNER_AUTH_USER_IDS;
  const previousProfileOwners = process.env.RANKBALL_OWNER_PROFILE_IDS;
  process.env.RANKBALL_OWNER_AUTH_USER_IDS = "verified-auth-user";
  process.env.RANKBALL_OWNER_PROFILE_IDS = "foreign-admin-profile";
  try {
    assert.equal(await getAdminLevel(context), 30);
  } finally {
    if (previousAuthOwners === undefined) delete process.env.RANKBALL_OWNER_AUTH_USER_IDS;
    else process.env.RANKBALL_OWNER_AUTH_USER_IDS = previousAuthOwners;
    if (previousProfileOwners === undefined) delete process.env.RANKBALL_OWNER_PROFILE_IDS;
    else process.env.RANKBALL_OWNER_PROFILE_IDS = previousProfileOwners;
  }
  assert.deepEqual(calls, [
    ["rankball_admin_level_for_profile", {
      actor_profile_id: "verified-profile",
      override_level: 0,
    }],
  ]);
});

test("admin routes require the shared server guard before reading a mutation body", async () => {
  for (const [path, route] of API_ROUTES) {
    if (route.auth !== "admin") continue;
    const source = route.handler.toString();
    assert.match(source, /requireAdminContext\(request/);
    const guardIndex = source.indexOf("requireAdminContext(request");
    const bodyIndex = source.indexOf("readJsonBody(request");
    if (bodyIndex >= 0) assert.ok(guardIndex >= 0 && guardIndex < bodyIndex, `${path} must authorize before body parsing`);
  }

  const [directorySource, stateSource] = await Promise.all([
    readSource("server/api/directory/load.js"),
    readSource("server/api/state/load.js"),
  ]);
  assert.match(directorySource, /body\.scope === "admin"[\s\S]*requireAdminContext\(request/);
  assert.match(stateSource, /requestedScope === "admin"[\s\S]*requireAdminContext\(request/);
});

test("admin URL flags do not authorize a request", async () => {
  const response = await invokeApi({
    query: {
      role: "admin",
      isAdmin: "true",
    },
  });
  assert.equal(response.statusCode, 401);
  assert.match(response.payload?.error ?? "", /bearer_token/);

  const tokenResponse = await invokeApi({
    query: {
      token: "redacted",
    },
  });
  assert.equal(tokenResponse.statusCode, 400);
  assert.equal(tokenResponse.payload?.error, "credentials_not_allowed_in_url");
});

test("admin page and menu authority use server context, not cached appointments", async () => {
  const [appSource, guardSource, adminSource, settingsSource, recruitingSource, matchRoomSource] = await Promise.all([
    readSource("src/App.jsx"),
    readSource("src/components/auth/RequireAdmin.jsx"),
    readSource("src/pages/Admin.jsx"),
    readSource("src/pages/Settings.jsx"),
    readSource("src/pages/Recruiting.jsx"),
    readSource("src/pages/MatchRoom.jsx"),
  ]);
  assert.match(appSource, /path="\/app\/admin" element=\{<RequireAdmin/);
  assert.match(appSource, /path="\/app\/admin\/court-map" element=\{<RequireAdmin/);
  assert.match(guardSource, /loadAdminContext\?\.\(true\)/);
  assert.doesNotMatch(guardSource, /location|searchParams|localStorage|adminAppointments|user_metadata/);
  assert.doesNotMatch(adminSource, /hasAdminAccess/);
  assert.doesNotMatch(settingsSource, /hasAdminAccess/);
  assert.doesNotMatch(recruitingSource, /hasAdminAccess/);
  assert.doesNotMatch(matchRoomSource, /hasAdminAccess/);

  const user = { id: "profile-1" };
  assert.equal(hasAdminAccess(user, {
    adminAppointments: [{
      userId: "profile-1",
      role: "admin",
      grade: "owner",
      status: "active",
    }],
  }), false);
  assert.equal(hasAdminAccess(user, {
    adminAppointments: [{
      userId: "profile-1",
      role: "admin",
      grade: "support",
      status: "active",
      source: "server_context",
    }],
  }), true);
});

test("profile cache v2 purges legacy and stores only the current public profile", () => {
  const localStorage = makeLocalStorage();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage };
  try {
    localStorage.setItem("rankball.auth.profileCache.v1", JSON.stringify({
      "old-auth": {
        user: {
          id: "old-profile",
          testPassword: "redacted",
          discordUserId: "redacted",
        },
        settings: {
          adminAppointments: [{ grade: "owner" }],
          approvedCourts: [{ id: "court-1" }],
          adminAuditLog: [{ id: "audit-1" }],
        },
      },
    }));

    writeProfileCache("current-auth", {
      user: {
        id: "current-profile",
        name: "현재 사용자",
        handle: "current",
        position: "PG",
        avatarIconKey: "01-first-bucket.png",
        testPassword: "redacted",
        discordUserId: "redacted",
        discordConnection: { userId: "redacted" },
        adminAppointments: [{ grade: "owner" }],
      },
      settings: {
        theme: "light",
        adminAppointments: [{ grade: "owner" }],
        approvedCourts: [{ id: "court-1" }],
        adminAuditLog: [{ id: "audit-1" }],
        adminDisciplinaryActions: [{ id: "discipline-1" }],
      },
    });

    assert.equal(localStorage.getItem("rankball.auth.profileCache.v1"), null);
    const rawCache = localStorage.getItem("rankball.auth.profileCache.v2");
    assert.ok(rawCache);
    assert.deepEqual(Object.keys(JSON.parse(rawCache)), ["current-auth"]);
    assert.doesNotMatch(rawCache, /testPassword|discordUserId|discordConnection|adminAppointments|approvedCourts|adminAudit|Disciplinary/);
    assert.deepEqual(readProfileCache("current-auth")?.settings, { theme: "light" });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("production storage cleanup removes stale demo state and profile bindings", () => {
  const localStorage = makeLocalStorage();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage };
  try {
    localStorage.setItem("rankball.mvp.state.v3", JSON.stringify({ users: [{ testPassword: "redacted" }] }));
    localStorage.setItem("rankball.auth.profile.v1", JSON.stringify({ "old-auth": "old-profile" }));
    clearDemoStorage();
    assert.equal(localStorage.getItem("rankball.mvp.state.v3"), null);
    assert.equal(localStorage.getItem("rankball.auth.profile.v1"), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("cache sanitizer cannot retain arbitrary profile or settings fields", () => {
  const sanitized = sanitizeProfileCacheEntry({
    user: {
      id: "profile-1",
      name: "사용자",
      authUserId: "auth-1",
      user_metadata: { role: "admin" },
      adminAppointments: [{ grade: "owner" }],
      testPassword: "redacted",
    },
    settings: {
      theme: "dark",
      approvedCourts: [{ id: "court-1" }],
    },
  });
  assert.deepEqual(sanitized.user, { id: "profile-1", name: "사용자" });
  assert.deepEqual(sanitized.settings, { theme: "dark" });
});

test("alpha test login uses a one-time server token without bundling a password", async () => {
  const [browserSource, serverSource, apiSource, authSource, loginSource, alphaLoginSource] = await Promise.all([
    readSourceTree("src"),
    readSourceTree("server/api"),
    readSourceTree("api"),
    readSource("src/hooks/useAuthSession.js"),
    readSource("src/pages/Login.jsx"),
    readSource("server/api/auth/alpha-test-login.js"),
  ]);
  assert.doesNotMatch(`${browserSource}\n${serverSource}\n${apiSource}`, /\btestPassword\b/);
  assert.doesNotMatch(authSource, /VITE_TEST_AUTH_PASSWORD|test-0000/);
  assert.match(authSource, /VITE_DEMO_LOGIN/);
  assert.match(authSource, /\/api\/auth\/alpha-test-login/);
  assert.match(authSource, /verifyOtp\(\{[\s\S]*token_hash:\s*alphaPayload\.tokenHash[\s\S]*type:\s*"magiclink"/);
  assert.doesNotMatch(authSource, /signInWithPassword/);
  assert.doesNotMatch(loginSource, /type="password"|testCredential/);
  assert.match(alphaLoginSource, /VITE_DEMO_LOGIN/);
  assert.match(alphaLoginSource, /TEST_ACCOUNT_COUNT/);
  assert.match(alphaLoginSource, /isActiveAdminAppointment/);
  assert.match(alphaLoginSource, /generateLink\(\{[\s\S]*type:\s*"magiclink"/);
  assert.doesNotMatch(alphaLoginSource, /password|VITE_TEST_AUTH_PASSWORD|RANKBALL_TEST_PASSWORD/);
});

test("migration fixes helper search_path, status, grants, and admin table RLS", async () => {
  const migration = await readSource("supabase/migrations/20260725022000_admin_authorization_hardening.sql");
  assert.match(migration, /create or replace function public\.current_admin_level\(\)[\s\S]*security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /appointment\.status = 'active'/);
  assert.doesNotMatch(migration, /greatest\(\s*coalesce\(override_level/);
  assert.match(migration, /caller_profile_id is distinct from nullif\(btrim\(actor_profile_id\), ''\)/);
  assert.match(migration, /coalesce\(auth\.role\(\), ''\) = 'service_role'/);
  assert.match(migration, /revoke all on function public\.rankball_admin_level_for_profile\(text, integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.rankball_admin_level_for_profile\(text, integer\) to service_role/);
  assert.match(migration, /alter table public\.%I enable row level security/);
  assert.match(migration, /revoke all privileges on table public\.%I from anon, authenticated/);
  assert.match(migration, /'rating_policy'/);
  assert.match(migration, /'rankball_admin_court_database'/);
  assert.match(migration, /'rankball_admin_court_change_history'/);
  assert.match(migration, /'rankball_approve_court_request'/);
  assert.match(migration, /'rankball_review_void_match_report'/);
  assert.match(migration, /'rankball_update_rating_policy'/);
  assert.match(migration, /using \(public\.current_is_admin\(30\)\)/);
});
