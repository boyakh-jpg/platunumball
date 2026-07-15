import { createClient } from "@supabase/supabase-js";
import { fromRemoteProfile } from "../../src/data/profileMappers.js";
import {
  PROFILE_CARD_COLUMNS,
  TEAM_COLUMNS,
  TEAM_MEMBER_COLUMNS,
  TOURNAMENT_COLUMNS,
  TOURNAMENT_TEAM_COLUMNS,
} from "../../src/data/repositoryColumns.js";
import { fromRemoteTournament } from "../../src/data/tournamentMappers.js";

const ADMIN_GRADE_LEVELS = {
  owner: 100,
  senior: 80,
  regionManager: 60,
  matchManager: 50,
  support: 30,
};

let adminClient = null;
const authUserCache = new Map();
const authContextCache = new Map();
const adminLevelCache = new Map();
const AUTH_CONTEXT_CACHE_TTL_MS = 30 * 1000;
const RELATED_TOURNAMENT_LIMIT = 40;

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

function canCacheProfileContext(profileSelect = "") {
  const columns = String(profileSelect)
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  return columns.length > 0 && columns.every((column) => ["id", "auth_user_id"].includes(column));
}

function readAuthUserCache(token = "") {
  const cached = authUserCache.get(token);
  if (!cached || cached.expiresAt <= Date.now()) {
    authUserCache.delete(token);
    return null;
  }
  return cached.user;
}

function writeAuthUserCache(token = "", user = null) {
  if (!token || !user?.id) return;
  const jwtExpiresAt = getJwtExpiresAt(token);
  const expiresAt = Math.min(Date.now() + AUTH_CONTEXT_CACHE_TTL_MS, jwtExpiresAt || Date.now() + AUTH_CONTEXT_CACHE_TTL_MS);
  if (expiresAt <= Date.now()) return;
  authUserCache.set(token, { expiresAt, user });
  if (authUserCache.size > 100) {
    const now = Date.now();
    for (const [cacheKey, value] of authUserCache) {
      if (value.expiresAt <= now || authUserCache.size > 100) authUserCache.delete(cacheKey);
    }
  }
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

function getAdminLevelCacheKey(context = {}) {
  return `${context.authUserId || ""}\n${context.profileId || ""}`;
}

function readAdminLevelCache(context = {}) {
  const key = getAdminLevelCacheKey(context);
  const cached = adminLevelCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    adminLevelCache.delete(key);
    return null;
  }
  return cached.level;
}

function writeAdminLevelCache(context = {}, level = 0) {
  const key = getAdminLevelCacheKey(context);
  if (!key.trim()) return;
  adminLevelCache.set(key, { expiresAt: Date.now() + AUTH_CONTEXT_CACHE_TTL_MS, level });
  if (adminLevelCache.size > 100) {
    const now = Date.now();
    for (const [cacheKey, value] of adminLevelCache) {
      if (value.expiresAt <= now || adminLevelCache.size > 100) adminLevelCache.delete(cacheKey);
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

export function isMissingTable(error = {}, table = "") {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || (table && message.includes(table));
}

export function isMissingUserRoomFeed(error = {}) {
  return isMissingTable(error, "user_room_feed");
}

export function isMissingRoomFeedCards(error = {}) {
  return isMissingTable(error, "room_feed_cards");
}

export function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function uniqueStringIds(ids = []) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

export function flattenIdValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenIdValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenIdValues);
  return value ? [String(value)] : [];
}

export function groupRowsBy(rows = [], key = "id") {
  return rows.reduce((map, row) => {
    const value = row?.[key];
    if (!value) return map;
    const list = map.get(value) ?? [];
    list.push(row);
    map.set(value, list);
    return map;
  }, new Map());
}

export function firstRowBy(rows = [], key = "id") {
  return Object.fromEntries((rows ?? []).filter((row) => row?.[key]).map((row) => [row[key], row]));
}

export function getRowsMaxUpdatedAt(rows = []) {
  return rows.reduce((max, row) => {
    const time = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
    return Number.isFinite(time) ? Math.max(max, time) : max;
  }, 0);
}

export async function timeStep(timing, key, callback) {
  const startedAt = Date.now();
  try {
    return await callback();
  } finally {
    if (timing) timing[key] = (timing[key] ?? 0) + Date.now() - startedAt;
  }
}

export function toDateTime(date, time, fallback) {
  if (date && time) return `${date} ${String(time).slice(0, 5)}`;
  if (date) return date;
  return fallback ?? "\uBBF8\uC815";
}

export function toDbTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

export function getDatePart(value) {
  return String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export function getTimePart(value) {
  return String(value ?? "").match(/\d{2}:\d{2}/)?.[0] ?? "";
}

export function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function toClientTeamWithMembers(team = {}, memberRows = []) {
  return {
    id: team.id,
    name: team.name,
    homeCourt: team.home_court,
    region: team.region,
    mmr: team.mmr ?? 1200,
    wins: team.wins ?? 0,
    losses: team.losses ?? 0,
    accent: team.accent,
    createdAt: team.created_at ?? null,
    updatedAt: team.updated_at ?? team.created_at ?? null,
    members: [...memberRows]
      .sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.user_id).localeCompare(String(b.user_id)))
      .map((member) => ({ userId: member.user_id, role: member.role ?? "regular" })),
  };
}

export async function loadCurrentUserTournamentIndex(client, profileId = "") {
  if (!profileId) return { users: [], teams: [], tournaments: [] };

  const { data: ownMembershipRows, error: ownMembershipError } = await client
    .from("team_members")
    .select(TEAM_MEMBER_COLUMNS)
    .eq("user_id", profileId);
  if (ownMembershipError) throw ownMembershipError;

  const ownTeamIds = uniqueValues((ownMembershipRows ?? []).map((row) => row.team_id));
  const { data: relatedTeamRows, error: relatedTeamError } = ownTeamIds.length
    ? await client
      .from("tournament_teams")
      .select(TOURNAMENT_TEAM_COLUMNS)
      .in("team_id", ownTeamIds)
    : { data: [], error: null };
  if (relatedTeamError) throw relatedTeamError;

  const relatedTournamentIds = uniqueValues((relatedTeamRows ?? []).map((row) => row.tournament_id));
  const [createdResult, relatedResult] = await Promise.all([
    client
      .from("tournaments")
      .select(TOURNAMENT_COLUMNS)
      .eq("created_by", profileId)
      .order("updated_at", { ascending: false })
      .limit(RELATED_TOURNAMENT_LIMIT),
    relatedTournamentIds.length
      ? client.from("tournaments").select(TOURNAMENT_COLUMNS).in("id", relatedTournamentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (createdResult.error) throw createdResult.error;
  if (relatedResult.error) throw relatedResult.error;

  const tournamentRows = mergeById(createdResult.data ?? [], relatedResult.data ?? [])
    .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")))
    .slice(0, RELATED_TOURNAMENT_LIMIT);
  const tournamentIds = tournamentRows.map((row) => row.id).filter(Boolean);
  if (!tournamentIds.length) return { users: [], teams: [], tournaments: [] };

  const { data: tournamentTeamRows, error: tournamentTeamError } = await client
    .from("tournament_teams")
    .select(TOURNAMENT_TEAM_COLUMNS)
    .in("tournament_id", tournamentIds);
  if (tournamentTeamError) throw tournamentTeamError;

  const tournamentTeamIds = uniqueValues((tournamentTeamRows ?? []).map((row) => row.team_id));
  const [{ data: teamRows, error: teamError }, { data: captainRows, error: captainError }] = tournamentTeamIds.length
    ? await Promise.all([
      client.from("teams").select(TEAM_COLUMNS).in("id", tournamentTeamIds).is("deleted_at", null),
      client.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", tournamentTeamIds).eq("role", "captain"),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (teamError) throw teamError;
  if (captainError) throw captainError;

  const memberByKey = new Map();
  [...(captainRows ?? []), ...(ownMembershipRows ?? [])]
    .filter((row) => tournamentTeamIds.includes(row.team_id))
    .forEach((row) => memberByKey.set(`${row.team_id}:${row.user_id}`, row));
  const memberRows = [...memberByKey.values()];

  const profileIds = uniqueValues(memberRows.map((row) => row.user_id));
  const { data: profileRows, error: profileError } = profileIds.length
    ? await client.from("profiles").select(PROFILE_CARD_COLUMNS).in("id", profileIds)
    : { data: [], error: null };
  if (profileError) throw profileError;

  const membersByTeam = groupRowsBy(memberRows, "team_id");
  const tournamentTeamsByTournament = groupRowsBy(tournamentTeamRows ?? [], "tournament_id");
  return {
    users: (profileRows ?? []).map(fromRemoteProfile),
    teams: (teamRows ?? []).map((team) => ({
      ...toClientTeamWithMembers(team, membersByTeam.get(team.id) ?? []),
      membersPartial: true,
    })),
    tournaments: tournamentRows.map((tournament) => fromRemoteTournament(tournament, { tournamentTeamsByTournament })),
  };
}

export function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function pickNotificationValue(value, fallback, coalesce = "falsy") {
  return coalesce === "nullish" ? (value ?? fallback) : (value || fallback);
}

export function toNotificationRows(notifications = [], profileId = "", options = {}) {
  const coalesce = options.coalesce === "nullish" ? "nullish" : "falsy";
  const filterToProfile = options.filterToProfile === true;
  const getUpdatedAt = typeof options.getUpdatedAt === "function"
    ? options.getUpdatedAt
    : (notification) => (
        pickNotificationValue(
          pickNotificationValue(notification.updatedAt, notification.createdAt, coalesce),
          new Date().toISOString(),
          coalesce,
        )
      );
  return toArray(notifications).map((notification) => {
    const explicitTargetUserId = pickNotificationValue(notification.targetUserId, null, coalesce);
    const targetUserId = pickNotificationValue(notification.targetUserId, profileId, coalesce);
    if (filterToProfile && targetUserId !== profileId) return null;
    return {
      id: notification.id,
      user_id: filterToProfile ? profileId : targetUserId,
      target_user_id: filterToProfile ? targetUserId : explicitTargetUserId,
      title: pickNotificationValue(notification.title, options.defaultTitle ?? "알림", coalesce),
      body: pickNotificationValue(notification.body, "", coalesce),
      tone: pickNotificationValue(notification.tone, options.defaultTone ?? "match", coalesce),
      type: pickNotificationValue(notification.type, options.defaultType ?? null, coalesce),
      match_id: pickNotificationValue(notification.matchId, null, coalesce),
      recruiting_post_id: pickNotificationValue(notification.recruitingPostId, null, coalesce),
      invitation_id: pickNotificationValue(notification.invitationId, null, coalesce),
      discord_event: pickNotificationValue(
        pickNotificationValue(notification.discordEvent, notification.eventType, coalesce),
        null,
        coalesce,
      ),
      read_at: pickNotificationValue(notification.readAt, null, coalesce),
      payload: notification,
      created_at: pickNotificationValue(notification.createdAt, new Date().toISOString(), coalesce),
      updated_at: getUpdatedAt(notification),
    };
  }).filter((row) => row?.id);
}

export async function fetchCourtRowsByIds(supabase, courtIds = [], columns = "*") {
  const ids = uniqueStringIds(courtIds);
  if (!ids.length) return { data: [], error: null };
  const [legacyResult, approvedResult] = await Promise.all([
    supabase.from("courts").select(columns).in("id", ids),
    supabase.from("approved_courts").select(columns).in("id", ids).or("status.is.null,status.eq.active"),
  ]);
  if (legacyResult.error && !isMissingTable(legacyResult.error, "courts")) return legacyResult;
  if (approvedResult.error) return approvedResult;
  const rowsById = new Map();
  (approvedResult.data ?? []).forEach((row) => rowsById.set(row.id, row));
  (legacyResult.data ?? []).forEach((row) => rowsById.set(row.id, row));
  return { data: [...rowsById.values()], error: null };
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

  const cacheProfileContext = canCacheProfileContext(profileSelect);
  const cachedContext = cacheProfileContext
    ? readAuthContextCache(token, profileSelect, allowMissingProfile)
    : null;
  if (cachedContext) return { ...cachedContext, supabase };

  // Test accounts use the same Supabase Auth JWT path as production accounts.
  let authUser = readAuthUserCache(token);
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
    profileId: profile.id,
    profile,
  };
  if (cacheProfileContext) writeAuthContextCache(token, profileSelect, allowMissingProfile, context);
  return context;
}

export async function getAdminLevel(context) {
  const cachedLevel = readAdminLevelCache(context);
  if (cachedLevel !== null) return cachedLevel;
  if (getEnvList("RANKBALL_OWNER_AUTH_USER_IDS").includes(context.authUserId)) {
    writeAdminLevelCache(context, 100);
    return 100;
  }
  if (getEnvList("RANKBALL_OWNER_PROFILE_IDS").includes(context.profileId)) {
    writeAdminLevelCache(context, 100);
    return 100;
  }

  const { data: rpcLevel, error: rpcError } = await context.supabase.rpc("rankball_admin_level_for_profile", {
    actor_profile_id: context.profileId,
    override_level: 0,
  });
  const rpcAdminLevel = !rpcError && Number.isFinite(Number(rpcLevel)) ? Number(rpcLevel) : 0;
  if (rpcAdminLevel >= 30) {
    writeAdminLevelCache(context, rpcAdminLevel);
    return rpcAdminLevel;
  }

  const { data, error } = await context.supabase
    .from("admin_appointments")
    .select("grade, status, starts_at, ends_at")
    .eq("user_id", context.profileId)
    .eq("role", "admin");

  if (error) throw error;

  const level = (data ?? [])
    .filter(isActiveAppointment)
    .reduce((level, appointment) => Math.max(level, ADMIN_GRADE_LEVELS[appointment.grade] ?? 0), rpcAdminLevel);
  writeAdminLevelCache(context, level);
  return level;
}
