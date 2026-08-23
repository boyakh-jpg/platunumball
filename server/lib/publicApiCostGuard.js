import { createHmac } from "node:crypto";
import { getSupabaseAdminClient } from "../api/_supabaseAuth.js";
import { getRequestNetworkIdentity } from "./requestNetworkIdentity.js";

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REQUESTS = 120;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function getPublicApiCostPolicy() {
  return {
    windowSeconds: boundedInteger(process.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS, 10, 3600),
    maxRequests: boundedInteger(process.env.PUBLIC_API_RATE_LIMIT_MAX_REQUESTS, DEFAULT_MAX_REQUESTS, 1, 10_000),
  };
}

function getGuardSecret() {
  const secret = String(process.env.API_COST_GUARD_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!secret) throw new Error("public_api_cost_guard_secret_missing");
  return secret;
}

export async function consumePublicApiCostGuard(request, supabase = getSupabaseAdminClient()) {
  const policy = getPublicApiCostPolicy();
  const identityHash = createHmac("sha256", getGuardSecret())
    .update(`boxtier:public-api:${getRequestNetworkIdentity(request)}`)
    .digest("hex");
  const { data, error } = await supabase.rpc("rankball_consume_api_fixed_window", {
    p_scope: "public-api",
    p_identity_hash: identityHash,
    p_limit: policy.maxRequests,
    p_window_seconds: policy.windowSeconds,
  });
  if (error) throw error;
  return data;
}

export async function enforcePublicApiCostGuard(request, response) {
  try {
    const state = await consumePublicApiCostGuard(request);
    response.setHeader?.("RateLimit-Limit", String(state.limit));
    response.setHeader?.("RateLimit-Remaining", String(state.remaining));
    response.setHeader?.("RateLimit-Reset", String(state.retryAfterSeconds));
    if (state.allowed) return true;
    response.setHeader?.("Retry-After", String(state.retryAfterSeconds));
    response.status(429).json({ error: "public_api_rate_limit_reached" });
    return false;
  } catch (error) {
    console.error("Public API cost guard failed.", error.message);
    response.status(503).json({ error: "public_api_cost_guard_unavailable" });
    return false;
  }
}
