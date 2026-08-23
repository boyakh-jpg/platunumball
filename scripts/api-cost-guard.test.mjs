import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getRequestNetworkIdentity } from "../server/lib/requestNetworkIdentity.js";
import { consumePublicApiCostGuard, getPublicApiCostPolicy } from "../server/lib/publicApiCostGuard.js";

test("request network identity groups IPv4 /24 and IPv6 /64 without raw addresses", () => {
  assert.equal(getRequestNetworkIdentity({ headers: { "x-forwarded-for": "203.0.113.7" } }), "ipv4:203.0.113.0/24");
  assert.equal(getRequestNetworkIdentity({ headers: { "x-vercel-forwarded-for": "203.0.113.99", "x-forwarded-for": "198.51.100.1" } }), "ipv4:203.0.113.0/24");
  assert.equal(getRequestNetworkIdentity({ headers: { "x-forwarded-for": "2001:db8:abcd:12::1" } }), "ipv6:2001:0db8:abcd:0012/64");
  assert.equal(getRequestNetworkIdentity({ headers: {} }), "network:unknown");
});

test("public API guard sends only an HMAC identity to the atomic limiter", async (t) => {
  const previousSecret = process.env.API_COST_GUARD_SECRET;
  const previousWindow = process.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS;
  const previousMaximum = process.env.PUBLIC_API_RATE_LIMIT_MAX_REQUESTS;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.API_COST_GUARD_SECRET;
    else process.env.API_COST_GUARD_SECRET = previousSecret;
    if (previousWindow === undefined) delete process.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS;
    else process.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS = previousWindow;
    if (previousMaximum === undefined) delete process.env.PUBLIC_API_RATE_LIMIT_MAX_REQUESTS;
    else process.env.PUBLIC_API_RATE_LIMIT_MAX_REQUESTS = previousMaximum;
  });
  process.env.API_COST_GUARD_SECRET = "test-secret";
  process.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS = "90";
  process.env.PUBLIC_API_RATE_LIMIT_MAX_REQUESTS = "7";
  const calls = [];
  const supabase = {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return { data: { allowed: true, remaining: 6, resetAt: "2026-08-23T00:01:30.000Z" }, error: null };
    },
  };

  const result = await consumePublicApiCostGuard({ headers: { "x-forwarded-for": "203.0.113.7" } }, supabase);
  assert.equal(result.allowed, true);
  assert.deepEqual(getPublicApiCostPolicy(), { windowSeconds: 90, maxRequests: 7 });
  assert.equal(calls[0].name, "rankball_consume_api_fixed_window");
  assert.match(calls[0].payload.p_identity_hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(calls[0]), /203\.0\.113\.7/);
  assert.equal(calls[0].payload.p_scope, "public-api");
});

test("public routes use the shared guard backed by a locked private migration", async () => {
  const [api, sql] = await Promise.all([
    readFile(new URL("../api/index.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260823002037_api_cost_guards.sql", import.meta.url), "utf8"),
  ]);
  assert.match(api, /enforceApiRouteSecurity[\s\S]*route\.auth === "publicRead"[\s\S]*enforcePublicApiCostGuard/);
  assert.match(sql, /api_fixed_window_limits[\s\S]*enable row level security/i);
  assert.match(sql, /rankball_consume_api_fixed_window[\s\S]*pg_advisory_xact_lock/i);
  assert.match(sql, /revoke all on function public\.rankball_consume_api_fixed_window/i);
  assert.doesNotMatch(sql, /grant .* to (anon|authenticated)|drop table|truncate|delete from/i);
});
