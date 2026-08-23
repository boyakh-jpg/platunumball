import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getStrictBearerToken } from "./_requestSecurity.js";

export let adminClient = null;

export const authUserCache = new Map();

export const authContextCache = new Map();

export const AUTH_CONTEXT_CACHE_TTL_MS = 30 * 1000;

export function getSupabaseUrl() {
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

export function getBearerToken(request) {
  return getStrictBearerToken(request);
}

export function getJwtPayload(token = "") {
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function getJwtExpiresAt(token = "") {
  const exp = Number(getJwtPayload(token)?.exp ?? 0);
  return Number.isFinite(exp) ? exp * 1000 : 0;
}

export function getTokenCacheKey(token = "") {
  return token ? createHash("sha256").update(token).digest("base64url") : "";
}

export function getAuthContextCacheKey(token = "", profileSelect = "", allowMissingProfile = false) {
  return `${allowMissingProfile ? "allow-missing" : "require-profile"}\n${profileSelect}\n${getTokenCacheKey(token)}`;
}

export function canCacheProfileContext(profileSelect = "") {
  const columns = String(profileSelect)
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  return columns.length > 0 && columns.every((column) => ["id", "auth_user_id"].includes(column));
}

export function readAuthUserCache(token = "") {
  const key = getTokenCacheKey(token);
  const cached = authUserCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    authUserCache.delete(key);
    return null;
  }
  return cached.user;
}

export function writeAuthUserCache(token = "", user = null) {
  if (!token || !user?.id) return;
  const jwtExpiresAt = getJwtExpiresAt(token);
  const expiresAt = Math.min(Date.now() + AUTH_CONTEXT_CACHE_TTL_MS, jwtExpiresAt || Date.now() + AUTH_CONTEXT_CACHE_TTL_MS);
  if (expiresAt <= Date.now()) return;
  authUserCache.set(getTokenCacheKey(token), { expiresAt, user });
  if (authUserCache.size > 100) {
    const now = Date.now();
    for (const [cacheKey, value] of authUserCache) {
      if (value.expiresAt <= now || authUserCache.size > 100) authUserCache.delete(cacheKey);
    }
  }
}

export function readAuthContextCache(token = "", profileSelect = "", allowMissingProfile = false) {
  const key = getAuthContextCacheKey(token, profileSelect, allowMissingProfile);
  const cached = authContextCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    authContextCache.delete(key);
    return null;
  }
  return cached.context;
}

export function writeAuthContextCache(token = "", profileSelect = "", allowMissingProfile = false, context = {}) {
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

export async function getAuthenticatedContext(request, options = {}) {
  const allowMissingProfile = Boolean(options.allowMissingProfile);
  const freshAuth = options.freshAuth === true;
  const profileSelect = options.profileSelect || "id, auth_user_id";
  const supabase = getSupabaseAdminClient();
  const token = getBearerToken(request);
  if (!token) {
    const error = new Error("missing_bearer_token");
    error.statusCode = 401;
    throw error;
  }

  const cacheProfileContext = canCacheProfileContext(profileSelect);
  const cachedContext = !freshAuth && cacheProfileContext
    ? readAuthContextCache(token, profileSelect, allowMissingProfile)
    : null;
  if (cachedContext) return { ...cachedContext, supabase };

  // Test accounts use the same Supabase Auth JWT path as production accounts.
  let authUser = freshAuth ? null : readAuthUserCache(token);
  if (!authUser) {
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      const error = new Error("invalid_bearer_token");
      error.statusCode = 401;
      throw error;
    }
    authUser = userData.user;
    writeAuthUserCache(token, authUser);
  }

  const authUserId = authUser.id;
  const accessTokenClaims = getJwtPayload(token) ?? {};
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
        authUser,
        authUserId,
        accessTokenClaims,
        profileId: null,
        isProfileMissing: true,
      };
      if (cacheProfileContext) writeAuthContextCache(token, profileSelect, allowMissingProfile, context);
      return context;
    }
    const error = new Error("profile_not_found");
    error.statusCode = 403;
    throw error;
  }

  const context = {
    supabase,
    authUser,
    authUserId,
    accessTokenClaims,
    profileId: profile.id,
    profile,
  };
  if (cacheProfileContext) writeAuthContextCache(token, profileSelect, allowMissingProfile, context);
  return context;
}
