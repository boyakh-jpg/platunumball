import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import homeLoadHandler from "../server/api/home/load.js";
import loadStateHandler from "../server/api/state/load.js";
import syncRecruitingPostHandler from "../server/api/recruiting/sync-post.js";
import recruitingListHandler from "../server/api/recruiting/list.js";
import discordRoomChatHandler from "../server/api/discord/room-chat.js";
import syncMatchHandler, { queueMatchDiscordDeliveries } from "../server/api/matches/sync-match.js";
import matchDetailHandler from "../server/api/matches/detail.js";
import syncTournamentHandler from "../server/api/tournaments/sync-tournament.js";
import refereeSyncHandler from "../server/api/referee/sync.js";
import teamsListHandler from "../server/api/teams/list.js";
import maintenanceHandler from "../server/api/system/maintenance.js";
import { gradeRefereeExamByQuestionIds } from "../src/lib/refereeExamBank.js";
import {
  getRecorderHandoffPatch,
  withEffectiveMatchStatRecorders,
} from "../src/lib/matchUtils.js";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...valueParts] = line.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env.production");

const baseUrlArg = process.argv.find((arg) => arg.startsWith("--base-url="));
const remoteBaseUrl = (baseUrlArg ? baseUrlArg.slice("--base-url=".length) : process.env.RANKBALL_SIM_BASE_URL || "").replace(/\/+$/, "");
const usesRemoteApi = Boolean(remoteBaseUrl);
const secretArg = process.argv.find((arg) => arg.startsWith("--secret="));
const schemaHealthSecret = secretArg ? secretArg.slice("--secret=".length) : process.env.RANKBALL_SIM_SECRET || process.env.CRON_SECRET || "";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const testAuthPassword = process.env.RANKBALL_TEST_PASSWORD || process.env.VITE_TEST_AUTH_PASSWORD || "test-0000";
const testAuthEmailDomain = process.env.RANKBALL_TEST_AUTH_EMAIL_DOMAIN || process.env.VITE_TEST_AUTH_EMAIL_DOMAIN || "rankball.test";
const requestTimeoutMs = Number(process.env.RANKBALL_SIM_TIMEOUT_MS || 20000);
const ensureRemoteTestActors = process.env.RANKBALL_SIM_ENSURE_TEST_ACTORS === "1" || process.env.RANKBALL_SIM_ENSURE_TEST_ACTORS === "true";
const fullSimulation = process.argv.includes("--full") || process.env.RANKBALL_SIM_FULL === "1" || process.env.RANKBALL_SIM_FULL === "true";
const remoteSmokeOnly = usesRemoteApi && !fullSimulation;

if (!url || !publishableKey || (!usesRemoteApi && !serviceRoleKey)) {
  const missing = [
    url ? "" : "SUPABASE_URL/VITE_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL",
    publishableKey ? "" : "VITE_SUPABASE_PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY",
    usesRemoteApi || serviceRoleKey ? "" : "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const supabase = url && serviceRoleKey
  ? createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

const authClient = createClient(url, publishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const keepRows = process.argv.includes("--keep") || process.env.RANKBALL_SIM_KEEP === "1";
const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const scenarioIds = [];
const temporaryProfileDiscordSnapshots = new Map();
const refereeSimulationAttemptIds = new Set();
const refereeSimulationRequestIds = new Set();
const profileRatingSnapshots = new Map();
const teamRatingSnapshots = new Map();
const MATCH_SCHEDULED_NOTICE_PREFIXES = [
  "match-reminder-24h",
  "match-reminder-2h",
  "match-reminder-1h",
  "match-manager-checkin-10m",
  "match-manager-start-now",
];
const MATCH_POSTGAME_NOTICE_PREFIXES = [
  "match-ended-score",
  "match-dispute-check",
];
const MATCH_CANCEL_NOTICE_PREFIXES = [
  ...MATCH_SCHEDULED_NOTICE_PREFIXES,
  "match-started",
  ...MATCH_POSTGAME_NOTICE_PREFIXES,
];

function makeScenarioIds(label) {
  const safeLabel = String(label || "scenario").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
  const nextIds = {
    label: safeLabel,
    postId: `sim_q_${safeLabel}_${suffix}`,
    matchId: `sim_m_${safeLabel}_${suffix}`,
    matchIds: [],
    tournamentId: `sim_trn_${safeLabel}_${suffix}`,
  };
  scenarioIds.push(nextIds);
  return nextIds;
}

function makeDiscordSnowflake(offset = 0) {
  return String(1783000000000000000n + BigInt(Date.now() % 100000000) * 1000n + BigInt(Math.max(0, Number(offset) || 0)));
}

function getRefereeExamAnswerKey(questionIds = []) {
  return Object.fromEntries(questionIds.map((questionId) => {
    const answerIndex = [0, 1, 2, 3].find((index) => (
      gradeRefereeExamByQuestionIds([questionId], { [questionId]: index }).score === 1
    ));
    return [questionId, Number.isInteger(answerIndex) ? answerIndex : 0];
  }));
}

let ids = {
  label: "init",
  postId: `sim_q_init_${suffix}`,
  matchId: `sim_m_init_${suffix}`,
};
let currentStep = "init";
const verbose = !process.argv.includes("--quiet");
const startedAtMs = Date.now();

async function step(label, action) {
  currentStep = label;
  if (verbose) console.error(`[sim +${((Date.now() - startedAtMs) / 1000).toFixed(1)}s] ${label}`);
  return action();
}

const authTokensByLogin = new Map();
const testLoginsByProfileId = new Map();

// RANKBALL_AUTH_CLEANUP: remove old test-token env docs after all simulations use Auth users.
function getTestAuthEmail(testLoginId = "") {
  return `${String(testLoginId).trim().toLowerCase()}@${testAuthEmailDomain}`;
}

async function getAuthToken(testLoginId) {
  const normalizedLoginId = String(testLoginId).trim().toLowerCase();
  if (authTokensByLogin.has(normalizedLoginId)) return authTokensByLogin.get(normalizedLoginId);
  const { data, error } = await authClient.auth.signInWithPassword({
    email: getTestAuthEmail(normalizedLoginId),
    password: testAuthPassword,
  });
  if (error || !data?.session?.access_token) {
    throw new Error(`test_auth_login_failed:${normalizedLoginId}:${error?.message ?? "missing_session"}`);
  }
  authTokensByLogin.set(normalizedLoginId, data.session.access_token);
  return data.session.access_token;
}

function makeRequest(bearerToken, body = {}) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
    },
    body,
  };
}

function makeResponse(route) {
  return {
    route,
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
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

async function callHandler(route, handler, bearerToken, body = {}) {
  if (usesRemoteApi) {
    const response = await fetchWithTimeout(`${remoteBaseUrl}${route}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await readResponseTextWithTimeout(response, route);
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`${route} failed ${response.status}: ${text}`);
    }
    return payload;
  }

  const response = makeResponse(route);
  await handler(makeRequest(bearerToken, body), response);
  if (response.statusCode >= 400) {
    const detail = response.payload ? JSON.stringify(response.payload) : "";
    throw new Error(`${route} failed ${response.statusCode}: ${detail}`);
  }
  return response.payload;
}

function getDiscordChatBridgeSecret() {
  const configured = String(process.env.DISCORD_CHAT_BRIDGE_SECRET || process.env.CRON_SECRET || "").trim();
  if (configured) return configured;
  if (usesRemoteApi) return "";
  const generated = `rankball-sim-${suffix}`;
  process.env.DISCORD_CHAT_BRIDGE_SECRET = generated;
  return generated;
}

async function syncDiscordRoomChatBridge(body = {}) {
  const bridgeSecret = getDiscordChatBridgeSecret();
  assertFlow(Boolean(bridgeSecret), "discord chat bridge secret missing");
  return callHandler("/api/discord/room-chat", discordRoomChatHandler, bridgeSecret, body);
}

async function fetchWithTimeout(resource, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseTextWithTimeout(response, label = "response") {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_body_timeout`)), requestTimeoutMs);
  });
  return Promise.race([response.text(), timeout]).finally(() => clearTimeout(timeoutId));
}

async function withTimeout(promise, label = "operation") {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), requestTimeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function assertRemoteSchemaHealth() {
  if (!usesRemoteApi || !schemaHealthSecret) return { skipped: true };
  const response = await fetchWithTimeout(`${remoteBaseUrl}/api/system/schema-health`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${schemaHealthSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(ensureRemoteTestActors ? { ensureTestActors: true } : {}),
  });
  const text = await readResponseTextWithTimeout(response, "schema_health");
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`/api/system/schema-health failed ${response.status}: ${text}`);
  }
  if (!payload?.ok) {
    const failed = (payload?.checks ?? [])
      .filter((check) => !check.ok)
      .map((check) => `${check.table}: ${check.error}`)
      .join("; ");
    const seedError = payload?.simulationSeed && !payload.simulationSeed.ok
      ? `simulationSeed: ${payload.simulationSeed.error || JSON.stringify(payload.simulationSeed.checks ?? [])}`
      : "";
    throw new Error(`schema health failed: ${[failed, seedError].filter(Boolean).join("; ")}`);
  }
  return payload;
}

async function runSystemMaintenanceProbe() {
  if (!schemaHealthSecret) return { skipped: true, reason: "secret_missing" };
  if (usesRemoteApi) {
    const response = await fetchWithTimeout(`${remoteBaseUrl}/api/system/maintenance`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${schemaHealthSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const text = await readResponseTextWithTimeout(response, "system_maintenance");
    if (!response.ok) throw new Error(`/api/system/maintenance failed ${response.status}: ${text}`);
    return text ? JSON.parse(text) : { ok: true };
  }

  const response = makeResponse("/api/system/maintenance");
  await maintenanceHandler(makeRequest(schemaHealthSecret, {}), response);
  if (response.statusCode >= 400) {
    const detail = response.payload ? JSON.stringify(response.payload) : "";
    throw new Error(`/api/system/maintenance failed ${response.statusCode}: ${detail}`);
  }
  return response.payload ?? { ok: true };
}

function assertFlow(condition, label, detail = {}) {
  if (!condition) {
    throw new Error(`${label}: ${JSON.stringify(detail)}`);
  }
}

function getProfileId(state, label) {
  const profileId = state?.currentUserId;
  assertFlow(Boolean(profileId), `${label} profile missing`);
  return profileId;
}

function getSeededProfileId(testLoginId = "") {
  const match = String(testLoginId || "").toLowerCase().match(/^rankball-0*(\d+)$/);
  if (!match) return "";
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? `u${number}` : "";
}

function getSeededLoginForProfileId(profileId = "") {
  const match = String(profileId || "").toLowerCase().match(/^u(\d+)$/);
  if (!match) return "";
  const number = Number(match[1]);
  return Number.isFinite(number) && number > 0 ? `rankball-${String(number).padStart(3, "0")}` : "";
}

async function getTestLoginForProfileId(profileId = "") {
  const safeProfileId = String(profileId || "").trim();
  if (!safeProfileId) return "";
  if (testLoginsByProfileId.has(safeProfileId)) return testLoginsByProfileId.get(safeProfileId);
  const seededLogin = getSeededLoginForProfileId(safeProfileId);
  if (seededLogin) {
    testLoginsByProfileId.set(safeProfileId, seededLogin);
    return seededLogin;
  }
  if (!supabase) return "";
  const { data, error } = await supabase
    .from("profiles")
    .select("id,test_login_id")
    .eq("id", safeProfileId)
    .maybeSingle();
  if (error) throw error;
  const login = String(data?.test_login_id || "").trim().toLowerCase();
  if (login) testLoginsByProfileId.set(safeProfileId, login);
  return login;
}

async function getProfileIdForLogin(testLoginId) {
  const seededProfileId = getSeededProfileId(testLoginId);
  const normalizedLoginId = String(testLoginId || "").trim().toLowerCase();
  const state = await loadStateAs(testLoginId);
  const profileId = getProfileId(state, testLoginId) || seededProfileId;
  if (profileId && normalizedLoginId) testLoginsByProfileId.set(profileId, normalizedLoginId);
  return profileId;
}

async function setTemporaryProfileDiscordUser(profileId = "", discordUserId = "", username = "rankball-sim") {
  assertFlow(Boolean(supabase), "service role client required for temporary discord profile");
  const safeProfileId = String(profileId || "").trim();
  const safeDiscordUserId = String(discordUserId || "").trim();
  assertFlow(Boolean(safeProfileId && safeDiscordUserId), "temporary discord profile input missing", { profileId, discordUserId });
  if (!temporaryProfileDiscordSnapshots.has(safeProfileId)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,discord_connection,discord_user_id")
      .eq("id", safeProfileId)
      .maybeSingle();
    if (error) throw error;
    assertFlow(data?.id === safeProfileId, "temporary discord profile not found", { profileId: safeProfileId });
    temporaryProfileDiscordSnapshots.set(safeProfileId, {
      discord_connection: data.discord_connection ?? null,
      discord_user_id: data.discord_user_id ?? null,
    });
  }
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      discord_connection: {
        status: "linked",
        userId: safeDiscordUserId,
        username: String(username || "rankball-sim").slice(0, 80),
      },
      discord_user_id: safeDiscordUserId,
    })
    .eq("id", safeProfileId);
  if (updateError) throw updateError;
}

async function restoreTemporaryProfileDiscordUsers() {
  if (!supabase || temporaryProfileDiscordSnapshots.size === 0) return { skipped: true };
  const errors = [];
  for (const [profileId, snapshot] of temporaryProfileDiscordSnapshots.entries()) {
    const { error } = await supabase
      .from("profiles")
      .update({
        discord_connection: snapshot.discord_connection,
        discord_user_id: snapshot.discord_user_id,
      })
      .eq("id", profileId);
    if (error) errors.push({ profileId, message: error.message });
  }
  temporaryProfileDiscordSnapshots.clear();
  return { skipped: false, errors };
}

async function cleanupRefereeSimulationRows() {
  if (!supabase || (!refereeSimulationAttemptIds.size && !refereeSimulationRequestIds.size)) return { skipped: true };
  const now = new Date().toISOString();
  const errors = [];
  for (const attemptId of refereeSimulationAttemptIds) {
    const { data, error: loadError } = await supabase
      .from("referee_exam_attempts")
      .select("payload")
      .eq("id", attemptId)
      .maybeSingle();
    if (loadError) {
      errors.push({ table: "referee_exam_attempts", id: attemptId, message: loadError.message });
      continue;
    }
    const payload = {
      ...(data?.payload && typeof data.payload === "object" ? data.payload : {}),
      availableAfter: now,
      simulationClosedAt: now,
    };
    const { error } = await supabase
      .from("referee_exam_attempts")
      .update({ available_after: now, payload, updated_at: now })
      .eq("id", attemptId);
    if (error) errors.push({ table: "referee_exam_attempts", id: attemptId, message: error.message });
  }
  if (refereeSimulationRequestIds.size) {
    const { error } = await supabase
      .from("referee_requests")
      .update({ status: "simulation_closed", updated_at: now })
      .in("id", [...refereeSimulationRequestIds]);
    if (error) errors.push({ table: "referee_requests", message: error.message });
  }
  refereeSimulationAttemptIds.clear();
  refereeSimulationRequestIds.clear();
  return { skipped: false, errors };
}

async function snapshotRatingSubjects(profileIds = [], teamIds = []) {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const safeProfileIds = uniqueIds(profileIds).filter((profileId) => !profileRatingSnapshots.has(profileId));
  const safeTeamIds = uniqueIds(teamIds).filter((teamId) => !teamRatingSnapshots.has(teamId));
  if (safeProfileIds.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,ratings,trust_score,streak")
      .in("id", safeProfileIds);
    if (error) throw error;
    for (const row of data ?? []) {
      profileRatingSnapshots.set(row.id, {
        ratings: row.ratings ?? null,
        trust_score: row.trust_score ?? null,
        streak: row.streak ?? null,
      });
    }
  }
  if (safeTeamIds.length) {
    const { data, error } = await supabase
      .from("teams")
      .select("id,mmr,wins,losses")
      .in("id", safeTeamIds);
    if (error) throw error;
    for (const row of data ?? []) {
      teamRatingSnapshots.set(row.id, {
        mmr: row.mmr ?? null,
        wins: row.wins ?? null,
        losses: row.losses ?? null,
      });
    }
  }
  return { skipped: false, profiles: safeProfileIds.length, teams: safeTeamIds.length };
}

async function restoreRatingSnapshots() {
  if (!supabase || (!profileRatingSnapshots.size && !teamRatingSnapshots.size)) return { skipped: true };
  const errors = [];
  for (const [profileId, snapshot] of profileRatingSnapshots.entries()) {
    const { error } = await supabase
      .from("profiles")
      .update({
        ratings: snapshot.ratings,
        trust_score: snapshot.trust_score,
        streak: snapshot.streak,
      })
      .eq("id", profileId);
    if (error) errors.push({ table: "profiles", id: profileId, message: error.message });
  }
  for (const [teamId, snapshot] of teamRatingSnapshots.entries()) {
    const { error } = await supabase
      .from("teams")
      .update({
        mmr: snapshot.mmr,
        wins: snapshot.wins,
        losses: snapshot.losses,
      })
      .eq("id", teamId);
    if (error) errors.push({ table: "teams", id: teamId, message: error.message });
  }
  profileRatingSnapshots.clear();
  teamRatingSnapshots.clear();
  return { skipped: false, errors };
}

async function loadStateAs(testLoginId) {
  const payload = await callHandler("/api/state/load", loadStateHandler, await getAuthToken(testLoginId));
  assertFlow(payload?.ok && payload?.state, `state load failed for ${testLoginId}`, payload);
  return payload.state;
}

async function loadHomeAs(testLoginId) {
  const payload = await callHandler("/api/home/load", homeLoadHandler, await getAuthToken(testLoginId), {
    includeFeedCounts: false,
    includeLocalRecruiting: false,
    recruitingLimit: 20,
  });
  assertFlow(payload?.ok && payload?.state, `home load failed for ${testLoginId}`, payload);
  return payload.state;
}

async function getCurrentProfileTrustScore(testLoginId, expectedProfileId = "") {
  const state = await loadStateAs(testLoginId);
  const user = (state.users ?? []).find((item) => item.id === (expectedProfileId || state.currentUserId));
  assertFlow(Boolean(user), `profile trust score missing for ${testLoginId}`, {
    expectedProfileId,
    currentUserId: state.currentUserId,
  });
  return Number(user.trustScore ?? 80);
}

async function loadTeamsAs(testLoginId) {
  const payload = await callHandler("/api/teams/list", teamsListHandler, await getAuthToken(testLoginId));
  assertFlow(payload?.ok && payload?.state, `teams list failed for ${testLoginId}`, payload);
  return payload.state;
}

function teamHasMembers(team = {}, memberIds = []) {
  const teamMemberIds = new Set((team.members ?? []).map((member) => member.userId).filter(Boolean));
  return memberIds.every((memberId) => teamMemberIds.has(memberId));
}

async function resolveTeamIdForMembers(testLoginId, memberIds = [], preferredTeamId = "") {
  const state = await loadTeamsAs(testLoginId);
  const teams = state.teams ?? [];
  const preferredTeam = preferredTeamId ? teams.find((team) => team.id === preferredTeamId && teamHasMembers(team, memberIds)) : null;
  if (preferredTeam) return preferredTeam.id;
  const sharedTeam = teams.find((team) => teamHasMembers(team, memberIds));
  assertFlow(Boolean(sharedTeam?.id), "shared team missing for simulation", {
    testLoginId,
    memberIds,
    preferredTeamId,
    teamIds: teams.map((team) => team.id),
  });
  return sharedTeam.id;
}

async function loadRecruitingPostAs(testLoginId, postId = ids.postId) {
  const payload = await callHandler("/api/recruiting/list", recruitingListHandler, await getAuthToken(testLoginId), {
    postId,
    limit: 1,
    adminContext: false,
    includeFeedCounts: false,
  });
  const post = (payload?.state?.recruitingPosts ?? []).find((item) => item.id === postId);
  assertFlow(payload?.ok && post, `recruiting post load failed for ${testLoginId}`, payload);
  return post;
}

async function loadRecruitingScopeAs(testLoginId, roomScope, postId = ids.postId) {
  const payload = await callHandler("/api/recruiting/list", recruitingListHandler, await getAuthToken(testLoginId), {
    scope: "mine",
    roomScope,
    limit: 20,
    adminContext: false,
    includeFeedCounts: true,
  });
  const post = (payload?.state?.recruitingPosts ?? []).find((item) => item.id === postId) ?? null;
  return { payload, post };
}

async function loadRecruitingRegionAs(testLoginId, { regionKey = "마포", startFilter = "instant", postId = ids.postId } = {}) {
  const payload = await callHandler("/api/recruiting/list", recruitingListHandler, await getAuthToken(testLoginId), {
    regionScope: "region",
    regionKey,
    startFilter,
    limit: 20,
    listOnly: true,
    adminContext: false,
    includeFeedCounts: false,
  });
  const post = (payload?.state?.recruitingPosts ?? []).find((item) => item.id === postId) ?? null;
  return { payload, post };
}

async function syncRecruitingAs(testLoginId, operation) {
  return callHandler("/api/recruiting/sync-post", syncRecruitingPostHandler, await getAuthToken(testLoginId), { operation });
}

async function syncMatchAs(testLoginId, operation, extra = {}) {
  return callHandler("/api/matches/sync-match", syncMatchHandler, await getAuthToken(testLoginId), { operation, ...extra });
}

async function syncTournamentAs(testLoginId, operation) {
  return callHandler("/api/tournaments/sync-tournament", syncTournamentHandler, await getAuthToken(testLoginId), { operation });
}

async function syncRefereeAs(testLoginId, body = {}) {
  return callHandler("/api/referee/sync", refereeSyncHandler, await getAuthToken(testLoginId), body);
}

async function loadMatchAs(testLoginId, matchId = ids.matchId) {
  const payload = await callHandler("/api/matches/detail", matchDetailHandler, await getAuthToken(testLoginId), {
    matchId,
    adminContext: false,
  });
  const match = (payload?.state?.matches ?? []).find((item) => item.id === matchId);
  assertFlow(payload?.ok && match, `match load failed for ${testLoginId}`, payload);
  return match;
}

function getKstFutureSchedule(offsetHours = 48) {
  const date = new Date(Date.now() + Math.max(1, Number(offsetHours) || 48) * 60 * 60 * 1000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    timingType: "scheduled",
    scheduledDate: `${parts.year}-${parts.month}-${parts.day}`,
    scheduledTime: `${parts.hour}:${parts.minute}`,
  };
}

async function countPendingRowsByPrefixes(table, matchId, prefixes = []) {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const kind = table === "discord_notification_deliveries" ? "discord" : "notice";
  const counts = {};
  for (const prefix of prefixes) {
    let query = supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .like("id", `${kind}-${prefix}-${matchId}-%`);
    if (table === "discord_notification_deliveries") {
      query = query.eq("status", "queued").is("sent_at", null);
    } else {
      query = query.is("read_at", null);
    }
    const { count, error } = await query;
    if (error) throw error;
    counts[prefix] = Number(count ?? 0);
  }
  return {
    skipped: false,
    counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

async function assertPendingMatchNotices(matchId, prefixes = [], { minNotifications = 0, maxNotifications = Infinity } = {}) {
  const notifications = await countPendingRowsByPrefixes("notifications", matchId, prefixes);
  const deliveries = await countPendingRowsByPrefixes("discord_notification_deliveries", matchId, prefixes);
  if (notifications.skipped || deliveries.skipped) {
    return {
      skipped: true,
      reason: notifications.reason || deliveries.reason,
    };
  }
  assertFlow(
    notifications.total >= minNotifications && notifications.total <= maxNotifications,
    "match reminder notification count mismatch",
    { matchId, prefixes, notifications, deliveries, minNotifications, maxNotifications },
  );
  return { notifications, deliveries };
}

async function seedPendingMatchNotices(matchId = "", profileId = "", prefixes = []) {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const safeMatchId = String(matchId || "").trim();
  const safeProfileId = String(profileId || "").trim();
  const uniquePrefixes = uniqueIds(prefixes);
  assertFlow(Boolean(safeMatchId && safeProfileId && uniquePrefixes.length), "pending match notice seed input missing", { matchId, profileId, prefixes });
  const now = new Date().toISOString();
  const notificationRows = uniquePrefixes.map((prefix) => {
    const id = `notice-${prefix}-${safeMatchId}-${safeProfileId}`;
    return {
      id,
      user_id: safeProfileId,
      target_user_id: safeProfileId,
      title: `Simulation ${prefix}`,
      body: "Backend simulation stale notice.",
      tone: "match",
      type: `simulation_${String(prefix).replace(/-/g, "_")}`,
      match_id: safeMatchId,
      discord_event: "match",
      read_at: null,
      payload: {
        id,
        matchId: safeMatchId,
        targetUserId: safeProfileId,
        sendAt: now,
        queuedAt: now,
        skipDiscordSync: true,
      },
      created_at: now,
      updated_at: now,
    };
  });
  const deliveryRows = uniquePrefixes.map((prefix, index) => {
    const notificationId = `notice-${prefix}-${safeMatchId}-${safeProfileId}`;
    return {
      id: `discord-${prefix}-${safeMatchId}-${safeProfileId}`,
      notification_id: notificationId,
      target_user_id: safeProfileId,
      discord_user_id: makeDiscordSnowflake(600 + index),
      event: "match",
      status: "queued",
      payload: {
        matchId: safeMatchId,
        targetUserId: safeProfileId,
        simulation: true,
      },
      queued_at: now,
      send_at: now,
      sent_at: null,
      failed_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    };
  });
  const { error: notificationError } = await supabase
    .from("notifications")
    .upsert(notificationRows, { onConflict: "id" });
  if (notificationError) throw notificationError;
  const { error: deliveryError } = await supabase
    .from("discord_notification_deliveries")
    .upsert(deliveryRows, { onConflict: "id" });
  if (deliveryError) throw deliveryError;
  return { skipped: false, notifications: notificationRows.length, deliveries: deliveryRows.length };
}

async function expectRejected(label, action, expectedErrors = []) {
  try {
    const payload = await step(label, action);
    throw new Error(`${label} unexpectedly succeeded: ${JSON.stringify(payload)}`);
  } catch (error) {
    const message = String(error?.message || "");
    if (expectedErrors.length && !expectedErrors.some((expected) => message.includes(expected))) {
      throw error;
    }
    return { rejected: true, message };
  }
}

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function hasPendingInvitationFor(post = {}, profileId = "") {
  return (post.roomState?.invitations ?? []).some((invitation) => (
    invitation?.targetUserId === profileId &&
    invitation?.role !== "referee" &&
    String(invitation?.status ?? "pending") === "pending"
  ));
}

function findPendingHomeInvitation(state = {}, profileId = "", postId = "") {
  const post = (state.recruitingPosts ?? []).find((item) => item.id === postId);
  const invitation = (post?.roomState?.invitations ?? []).find((item) => (
    item?.targetUserId === profileId &&
    item?.role !== "referee" &&
    String(item?.status ?? "pending") === "pending"
  ));
  return { post, invitation };
}

function getApplicantPlayerIds(applicant = {}) {
  if (Array.isArray(applicant.playerIds) && applicant.playerIds.length) return applicant.playerIds;
  return applicant.playerId ? [applicant.playerId] : [];
}

function getRecruitingPlacement(post = {}, profileId = "") {
  const applicant = (post.applicants ?? []).find((item) => getApplicantPlayerIds(item).includes(profileId));
  if (applicant) {
    return {
      side: applicant.side,
      reserve: Boolean(applicant.reserve),
      kind: applicant.kind,
      teamId: applicant.teamId ?? null,
    };
  }
  const partyReserves = post.roomState?.partyReserves ?? {};
  const reserveKey = Object.entries(partyReserves).find(([, playerIds]) => Array.isArray(playerIds) && playerIds.includes(profileId))?.[0] ?? "";
  if (!reserveKey) return null;
  const reserveApplicant = reserveKey === "host"
    ? { side: post.hostSide ?? "teamA", kind: post.hostJoinMode ?? "player", teamId: post.teamId ?? null }
    : (post.applicants ?? []).find((item) => (
      (item.kind === "team" || item.teamId) && `team:${item.teamId}` === reserveKey
    ));
  return reserveApplicant
    ? {
        side: reserveApplicant.side ?? "teamB",
        reserve: true,
        kind: reserveApplicant.kind ?? "team",
        teamId: reserveApplicant.teamId ?? null,
      }
    : null;
}

function assertStateIncludesUsers(payload = {}, profileIds = [], label = "state users missing") {
  const users = Array.isArray(payload?.state?.users) ? payload.state.users : [];
  const userIds = new Set(users.map((user) => user?.id).filter(Boolean));
  const missing = profileIds.filter((profileId) => profileId && !userIds.has(profileId));
  assertFlow(!missing.length, label, {
    missing,
    userIds: [...userIds],
  });
}

async function getRecruitingPostAfterResult(result, login, label) {
  if (result?.post) return result.post;
  return step(label, () => loadRecruitingPostAs(login));
}

async function getMatchAfterResult(result, login, label) {
  if (result?.match) return result.match;
  return step(label, () => loadMatchAs(login));
}

function makeResult(match) {
  const teamAPlayer = match.teamA?.players?.[0];
  const teamBPlayer = match.teamB?.players?.[0];
  assertFlow(Boolean(teamAPlayer && teamBPlayer), "match players missing", match);
  return {
    scoreA: 21,
    scoreB: 12,
    playerStats: {
      [teamAPlayer]: {
        points: 21,
        rebounds: 6,
        assists: 3,
        steals: 1,
        blocks: 0,
        fouls: 2,
      },
      [teamBPlayer]: {
        points: 12,
        rebounds: 5,
        assists: 2,
        steals: 1,
        blocks: 0,
        fouls: 2,
      },
    },
  };
}

function withLateAnonymousPlayer(match = {}, playerId = "", sideName = "teamA", name = "Backend Anonymous") {
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const mmrExcludedPlayerIds = match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? [];
  const reservePlayers = match.reservePlayers ?? match.rules?.reservePlayers ?? {};
  const nextPlayedPlayerIds = {
    ...playedPlayerIds,
    [sideName]: uniqueIds([...(playedPlayerIds[sideName] ?? []), playerId]),
  };
  const nextReservePlayers = {
    teamA: uniqueIds(reservePlayers.teamA ?? []).filter((id) => id !== playerId),
    teamB: uniqueIds(reservePlayers.teamB ?? []).filter((id) => id !== playerId),
  };
  const nextExcludedIds = uniqueIds([...mmrExcludedPlayerIds, playerId]);
  return {
    ...match,
    playedPlayerIds: nextPlayedPlayerIds,
    reservePlayers: nextReservePlayers,
    anonymousPlayers: {
      ...(match.anonymousPlayers ?? {}),
      [playerId]: {
        id: playerId,
        name,
        position: "-",
        avatarColor: "#64748b",
        trustScore: "-",
        ratings: { integrated: 0, modes: {} },
      },
    },
    mmrExcludedPlayerIds: nextExcludedIds,
    rules: {
      ...(match.rules ?? {}),
      playedPlayerIds: nextPlayedPlayerIds,
      mmrExcludedPlayerIds: nextExcludedIds,
    },
  };
}

function withoutLatePlayer(match = {}, playerId = "") {
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const mmrExcludedPlayerIds = match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? [];
  const anonymousPlayers = { ...(match.anonymousPlayers ?? {}) };
  delete anonymousPlayers[playerId];
  const nextPlayedPlayerIds = {
    teamA: uniqueIds(playedPlayerIds.teamA ?? []).filter((id) => id !== playerId),
    teamB: uniqueIds(playedPlayerIds.teamB ?? []).filter((id) => id !== playerId),
  };
  const nextExcludedIds = uniqueIds(mmrExcludedPlayerIds).filter((id) => id !== playerId);
  return {
    ...match,
    playedPlayerIds: nextPlayedPlayerIds,
    anonymousPlayers,
    mmrExcludedPlayerIds: nextExcludedIds,
    rules: {
      ...(match.rules ?? {}),
      playedPlayerIds: nextPlayedPlayerIds,
      mmrExcludedPlayerIds: nextExcludedIds,
    },
  };
}

function withEndedMatch(match = {}) {
  const now = new Date().toISOString();
  const startedAt = match.startedAt ?? match.rules?.startedAt ?? now;
  const endedAt = match.endedAt ?? now;
  return {
    ...match,
    startedAt,
    endedAt,
    rules: {
      ...(match.rules ?? {}),
      startedAt: match.rules?.startedAt ?? startedAt,
    },
  };
}

function withAgreement(match = {}, sideName = "teamA", playerId = "") {
  return {
    ...match,
    agreements: {
      ...(match.agreements ?? { teamA: [], teamB: [] }),
      [sideName]: uniqueIds([...(match.agreements?.[sideName] ?? []), playerId]),
    },
  };
}

function withAttendance(match = {}, sideName = "teamA", playerId = "") {
  return {
    ...match,
    attendance: {
      ...(match.attendance ?? { teamA: [], teamB: [] }),
      [sideName]: uniqueIds([...(match.attendance?.[sideName] ?? []), playerId]),
    },
  };
}

function withStartedMatch(match = {}, operatorId = "") {
  const now = new Date().toISOString();
  const teamASide = (match.teamA?.players ?? []).includes(operatorId) ? "teamA" : "";
  const teamBSide = (match.teamB?.players ?? []).includes(operatorId) ? "teamB" : "";
  const operatorSide = teamASide || teamBSide;
  const matchWithOperatorAttendance = operatorSide ? withAttendance(match, operatorSide, operatorId) : match;
  const startedAt = matchWithOperatorAttendance.startedAt ?? now;
  return {
    ...matchWithOperatorAttendance,
    status: "agreed",
    agreedAt: matchWithOperatorAttendance.agreedAt ?? now,
    startedAt,
    rules: {
      ...(matchWithOperatorAttendance.rules ?? {}),
      startedAt: matchWithOperatorAttendance.rules?.startedAt ?? startedAt,
    },
  };
}

function withRecorderHandoff(match = {}, sideName = "teamA", currentRecorderId = "", nextRecorderId = "") {
  const effectiveMatch = withEffectiveMatchStatRecorders(match);
  const patch = getRecorderHandoffPatch(effectiveMatch, sideName, currentRecorderId, nextRecorderId);
  if (!patch.valid) return { valid: false, patch, match: effectiveMatch };
  const nextRecorders = {
    ...(effectiveMatch.statRecorders ?? effectiveMatch.rules?.statRecorders ?? {}),
    [sideName]: nextRecorderId,
  };
  const nextMatch = {
    ...patch.match,
    statRecorders: nextRecorders,
    rules: {
      ...(patch.match.rules ?? {}),
      statRecorders: nextRecorders,
    },
  };
  return { valid: true, patch, match: nextMatch };
}

function withSubstitution(match = {}, sideName = "teamA", activePlayerId = "", reservePlayerId = "") {
  const effectiveMatch = withEffectiveMatchStatRecorders(match);
  const patch = getRecorderHandoffPatch(effectiveMatch, sideName, activePlayerId, reservePlayerId);
  if (!patch.valid || !patch.swapped) return { valid: false, patch, match: effectiveMatch };
  return { valid: true, patch, match: patch.match };
}

async function cleanup() {
  const profileDiscordRestore = await restoreTemporaryProfileDiscordUsers();
  const refereeSimulationCleanup = await cleanupRefereeSimulationRows();
  const ratingRestore = await restoreRatingSnapshots();
  if (keepRows) return { skipped: true, reason: "keep_requested", profileDiscordRestore, refereeSimulationCleanup, ratingRestore };
  if (usesRemoteApi && schemaHealthSecret) {
    const response = await fetchWithTimeout(`${remoteBaseUrl}/api/system/cleanup-sim`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${schemaHealthSecret}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    const text = await readResponseTextWithTimeout(response, "cleanup_sim");
    if (!response.ok) return { skipped: true, reason: `remote_cleanup_failed:${response.status}:${text}`, profileDiscordRestore, refereeSimulationCleanup, ratingRestore };
    return { ...(text ? JSON.parse(text) : { ok: true }), profileDiscordRestore, refereeSimulationCleanup, ratingRestore };
  }
  if (!supabase) return { skipped: true, reason: "service_role_key_missing", profileDiscordRestore, refereeSimulationCleanup, ratingRestore };

  const closedAt = new Date().toISOString();
  const closures = scenarioIds.flatMap((scenario) => [
    ...uniqueIds([scenario.matchId, ...(scenario.matchIds ?? [])])
      .filter(Boolean)
      .map((matchId) => ["matches", "id", matchId]),
    ["recruiting_posts", "id", scenario.postId],
    ["tournaments", "id", scenario.tournamentId],
  ]);

  const errors = [];
  for (const [table, column, value] of closures) {
    const { error } = await supabase
      .from(table)
      .update({ status: "closed", updated_at: closedAt })
      .eq(column, value)
      .neq("status", "closed");
    if (error && !String(error.message || "").includes("does not exist")) {
      errors.push({ table, message: error.message });
    }
  }
  const postIds = scenarioIds.map((scenario) => scenario.postId).filter(Boolean);
  if (postIds.length) {
    const { error } = await supabase
      .from("room_discord_links")
      .update({ enabled: false, updated_at: closedAt })
      .eq("room_type", "recruiting")
      .in("room_id", postIds)
      .eq("enabled", true);
    if (error && !String(error.message || "").includes("does not exist")) {
      errors.push({ table: "room_discord_links", message: error.message });
    }
  }
  return { skipped: false, errors, profileDiscordRestore, refereeSimulationCleanup, ratingRestore };
}

async function runOneOnOneScenario({
  label,
  hostLogin,
  opponentLogin,
  refereeLogin = "",
  refereeWanted = false,
  scheduledOffsetHours = 0,
  ranked = false,
  includeLatePlayer = !refereeWanted,
  verifyRatingCommit = false,
}) {
  ids = makeScenarioIds(label);
  const operatorLogin = refereeWanted ? refereeLogin : hostLogin;

  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const opponentId = await step(`${ids.label}:resolveProfile:opponent`, () => getProfileIdForLogin(opponentLogin));
  let refereeId = "";

  assertFlow(hostId !== opponentId, "host and opponent must be different profiles", { hostId, opponentId });

  if (refereeWanted) {
    assertFlow(Boolean(refereeLogin), "referee login required");
    refereeId = await step(`${ids.label}:resolveProfile:referee`, () => getProfileIdForLogin(refereeLogin));
    assertFlow(![hostId, opponentId].includes(refereeId), "referee must be separate profile", { hostId, opponentId, refereeId });
  }
  if (verifyRatingCommit) {
    await step(`${ids.label}:snapshotRatingSubjects`, () => snapshotRatingSubjects([hostId, opponentId]));
  }

  const scheduleDraft = scheduledOffsetHours > 0 ? getKstFutureSchedule(scheduledOffsetHours) : { timingType: "instant" };
  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      ...scheduleDraft,
      ranked,
      official: false,
      mmrLimitMode: ranked ? "off" : undefined,
      preRegistered: true,
      teamOnly: false,
      refereeWanted,
      refereeTrustMin: 70,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  let post = createResult?.post;
  assertFlow(post?.id === ids.postId, "created post not returned", createResult);
  assertFlow(post.ownerId === hostId || post.playerId === hostId, "created post owner mismatch", { hostId, post });

  if (refereeWanted) {
    const refereeJoinResult = await step(`${ids.label}:interestRecruitingPost:referee`, () => syncRecruitingAs(refereeLogin, {
      action: "interestRecruitingPost",
      postId: ids.postId,
      application: {
        joinMode: "referee",
      },
      joinMode: "referee",
    }));
    post = refereeJoinResult?.post;
    assertFlow(post?.refereeId === refereeId, "referee join not persisted", { refereeId, post });
  }

  const opponentJoinResult = await step(`${ids.label}:interestRecruitingPost:opponent`, () => syncRecruitingAs(opponentLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamB",
      position: "PG",
    },
    joinMode: "player",
  }));
  post = await getRecruitingPostAfterResult(opponentJoinResult, opponentLogin, `${ids.label}:loadAfterJoin`);
  assertFlow(post?.applicants?.some((applicant) => applicant.playerId === opponentId), "opponent join not persisted", post);
  const readyResult = { skipped: true };
  assertFlow(post?.applicants?.some((applicant) => applicant.playerId === opponentId && applicant.status === "ready"), "opponent ready not persisted", post);

  const confirmResult = await step(`${ids.label}:confirmRecruitingMatch`, () => syncRecruitingAs(hostLogin, {
    action: "confirmRecruitingMatch",
    postId: ids.postId,
    preferredMatchId: ids.matchId,
  }));
  let match = confirmResult?.createdMatch;
  assertFlow(match?.id === ids.matchId, "confirmed match not returned", confirmResult);
  if (refereeWanted) assertFlow(match.refereeId === refereeId, "match referee not persisted", { refereeId, match });
  assertFlow(match.teamA?.players?.includes(hostId), "host missing from teamA", match);
  assertFlow(match.teamB?.players?.includes(opponentId), "opponent missing from teamB", match);

  const reminderChecks = {};
  if (scheduledOffsetHours > 0) {
    reminderChecks.afterConfirm = await step(`${ids.label}:remindersAfterConfirm`, () => assertPendingMatchNotices(
      ids.matchId,
      MATCH_SCHEDULED_NOTICE_PREFIXES,
      { minNotifications: 1 },
    ));
  }

  let agreeASqlReducer = false;
  let agreeBSqlReducer = false;
  if (!match.agreements?.teamA?.includes(hostId)) {
    const matchWithHostAgreement = withAgreement(match, "teamA", hostId);
    const agreeAResult = await step(`${ids.label}:agreeMatch:teamA`, () => syncMatchAs(hostLogin, {
      action: "agreeMatch",
      matchId: ids.matchId,
      sideName: "teamA",
      playerId: hostId,
    }, { match: matchWithHostAgreement }));
    agreeASqlReducer = Boolean(agreeAResult?.sqlReducer);
    match = await getMatchAfterResult(agreeAResult, hostLogin, `${ids.label}:loadAfterAgreeTeamA`);
    assertFlow(match?.agreements?.teamA?.includes(hostId), "teamA agreement not persisted", match);
  }

  if (!match.agreements?.teamB?.includes(opponentId)) {
    const matchWithOpponentAgreement = withAgreement(match, "teamB", opponentId);
    const agreeBResult = await step(`${ids.label}:agreeMatch:teamB`, () => syncMatchAs(opponentLogin, {
      action: "agreeMatch",
      matchId: ids.matchId,
      sideName: "teamB",
      playerId: opponentId,
    }, { match: matchWithOpponentAgreement }));
    agreeBSqlReducer = Boolean(agreeBResult?.sqlReducer);
    match = await getMatchAfterResult(agreeBResult, opponentLogin, `${ids.label}:loadAfterAgreeTeamB`);
    assertFlow(match?.agreements?.teamB?.includes(opponentId), "teamB agreement not persisted", match);
  }

  if (refereeWanted) {
    const matchWithHostAttendance = withAttendance(match, "teamA", hostId);
    const checkInAResult = await step(`${ids.label}:checkInMatchPlayer:teamA`, () => syncMatchAs(operatorLogin, {
      action: "checkInMatchPlayer",
      matchId: ids.matchId,
      sideName: "teamA",
      playerId: hostId,
    }, { match: matchWithHostAttendance }));
    match = await getMatchAfterResult(checkInAResult, operatorLogin, `${ids.label}:loadAfterCheckInTeamA`);
    assertFlow(match?.attendance?.teamA?.includes(hostId), "teamA check-in not persisted", match);
  }

  const matchWithOpponentAttendance = withAttendance(match, "teamB", opponentId);
  const checkInBResult = await step(`${ids.label}:checkInMatchPlayer:teamB`, () => syncMatchAs(operatorLogin, {
    action: "checkInMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: opponentId,
  }, { match: matchWithOpponentAttendance }));
  match = await getMatchAfterResult(checkInBResult, operatorLogin, `${ids.label}:loadAfterCheckInTeamB`);
  assertFlow(match?.attendance?.teamB?.includes(opponentId), "teamB check-in not persisted", match);

  const matchWithStart = withStartedMatch(match, operatorLogin === hostLogin ? hostId : refereeId);
  const startResult = await step(`${ids.label}:startMatch`, () => syncMatchAs(operatorLogin, {
    action: "startMatch",
    matchId: ids.matchId,
  }, { match: matchWithStart }));
  match = await getMatchAfterResult(startResult, operatorLogin, `${ids.label}:loadAfterStartMatch`);
  assertFlow(Boolean(match?.startedAt), "match start not persisted", match);
  if (scheduledOffsetHours > 0) {
    reminderChecks.afterStart = await step(`${ids.label}:remindersAfterStart`, () => assertPendingMatchNotices(
      ids.matchId,
      MATCH_SCHEDULED_NOTICE_PREFIXES,
      { maxNotifications: 0 },
    ));
  }

  const matchWithEnd = withEndedMatch(match);
  const endResult = await step(`${ids.label}:endMatch`, () => syncMatchAs(operatorLogin, {
    action: "endMatch",
    matchId: ids.matchId,
  }, { match: matchWithEnd }));
  match = await getMatchAfterResult(endResult, operatorLogin, `${ids.label}:loadAfterEndMatch`);
  assertFlow(Boolean(match?.endedAt), "match end not persisted", match);
  reminderChecks.afterEnd = await step(`${ids.label}:postgameAfterEnd`, () => assertPendingMatchNotices(
    ids.matchId,
    MATCH_POSTGAME_NOTICE_PREFIXES,
    { minNotifications: 1 },
  ));

  let latePlayerSqlReducers = null;
  if (includeLatePlayer && !refereeWanted) {
    const latePlayerId = `anon_${ids.label}_${suffix}`;
    const matchWithLatePlayer = withLateAnonymousPlayer(match, latePlayerId, "teamA", "Backend Anonymous");
    const addLateResult = await step(`${ids.label}:addMatchLatePlayer:anonymous`, () => syncMatchAs(operatorLogin, {
      action: "addMatchLatePlayer",
      matchId: ids.matchId,
      draft: {
        sideName: "teamA",
        name: "Backend Anonymous",
      },
    }, { match: matchWithLatePlayer }));
    match = await getMatchAfterResult(addLateResult, operatorLogin, `${ids.label}:loadAfterLatePlayerAdd`);
    assertFlow(Boolean(match?.anonymousPlayers?.[latePlayerId]), "anonymous late player not persisted", { latePlayerId, match });
    assertFlow((match?.playedPlayerIds?.teamA ?? []).includes(latePlayerId), "anonymous late player not in played ids", { latePlayerId, match });

    const matchWithoutLatePlayer = withoutLatePlayer(match, latePlayerId);
    const removeLateResult = await step(`${ids.label}:removeMatchLatePlayer:anonymous`, () => syncMatchAs(operatorLogin, {
      action: "removeMatchLatePlayer",
      matchId: ids.matchId,
      playerId: latePlayerId,
    }, { match: matchWithoutLatePlayer }));
    match = await getMatchAfterResult(removeLateResult, operatorLogin, `${ids.label}:loadAfterLatePlayerRemove`);
    assertFlow(!match?.anonymousPlayers?.[latePlayerId], "anonymous late player remove not persisted", { latePlayerId, match });
    assertFlow(!(match?.playedPlayerIds?.teamA ?? []).includes(latePlayerId), "anonymous late player still in played ids", { latePlayerId, match });
    latePlayerSqlReducers = {
      add: Boolean(addLateResult?.sqlReducer),
      remove: Boolean(removeLateResult?.sqlReducer),
    };
  }

  const resultSubmit = await step(`${ids.label}:submitMatchResult`, () => syncMatchAs(operatorLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: makeResult(match),
  }));
  match = resultSubmit?.match;
  assertFlow(match?.status === "approval" && match?.result, "match result not persisted", match);
  reminderChecks.afterSubmitResult = await step(`${ids.label}:postgameAfterSubmitResult`, () => assertPendingMatchNotices(
    ids.matchId,
    MATCH_POSTGAME_NOTICE_PREFIXES,
    { maxNotifications: 0 },
  ));
  if (refereeWanted) {
    assertFlow(match.result.submittedBy === refereeId, "referee result submitter not persisted", { refereeId, result: match.result });
  }

  const approveAResult = await step(`${ids.label}:approveMatch:teamA`, () => syncMatchAs(hostLogin, {
    action: "approveMatch",
    matchId: ids.matchId,
    sideName: "teamA",
    playerId: hostId,
  }));
  match = approveAResult?.match;
  assertFlow(match?.approvals?.teamA?.includes(hostId), "teamA approval not persisted", match);
  assertFlow(Boolean(approveAResult?.sqlReducer), "approval SQL reducer not used", approveAResult);

  const approveBResult = await step(`${ids.label}:approveMatch:teamB`, () => syncMatchAs(opponentLogin, {
    action: "approveMatch",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: opponentId,
  }));
  match = approveBResult?.match;
  assertFlow(match?.status === "confirmed", "match approval not confirmed", match);
  if (verifyRatingCommit) {
    assertFlow(approveBResult?.ratingCommitted === true, "rating commit RPC was not used", approveBResult);
    assertFlow(Array.isArray(match?.ratingResult) && match.ratingResult.length > 0, "rating result missing after ranked confirmation", match);
    const responseUserIds = new Set((approveBResult?.state?.users ?? []).map((user) => user.id));
    assertFlow(responseUserIds.has(hostId) && responseUserIds.has(opponentId), "rating commit response missing DB users", {
      hostId,
      opponentId,
      users: approveBResult?.state?.users,
    });
  }

  return {
    label: ids.label,
    hostLogin,
    opponentLogin,
    refereeLogin: refereeWanted ? refereeLogin : "",
    hostId,
    opponentId,
    refereeId,
    postId: ids.postId,
    matchId: ids.matchId,
    finalStatus: match.status,
    ratingCommitted: verifyRatingCommit ? Boolean(approveBResult?.ratingCommitted) : undefined,
    sqlReducers: {
      setRecruitingReady: Boolean(readyResult?.sqlReducer),
      agreeMatch: agreeASqlReducer || agreeBSqlReducer,
      checkInMatchPlayer: Boolean(checkInBResult?.sqlReducer),
      startMatch: Boolean(startResult?.sqlReducer),
      endMatch: Boolean(endResult?.sqlReducer),
      approveMatch: Boolean(approveAResult?.sqlReducer),
      latePlayer: latePlayerSqlReducers,
    },
    reminderChecks,
  };
}

async function runMatchReminderCancelScenario({
  label,
  hostLogin,
  opponentLogin,
  scheduledOffsetHours = 23,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const opponentId = await step(`${ids.label}:resolveProfile:opponent`, () => getProfileIdForLogin(opponentLogin));
  assertFlow(hostId !== opponentId, "host and opponent must be different profiles", { hostId, opponentId });

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      ...getKstFutureSchedule(scheduledOffsetHours),
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      refereeTrustMin: 70,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation reminder row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  let post = createResult?.post;
  assertFlow(post?.id === ids.postId, "created reminder post not returned", createResult);

  const opponentJoinResult = await step(`${ids.label}:interestRecruitingPost:opponent`, () => syncRecruitingAs(opponentLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamB",
      position: "PG",
    },
    joinMode: "player",
  }));
  post = await getRecruitingPostAfterResult(opponentJoinResult, opponentLogin, `${ids.label}:loadAfterJoin`);
  assertFlow(post?.applicants?.some((applicant) => applicant.playerId === opponentId && applicant.status === "ready"), "reminder opponent join not ready", post);

  const confirmResult = await step(`${ids.label}:confirmRecruitingMatch`, () => syncRecruitingAs(hostLogin, {
    action: "confirmRecruitingMatch",
    postId: ids.postId,
    preferredMatchId: ids.matchId,
  }));
  let match = confirmResult?.createdMatch;
  assertFlow(match?.id === ids.matchId, "reminder match not returned", confirmResult);

  const reminderChecks = {
    afterConfirm: await step(`${ids.label}:remindersAfterConfirm`, () => assertPendingMatchNotices(
      ids.matchId,
      MATCH_SCHEDULED_NOTICE_PREFIXES,
      { minNotifications: 1 },
    )),
  };

  const cancelResult = await step(`${ids.label}:cancelMatch`, () => syncMatchAs(hostLogin, {
    action: "cancelMatch",
    matchId: ids.matchId,
  }));
  match = await getMatchAfterResult(cancelResult, hostLogin, `${ids.label}:loadAfterCancelMatch`);
  assertFlow(match?.status === "cancelled", "reminder match not cancelled", match);
  reminderChecks.afterCancel = await step(`${ids.label}:remindersAfterCancel`, () => assertPendingMatchNotices(
    ids.matchId,
    MATCH_SCHEDULED_NOTICE_PREFIXES,
    { maxNotifications: 0 },
  ));

  return {
    label: ids.label,
    hostLogin,
    opponentLogin,
    hostId,
    opponentId,
    postId: ids.postId,
    matchId: ids.matchId,
    finalStatus: match.status,
    reminderChecks,
  };
}

async function runMatchReminderCleanupProbe({
  label,
  hostLogin,
  matchId,
}) {
  ids = makeScenarioIds(label);
  if (!supabase) {
    return { label: ids.label, skipped: true, reason: "service_role_key_missing" };
  }
  const targetMatchId = String(matchId || ids.matchId).trim();
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const checks = {};

  await step(`${ids.label}:seedScheduledNotices`, () => seedPendingMatchNotices(targetMatchId, hostId, MATCH_SCHEDULED_NOTICE_PREFIXES));
  checks.scheduledBeforeStart = await step(`${ids.label}:scheduledBeforeStart`, () => assertPendingMatchNotices(
    targetMatchId,
    MATCH_SCHEDULED_NOTICE_PREFIXES,
    { minNotifications: MATCH_SCHEDULED_NOTICE_PREFIXES.length },
  ));
  await step(`${ids.label}:cleanupStartMatch`, () => queueMatchDiscordDeliveries(supabase, { id: targetMatchId, status: "agreed" }, "startMatch"));
  checks.scheduledAfterStart = await step(`${ids.label}:scheduledAfterStart`, () => assertPendingMatchNotices(
    targetMatchId,
    MATCH_SCHEDULED_NOTICE_PREFIXES,
    { maxNotifications: 0 },
  ));

  await step(`${ids.label}:seedPostgameNotices`, () => seedPendingMatchNotices(targetMatchId, hostId, MATCH_POSTGAME_NOTICE_PREFIXES));
  checks.postgameBeforeApprove = await step(`${ids.label}:postgameBeforeApprove`, () => assertPendingMatchNotices(
    targetMatchId,
    MATCH_POSTGAME_NOTICE_PREFIXES,
    { minNotifications: MATCH_POSTGAME_NOTICE_PREFIXES.length },
  ));
  await step(`${ids.label}:cleanupApproveMatch`, () => queueMatchDiscordDeliveries(supabase, { id: targetMatchId, status: "confirmed" }, "approveMatch"));
  checks.postgameAfterApprove = await step(`${ids.label}:postgameAfterApprove`, () => assertPendingMatchNotices(
    targetMatchId,
    MATCH_POSTGAME_NOTICE_PREFIXES,
    { maxNotifications: 0 },
  ));

  await step(`${ids.label}:seedCancelNotices`, () => seedPendingMatchNotices(targetMatchId, hostId, MATCH_CANCEL_NOTICE_PREFIXES));
  checks.cancelBeforeVoid = await step(`${ids.label}:cancelBeforeVoid`, () => assertPendingMatchNotices(
    targetMatchId,
    MATCH_CANCEL_NOTICE_PREFIXES,
    { minNotifications: MATCH_CANCEL_NOTICE_PREFIXES.length },
  ));
  await step(`${ids.label}:cleanupVoidMatch`, () => queueMatchDiscordDeliveries(supabase, { id: targetMatchId, status: "void" }, "voidMatch"));
  checks.cancelAfterVoid = await step(`${ids.label}:cancelAfterVoid`, () => assertPendingMatchNotices(
    targetMatchId,
    MATCH_CANCEL_NOTICE_PREFIXES,
    { maxNotifications: 0 },
  ));

  return {
    label: ids.label,
    hostLogin,
    matchId: targetMatchId,
    startStaleCleared: checks.scheduledAfterStart.notifications.total === 0,
    approveStaleCleared: checks.postgameAfterApprove.notifications.total === 0,
    voidStaleCleared: checks.cancelAfterVoid.notifications.total === 0,
    checks,
  };
}

async function runRecruitingInviteAcceptScenario({
  label,
  hostLogin,
  inviteeLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const inviteeId = await step(`${ids.label}:resolveProfile:invitee`, () => getProfileIdForLogin(inviteeLogin));
  assertFlow(hostId !== inviteeId, "host and invitee must be different profiles", { hostId, inviteeId });

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "private",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  let post = createResult?.post;
  assertFlow(post?.id === ids.postId, "created invite post not returned", createResult);
  assertFlow(post.ownerId === hostId || post.playerId === hostId, "created invite post owner mismatch", { hostId, post });

  const inviteResult = await step(`${ids.label}:inviteRecruitingPlayers:invitee`, () => syncRecruitingAs(hostLogin, {
    action: "inviteRecruitingPlayers",
    postId: ids.postId,
    invite: {
      side: "teamB",
      reserve: false,
      joinMode: "player",
      playerIds: [inviteeId],
    },
  }));
  post = await getRecruitingPostAfterResult(inviteResult, hostLogin, `${ids.label}:loadAfterInvite`);
  assertStateIncludesUsers(inviteResult, [hostId, inviteeId], "invite mutation response missing feed users");
  const invitation = post?.roomState?.invitations?.find((item) => (
    item.targetUserId === inviteeId &&
    item.status === "pending" &&
    item.role !== "referee"
  ));
  assertFlow(Boolean(invitation), "player invitation not persisted", { inviteeId, post });

  const invitedBeforeAccept = await step(`${ids.label}:roomScope:invited:beforeAccept`, () => loadRecruitingScopeAs(inviteeLogin, "invited"));
  assertFlow(Boolean(invitedBeforeAccept.post), "invited room scope missing invited post before accept", {
    inviteeId,
    postId: ids.postId,
    page: invitedBeforeAccept.payload?.page,
  });
  assertStateIncludesUsers(invitedBeforeAccept.payload, [hostId, inviteeId], "invited room scope missing feed users before accept");
  const invitedPostBeforeAccept = invitedBeforeAccept.post?.__invitationsPartial
    ? await step(`${ids.label}:loadInvitedDetail:beforeAccept`, () => loadRecruitingPostAs(inviteeLogin, ids.postId))
    : invitedBeforeAccept.post;
  assertFlow(hasPendingInvitationFor(invitedPostBeforeAccept, inviteeId), "invited room scope post missing pending invitation before accept", {
    inviteeId,
    post: invitedPostBeforeAccept,
  });

  const acceptResult = await step(`${ids.label}:acceptRecruitingInvitation`, () => syncRecruitingAs(inviteeLogin, {
    action: "acceptRecruitingInvitation",
    postId: ids.postId,
    invitationId: invitation.id,
  }));
  post = await getRecruitingPostAfterResult(acceptResult, inviteeLogin, `${ids.label}:loadAfterAccept`);
  assertStateIncludesUsers(acceptResult, [hostId, inviteeId], "accept mutation response missing feed users");
  const applicant = post?.applicants?.find((item) => item.playerId === inviteeId);
  const pendingInvite = post?.roomState?.invitations?.find((item) => item.id === invitation.id && item.status === "pending");
  assertFlow(applicant?.status === "ready" && applicant.side === "teamB", "accepted invitee not ready on teamB", {
    inviteeId,
    applicant,
    post,
  });
  assertFlow(!pendingInvite, "accepted invitation still pending", { invitationId: invitation.id, post });

  const invitedAfterAccept = await step(`${ids.label}:roomScope:invited:afterAccept`, () => loadRecruitingScopeAs(inviteeLogin, "invited"));
  const invitedPostAfterAccept = invitedAfterAccept.post;
  assertFlow(!invitedPostAfterAccept || !hasPendingInvitationFor(invitedPostAfterAccept, inviteeId), "accepted invite still appears as pending in invited scope", {
    inviteeId,
    post: invitedPostAfterAccept,
    page: invitedAfterAccept.payload?.page,
  });

  const joinedAfterAccept = await step(`${ids.label}:roomScope:joined:afterAccept`, () => loadRecruitingScopeAs(inviteeLogin, "joined"));
  const joinedPostAfterAccept = joinedAfterAccept.post?.listCardOnly
    ? await step(`${ids.label}:loadJoinedDetail:afterAccept`, () => loadRecruitingPostAs(inviteeLogin, ids.postId))
    : joinedAfterAccept.post;
  const joinedApplicant = joinedPostAfterAccept?.applicants?.find((item) => item.playerId === inviteeId);
  assertStateIncludesUsers(joinedAfterAccept.payload, [hostId, inviteeId], "joined room scope missing feed users after accept");
  assertFlow(joinedApplicant?.status === "ready" && joinedApplicant.side === "teamB", "joined room scope missing accepted invitee after accept", {
    inviteeId,
    post: joinedPostAfterAccept,
    page: joinedAfterAccept.payload?.page,
  });

  const confirmResult = await step(`${ids.label}:confirmRecruitingMatch`, () => syncRecruitingAs(hostLogin, {
    action: "confirmRecruitingMatch",
    postId: ids.postId,
    preferredMatchId: ids.matchId,
  }));
  const match = confirmResult?.createdMatch;
  assertFlow(match?.id === ids.matchId, "invite match not returned", confirmResult);
  assertFlow(match.teamA?.players?.includes(hostId), "invite host missing from teamA", match);
  assertFlow(match.teamB?.players?.includes(inviteeId), "invitee missing from teamB", match);

  return {
    label: ids.label,
    hostLogin,
    inviteeLogin,
    hostId,
    inviteeId,
    postId: ids.postId,
    matchId: ids.matchId,
    inviteAccepted: true,
    matchCreated: true,
  };
}

async function runPublicTeamRegionFeedScenario({
  label,
  hostLogin,
  teammateLogin,
  teamId,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const teammateId = await step(`${ids.label}:resolveProfile:teammate`, () => getProfileIdForLogin(teammateLogin));
  assertFlow(hostId !== teammateId, "public team host and teammate must be different profiles", { hostId, teammateId });
  const resolvedTeamId = await step(`${ids.label}:resolveTeam`, () => resolveTeamIdForMembers(hostLogin, [hostId, teammateId], teamId));

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "team",
      mode: "2v2",
      sideCapacity: 2,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: true,
      refereeWanted: false,
      region: "마포",
      courtId: "c1",
      court: "Backend Simulation Court",
      teamId: resolvedTeamId,
      playerIds: [hostId, teammateId],
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  const createdPost = createResult?.post;
  assertFlow(createdPost?.id === ids.postId, "created public team post not returned", createResult);
  assertFlow(createdPost.visibility === "public" && createdPost.hostJoinMode === "team" && createdPost.teamId === resolvedTeamId, "public team post shape mismatch", createdPost);

  const regionResult = await step(`${ids.label}:regionFeed:mapo`, () => loadRecruitingRegionAs(hostLogin, {
    regionKey: "마포",
    startFilter: "instant",
  }));
  assertFlow(Boolean(regionResult.post), "public team post missing from Mapo region feed", {
    postId: ids.postId,
    page: regionResult.payload?.page,
  });
  assertFlow(regionResult.payload?.page?.feedCounts == null, "region feed unexpectedly loaded profile feed counts", {
    page: regionResult.payload?.page,
  });
  assertFlow((regionResult.payload?.state?.teams ?? []).some((team) => team.id === resolvedTeamId), "public team region feed missing host team attachment", {
    teamId: resolvedTeamId,
    teams: regionResult.payload?.state?.teams ?? [],
  });

  return {
    label: ids.label,
    hostLogin,
    teammateLogin,
    teamId: resolvedTeamId,
    hostId,
    teammateId,
    postId: ids.postId,
    publicRegionFeed: true,
  };
}

async function runDisputeResumeThumbsScenario({
  label,
  hostLogin,
  opponentLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const opponentId = await step(`${ids.label}:resolveProfile:opponent`, () => getProfileIdForLogin(opponentLogin));
  assertFlow(hostId !== opponentId, "host and opponent must be different profiles", { hostId, opponentId });

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  let post = createResult?.post;
  assertFlow(post?.id === ids.postId, "created dispute post not returned", createResult);

  const opponentJoinResult = await step(`${ids.label}:interestRecruitingPost:opponent`, () => syncRecruitingAs(opponentLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamB",
      position: "PG",
    },
    joinMode: "player",
  }));
  post = await getRecruitingPostAfterResult(opponentJoinResult, opponentLogin, `${ids.label}:loadAfterJoin`);
  assertFlow(post?.applicants?.some((applicant) => applicant.playerId === opponentId), "dispute opponent join not persisted", post);
  const readyResult = { skipped: true };
  assertFlow(post?.applicants?.some((applicant) => applicant.playerId === opponentId && applicant.status === "ready"), "dispute opponent ready not persisted", post);

  const confirmResult = await step(`${ids.label}:confirmRecruitingMatch`, () => syncRecruitingAs(hostLogin, {
    action: "confirmRecruitingMatch",
    postId: ids.postId,
    preferredMatchId: ids.matchId,
  }));
  let match = confirmResult?.createdMatch;
  assertFlow(match?.id === ids.matchId, "dispute match not returned", confirmResult);

  if (!match.agreements?.teamA?.includes(hostId)) {
    const agreeAResult = await step(`${ids.label}:agreeMatch:teamA`, () => syncMatchAs(hostLogin, {
      action: "agreeMatch",
      matchId: ids.matchId,
      sideName: "teamA",
      playerId: hostId,
    }, { match: withAgreement(match, "teamA", hostId) }));
    match = await getMatchAfterResult(agreeAResult, hostLogin, `${ids.label}:loadAfterAgreeTeamA`);
    assertFlow(match?.agreements?.teamA?.includes(hostId), "dispute teamA agreement not persisted", match);
  }

  if (!match.agreements?.teamB?.includes(opponentId)) {
    const agreeBResult = await step(`${ids.label}:agreeMatch:teamB`, () => syncMatchAs(opponentLogin, {
      action: "agreeMatch",
      matchId: ids.matchId,
      sideName: "teamB",
      playerId: opponentId,
    }, { match: withAgreement(match, "teamB", opponentId) }));
    match = await getMatchAfterResult(agreeBResult, opponentLogin, `${ids.label}:loadAfterAgreeTeamB`);
    assertFlow(match?.agreements?.teamB?.includes(opponentId), "dispute teamB agreement not persisted", match);
  }

  const checkInBResult = await step(`${ids.label}:checkInMatchPlayer:teamB`, () => syncMatchAs(hostLogin, {
    action: "checkInMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: opponentId,
  }, { match: withAttendance(match, "teamB", opponentId) }));
  match = await getMatchAfterResult(checkInBResult, hostLogin, `${ids.label}:loadAfterCheckInTeamB`);
  assertFlow(match?.attendance?.teamB?.includes(opponentId), "dispute teamB check-in not persisted", match);

  const startResult = await step(`${ids.label}:startMatch`, () => syncMatchAs(hostLogin, {
    action: "startMatch",
    matchId: ids.matchId,
  }, { match: withStartedMatch(match, hostId) }));
  match = await getMatchAfterResult(startResult, hostLogin, `${ids.label}:loadAfterStartMatch`);
  assertFlow(Boolean(match?.startedAt), "dispute match start not persisted", match);

  const endResult = await step(`${ids.label}:endMatch`, () => syncMatchAs(hostLogin, {
    action: "endMatch",
    matchId: ids.matchId,
  }, { match: withEndedMatch(match) }));
  match = await getMatchAfterResult(endResult, hostLogin, `${ids.label}:loadAfterEndMatch`);
  assertFlow(Boolean(match?.endedAt), "dispute match end not persisted", match);

  const resultSubmit = await step(`${ids.label}:submitMatchResult`, () => syncMatchAs(hostLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: makeResult(match),
  }));
  match = resultSubmit?.match;
  assertFlow(match?.status === "approval" && match?.result, "dispute result not persisted", match);

  const disputeResult = await step(`${ids.label}:disputeMatch`, () => syncMatchAs(opponentLogin, {
    action: "disputeMatch",
    matchId: ids.matchId,
    reason: "Backend simulation dispute",
  }));
  match = disputeResult?.match;
  assertFlow(match?.status === "disputed" && (match.disputes ?? []).some((item) => item.by === opponentId), "dispute not persisted", match);

  const disputeDraft = makeResult(match);
  disputeDraft.scoreA = 22;
  disputeDraft.scoreB = 14;
  const teamAPlayer = match.teamA?.players?.[0];
  const teamBPlayer = match.teamB?.players?.[0];
  disputeDraft.playerStats[teamAPlayer].points = 22;
  disputeDraft.playerStats[teamBPlayer].points = 14;
  const draftResult = await step(`${ids.label}:submitMatchResult:disputeDraft`, () => syncMatchAs(hostLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: disputeDraft,
  }));
  match = draftResult?.match;
  assertFlow(match?.status === "disputed" && match?.disputeDraftResult?.scoreA === 22 && match?.disputeDraftResult?.scoreB === 14, "dispute draft edit not persisted", match);

  const resumeResult = await step(`${ids.label}:resumeMatchApproval`, () => syncMatchAs(hostLogin, {
    action: "resumeMatchApproval",
    matchId: ids.matchId,
  }));
  match = resumeResult?.match;
  assertFlow(match?.status === "confirmed", "dispute resume did not confirm match", match);
  assertFlow(match?.result?.scoreA === 22 && match?.result?.scoreB === 14, "dispute draft result not committed", match);

  const opponentTrustBeforeThumbs = await step(`${ids.label}:loadTrustBeforeThumbs`, () => getCurrentProfileTrustScore(opponentLogin, opponentId));
  const thumbsResult = await step(`${ids.label}:submitMatchThumbs`, () => syncMatchAs(hostLogin, {
    action: "submitMatchThumbs",
    matchId: ids.matchId,
    targetUserIds: [opponentId],
  }));
  match = thumbsResult?.match;
  assertFlow((match?.trustFeedback?.stars?.[hostId] ?? []).includes(opponentId), "match thumbs not persisted", {
    hostId,
    opponentId,
    match,
  });
  assertFlow(
    opponentTrustBeforeThumbs >= 100 || thumbsResult?.trustCommitted === true,
    "match thumbs trust delta not committed",
    thumbsResult,
  );
  const opponentTrustAfterThumbs = await step(`${ids.label}:loadTrustAfterThumbs`, () => getCurrentProfileTrustScore(opponentLogin, opponentId));
  assertFlow(opponentTrustAfterThumbs === Math.min(100, opponentTrustBeforeThumbs + 1), "match thumbs trust score not persisted", {
    opponentTrustBeforeThumbs,
    opponentTrustAfterThumbs,
  });

  let clearThumbsResult = null;
  let opponentTrustAfterClear = opponentTrustAfterThumbs;
  if (opponentTrustBeforeThumbs < 100) {
    clearThumbsResult = await step(`${ids.label}:submitMatchThumbs:clear`, () => syncMatchAs(hostLogin, {
      action: "submitMatchThumbs",
      matchId: ids.matchId,
      targetUserIds: [],
    }));
    match = clearThumbsResult?.match;
    assertFlow((match?.trustFeedback?.stars?.[hostId] ?? []).length === 0, "match thumbs clear not persisted", {
      hostId,
      match,
    });
    assertFlow(clearThumbsResult?.trustCommitted === true, "match thumbs clear trust delta not committed", clearThumbsResult);
    opponentTrustAfterClear = await step(`${ids.label}:loadTrustAfterThumbsClear`, () => getCurrentProfileTrustScore(opponentLogin, opponentId));
    assertFlow(opponentTrustAfterClear === opponentTrustBeforeThumbs, "match thumbs clear trust score not restored", {
      opponentTrustBeforeThumbs,
      opponentTrustAfterClear,
    });
  }

  return {
    label: ids.label,
    hostLogin,
    opponentLogin,
    hostId,
    opponentId,
    postId: ids.postId,
    matchId: ids.matchId,
    finalStatus: match.status,
    disputed: true,
    thumbsSubmitted: true,
    thumbsCleared: Boolean(clearThumbsResult),
    trustScoreRoundTrip: {
      before: opponentTrustBeforeThumbs,
      afterThumbs: opponentTrustAfterThumbs,
      afterClear: opponentTrustAfterClear,
    },
    sqlReducers: {
      setRecruitingReady: Boolean(readyResult?.sqlReducer),
      checkInMatchPlayer: Boolean(checkInBResult?.sqlReducer),
      startMatch: Boolean(startResult?.sqlReducer),
      endMatch: Boolean(endResult?.sqlReducer),
    },
  };
}

async function runRecruitingActorScenario({
  label,
  hostLogin,
  opponentLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const opponentId = await step(`${ids.label}:resolveProfile:opponent`, () => getProfileIdForLogin(opponentLogin));
  assertFlow(hostId !== opponentId, "host and opponent must be different profiles", { hostId, opponentId });

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "player",
      mode: "2v2",
      sideCapacity: 2,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  let post = createResult?.post;
  assertFlow(post?.id === ids.postId, "created actor post not returned", createResult);
  assertFlow(post.ownerId === hostId || post.playerId === hostId, "created actor post owner mismatch", { hostId, post });

  const joinResult = await step(`${ids.label}:interestRecruitingPost:opponent`, () => syncRecruitingAs(opponentLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamB",
      position: "SG",
    },
    joinMode: "player",
  }));
  post = await getRecruitingPostAfterResult(joinResult, opponentLogin, `${ids.label}:loadAfterJoin`);
  let applicant = post?.applicants?.find((item) => item.playerId === opponentId);
  assertFlow(Boolean(applicant), "actor opponent join not persisted", { opponentId, post });
  assertFlow(applicant.position === "SG", "actor join position not persisted", { opponentId, applicant });

  const positionResult = await step(`${ids.label}:setRecruitingSlotPosition:opponent`, () => syncRecruitingAs(opponentLogin, {
    action: "setRecruitingSlotPosition",
    postId: ids.postId,
    playerId: opponentId,
    position: "SF",
  }));
  post = await getRecruitingPostAfterResult(positionResult, opponentLogin, `${ids.label}:loadAfterSlotPosition`);
  assertFlow(post?.roomState?.slotPositions?.[opponentId] === "SF", "actor slot position not persisted", { opponentId, post });
  const reloadedPostAfterPosition = await step(`${ids.label}:loadAfterPosition`, () => loadRecruitingPostAs(opponentLogin));
  const reloadedApplicantAfterPosition = reloadedPostAfterPosition?.applicants?.find((item) => item.playerId === opponentId);
  assertFlow(reloadedApplicantAfterPosition?.position === "SF", "actor application position column not persisted", {
    opponentId,
    reloadedApplicantAfterPosition,
  });

  const reserveResult = await step(`${ids.label}:setRecruitingApplicantPlacement:reserve`, () => syncRecruitingAs(opponentLogin, {
    action: "setRecruitingApplicantPlacement",
    postId: ids.postId,
    playerId: opponentId,
    placement: {
      side: "teamB",
      reserve: true,
    },
  }));
  post = await getRecruitingPostAfterResult(reserveResult, opponentLogin, `${ids.label}:loadAfterReservePlacement`);
  applicant = post?.applicants?.find((item) => item.playerId === opponentId);
  assertFlow(applicant?.reserve === true, "actor reserve placement not persisted", { opponentId, applicant, post });

  const activeResult = await step(`${ids.label}:setRecruitingApplicantPlacement:active`, () => syncRecruitingAs(opponentLogin, {
    action: "setRecruitingApplicantPlacement",
    postId: ids.postId,
    playerId: opponentId,
    placement: {
      side: "teamB",
      reserve: false,
    },
  }));
  post = await getRecruitingPostAfterResult(activeResult, opponentLogin, `${ids.label}:loadAfterActivePlacement`);
  applicant = post?.applicants?.find((item) => item.playerId === opponentId);
  assertFlow(applicant?.reserve === false, "actor active placement not persisted", { opponentId, applicant, post });
  assertFlow(post?.roomState?.slotPositions?.[opponentId] === "SF", "actor position lost after placement", { opponentId, post });

  return {
    label: ids.label,
    hostLogin,
    opponentLogin,
    hostId,
    opponentId,
    postId: ids.postId,
    position: post.roomState.slotPositions[opponentId],
    reserve: applicant.reserve,
    sqlReducers: {
      interestRecruitingPost: Boolean(joinResult?.sqlReducer),
      setRecruitingSlotPosition: Boolean(positionResult?.sqlReducer),
      reservePlacement: Boolean(reserveResult?.sqlReducer),
      activePlacement: Boolean(activeResult?.sqlReducer),
    },
  };
}

async function runRecorderHandoffScenario({
  label,
  hostLogin,
  teamAReserveLogin,
  teamBActiveLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const teamAReserveId = await step(`${ids.label}:resolveProfile:teamAReserve`, () => getProfileIdForLogin(teamAReserveLogin));
  const teamBActiveId = await step(`${ids.label}:resolveProfile:teamBActive`, () => getProfileIdForLogin(teamBActiveLogin));
  assertFlow(
    new Set([hostId, teamAReserveId, teamBActiveId]).size === 3,
    "recorder handoff profiles must be unique",
    { hostId, teamAReserveId, teamBActiveId },
  );

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  let post = createResult?.post;
  assertFlow(post?.id === ids.postId, "created recorder handoff post not returned", createResult);

  const joinTeamAReserveResult = await step(`${ids.label}:interestRecruitingPost:teamAReserve`, () => syncRecruitingAs(teamAReserveLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamA",
      reserve: true,
      position: "SF",
    },
    joinMode: "player",
  }));
  post = await getRecruitingPostAfterResult(joinTeamAReserveResult, teamAReserveLogin, `${ids.label}:loadAfterTeamAReserve`);
  assertFlow(post?.applicants?.some((applicant) => applicant.playerId === teamAReserveId && applicant.side === "teamA" && applicant.reserve === true), "teamA reserve join not persisted", post);

  const joinTeamBActiveResult = await step(`${ids.label}:interestRecruitingPost:teamBActive`, () => syncRecruitingAs(teamBActiveLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamB",
      position: "PG",
    },
    joinMode: "player",
  }));
  post = await getRecruitingPostAfterResult(joinTeamBActiveResult, teamBActiveLogin, `${ids.label}:loadAfterTeamBActive`);
  assertFlow(post?.applicants?.some((applicant) => applicant.playerId === teamBActiveId && applicant.side === "teamB" && applicant.reserve === false), "teamB active join not persisted", post);

  const confirmResult = await step(`${ids.label}:confirmRecruitingMatch`, () => syncRecruitingAs(hostLogin, {
    action: "confirmRecruitingMatch",
    postId: ids.postId,
    preferredMatchId: ids.matchId,
  }));
  let match = confirmResult?.createdMatch;
  assertFlow(match?.id === ids.matchId, "recorder handoff match not returned", confirmResult);
  match = withEffectiveMatchStatRecorders(match);
  assertFlow((match.teamA?.players ?? []).includes(hostId), "teamA active roster mismatch", match);
  assertFlow((match.teamB?.players ?? []).includes(teamBActiveId), "teamB active roster mismatch", match);
  assertFlow((match.reservePlayers?.teamA ?? []).includes(teamAReserveId), "teamA reserve not persisted", match);
  assertFlow(match.statRecorders?.teamA === teamAReserveId, "teamA reserve recorder not assigned", match);

  if (!match.agreements?.teamA?.includes(hostId)) {
    const agreeAResult = await step(`${ids.label}:agreeMatch:teamA`, () => syncMatchAs(hostLogin, {
      action: "agreeMatch",
      matchId: ids.matchId,
      sideName: "teamA",
      playerId: hostId,
    }, { match: withAgreement(match, "teamA", hostId) }));
    match = await getMatchAfterResult(agreeAResult, hostLogin, `${ids.label}:loadAfterAgreeTeamA`);
  }

  if (!match.agreements?.teamB?.includes(teamBActiveId)) {
    const agreeBResult = await step(`${ids.label}:agreeMatch:teamB`, () => syncMatchAs(teamBActiveLogin, {
      action: "agreeMatch",
      matchId: ids.matchId,
      sideName: "teamB",
      playerId: teamBActiveId,
    }, { match: withAgreement(match, "teamB", teamBActiveId) }));
    match = await getMatchAfterResult(agreeBResult, teamBActiveLogin, `${ids.label}:loadAfterAgreeTeamB`);
  }

  const checkInBResult = await step(`${ids.label}:checkInMatchPlayer:teamB`, () => syncMatchAs(hostLogin, {
    action: "checkInMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: teamBActiveId,
  }, { match: withAttendance(match, "teamB", teamBActiveId) }));
  match = await getMatchAfterResult(checkInBResult, hostLogin, `${ids.label}:loadAfterCheckInTeamB`);
  assertFlow((match.attendance?.teamB ?? []).includes(teamBActiveId), "recorder handoff teamB check-in not persisted", match);

  const startedMatchDraft = withStartedMatch(match, hostId);
  assertFlow(Boolean(startedMatchDraft.startedAt), "recorder handoff started draft missing", startedMatchDraft);
  const startResult = await step(`${ids.label}:syncStartedSnapshot`, () => syncMatchAs(hostLogin, {
    action: "sync",
    matchId: ids.matchId,
  }, { match: startedMatchDraft }));
  match = await getMatchAfterResult(startResult, hostLogin, `${ids.label}:loadAfterStartMatch`);
  assertFlow(Boolean(match?.startedAt), "recorder handoff match start not persisted", match);

  const handoffDraft = withRecorderHandoff(match, "teamA", teamAReserveId, hostId);
  assertFlow(handoffDraft.valid && handoffDraft.patch?.swapped, "recorder handoff draft not valid", handoffDraft);
  const handoffResult = await step(`${ids.label}:handoffMatchRecorder`, () => syncMatchAs(teamAReserveLogin, {
    action: "handoffMatchRecorder",
    matchId: ids.matchId,
    sideName: "teamA",
    nextRecorderId: hostId,
  }, { match: handoffDraft.match }));
  match = await getMatchAfterResult(handoffResult, teamAReserveLogin, `${ids.label}:loadAfterRecorderHandoff`);
  assertFlow(match?.statRecorders?.teamA === hostId && match?.rules?.statRecorders?.teamA === hostId, "recorder handoff not persisted", match);
  assertFlow((match.teamA?.players ?? []).includes(teamAReserveId) && !(match.teamA?.players ?? []).includes(hostId), "recorder handoff did not swap active player", match);
  assertFlow((match.reservePlayers?.teamA ?? []).includes(hostId) && !(match.reservePlayers?.teamA ?? []).includes(teamAReserveId), "recorder handoff reserve roster mismatch", match);
  assertFlow((match.playedPlayerIds?.teamA ?? []).includes(hostId) && (match.playedPlayerIds?.teamA ?? []).includes(teamAReserveId), "recorder handoff played ids missing", match);
  assertFlow(Boolean(handoffResult?.sqlReducer), "recorder handoff SQL reducer not used", handoffResult);

  const substituteDraft = withSubstitution(match, "teamA", teamAReserveId, hostId);
  assertFlow(substituteDraft.valid && substituteDraft.patch?.swapped, "substitution draft not valid", substituteDraft);
  const substituteResult = await step(`${ids.label}:substituteMatchPlayer`, () => syncMatchAs(hostLogin, {
    action: "substituteMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamA",
    activePlayerId: teamAReserveId,
    reservePlayerId: hostId,
  }, { match: substituteDraft.match }));
  match = await getMatchAfterResult(substituteResult, hostLogin, `${ids.label}:loadAfterSubstitution`);
  assertFlow(Boolean(substituteResult?.sqlReducer), "substitution SQL reducer not used", substituteResult);
  assertFlow(match?.statRecorders?.teamA === hostId && match?.rules?.statRecorders?.teamA === hostId, "substitution changed recorder unexpectedly", match);
  assertFlow((match.teamA?.players ?? []).includes(hostId) && !(match.teamA?.players ?? []).includes(teamAReserveId), "substitution did not promote reserve", match);
  assertFlow((match.reservePlayers?.teamA ?? []).includes(teamAReserveId) && !(match.reservePlayers?.teamA ?? []).includes(hostId), "substitution reserve roster mismatch", match);
  assertFlow((match.playedPlayerIds?.teamA ?? []).includes(hostId) && (match.playedPlayerIds?.teamA ?? []).includes(teamAReserveId), "substitution played ids missing", match);

  return {
    label: ids.label,
    hostLogin,
    recorderLogin: teamAReserveLogin,
    nextRecorderLogin: hostLogin,
    postId: ids.postId,
    matchId: ids.matchId,
    recorderBefore: teamAReserveId,
    recorderAfter: match.statRecorders.teamA,
    swapped: true,
    sqlReducers: {
      teamAReserveJoin: Boolean(joinTeamAReserveResult?.sqlReducer),
      teamBActiveJoin: Boolean(joinTeamBActiveResult?.sqlReducer),
      checkInMatchPlayer: Boolean(checkInBResult?.sqlReducer),
      syncStartedSnapshot: Boolean(startResult?.ok),
      handoffMatchRecorder: Boolean(handoffResult?.sqlReducer),
      substituteMatchPlayer: Boolean(substituteResult?.sqlReducer),
    },
  };
}

async function runDiscordRoomChatBridgeScenario({
  label,
  hostLogin,
}) {
  ids = makeScenarioIds(label);
  if (!supabase) {
    return { label: ids.label, skipped: true, reason: "service_role_key_missing" };
  }

  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const discordUserId = makeDiscordSnowflake(301);
  const discordChannelId = makeDiscordSnowflake(302);
  const discordThreadId = makeDiscordSnowflake(303);
  const discordMessageId = makeDiscordSnowflake(304);
  const botMessageId = makeDiscordSnowflake(305);

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation Discord room chat row. Safe to close.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  const post = createResult?.post;
  assertFlow(post?.id === ids.postId, "created discord room chat post not returned", createResult);

  await step(`${ids.label}:setTemporaryDiscordUser`, () => setTemporaryProfileDiscordUser(hostId, discordUserId, "rankball-sim-chat"));

  const { data: link, error: linkError } = await supabase
    .from("room_discord_links")
    .insert({
      room_type: "recruiting",
      room_id: ids.postId,
      discord_channel_id: discordChannelId,
      discord_thread_id: discordThreadId,
      enabled: true,
      created_by: hostId,
      updated_at: new Date().toISOString(),
    })
    .select("id,room_type,room_id,discord_channel_id,discord_thread_id,enabled")
    .single();
  if (linkError) throw linkError;
  assertFlow(link?.room_id === ids.postId && link.discord_thread_id === discordThreadId, "discord room link insert failed", link);

  const bridgePayload = {
    messageId: discordMessageId,
    channelId: discordThreadId,
    discordUserId,
    username: "rankball-sim-chat",
    body: "discord bridge ping",
  };
  const bridgeResult = await step(`${ids.label}:discordRoomChatBridge`, () => syncDiscordRoomChatBridge(bridgePayload));
  assertFlow(bridgeResult?.ok && bridgeResult?.roomId === ids.postId, "discord bridge message not accepted", bridgeResult);
  assertFlow(bridgeResult?.message?.userId === hostId && bridgeResult.message.body === bridgePayload.body, "discord bridge message payload mismatch", bridgeResult);

  const duplicateResult = await step(`${ids.label}:discordRoomChatBridge:duplicate`, () => syncDiscordRoomChatBridge(bridgePayload));
  assertFlow(duplicateResult?.ok && duplicateResult?.duplicate === true, "discord bridge duplicate not detected", duplicateResult);

  const botResult = await step(`${ids.label}:discordRoomChatBridge:botSkip`, () => syncDiscordRoomChatBridge({
    ...bridgePayload,
    messageId: botMessageId,
    body: "discord bot echo",
    authorBot: true,
  }));
  assertFlow(botResult?.ok && botResult?.skipped === "bot_or_webhook_message", "discord bridge bot echo not skipped", botResult);

  const loadedPost = await loadRecruitingPostAs(hostLogin, ids.postId);
  const chatMessages = loadedPost?.roomState?.chatMessages ?? [];
  assertFlow(chatMessages.some((message) => message.id === bridgeResult.message.id && message.userId === hostId && message.body === bridgePayload.body), "discord bridge chat not visible in room detail", chatMessages);
  assertFlow(!chatMessages.some((message) => message.body === "discord bot echo"), "discord bridge bot echo persisted", chatMessages);

  return {
    label: ids.label,
    hostLogin,
    postId: ids.postId,
    discordThreadNormalized: true,
    duplicateBlocked: true,
    botEchoSkipped: true,
    messageId: bridgeResult.message.id,
  };
}

async function runRefereeExamServerScenario({
  label,
  login,
}) {
  ids = makeScenarioIds(label);
  const profileId = await step(`${ids.label}:resolveProfile`, () => getProfileIdForLogin(login));
  const attemptId = `sim_rea_${ids.label}_${suffix}`;
  const secondAttemptId = `sim_rea_${ids.label}_cooldown_${suffix}`;
  const requestId = `sim_rr_${ids.label}_${suffix}`;
  refereeSimulationAttemptIds.add(attemptId);
  refereeSimulationRequestIds.add(requestId);

  const startResult = await step(`${ids.label}:startExam`, () => syncRefereeAs(login, {
    action: "startExam",
    attempt: { id: attemptId },
  }));
  const attempt = startResult?.attempt ?? {};
  assertFlow(startResult?.ok && startResult.attemptId === attemptId, "referee exam start failed", startResult);
  assertFlow(attempt.userId === profileId && attempt.status === "started", "referee exam start payload mismatch", attempt);
  assertFlow(Array.isArray(attempt.questionIds) && attempt.questionIds.length === attempt.total, "referee exam question ids missing", attempt);
  assertFlow((attempt.questions ?? []).length === attempt.total, "referee exam public questions missing", attempt);
  assertFlow((attempt.questions ?? []).every((question) => question.answerIndex === undefined && question.explanation === undefined), "referee exam leaked answer data", attempt.questions);

  const duplicateStart = await step(`${ids.label}:startExamDuplicate`, () => syncRefereeAs(login, {
    action: "startExam",
    attempt: { id: attemptId },
  }));
  assertFlow(duplicateStart?.duplicate === true && duplicateStart?.attempt?.id === attemptId, "referee exam duplicate start mismatch", duplicateStart);

  const answerKey = getRefereeExamAnswerKey(attempt.questionIds);
  const finishResult = await step(`${ids.label}:finishExam`, () => syncRefereeAs(login, {
    action: "finishExam",
    attempt: {
      id: attemptId,
      answers: answerKey,
      result: { passed: false, score: 0, total: 0 },
    },
  }));
  assertFlow(finishResult?.ok && finishResult?.result?.passed === true, "referee exam server grading failed", finishResult);
  assertFlow(finishResult.result.score >= attempt.passScore, "referee exam pass score mismatch", finishResult.result);
  assertFlow(finishResult.attempt?.passed === true && finishResult.attempt?.score === finishResult.result.score, "referee exam finish payload mismatch", finishResult);

  const requestResult = await step(`${ids.label}:submitRefereeRequest`, () => syncRefereeAs(login, {
    action: "submitRequest",
    request: {
      id: requestId,
      qualification: "community_exam",
      examAttemptId: attemptId,
      examVersion: attempt.examVersion,
      experience: "Backend simulation referee exam flow.",
      memo: "Backend simulation row.",
    },
    notifications: [],
  }));
  assertFlow(requestResult?.ok && requestResult?.requestId === requestId, "referee request submit failed", requestResult);

  const cooldownResult = await expectRejected(
    `${ids.label}:startExamCooldownBlocked`,
    () => syncRefereeAs(login, {
      action: "startExam",
      attempt: { id: secondAttemptId },
    }),
    ["referee_exam_cooldown_active"],
  );

  return {
    label: ids.label,
    login,
    profileId,
    attemptId,
    requestId,
    publicQuestionsOnly: true,
    serverGraded: true,
    requestAccepted: true,
    cooldownBlocked: cooldownResult.rejected,
    score: finishResult.result.score,
    total: finishResult.result.total,
  };
}

async function runSoloRoomTeamBlockedScenario({
  label,
  hostLogin,
  teamLogin,
  teamId,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const teamActorId = await step(`${ids.label}:resolveProfile:teamActor`, () => getProfileIdForLogin(teamLogin));
  assertFlow(hostId !== teamActorId, "host and team actor must be different profiles", { hostId, teamActorId });
  const resolvedTeamId = await step(`${ids.label}:resolveTeam`, () => resolveTeamIdForMembers(teamLogin, [teamActorId], teamId));

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  const createdPost = createResult?.post;
  assertFlow(createdPost?.id === ids.postId, "created solo block post not returned", createResult);

  const rejection = await expectRejected(
    `${ids.label}:interestRecruitingPost:teamBlocked`,
    () => syncRecruitingAs(teamLogin, {
      action: "interestRecruitingPost",
      postId: ids.postId,
      application: {
        joinMode: "team",
        teamId: resolvedTeamId,
        side: "teamB",
        playerIds: [teamActorId],
        position: "PG",
      },
      joinMode: "team",
    }),
    ["solo_room_team_party_not_allowed", "recruiting_operation_blocked", "recruiting_sync_permission_denied", "recruiting_operation_noop"],
  );

  const post = await step(`${ids.label}:loadAfterReject`, () => loadRecruitingPostAs(hostLogin));
  const applications = post?.applicants ?? [];
  assertFlow(Boolean(post), "solo block post missing after rejection", post);
  assertFlow(!applications.some((application) => application.teamId || application.kind === "team"), "blocked team application persisted", {
    applications,
    post,
  });
  assertFlow(!applications.some((application) => application.playerId === teamActorId), "blocked team actor persisted as applicant", {
    teamActorId,
    applications,
  });

  return {
    label: ids.label,
    hostLogin,
    teamLogin,
    teamId: resolvedTeamId,
    hostId,
    teamActorId,
    postId: ids.postId,
    rejected: rejection.rejected,
  };
}

async function runIneligibleRefereeBlockedScenario({
  label,
  hostLogin,
  refereeLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const refereeCandidateId = await step(`${ids.label}:resolveProfile:refereeCandidate`, () => getProfileIdForLogin(refereeLogin));
  assertFlow(hostId !== refereeCandidateId, "host and referee candidate must be different profiles", { hostId, refereeCandidateId });

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "public",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: true,
      refereeTrustMin: 70,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  const createdPost = createResult?.post;
  assertFlow(createdPost?.id === ids.postId, "created referee block post not returned", createResult);

  const rejection = await expectRejected(
    `${ids.label}:interestRecruitingPost:refereeBlocked`,
    () => syncRecruitingAs(refereeLogin, {
      action: "interestRecruitingPost",
      postId: ids.postId,
      application: {
        joinMode: "referee",
      },
      joinMode: "referee",
    }),
    ["referee_not_eligible", "recruiting_operation_blocked", "recruiting_sync_permission_denied", "recruiting_operation_noop"],
  );

  const post = await step(`${ids.label}:loadAfterReject`, () => loadRecruitingPostAs(hostLogin));
  assertFlow(Boolean(post), "referee block post missing after rejection", post);
  assertFlow(post.refereeId !== refereeCandidateId, "ineligible referee persisted", {
    refereeCandidateId,
    post,
  });

  return {
    label: ids.label,
    hostLogin,
    refereeLogin,
    hostId,
    refereeCandidateId,
    postId: ids.postId,
    rejected: rejection.rejected,
  };
}

async function runBulkHomeInviteAcceptScenario({
  label,
  hostLogin,
  teamId,
  overflow = false,
}) {
  ids = makeScenarioIds(label);
  const teamInviteLogins = ["rankball-001", "rankball-002"];
  const teamAActiveLogins = overflow
    ? ["rankball-021", "rankball-022", "rankball-023", "rankball-024", "rankball-025", "rankball-026", "rankball-027", "rankball-028", "rankball-029", "rankball-030"]
    : ["rankball-021", "rankball-022", "rankball-023", "rankball-024"];
  const teamBActiveLogins = overflow
    ? ["rankball-039", "rankball-040", "rankball-041", "rankball-042", "rankball-043", "rankball-044", "rankball-045", "rankball-046"]
    : ["rankball-025", "rankball-026", "rankball-027"];
  const teamAReserveLogins = overflow ? [] : ["rankball-028", "rankball-029"];
  const teamBReserveLogins = overflow ? [] : ["rankball-030", "rankball-031"];
  const allInviteeLogins = [
    ...teamInviteLogins,
    ...teamAActiveLogins,
    ...teamBActiveLogins,
    ...teamAReserveLogins,
    ...teamBReserveLogins,
  ];
  assertFlow(allInviteeLogins.length === (overflow ? 20 : 13), "bulk invite scenario target count mismatch", allInviteeLogins);

  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const inviteeIdsByLogin = {};
  for (const login of allInviteeLogins) {
    inviteeIdsByLogin[login] = await step(`${ids.label}:resolveProfile:${login}`, () => getProfileIdForLogin(login));
  }
  const allInviteeIds = Object.values(inviteeIdsByLogin);
  assertFlow(new Set([hostId, ...allInviteeIds]).size === allInviteeIds.length + 1, "bulk invite profiles must be unique", {
    hostId,
    inviteeIdsByLogin,
  });

  const teamInviteIds = teamInviteLogins.map((login) => inviteeIdsByLogin[login]);
  const resolvedTeamId = await step(`${ids.label}:resolveInviteTeam`, () => resolveTeamIdForMembers(teamInviteLogins[0], teamInviteIds, teamId));

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: `Backend simulation ${ids.label}`,
      visibility: "private",
      hostJoinMode: "player",
      mode: "5v5",
      sideCapacity: 5,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: "c1",
      court: "Backend Simulation Court",
      position: "C",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  let post = createResult?.post;
  assertFlow(post?.id === ids.postId && (post.ownerId === hostId || post.playerId === hostId), "bulk invite post create mismatch", {
    hostId,
    post,
  });

  const inviteBTeamResult = await step(`${ids.label}:inviteTeamB:teamParty`, () => syncRecruitingAs(hostLogin, {
    action: "inviteRecruitingPlayers",
    postId: ids.postId,
    invite: {
      side: "teamB",
      reserve: false,
      joinMode: "team",
      teamId: resolvedTeamId,
      playerIds: teamInviteIds,
    },
  }));
  assertStateIncludesUsers(inviteBTeamResult, [hostId, ...teamInviteIds], "bulk team invite response missing users");

  const inviteAActiveIds = teamAActiveLogins.map((login) => inviteeIdsByLogin[login]);
  await step(`${ids.label}:inviteTeamA:activePlayers`, () => syncRecruitingAs(hostLogin, {
    action: "inviteRecruitingPlayers",
    postId: ids.postId,
    invite: {
      side: "teamA",
      reserve: false,
      joinMode: "player",
      playerIds: inviteAActiveIds,
    },
  }));

  const inviteBActiveIds = teamBActiveLogins.map((login) => inviteeIdsByLogin[login]);
  await step(`${ids.label}:inviteTeamB:activePlayers`, () => syncRecruitingAs(hostLogin, {
    action: "inviteRecruitingPlayers",
    postId: ids.postId,
    invite: {
      side: "teamB",
      reserve: false,
      joinMode: "player",
      playerIds: inviteBActiveIds,
    },
  }));

  const inviteAReserveIds = teamAReserveLogins.map((login) => inviteeIdsByLogin[login]);
  if (inviteAReserveIds.length) {
    await step(`${ids.label}:inviteTeamA:reservePlayers`, () => syncRecruitingAs(hostLogin, {
      action: "inviteRecruitingPlayers",
      postId: ids.postId,
      invite: {
        side: "teamA",
        reserve: true,
        joinMode: "player",
        playerIds: inviteAReserveIds,
      },
    }));
  }

  const inviteBReserveIds = teamBReserveLogins.map((login) => inviteeIdsByLogin[login]);
  if (inviteBReserveIds.length) {
    await step(`${ids.label}:inviteTeamB:reservePlayers`, () => syncRecruitingAs(hostLogin, {
      action: "inviteRecruitingPlayers",
      postId: ids.postId,
      invite: {
        side: "teamB",
        reserve: true,
        joinMode: "player",
        playerIds: inviteBReserveIds,
      },
    }));
  }

  post = await step(`${ids.label}:loadAfterBulkInvites`, () => loadRecruitingPostAs(hostLogin));
  const pendingTargetIds = new Set((post.roomState?.invitations ?? [])
    .filter((invitation) => String(invitation.status ?? "pending") === "pending")
    .map((invitation) => invitation.targetUserId));
  assertFlow(allInviteeIds.every((profileId) => pendingTargetIds.has(profileId)), "bulk pending invitations missing", {
    expected: allInviteeIds,
    actual: [...pendingTargetIds],
  });

  for (const login of allInviteeLogins) {
    const profileId = inviteeIdsByLogin[login];
    const homeState = await step(`${ids.label}:homeLoadBeforeAccept:${login}`, () => loadHomeAs(login));
    const { post: homePost, invitation } = findPendingHomeInvitation(homeState, profileId, ids.postId);
    assertFlow(Boolean(homePost && invitation?.id), "home action queue missing pending invite", {
      login,
      profileId,
      postId: ids.postId,
      homePostIds: (homeState.recruitingPosts ?? []).map((item) => item.id),
    });
    const acceptResult = await step(`${ids.label}:homeAcceptInvite:${login}`, () => syncRecruitingAs(login, {
      action: "acceptRecruitingInvitation",
      postId: ids.postId,
      invitationId: invitation.id,
    }));
    assertStateIncludesUsers(acceptResult, [hostId, profileId], "bulk home accept response missing users");
    const afterHomeState = await step(`${ids.label}:homeLoadAfterAccept:${login}`, () => loadHomeAs(login));
    const afterInvitation = findPendingHomeInvitation(afterHomeState, profileId, ids.postId).invitation;
    assertFlow(!afterInvitation, "accepted invite still appears in home action queue", {
      login,
      profileId,
      invitationId: invitation.id,
    });
  }

  post = await step(`${ids.label}:loadAfterAllHomeAccepts`, () => loadRecruitingPostAs(hostLogin));
  const expectedPlacements = overflow
    ? [
        ...teamInviteIds.map((profileId) => ({ profileId, side: "teamB", reserve: false, kind: "team" })),
        ...inviteAActiveIds.slice(0, 4).map((profileId) => ({ profileId, side: "teamA", reserve: false, kind: "player" })),
        ...inviteAActiveIds.slice(4, 6).map((profileId) => ({ profileId, side: "teamA", reserve: true, kind: "player" })),
        ...inviteBActiveIds.slice(0, 3).map((profileId) => ({ profileId, side: "teamB", reserve: false, kind: "player" })),
        ...inviteBActiveIds.slice(3, 5).map((profileId) => ({ profileId, side: "teamB", reserve: true, kind: "player" })),
      ]
    : [
        ...teamInviteIds.map((profileId) => ({ profileId, side: "teamB", reserve: false, kind: "team" })),
        ...inviteAActiveIds.map((profileId) => ({ profileId, side: "teamA", reserve: false, kind: "player" })),
        ...inviteBActiveIds.map((profileId) => ({ profileId, side: "teamB", reserve: false, kind: "player" })),
        ...inviteAReserveIds.map((profileId) => ({ profileId, side: "teamA", reserve: true, kind: "player" })),
        ...inviteBReserveIds.map((profileId) => ({ profileId, side: "teamB", reserve: true, kind: "player" })),
      ];
  const expiredIds = overflow ? [...inviteAActiveIds.slice(6), ...inviteBActiveIds.slice(5)] : [];
  for (const expected of expectedPlacements) {
    const placement = getRecruitingPlacement(post, expected.profileId);
    assertFlow(
      placement?.side === expected.side &&
        placement?.reserve === expected.reserve &&
        (expected.kind !== "team" || placement?.teamId === resolvedTeamId),
      "bulk invite accepted placement mismatch",
      { expected, placement, postId: ids.postId },
    );
  }
  for (const expiredId of expiredIds) {
    const placement = getRecruitingPlacement(post, expiredId);
    const expiredInvitation = (post.roomState?.invitations ?? []).find((invitation) => (
      invitation.targetUserId === expiredId &&
      invitation.status === "expired"
    ));
    assertFlow(!placement && expiredInvitation, "bulk overflow invite entered room or did not expire", {
      expiredId,
      placement,
      invitations: post.roomState?.invitations ?? [],
    });
  }

  const activeAIds = uniqueIds([hostId, ...expectedPlacements.filter((item) => item.side === "teamA" && !item.reserve).map((item) => item.profileId)]);
  const activeBIds = uniqueIds(expectedPlacements.filter((item) => item.side === "teamB" && !item.reserve).map((item) => item.profileId));
  const reserveIds = uniqueIds(expectedPlacements.filter((item) => item.reserve).map((item) => item.profileId));
  assertFlow(activeAIds.length === 5 && activeBIds.length === 5 && reserveIds.length === 4, "bulk 5v5 active/reserve count mismatch", {
    activeAIds,
    activeBIds,
    reserveIds,
  });

  return {
    label: ids.label,
    hostLogin,
    hostId,
    postId: ids.postId,
    invited: allInviteeIds.length,
    activeA: activeAIds.length,
    activeB: activeBIds.length,
    reserves: reserveIds.length,
    expired: expiredIds.length,
    teamInviteId: resolvedTeamId,
  };
}

async function runSoloRecordScenario({
  label,
  hostLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const today = new Date().toISOString().slice(0, 10);

  const createResult = await step(`${ids.label}:createSoloRecord`, () => syncMatchAs(hostLogin, {
    action: "createMatch",
    preferredMatchId: ids.matchId,
    draft: {
      id: ids.matchId,
      recordType: "solo",
      title: `Backend simulation ${ids.label}`,
      courtId: "c1",
      court: "Backend Simulation Court",
      scheduledDate: today,
      scheduledTime: "20:30",
      soloOpponentName: "Solo Opponent",
      soloScoreFor: 17,
      soloScoreAgainst: 11,
      soloStats: {
        rebounds: 5,
        assists: 3,
        steals: 2,
        blocks: 1,
        fouls: 1,
      },
    },
  }));
  const match = await getMatchAfterResult(createResult, hostLogin, `${ids.label}:loadAfterCreateSoloRecord`);
  const anonymousIds = Object.keys(match?.anonymousPlayers ?? {});
  const opponentId = anonymousIds[0] ?? "";
  const excludedIds = new Set([...(match?.mmrExcludedPlayerIds ?? []), ...(match?.rules?.mmrExcludedPlayerIds ?? [])]);
  const stats = match?.result?.playerStats?.[hostId] ?? {};

  assertFlow(match?.id === ids.matchId, "solo record id mismatch", match);
  assertFlow(match?.status === "confirmed", "solo record not confirmed", match);
  assertFlow(match?.rules?.recordType === "solo", "solo record type missing", match);
  assertFlow(match?.ranked === false && Number(match?.ratingScale ?? 0) === 0, "solo record rating not disabled", match);
  assertFlow((match?.ratingResult ?? []).length === 0, "solo record rating result should be empty", match);
  assertFlow((match?.teamA?.players ?? []).includes(hostId), "solo record host missing", { hostId, match });
  assertFlow(!(match?.teamB?.players ?? []).length, "solo record should not store real opponent", match);
  assertFlow(Boolean(opponentId) && (match?.playedPlayerIds?.teamB ?? []).includes(opponentId), "solo record anonymous opponent missing", match);
  assertFlow(excludedIds.has(hostId) && excludedIds.has(opponentId), "solo record MMR exclusions missing", {
    hostId,
    opponentId,
    mmrExcludedPlayerIds: match?.mmrExcludedPlayerIds,
    rules: match?.rules,
  });
  assertFlow(match?.result?.scoreA === 17 && match?.result?.scoreB === 11, "solo record score not persisted", match?.result);
  assertFlow(stats.points === 17 && stats.rebounds === 5 && stats.assists === 3 && stats.steals === 2 && stats.blocks === 1 && stats.fouls === 1, "solo record stats not persisted", stats);

  return {
    label: ids.label,
    hostLogin,
    hostId,
    matchId: ids.matchId,
    opponentId,
    score: `${match.result.scoreA}:${match.result.scoreB}`,
    mmrExcluded: true,
  };
}

function getTeamCaptainId(team = {}) {
  return (team.members ?? []).find((member) => member.role === "captain")?.userId
    || team.members?.[0]?.userId
    || "";
}

async function resolveTournamentTeamFixtures(login, preferredTeamIds = []) {
  if (supabase) {
    let { data: teamRows, error: teamError } = await supabase
      .from("teams")
      .select("id,name,home_court,region,mmr,wins,losses,accent,created_at,updated_at")
      .in("id", preferredTeamIds)
      .is("deleted_at", null);
    if (teamError) throw teamError;
    if ((teamRows ?? []).length < preferredTeamIds.length) {
      const fallback = await supabase
        .from("teams")
        .select("id,name,home_court,region,mmr,wins,losses,accent,created_at,updated_at")
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .limit(12);
      if (fallback.error) throw fallback.error;
      const byId = new Map([...(teamRows ?? []), ...(fallback.data ?? [])].map((team) => [team.id, team]));
      teamRows = [...byId.values()].slice(0, Math.max(4, preferredTeamIds.length));
    }
    const teamIds = (teamRows ?? []).map((team) => team.id).filter(Boolean);
    const { data: memberRows, error: memberError } = teamIds.length
      ? await supabase
          .from("team_members")
          .select("team_id,user_id,role")
          .in("team_id", teamIds)
      : { data: [], error: null };
    if (memberError) throw memberError;
    const profileIds = uniqueIds((memberRows ?? []).map((member) => member.user_id));
    const { data: profileRows, error: profileError } = profileIds.length
      ? await supabase
          .from("profiles")
          .select("id,test_login_id")
          .in("id", profileIds)
      : { data: [], error: null };
    if (profileError) throw profileError;
    for (const profile of profileRows ?? []) {
      if (profile.id && profile.test_login_id) testLoginsByProfileId.set(profile.id, String(profile.test_login_id).toLowerCase());
    }
    const membersByTeam = new Map();
    for (const member of memberRows ?? []) {
      const rows = membersByTeam.get(member.team_id) ?? [];
      rows.push({ userId: member.user_id, role: member.role ?? "regular" });
      membersByTeam.set(member.team_id, rows);
    }
    const fixtures = (teamRows ?? [])
      .map((team) => ({
        team: {
          id: team.id,
          name: team.name,
          members: [...(membersByTeam.get(team.id) ?? [])]
            .sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.userId).localeCompare(String(b.userId))),
        },
      }))
      .map((fixture) => {
        const captainId = getTeamCaptainId(fixture.team);
        const captainLogin = captainId ? testLoginsByProfileId.get(captainId) || getSeededLoginForProfileId(captainId) : "";
        return { ...fixture, captainId, captainLogin };
      })
      .filter((fixture) => fixture.team.members.length && fixture.captainId && fixture.captainLogin)
      .slice(0, 4);
    assertFlow(fixtures.length >= 4, "tournament DB fixture teams missing", {
      preferredTeamIds,
      foundTeamIds: (teamRows ?? []).map((team) => team.id),
      fixtureTeamIds: fixtures.map((fixture) => fixture.team.id),
    });
    assertFlow(new Set(fixtures.map((item) => item.captainId)).size === fixtures.length, "tournament captains must be unique", fixtures);
    return fixtures;
  }

  const state = await loadTeamsAs(login);
  const teamsById = new Map((state.teams ?? []).map((team) => [team.id, team]));
  const teams = preferredTeamIds.map((teamId) => teamsById.get(teamId)).filter(Boolean);
  assertFlow(teams.length === preferredTeamIds.length, "tournament fixture teams missing", {
    preferredTeamIds,
    foundTeamIds: teams.map((team) => team.id),
  });
  const fixtures = teams.map((team) => {
    const captainId = getTeamCaptainId(team);
    const captainLogin = getSeededLoginForProfileId(captainId);
    assertFlow(Boolean(captainId && captainLogin), "tournament team captain login missing", {
      teamId: team.id,
      captainId,
    });
    return { team, captainId, captainLogin };
  });
  assertFlow(new Set(fixtures.map((item) => item.captainId)).size === fixtures.length, "tournament captains must be unique", fixtures);
  return fixtures;
}

async function loadTournamentRow(tournamentId = "") {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const { data, error } = await supabase
    .from("tournaments")
    .select("id,status,match_ids,bracket")
    .eq("id", tournamentId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function playTournamentMatchToConfirmed({ label, matchId, operatorLogin }) {
  let match = await step(`${label}:loadMatch`, () => loadMatchAs(operatorLogin, matchId));
  const teamAPlayerId = match.teamA?.players?.[0] ?? "";
  const teamBPlayerId = match.teamB?.players?.[0] ?? "";
  const teamALogin = await getTestLoginForProfileId(teamAPlayerId);
  const teamBLogin = await getTestLoginForProfileId(teamBPlayerId);
  const operatorId = await getProfileIdForLogin(operatorLogin);
  assertFlow(Boolean(teamAPlayerId && teamBPlayerId && teamALogin && teamBLogin), "tournament match player login missing", {
    matchId,
    teamAPlayerId,
    teamBPlayerId,
  });

  const endedMatch = withEndedMatch(withStartedMatch(match, teamAPlayerId));
  const submittedAt = new Date().toISOString();
  const result = {
    ...makeResult(endedMatch),
    statSubmissions: {
      [teamAPlayerId]: { by: operatorId, side: "teamA", source: "host_postgame", submittedAt },
      [teamBPlayerId]: { by: operatorId, side: "teamB", source: "host_postgame", submittedAt },
    },
    submittedBy: operatorId,
    submittedAt,
    updatedAt: submittedAt,
  };
  const resultDraft = {
    ...endedMatch,
    status: "approval",
    teamA: { ...endedMatch.teamA, score: result.scoreA },
    teamB: { ...endedMatch.teamB, score: result.scoreB },
    approvals: { teamA: [], teamB: [] },
    result,
  };

  const resultSubmit = await step(`${label}:submitMatchResult`, () => syncMatchAs(operatorLogin, {
    action: "submitMatchResult",
    matchId,
    result,
  }, { match: resultDraft }));
  match = resultSubmit?.match;
  assertFlow(match?.status === "approval" && match?.result, "tournament match result not persisted", match);

  const approveAResult = await step(`${label}:approveMatch:teamA`, () => syncMatchAs(teamALogin, {
    action: "approveMatch",
    matchId,
    sideName: "teamA",
    playerId: teamAPlayerId,
  }));
  match = approveAResult?.match;
  assertFlow(match?.approvals?.teamA?.includes(teamAPlayerId), "tournament teamA approval not persisted", match);

  const approveBResult = await step(`${label}:approveMatch:teamB`, () => syncMatchAs(teamBLogin, {
    action: "approveMatch",
    matchId,
    sideName: "teamB",
    playerId: teamBPlayerId,
  }));
  match = approveBResult?.match;
  assertFlow(match?.status === "confirmed", "tournament match not confirmed", match);

  return { match, result: approveBResult, teamAPlayerId, teamBPlayerId };
}

async function runTournamentFollowupRoundScenario({
  label,
  creatorLogin,
  teamIds = ["team-rb-01", "team-rb-02", "team-rb-03", "team-rb-04"],
}) {
  ids = makeScenarioIds(label);
  const fixtures = await step(`${ids.label}:resolveTournamentTeams`, () => resolveTournamentTeamFixtures(creatorLogin, teamIds));
  const effectiveCreatorLogin = fixtures[0]?.captainLogin || creatorLogin;
  const selectedTeamIds = fixtures.map((fixture) => fixture.team.id);
  const creatorId = await step(`${ids.label}:resolveProfile:creator`, () => getProfileIdForLogin(effectiveCreatorLogin));
  assertFlow(fixtures[0]?.captainId === creatorId, "tournament creator must captain first team", {
    creatorId,
    firstTeamCaptainId: fixtures[0]?.captainId,
    selectedTeamIds,
  });

  const firstRoundMatchIds = [`${ids.matchId}_r1_1`, `${ids.matchId}_r1_2`];
  ids.matchIds = firstRoundMatchIds;
  const startDate = getKstFutureSchedule(72).scheduledDate;
  const createResult = await step(`${ids.label}:createTournament`, () => syncTournamentAs(effectiveCreatorLogin, {
    action: "createTournament",
    preferredTournamentId: ids.tournamentId,
    preferredMatchIds: firstRoundMatchIds,
    draft: {
      id: ids.tournamentId,
      title: `Backend simulation ${ids.label}`,
      tournamentFormat: "tournament",
      teamIds: selectedTeamIds,
      mode: "1v1",
      ranked: false,
      official: false,
      scheduledDate: startDate,
      tournamentEndDate: startDate,
      courtId: "c1",
      court: "Backend Simulation Court",
      region: "Backend Simulation",
      mmrLimitMode: "warn",
      targetScore: 21,
      timeLimit: 12,
      winByTwo: true,
      memo: "Backend simulation tournament row. Safe to close.",
    },
  }));
  assertFlow(createResult?.ok && createResult?.tournamentId === ids.tournamentId, "tournament create failed", createResult);
  assertFlow(Number(createResult?.createdMatchCount ?? 0) === 0, "tournament should wait for invited teams", createResult);

  let finalApproveResult = null;
  for (const fixture of fixtures.slice(1)) {
    finalApproveResult = await step(`${ids.label}:approveTournamentTeam:${fixture.team.id}`, () => syncTournamentAs(fixture.captainLogin, {
      action: "approveTournamentTeam",
      tournamentId: ids.tournamentId,
      teamId: fixture.team.id,
      preferredMatchIds: firstRoundMatchIds,
    }));
  }
  assertFlow(Number(finalApproveResult?.createdMatchCount ?? 0) === firstRoundMatchIds.length, "tournament first round was not generated", finalApproveResult);

  const firstRoundMatches = [];
  for (const matchId of firstRoundMatchIds) {
    const match = await step(`${ids.label}:loadFirstRound:${matchId}`, () => loadMatchAs(effectiveCreatorLogin, matchId));
    assertFlow(match?.tournamentId === ids.tournamentId && Number(match?.tournamentRound) === 1, "first round match metadata mismatch", match);
    firstRoundMatches.push(match);
  }

  const firstConfirmed = await playTournamentMatchToConfirmed({
    label: `${ids.label}:round1fixture1`,
    matchId: firstRoundMatches[0].id,
    operatorLogin: effectiveCreatorLogin,
  });
  assertFlow(Number(firstConfirmed.result?.createdTournamentMatchCount ?? 0) === 0, "follow-up should wait for both source winners", firstConfirmed.result);

  const secondConfirmed = await playTournamentMatchToConfirmed({
    label: `${ids.label}:round1fixture2`,
    matchId: firstRoundMatches[1].id,
    operatorLogin: effectiveCreatorLogin,
  });
  assertFlow(Number(secondConfirmed.result?.createdTournamentMatchCount ?? 0) === 1, "follow-up match not generated after both source winners", secondConfirmed.result);

  const finalMatch = (secondConfirmed.result?.state?.matches ?? []).find((match) => (
    match.tournamentId === ids.tournamentId &&
    Number(match.tournamentRound) === 2 &&
    Number(match.tournamentFixture) === 1
  ));
  assertFlow(Boolean(finalMatch?.id), "follow-up final match missing from response state", secondConfirmed.result?.state);
  ids.matchIds = uniqueIds([...ids.matchIds, finalMatch.id]);

  const persistedFinal = await step(`${ids.label}:loadFollowupFinal`, () => loadMatchAs(effectiveCreatorLogin, finalMatch.id));
  assertFlow(
    persistedFinal?.tournamentId === ids.tournamentId &&
      Number(persistedFinal?.tournamentRound) === 2 &&
      Number(persistedFinal?.tournamentFixture) === 1,
    "persisted follow-up final metadata mismatch",
    persistedFinal,
  );

  const responseTournament = secondConfirmed.result?.state?.tournaments?.find((tournament) => tournament.id === ids.tournamentId);
  assertFlow(responseTournament?.matchIds?.includes(finalMatch.id), "response tournament missing follow-up match id", responseTournament);
  const dbTournament = await step(`${ids.label}:loadTournamentRow`, () => loadTournamentRow(ids.tournamentId));
  if (dbTournament && !dbTournament.skipped) {
    assertFlow((dbTournament.match_ids ?? []).includes(finalMatch.id), "DB tournament missing follow-up match id", dbTournament);
  }

  return {
    label: ids.label,
    creatorLogin: effectiveCreatorLogin,
    tournamentId: ids.tournamentId,
    teamIds: selectedTeamIds,
    firstRoundMatchIds,
    followupMatchId: finalMatch.id,
    tournamentSynced: Boolean(secondConfirmed.result?.tournamentSynced),
    createdTournamentMatchCount: Number(secondConfirmed.result?.createdTournamentMatchCount ?? 0),
  };
}

async function main() {
  const schemaHealth = await assertRemoteSchemaHealth();
  const basicHostLogin = process.env.RANKBALL_SIM_HOST || "rankball-010";
  const basicOpponentLogin = process.env.RANKBALL_SIM_OPPONENT || "rankball-011";
  const refereeHostLogin = process.env.RANKBALL_SIM_REF_HOST || "rankball-012";
  const refereeOpponentLogin = process.env.RANKBALL_SIM_REF_OPPONENT || "rankball-013";
  const refereeLogin = process.env.RANKBALL_SIM_REFEREE || "rankball-001";
  const actorHostLogin = process.env.RANKBALL_SIM_ACTOR_HOST || "rankball-014";
  const actorOpponentLogin = process.env.RANKBALL_SIM_ACTOR_OPPONENT || "rankball-015";
  const recorderHandoffHostLogin = process.env.RANKBALL_SIM_RECORDER_HANDOFF_HOST || "rankball-032";
  const recorderHandoffTeamAReserveLogin = process.env.RANKBALL_SIM_RECORDER_HANDOFF_TEAM_A_RESERVE || "rankball-034";
  const recorderHandoffTeamBActiveLogin = process.env.RANKBALL_SIM_RECORDER_HANDOFF_TEAM_B_ACTIVE || "rankball-036";
  const discordChatHostLogin = process.env.RANKBALL_SIM_DISCORD_CHAT_HOST || "rankball-033";
  const refereeExamLogin = process.env.RANKBALL_SIM_REFEREE_EXAM_LOGIN || "rankball-034";
  const tournamentCreatorLogin = process.env.RANKBALL_SIM_TOURNAMENT_CREATOR || "rankball-001";
  const teamBlockedHostLogin = process.env.RANKBALL_SIM_SOLO_BLOCK_HOST || "rankball-014";
  const teamBlockedLogin = process.env.RANKBALL_SIM_SOLO_BLOCK_TEAM_LOGIN || "rankball-001";
  const teamBlockedTeamId = process.env.RANKBALL_SIM_SOLO_BLOCK_TEAM_ID || "t1";
  const refereeBlockedHostLogin = process.env.RANKBALL_SIM_REF_BLOCK_HOST || "rankball-014";
  const refereeBlockedLogin = process.env.RANKBALL_SIM_REF_BLOCK_CANDIDATE || "rankball-015";
  const inviteHostLogin = process.env.RANKBALL_SIM_INVITE_HOST || "rankball-016";
  const inviteeLogin = process.env.RANKBALL_SIM_INVITEE || "rankball-015";
  const publicTeamHostLogin = process.env.RANKBALL_SIM_PUBLIC_TEAM_HOST || "rankball-001";
  const publicTeamTeammateLogin = process.env.RANKBALL_SIM_PUBLIC_TEAM_TEAMMATE || "rankball-002";
  const publicTeamId = process.env.RANKBALL_SIM_PUBLIC_TEAM_ID || "t1";
  const bulkInviteHostLogin = process.env.RANKBALL_SIM_BULK_INVITE_HOST || "rankball-020";
  const bulkInviteTeamId = process.env.RANKBALL_SIM_BULK_INVITE_TEAM_ID || "t1";
  const disputeHostLogin = process.env.RANKBALL_SIM_DISPUTE_HOST || "rankball-010";
  const disputeOpponentLogin = process.env.RANKBALL_SIM_DISPUTE_OPPONENT || "rankball-011";
  const soloRecordLogin = process.env.RANKBALL_SIM_SOLO_RECORD_HOST || "rankball-010";
  const mmrCommitHostLogin = process.env.RANKBALL_SIM_MMR_COMMIT_HOST || "rankball-021";
  const mmrCommitOpponentLogin = process.env.RANKBALL_SIM_MMR_COMMIT_OPPONENT || "rankball-022";

  const scenarios = [];
  scenarios.push(await runSoloRecordScenario({
    label: "solo_record",
    hostLogin: soloRecordLogin,
  }));
  scenarios.push(await runRecruitingInviteAcceptScenario({
    label: "private_player_invite_accept",
    hostLogin: inviteHostLogin,
    inviteeLogin,
  }));
  scenarios.push(await runRecruitingInviteAcceptScenario({
    label: "private_player_invite_accept_reverse",
    hostLogin: inviteeLogin,
    inviteeLogin: inviteHostLogin,
  }));
  scenarios.push(await runPublicTeamRegionFeedScenario({
    label: "public_team_region_feed",
    hostLogin: publicTeamHostLogin,
    teammateLogin: publicTeamTeammateLogin,
    teamId: publicTeamId,
  }));
  scenarios.push(await runBulkHomeInviteAcceptScenario({
    label: "bulk_home_invite_accept_5v5",
    hostLogin: bulkInviteHostLogin,
    teamId: bulkInviteTeamId,
  }));
  if (!remoteSmokeOnly) {
    scenarios.push(await runBulkHomeInviteAcceptScenario({
      label: "bulk_home_invite_overflow_5v5",
      hostLogin: bulkInviteHostLogin,
      teamId: bulkInviteTeamId,
      overflow: true,
    }));
    scenarios.push(await runRecruitingActorScenario({
      label: "recruiting_actor_join_position",
      hostLogin: actorHostLogin,
      opponentLogin: actorOpponentLogin,
    }));
    scenarios.push(await runRecorderHandoffScenario({
      label: "recorder_handoff_1v1",
      hostLogin: recorderHandoffHostLogin,
      teamAReserveLogin: recorderHandoffTeamAReserveLogin,
      teamBActiveLogin: recorderHandoffTeamBActiveLogin,
    }));
    scenarios.push(await runDiscordRoomChatBridgeScenario({
      label: "discord_room_chat_bridge",
      hostLogin: discordChatHostLogin,
    }));
    scenarios.push(await runRefereeExamServerScenario({
      label: "referee_exam_server",
      login: refereeExamLogin,
    }));
    scenarios.push(await runTournamentFollowupRoundScenario({
      label: "tournament_followup_round",
      creatorLogin: tournamentCreatorLogin,
    }));
    scenarios.push(await runOneOnOneScenario({
      label: "ranked_mmr_commit_1v1",
      hostLogin: mmrCommitHostLogin,
      opponentLogin: mmrCommitOpponentLogin,
      ranked: true,
      includeLatePlayer: false,
      verifyRatingCommit: true,
    }));
    scenarios.push(await runSoloRoomTeamBlockedScenario({
      label: "solo_1v1_team_join_blocked",
      hostLogin: teamBlockedHostLogin,
      teamLogin: teamBlockedLogin,
      teamId: teamBlockedTeamId,
    }));
    scenarios.push(await runIneligibleRefereeBlockedScenario({
      label: "ineligible_referee_join_blocked",
      hostLogin: refereeBlockedHostLogin,
      refereeLogin: refereeBlockedLogin,
    }));
  }
  const matchReminderCancelScenario = await runMatchReminderCancelScenario({
    label: "match_reminder_cancel",
    hostLogin: basicHostLogin,
    opponentLogin: basicOpponentLogin,
  });
  scenarios.push(matchReminderCancelScenario);
  scenarios.push(await runMatchReminderCleanupProbe({
    label: "match_reminder_cleanup_probe",
    hostLogin: basicHostLogin,
    matchId: matchReminderCancelScenario.matchId,
  }));
  scenarios.push(await runOneOnOneScenario({
    label: "basic_1v1_no_referee",
    hostLogin: basicHostLogin,
    opponentLogin: basicOpponentLogin,
  }));
  if (!remoteSmokeOnly) {
    scenarios.push(await runDisputeResumeThumbsScenario({
      label: "dispute_resume_thumbs",
      hostLogin: disputeHostLogin,
      opponentLogin: disputeOpponentLogin,
    }));
    scenarios.push(await runOneOnOneScenario({
      label: "referee_1v1",
      hostLogin: refereeHostLogin,
      opponentLogin: refereeOpponentLogin,
      refereeLogin,
      refereeWanted: true,
    }));
  }

  console.log(JSON.stringify({
    ok: true,
    mode: remoteSmokeOnly ? "remote_smoke" : "full",
    scenarios,
    schemaHealth: schemaHealth?.skipped ? "skipped" : "ok",
    maintenance: remoteSmokeOnly
      ? { skipped: true, reason: "remote_smoke" }
      : await runSystemMaintenanceProbe(),
    cleanup: await cleanup(),
  }, null, 2));
}

try {
  await main();
} catch (error) {
  const failure = {
    ok: false,
    postId: ids.postId,
    matchId: ids.matchId,
    step: currentStep,
    error: error.message,
  };
  console.error(JSON.stringify({ ...failure, cleanup: "pending" }, null, 2));
  const cleanupResult = await withTimeout(cleanup(), "cleanup").catch((cleanupError) => ({ failed: cleanupError.message }));
  console.error(JSON.stringify({ ...failure, cleanup: cleanupResult }, null, 2));
  process.exit(1);
}
