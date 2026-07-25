import { createHash, timingSafeEqual } from "node:crypto";
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
import { getNotificationActorId, isTerminalMatchStatus, isTerminalRecruitingStatus } from "../../src/lib/notifications.js";
import { DEFAULT_RATING } from "../../src/lib/constants.js";
import { assertSafeInputPayload } from "../../src/lib/inputSecurity.js";
import { getStrictBearerToken, setApiSecurityHeaders } from "./_requestSecurity.js";

export { getDatePart, getTimePart, toDbTime } from "../../src/data/scheduleUtils.js";

const IMMEDIATE_NOTIFICATION_DUE_AT = "1970-01-01T00:00:00.000Z";
const MAX_API_JSON_BODY_BYTES = 1_000_000;

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
const AUTH_CONTEXT_CACHE_TTL_MS = 30 * 1000;
const RELATED_TOURNAMENT_LIMIT = 40;

export function sendJson(response, statusCode, payload) {
  setApiSecurityHeaders(response);
  if (statusCode === 401) response.setHeader?.("WWW-Authenticate", "Bearer");
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

function createBodyError(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function parseJsonBody(raw = "") {
  if (Buffer.byteLength(raw, "utf8") > MAX_API_JSON_BODY_BYTES) throw createBodyError("request_body_too_large", 413);
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw createBodyError("invalid_json_body", 400);
  }
}

function validateJsonBody(body) {
  assertSafeInputPayload(body, { path: "$body" });
  return body;
}

export async function readJsonBody(request) {
  if (Buffer.isBuffer(request.body)) return validateJsonBody(parseJsonBody(request.body.toString("utf8")));
  if (request.body && typeof request.body === "object") return validateJsonBody(request.body);
  if (typeof request.body === "string") return validateJsonBody(parseJsonBody(request.body));

  const chunks = [];
  let bodyBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bodyBytes += buffer.length;
    if (bodyBytes > MAX_API_JSON_BODY_BYTES) throw createBodyError("request_body_too_large", 413);
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return validateJsonBody(parseJsonBody(raw));
}

export function getBearerToken(request) {
  return getStrictBearerToken(request);
}

export function bearerTokenMatches(request, expectedToken = "") {
  const token = getStrictBearerToken(request);
  const expected = String(expectedToken || "");
  if (!token || !expected) return false;
  const tokenDigest = createHash("sha256").update(token).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(tokenDigest, expectedDigest);
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

function getTokenCacheKey(token = "") {
  return token ? createHash("sha256").update(token).digest("base64url") : "";
}

function getAuthContextCacheKey(token = "", profileSelect = "", allowMissingProfile = false) {
  return `${allowMissingProfile ? "allow-missing" : "require-profile"}\n${profileSelect}\n${getTokenCacheKey(token)}`;
}

function canCacheProfileContext(profileSelect = "") {
  const columns = String(profileSelect)
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  return columns.length > 0 && columns.every((column) => ["id", "auth_user_id"].includes(column));
}

function readAuthUserCache(token = "") {
  const key = getTokenCacheKey(token);
  const cached = authUserCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    authUserCache.delete(key);
    return null;
  }
  return cached.user;
}

function writeAuthUserCache(token = "", user = null) {
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
    mmr: team.mmr ?? DEFAULT_RATING,
    wins: team.wins ?? 0,
    losses: team.losses ?? 0,
    accent: team.accent,
    emblemKey: team.emblem_key ?? null,
    emblemSource: team.emblem_source ?? (team.emblem_key ? "upload" : "initial"),
    emblemUpdatedAt: team.emblem_updated_at ?? null,
    emblemUploadedAt: team.emblem_uploaded_at ?? null,
    emblemUploadCount: Number(team.emblem_upload_count ?? 0),
    emblemColor: team.emblem_color ?? team.accent ?? null,
    emblemBorderEnabled: team.emblem_border_enabled !== false,
    emblemBorderColor: team.emblem_border_color ?? team.accent ?? null,
    emblemTextMode: new Set(["name", "abbreviation"]).has(team.emblem_text_mode) ? team.emblem_text_mode : "initial",
    emblemAbbreviation: team.emblem_abbreviation ?? "",
    emblemFont: team.emblem_font ?? "sport",
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
  const [createdResult, relatedResult, refereeResult] = await Promise.all([
    client
      .from("tournaments")
      .select(TOURNAMENT_COLUMNS)
      .eq("created_by", profileId)
      .order("updated_at", { ascending: false })
      .limit(RELATED_TOURNAMENT_LIMIT),
    relatedTournamentIds.length
      ? client.from("tournaments").select(TOURNAMENT_COLUMNS).in("id", relatedTournamentIds)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("tournaments")
      .select(TOURNAMENT_COLUMNS)
      .contains("referee_ids", [profileId])
      .order("updated_at", { ascending: false })
      .limit(RELATED_TOURNAMENT_LIMIT),
  ]);
  if (createdResult.error) throw createdResult.error;
  if (relatedResult.error) throw relatedResult.error;
  if (refereeResult.error) throw refereeResult.error;

  const tournamentRows = mergeById(
    mergeById(createdResult.data ?? [], relatedResult.data ?? []),
    refereeResult.data ?? [],
  )
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

  const profileIds = uniqueValues([
    ...memberRows.map((row) => row.user_id),
    ...tournamentRows.flatMap((row) => row.referee_ids ?? []),
    ...tournamentRows.map((row) => row.sanction_reviewed_by),
  ]);
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

export async function attachNotificationActors(supabase, notifications = []) {
  const rows = toArray(notifications);
  const missingActorRows = rows.filter((notification) => !getNotificationActorId(notification));
  if (!missingActorRows.length) return rows;

  const invitationIds = uniqueStringIds(missingActorRows.flatMap((notification) => [
    notification.invitationId,
    notification.teamInvitationId,
    notification.payload?.invitationId,
    notification.payload?.teamInvitationId,
  ]));
  const recruitingPostIds = uniqueStringIds(missingActorRows.flatMap((notification) => [
    notification.recruitingPostId,
    notification.payload?.recruitingPostId,
  ]));
  const tournamentIds = uniqueStringIds(missingActorRows.flatMap((notification) => [
    notification.tournamentId,
    notification.payload?.tournamentId,
  ]));

  const [teamInvitationResult, recruitingResult, tournamentResult] = await Promise.all([
    invitationIds.length
      ? supabase.from("team_invitations").select("id,from_user_id").in("id", invitationIds)
      : Promise.resolve({ data: [], error: null }),
    recruitingPostIds.length
      ? supabase.from("recruiting_posts").select("id,room_state").in("id", recruitingPostIds)
      : Promise.resolve({ data: [], error: null }),
    tournamentIds.length
      ? supabase.from("tournaments").select("id,created_by").in("id", tournamentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (teamInvitationResult.error && !isMissingTable(teamInvitationResult.error, "team_invitations")) throw teamInvitationResult.error;
  if (recruitingResult.error && !isMissingTable(recruitingResult.error, "recruiting_posts")) throw recruitingResult.error;
  if (tournamentResult.error && !isMissingTable(tournamentResult.error, "tournaments")) throw tournamentResult.error;

  const teamActorByInvitationId = new Map((teamInvitationResult.data ?? []).map((row) => [row.id, row.from_user_id]));
  const recruitingRoomById = new Map((recruitingResult.data ?? []).map((row) => [row.id, row.room_state ?? {}]));
  const tournamentActorById = new Map((tournamentResult.data ?? []).map((row) => [row.id, row.created_by]));

  return rows.map((notification) => {
    if (getNotificationActorId(notification)) return notification;
    const invitationId = notification.invitationId || notification.teamInvitationId || notification.payload?.invitationId || notification.payload?.teamInvitationId || "";
    const recruitingPostId = notification.recruitingPostId || notification.payload?.recruitingPostId || "";
    const roomState = recruitingRoomById.get(recruitingPostId) ?? {};
    const roomInvitation = toArray(roomState.invitations).find((invitation) => invitation.id === invitationId);
    const tournamentId = notification.tournamentId || notification.payload?.tournamentId || "";
    const fromUserId = teamActorByInvitationId.get(invitationId)
      || roomInvitation?.fromUserId
      || roomState.ownerId
      || tournamentActorById.get(tournamentId)
      || "";
    return fromUserId ? { ...notification, fromUserId } : notification;
  });
}

export async function attachNotificationTargetState(supabase, notifications = []) {
  const rows = toArray(notifications);
  const matchIds = uniqueStringIds(rows.map((notification) => notification.matchId));
  const recruitingPostIds = uniqueStringIds(rows
    .filter((notification) => !notification.matchId)
    .map((notification) => notification.recruitingPostId));

  const [matchResult, recruitingResult] = await Promise.all([
    matchIds.length
      ? supabase.from("matches").select("id,status").in("id", matchIds)
      : Promise.resolve({ data: [], error: null }),
    recruitingPostIds.length
      ? supabase.from("recruiting_posts").select("id,status,room_state").in("id", recruitingPostIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (matchResult.error && !isMissingTable(matchResult.error, "matches")) throw matchResult.error;
  if (recruitingResult.error && !isMissingTable(recruitingResult.error, "recruiting_posts")) throw recruitingResult.error;

  const matchStatusById = new Map((matchResult.data ?? []).map((row) => [row.id, row.status]));
  const recruitingStatusById = new Map((recruitingResult.data ?? []).map((row) => [
    row.id,
    row.status ?? row.room_state?.status,
  ]));

  return rows.map((notification) => {
    const targetType = notification.matchId ? "match" : notification.recruitingPostId ? "recruiting" : "";
    if (!targetType) return notification;
    const targetId = notification.matchId || notification.recruitingPostId;
    const statusById = targetType === "match" ? matchStatusById : recruitingStatusById;
    const targetStatus = String(statusById.get(targetId) ?? (statusById.has(targetId) ? "" : "missing"));
    const targetUnavailable = targetStatus === "missing" || (
      targetType === "match"
        ? isTerminalMatchStatus(targetStatus)
        : isTerminalRecruitingStatus(targetStatus)
    );
    return { ...notification, targetStatus, targetUnavailable };
  });
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
    const createdAt = pickNotificationValue(notification.createdAt, new Date().toISOString(), coalesce);
    const dueAt = pickNotificationValue(
      pickNotificationValue(notification.sendAt, notification.dueAt, coalesce),
      IMMEDIATE_NOTIFICATION_DUE_AT,
      coalesce,
    );
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
      due_at: dueAt,
      payload: notification,
      created_at: createdAt,
      updated_at: getUpdatedAt(notification),
    };
  }).filter((row) => row?.id);
}

export async function fetchCourtRowsByIds(supabase, courtIds = [], columns = "*", options = {}) {
  const ids = uniqueStringIds(courtIds);
  if (!ids.length) return { data: [], error: null };
  const approvedBaseColumns = options.approvedColumns ?? columns;
  const approvedColumns = approvedBaseColumns === "*" || String(approvedBaseColumns).split(",").some((column) => column.trim() === "status")
    ? approvedBaseColumns
    : `${approvedBaseColumns},status`;
  const [legacyResult, approvedResult] = await Promise.all([
    supabase.from("courts").select(columns).in("id", ids),
    supabase.from("approved_courts").select(approvedColumns).in("id", ids),
  ]);
  if (legacyResult.error && !isMissingTable(legacyResult.error, "courts")) return legacyResult;
  if (approvedResult.error) return approvedResult;
  const rowsById = new Map();
  const approvedIds = new Set((approvedResult.data ?? []).map((row) => row.id));
  (legacyResult.data ?? []).forEach((row) => {
    if (!approvedIds.has(row.id)) rowsById.set(row.id, row);
  });
  (approvedResult.data ?? []).forEach((row) => {
    if (row.status == null || row.status === "active") rowsById.set(row.id, row);
  });
  return { data: [...rowsById.values()], error: null };
}

export function isActiveAdminAppointment(appointment = {}, nowMs = Date.now()) {
  if (appointment.status !== "active") return false;
  const startsAt = appointment.starts_at ? new Date(appointment.starts_at).getTime() : null;
  const endsAt = appointment.ends_at ? new Date(appointment.ends_at).getTime() : null;
  if (startsAt !== null && !Number.isFinite(startsAt)) return false;
  if (endsAt !== null && !Number.isFinite(endsAt)) return false;
  return (startsAt === null || startsAt <= nowMs) && (endsAt === null || endsAt >= nowMs);
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
  if (!context?.profileId || !context?.supabase) return 0;

  const { data, error } = await context.supabase.rpc("rankball_admin_level_for_profile", {
    actor_profile_id: context.profileId,
    override_level: 0,
  });

  if (error) throw error;
  return Math.max(0, Number(data ?? 0) || 0);
}

export function assertAdminLevel(adminLevel = 0, minimumLevel = 30) {
  if (Number(adminLevel) >= Number(minimumLevel)) return;
  const error = new Error("admin_required");
  error.statusCode = 403;
  throw error;
}

export async function requireAdminContext(request, options = {}) {
  const minimumLevel = Number(options.minimumLevel ?? 30);
  const context = await getAuthenticatedContext(request, {
    ...options,
    freshAuth: true,
  });
  const adminLevel = await getAdminLevel(context);
  assertAdminLevel(adminLevel, minimumLevel);
  return { ...context, adminLevel };
}
