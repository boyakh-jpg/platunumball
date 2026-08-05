import assert from "node:assert/strict";
import test from "node:test";
import handler, {
  assertAlphaTestLoginEnabled,
  assertNonAdminTestProfile,
  isAlphaTestLoginEnabled,
  isLocalAlphaTestRequest,
  isSettingsTestSwitchActor,
  isTemporaryAdminTestLoginAllowed,
  normalizeAlphaTestLoginId,
} from "../server/api/auth/alpha-test-login.js";
import { getBoundAuthProfileId } from "../src/hooks/appData/metadata.js";

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

function createProfileClient(appointments = [], testLoginId = "rankball-006") {
  return {
    auth: {
      admin: {
        async getUserById() {
          return { data: { user: { email: `${testLoginId}@rankball.test` } }, error: null };
        },
      },
    },
    from(table) {
      if (table === "profiles") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: {
                id: "profile-6",
                auth_user_id: "auth-6",
                test_login_id: testLoginId,
              },
              error: null,
            };
          },
        };
      }
      assert.equal(table, "admin_appointments");
      let filters = 0;
      return {
        select() {
          return this;
        },
        eq() {
          filters += 1;
          if (filters < 2) return this;
          return Promise.resolve({ data: appointments, error: null });
        },
      };
    },
  };
}

test("alpha test login accepts only the fixed test account allowlist", () => {
  assert.equal(normalizeAlphaTestLoginId("6"), "rankball-006");
  assert.equal(normalizeAlphaTestLoginId("rankball-050"), "rankball-050");
  assert.throws(() => normalizeAlphaTestLoginId("rankball-000"), /invalid_test_login_id/);
  assert.throws(() => normalizeAlphaTestLoginId("rankball-051"), /invalid_test_login_id/);
  assert.throws(() => normalizeAlphaTestLoginId("owner@example.com"), /invalid_test_login_id/);
});

test("alpha test login flag is exact and disabled by default", () => {
  const previous = process.env.VITE_DEMO_LOGIN;
  try {
    delete process.env.VITE_DEMO_LOGIN;
    assert.equal(isAlphaTestLoginEnabled(), false);
    process.env.VITE_DEMO_LOGIN = "TRUE";
    assert.equal(isAlphaTestLoginEnabled(), true);
    process.env.VITE_DEMO_LOGIN = "1";
    assert.equal(isAlphaTestLoginEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.VITE_DEMO_LOGIN;
    else process.env.VITE_DEMO_LOGIN = previous;
  }
});

test("public alpha login is localhost-only even when the flag is enabled", () => {
  const previousDemoLogin = process.env.VITE_DEMO_LOGIN;
  const previousVercelEnvironment = process.env.VERCEL_ENV;
  try {
    process.env.VITE_DEMO_LOGIN = "true";
    delete process.env.VERCEL_ENV;
    assert.equal(isLocalAlphaTestRequest({ headers: { host: "127.0.0.1:4174" } }), true);
    assert.equal(isLocalAlphaTestRequest({ headers: { host: "boxtier.kr" } }), false);
    assert.doesNotThrow(() => assertAlphaTestLoginEnabled({ headers: { host: "localhost:4174" } }));
    assert.throws(() => assertAlphaTestLoginEnabled({ headers: { host: "boxtier.kr" } }), /alpha_test_login_disabled/);
    process.env.VERCEL_ENV = "preview";
    assert.throws(() => assertAlphaTestLoginEnabled({ headers: { host: "localhost:4174" } }), /alpha_test_login_disabled/);
  } finally {
    if (previousDemoLogin === undefined) delete process.env.VITE_DEMO_LOGIN;
    else process.env.VITE_DEMO_LOGIN = previousDemoLogin;
    if (previousVercelEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnvironment;
  }
});

test("disabled alpha login fails before reading credentials or reaching Supabase", async () => {
  const previous = process.env.VITE_DEMO_LOGIN;
  const response = createResponse();
  try {
    process.env.VITE_DEMO_LOGIN = "false";
    await handler({ method: "POST", headers: {}, body: { testLoginId: "rankball-006" } }, response);
  } finally {
    if (previous === undefined) delete process.env.VITE_DEMO_LOGIN;
    else process.env.VITE_DEMO_LOGIN = previous;
  }
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.payload, { error: "alpha_test_login_disabled" });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("active administrator test profiles cannot receive an alpha login token", async () => {
  await assert.doesNotReject(() => assertNonAdminTestProfile(
    createProfileClient([{ role: "admin", status: "inactive" }]),
    "rankball-006",
    "rankball-006@rankball.test",
  ));
  await assert.rejects(
    () => assertNonAdminTestProfile(
      createProfileClient([{ role: "admin", status: "active" }]),
      "rankball-006",
      "rankball-006@rankball.test",
    ),
    (error) => error?.message === "alpha_test_admin_login_forbidden" && error?.statusCode === 403,
  );
});

test("rankball-001 alone temporarily bypasses the active administrator block", async () => {
  assert.equal(isTemporaryAdminTestLoginAllowed("rankball-001"), true);
  assert.equal(isTemporaryAdminTestLoginAllowed("rankball-002"), false);
  await assert.doesNotReject(() => assertNonAdminTestProfile(
    createProfileClient([{ role: "admin", status: "active" }], "rankball-001"),
    "rankball-001",
    "rankball-001@rankball.test",
  ));
});

test("settings test account switching requires the owner or an exact test auth identity", () => {
  assert.equal(isSettingsTestSwitchActor({ adminLevel: 100 }), true);
  assert.equal(isSettingsTestSwitchActor({
    testLoginId: "rankball-006",
    email: "rankball-006@rankball.test",
  }), true);
  assert.equal(isSettingsTestSwitchActor({
    testLoginId: "rankball-006",
    email: "player@example.com",
  }), false);
  assert.equal(isSettingsTestSwitchActor({
    testLoginId: "rankball-051",
    email: "rankball-051@rankball.test",
  }), false);
});

test("local test session selects the demo profile with the exact login id", () => {
  const state = {
    currentUserId: "u53",
    users: [
      { id: "u31", testLoginId: "rankball-031" },
      { id: "u53", testLoginId: "rankball-053" },
    ],
  };
  assert.equal(getBoundAuthProfileId(state, "test-rankball-031", {}, "test-rankball-031"), "u31");
  assert.equal(getBoundAuthProfileId(state, "test-unknown", {}, "test-unknown"), "u53");
});
