import {
  allowRequestMethod,
  getSupabaseAdminClient,
  isActiveAdminAppointment,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";
import { normalizeTestLoginId, TEST_ACCOUNT_COUNT } from "../../../shared/lib/constants.js";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
// TEMPORARY ALPHA EXCEPTION: remove before beta and restore the all-admin block.
const TEMPORARY_ADMIN_TEST_LOGIN_IDS = new Set(["rankball-001"]);
const requestWindows = new Map();

function createAlphaLoginError(code, statusCode) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

function getTestAuthEmail(testLoginId) {
  const domain = process.env.RANKBALL_TEST_AUTH_EMAIL_DOMAIN
    || process.env.VITE_TEST_AUTH_EMAIL_DOMAIN
    || "rankball.test";
  return `${testLoginId}@${domain}`;
}

function getRequestKey(request = {}) {
  const forwarded = String(request.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || String(request.socket?.remoteAddress ?? "unknown");
}

function assertRateLimit(request, now = Date.now()) {
  if (requestWindows.size > 1_000) {
    for (const [storedKey, storedWindow] of requestWindows) {
      if (now - storedWindow.startedAt >= RATE_LIMIT_WINDOW_MS) requestWindows.delete(storedKey);
    }
  }
  const key = getRequestKey(request);
  const activeWindow = requestWindows.get(key);
  if (!activeWindow || now - activeWindow.startedAt >= RATE_LIMIT_WINDOW_MS) {
    requestWindows.set(key, { count: 1, startedAt: now });
    return;
  }
  activeWindow.count += 1;
  if (activeWindow.count > RATE_LIMIT_MAX_REQUESTS) {
    throw createAlphaLoginError("alpha_test_login_rate_limited", 429);
  }
}

export function isAlphaTestLoginEnabled() {
  return String(process.env.VITE_DEMO_LOGIN ?? "").trim().toLowerCase() === "true";
}

export function assertAlphaTestLoginEnabled() {
  if (!isAlphaTestLoginEnabled()) throw createAlphaLoginError("alpha_test_login_disabled", 404);
}

export function normalizeAlphaTestLoginId(value = "") {
  const normalized = normalizeTestLoginId(value);
  const match = normalized.match(/^rankball-(\d{3})$/);
  const accountNumber = Number(match?.[1] ?? 0);
  if (!match || accountNumber < 1 || accountNumber > TEST_ACCOUNT_COUNT) {
    throw createAlphaLoginError("invalid_test_login_id", 400);
  }
  return normalized;
}

export function isTemporaryAdminTestLoginAllowed(testLoginId = "") {
  return TEMPORARY_ADMIN_TEST_LOGIN_IDS.has(normalizeTestLoginId(testLoginId));
}

export async function assertNonAdminTestProfile(client, testLoginId, email) {
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("id,auth_user_id,test_login_id")
    .eq("test_login_id", testLoginId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.id || !profile.auth_user_id) {
    throw createAlphaLoginError("test_account_not_available", 404);
  }

  const { data: authData, error: authError } = await client.auth.admin.getUserById(profile.auth_user_id);
  if (authError) throw authError;
  if (String(authData?.user?.email ?? "").toLowerCase() !== email.toLowerCase()) {
    throw createAlphaLoginError("test_account_not_available", 404);
  }

  const { data: appointments, error: appointmentError } = await client
    .from("admin_appointments")
    .select("status,starts_at,ends_at,role")
    .eq("user_id", profile.id)
    .eq("role", "admin");
  if (appointmentError) throw appointmentError;
  if (
    !isTemporaryAdminTestLoginAllowed(testLoginId)
    && (appointments ?? []).some((appointment) => isActiveAdminAppointment(appointment))
  ) {
    throw createAlphaLoginError("alpha_test_admin_login_forbidden", 403);
  }
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    assertAlphaTestLoginEnabled();
    assertRateLimit(request);
    const body = await readJsonBody(request);
    const testLoginId = normalizeAlphaTestLoginId(body.testLoginId);
    const email = getTestAuthEmail(testLoginId);
    const client = getSupabaseAdminClient();

    await assertNonAdminTestProfile(client, testLoginId, email);
    const { data, error } = await client.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) throw error;
    const tokenHash = String(data?.properties?.hashed_token ?? "");
    if (!tokenHash) throw createAlphaLoginError("alpha_test_login_token_missing", 502);

    sendJson(response, 200, {
      ok: true,
      tokenHash,
      verificationType: "magiclink",
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(response, statusCode, {
      error: statusCode < 500 ? error.message : "alpha_test_login_failed",
    });
  }
}
