import { createClient } from "@supabase/supabase-js";

const ADMIN_GRADE_LEVELS = {
  owner: 100,
  senior: 80,
  regionManager: 60,
  matchManager: 50,
  support: 30,
};

let adminClient = null;
const authContextCache = new Map();
const AUTH_CONTEXT_CACHE_TTL_MS = 30 * 1000;

export function sendJson(response, statusCode, payload) {
  response.status(statusCode).json(payload);
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("supabase_admin_not_configured");
  }
  if (!adminClient) {
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return adminClient;
}

export async function readJsonBody(request) {
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8") || "{}");
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

export function getBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function getJwtExpiresAt(token = "") {
  const parts = String(token).split(".");
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const exp = Number(payload?.exp ?? 0);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function getAuthContextCacheKey(token = "", profileSelect = "", allowMissingProfile = false) {
  return `${allowMissingProfile ? "allow-missing" : "require-profile"}\n${profileSelect}\n${token}`;
}

function readAuthContextCache(token = "", profileSelect = "", allowMissingProfile = false) {
  const key = getAuthContextCacheKey(token, profileSelect, allowMissingProfile);
  const cached = authContextCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    authContextCache.delete(key);
    return null;
  }
  return cached.context;
}

function writeAuthContextCache(token = "", profileSelect = "", allowMissingProfile = false, context = {}) {
  const jwtExpiresAt = getJwtExpiresAt(token);
  const expiresAt = Math.min(Date.now() + AUTH_CONTEXT_CACHE_TTL_MS, jwtExpiresAt || Date.now() + AUTH_CONTEXT_CACHE_TTL_MS);
  if (expiresAt <= Date.now()) return;
  const key = getAuthContextCacheKey(token, profileSelect, allowMissingProfile);
  authContextCache.set(key, { expiresAt, context });
  if (authContextCache.size > 100) {
    const now = Date.now();
    for (const [cacheKey, value] of authContextCache) {
      if (value.expiresAt <= now || authContextCache.size > 100) authContextCache.delete(cacheKey);
    }
  }
}

export function mergeById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  return [...merged.values()];
}

export function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getEnvList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isActiveAppointment(appointment = {}, nowMs = Date.now()) {
  if (appointment.status && !["active", "approved"].includes(appointment.status)) return false;
  const startsAt = appointment.starts_at ? new Date(appointment.starts_at).getTime() : 0;
  const endsAt = appointment.ends_at ? new Date(appointment.ends_at).getTime() : 0;
  return (!startsAt || startsAt <= nowMs) && (!endsAt || endsAt >= nowMs);
}

export async function getAuthenticatedContext(request, options = {}) {
  const allowMissingProfile = Boolean(options.allowMissingProfile);
  const profileSelect = options.profileSelect || "id, auth_user_id";
  const supabase = getSupabaseAdminClient();
  const token = getBearerToken(request);
  if (!token) {
    const error = new Error("missing_bearer_token");
    error.statusCode = 401;
    throw error;
  }

  const cachedContext = readAuthContextCache(token, profileSelect, allowMissingProfile);
  if (cachedContext) return { ...cachedContext, supabase };

  // RANKBALL_AUTH_CLEANUP: legacy test-token auth removed. Test accounts must be Supabase Auth users.
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    const error = new Error("invalid_bearer_token");
    error.statusCode = 401;
    throw error;
  }

  const authUserId = userData.user.id;
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(profileSelect)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile?.id) {
    if (allowMissingProfile) {
      const context = {
        supabase,
        authUser: userData.user,
        authUserId,
        profileId: null,
        isProfileMissing: true,
      };
      writeAuthContextCache(token, profileSelect, allowMissingProfile, context);
      return context;
    }
    const error = new Error("profile_not_found");
    error.statusCode = 403;
    throw error;
  }

  const context = {
    supabase,
    authUser: userData.user,
    authUserId,
    profileId: profile.id,
    profile,
  };
  writeAuthContextCache(token, profileSelect, allowMissingProfile, context);
  return context;
}

export async function getAdminLevel(context) {
  if (getEnvList("RANKBALL_OWNER_AUTH_USER_IDS").includes(context.authUserId)) return 100;
  if (getEnvList("RANKBALL_OWNER_PROFILE_IDS").includes(context.profileId)) return 100;

  const { data: rpcLevel, error: rpcError } = await context.supabase.rpc("rankball_admin_level_for_profile", {
    actor_profile_id: context.profileId,
    override_level: 0,
  });
  const rpcAdminLevel = !rpcError && Number.isFinite(Number(rpcLevel)) ? Number(rpcLevel) : 0;
  if (rpcAdminLevel >= 30) return rpcAdminLevel;

  const { data, error } = await context.supabase
    .from("admin_appointments")
    .select("grade, status, starts_at, ends_at")
    .eq("user_id", context.profileId)
    .eq("role", "admin");

  if (error) throw error;

  return (data ?? [])
    .filter(isActiveAppointment)
    .reduce((level, appointment) => Math.max(level, ADMIN_GRADE_LEVELS[appointment.grade] ?? 0), rpcAdminLevel);
}
