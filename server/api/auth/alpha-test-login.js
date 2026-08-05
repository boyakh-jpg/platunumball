import {
  allowRequestMethod,
  getAdminLevel,
  getAuthenticatedContext,
  getSupabaseAdminClient,
  isActiveAdminAppointment,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";
import { normalizeTestLoginId, TEST_ACCOUNT_COUNT } from "../../../shared/lib/constants.js";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
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

export function isLocalAlphaTestRequest(request = {}) {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(request.headers?.host ?? "").trim());
}

export function assertAlphaTestLoginEnabled(request) {
  const vercelEnvironment = String(process.env.VERCEL_ENV ?? "").trim().toLowerCase();
  const nodeEnvironment = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (
    !isAlphaTestLoginEnabled()
    || nodeEnvironment === "production"
    || (vercelEnvironment && vercelEnvironment !== "development")
    || !isLocalAlphaTestRequest(request)
  ) {
    throw createAlphaLoginError("alpha_test_login_disabled", 404);
  }
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

export function isSettingsTestSwitchActor({ adminLevel = 0, testLoginId = "", email = "" } = {}) {
  if (Number(adminLevel) >= 100) return true;
  try {
    const normalizedLoginId = normalizeAlphaTestLoginId(testLoginId);
    return String(email).trim().toLowerCase() === getTestAuthEmail(normalizedLoginId).toLowerCase();
  } catch {
    return false;
  }
}

async function getSettingsTestSwitchAccess(request) {
  const context = await getAuthenticatedContext(request, {
    freshAuth: true,
    profileSelect: "id, auth_user_id, test_login_id",
  });
  const adminLevel = await getAdminLevel(context);
  if (!isSettingsTestSwitchActor({
    adminLevel,
    testLoginId: context.profile?.test_login_id,
    email: context.authUser?.email,
  })) {
    throw createAlphaLoginError("test_account_switch_forbidden", 403);
  }
  return { allowActiveAdminTarget: Number(adminLevel) >= 100 };
}

export async function assertTestProfileAvailable(client, testLoginId, email, { allowActiveAdminTarget = false } = {}) {
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
  if (!allowActiveAdminTarget && (appointments ?? []).some((appointment) => isActiveAdminAppointment(appointment))) {
    throw createAlphaLoginError("alpha_test_admin_login_forbidden", 403);
  }
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    assertRateLimit(request);
    const body = await readJsonBody(request);
    let switchAccess = { allowActiveAdminTarget: false };
    if (body.settingsSwitch === true) switchAccess = await getSettingsTestSwitchAccess(request);
    else assertAlphaTestLoginEnabled(request);
    const testLoginId = normalizeAlphaTestLoginId(body.testLoginId);
    const email = getTestAuthEmail(testLoginId);
    const client = getSupabaseAdminClient();

    await assertTestProfileAvailable(client, testLoginId, email, switchAccess);
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
