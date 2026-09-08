import assert from "node:assert/strict";
import test from "node:test";
import handler, { getAdminDashboardErrorStatus, loadAdminDashboard } from "./dashboard.js";
import { API_ROUTES } from "../../../api/index.js";
import {
  ADMIN_DASHBOARD_MIN_LEVEL,
  normalizeAdminDashboardQuery,
} from "../../../shared/lib/adminDashboardPolicy.js";

function dashboardResult(query = normalizeAdminDashboardQuery(), rows = []) {
  return {
    ok: true,
    generatedAt: "2026-09-08T03:00:00.000Z",
    summary: {
      members: { total: 120, today: 3 },
      teams: { total: 12, today: 1 },
      matches: { total: 80, active: 2, confirmed: 61, today: 4 },
      tournaments: { total: 6, active: 1, completed: 2 },
    },
    rows,
    page: { ...query, total: rows.length, hasMore: false, nextOffset: null },
  };
}

function mockContext(reply, calls = []) {
  return {
    profileId: "operator-profile",
    adminLevel: ADMIN_DASHBOARD_MIN_LEVEL,
    supabase: { rpc: async (name, args) => { calls.push({ name, args }); return reply; } },
  };
}

function mockResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test("dashboard query defaults, kind restrictions and limits use shared policy", () => {
  assert.deepEqual(normalizeAdminDashboardQuery(), { kind: "tournaments", search: "", status: "all", limit: 30, offset: 0 });
  assert.deepEqual(normalizeAdminDashboardQuery({ kind: "members", search: "  서울,(강남)% ", status: "completed", limit: 300, offset: 99_999 }), {
    kind: "members", search: "서울 강남", status: "all", limit: 60, offset: 10_000,
  });
  assert.equal(normalizeAdminDashboardQuery({ kind: "teams", status: "active" }).status, "all");
  assert.equal(normalizeAdminDashboardQuery({ kind: "matches", status: "completed" }).status, "completed");
  assert.deepEqual(normalizeAdminDashboardQuery({ kind: "other", status: "invalid", limit: "bad", offset: -1 }), normalizeAdminDashboardQuery());
  assert.equal(normalizeAdminDashboardQuery({ search: "가".repeat(100) }).search.length, 80);
  assert.equal(normalizeAdminDashboardQuery({ limit: 12.8 }).limit, 12);
});

test("one RPC gets the authenticated actor and bounded request; private member fields cannot escape", async () => {
  const query = normalizeAdminDashboardQuery({ kind: "members", search: "회원", status: "active", limit: 1 });
  const rpcResult = dashboardResult(query, [{
    id: "member-1", name: "회원", hashtag: "#1234", region: "서울", createdAt: "2026-09-07T15:00:00Z", status: null,
    auth_user_id: "private-auth", discord_connection: { token: "private" }, app_settings: { privacy: {} },
  }]);
  const calls = [];
  const result = await loadAdminDashboard(mockContext({ data: rpcResult, error: null }, calls), query);
  assert.deepEqual(calls, [{ name: "rankball_admin_dashboard", args: {
    p_actor_profile_id: "operator-profile", p_actor_admin_level: 50,
    p_kind: "members", p_search: "회원", p_status: "all", p_limit: 1, p_offset: 0,
  } }]);
  assert.deepEqual(result.rows, [{ id: "member-1", name: "회원", hashtag: "#1234", region: "서울", createdAt: "2026-09-07T15:00:00Z", status: null }]);
  assert.equal(result.summary.members.total, 120);
  assert.equal(result.page.total, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-auth|discord_connection|app_settings/);
});

test("tournament counts preserve generated, confirmed and cancelled as separate quantities", async () => {
  const row = {
    id: "tournament-1", name: "대회", region: "서울", createdAt: "2026-09-08T00:00:00Z", status: "active",
    format: "league", startDate: "2026-09-08", endDate: "2026-09-10",
    teamCount: 4, approvedTeamCount: 3, matchCount: 6, confirmedMatchCount: 2, cancelledMatchCount: 1,
  };
  const result = await loadAdminDashboard(mockContext({ data: dashboardResult(undefined, [row]), error: null }));
  assert.deepEqual(result.rows, [row]);
  assert.equal(result.summary.tournaments.total, 6);
});

test("database errors and partial aggregates never become zero statistics", async () => {
  const dbError = { code: "42P01", message: "relation unavailable" };
  await assert.rejects(loadAdminDashboard(mockContext({ data: null, error: dbError })), (error) => error === dbError);
  for (const mutate of [
    () => null,
    (value) => { delete value.summary.matches.active; return value; },
    (value) => { value.summary.members.total = -1; return value; },
    (value) => { value.page.kind = "members"; return value; },
    (value) => { value.rows = Array.from({ length: 31 }, (_, index) => ({ id: String(index) })); return value; },
  ]) {
    await assert.rejects(loadAdminDashboard(mockContext({ data: mutate(dashboardResult()), error: null })), {
      message: "admin_dashboard_invalid_response", statusCode: 502,
    });
  }
  assert.equal(getAdminDashboardErrorStatus({ code: "42501", message: "permission denied" }), 403);
  assert.equal(getAdminDashboardErrorStatus(dbError), 500);
});

test("route is POST-only and uses the admin security boundary", async () => {
  const route = API_ROUTES.get("/admin/dashboard");
  assert.deepEqual(route.methods, ["POST"]);
  assert.equal(route.auth, "admin");
  assert.equal(route.handler, handler);
  const response = mockResponse();
  await handler({ method: "GET" }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, "POST");
});

test("handler verifies live authentication and level 50 before the dashboard RPC", async (t) => {
  const savedEnv = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = "https://dashboard-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "dashboard-service-role-test";
  t.after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const calls = [];
  let level = 30;
  let dashboardError = false;
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (input) => {
    const path = new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname;
    calls.push(path);
    if (path === "/auth/v1/user") return Response.json({ id: "auth-operator", aud: "authenticated" });
    if (path === "/rest/v1/profiles") return Response.json([{ id: "operator-profile", auth_user_id: "auth-operator" }]);
    if (path === "/rest/v1/rpc/rankball_admin_level_for_profile") return Response.json(level);
    if (path === "/rest/v1/rpc/rankball_admin_dashboard") {
      return dashboardError
        ? Response.json({ code: "42501", message: "admin_permission_required" }, { status: 403 })
        : Response.json(dashboardResult());
    }
    throw new Error(`Unexpected network request: ${path}`);
  });
  const missing = mockResponse();
  await handler({ method: "POST", headers: {}, body: {} }, missing);
  assert.equal(missing.statusCode, 401);
  assert.equal(calls.length, 0);

  const request = { method: "POST", headers: { authorization: "Bearer operator-test-token" }, body: {} };
  const denied = mockResponse();
  await handler(request, denied);
  assert.equal(denied.statusCode, 403, JSON.stringify({ body: denied.body, calls }));
  assert.equal(calls.includes("/rest/v1/rpc/rankball_admin_dashboard"), false);

  level = 50;
  const allowed = mockResponse();
  await handler(request, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.body, dashboardResult());
  assert.equal(calls.filter((path) => path === "/auth/v1/user").length, 2);

  dashboardError = true;
  const databaseDenied = mockResponse();
  await handler(request, databaseDenied);
  assert.equal(databaseDenied.statusCode, 403);
  assert.equal(databaseDenied.body.error, "admin_permission_required");
});
