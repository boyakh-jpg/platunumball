import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import homeLoadHandler from "../server/api/home/load.js";
import notificationListHandler from "../server/api/notifications/list.js";
import syncRecruitingPostHandler from "../server/api/recruiting/sync-post.js";
import recruitingListHandler from "../server/api/recruiting/list.js";
import discordRoomChatHandler from "../server/api/discord/room-chat.js";
import discordSyncDeliveriesHandler from "../server/api/discord/sync-deliveries.js";
import settingsSyncHandler from "../server/api/settings/sync.js";
import syncMatchHandler, { getDiscordProfiles, persistMatchSnapshot, queueMatchDiscordDeliveries } from "../server/api/matches/sync-match.js";
import matchClockHandler from "../server/api/matches/clock.js";
import matchDetailHandler from "../server/api/matches/detail.js";
import matchesListHandler from "../server/api/matches/list.js";
import syncTournamentHandler from "../server/api/tournaments/sync-tournament.js";
import refereeSyncHandler from "../server/api/referee/sync.js";
import teamsListHandler from "../server/api/teams/list.js";
import syncTeamHandler from "../server/api/teams/sync-team.js";
import profileMeHandler from "../server/api/profile/me.js";
import profileUpsertHandler from "../server/api/profile/upsert.js";
import directoryLoadHandler from "../server/api/directory/load.js";
import submitReportHandler from "../server/api/reports/submit.js";
import submitCourtRequestHandler from "../server/api/court-requests/submit.js";
import approveCourtRequestHandler from "../server/api/court-requests/approve.js";
import reportCourtRequestHandler from "../server/api/court-requests/report.js";
import adminAppointmentActionHandler from "../server/api/admin/appointment-action.js";
import adminDisciplinaryActionHandler from "../server/api/admin/disciplinary-action.js";
import adminReviewActionHandler from "../server/api/admin/review-action.js";
import teamEmblemHandler, { deleteObject as deleteTeamEmblemObject, getR2Config as getTeamEmblemR2Config } from "../server/api/teams/emblem.js";
import schemaHealthHandler from "../server/api/system/schema-health.js";
import maintenanceHandler from "../server/api/system/maintenance.js";
import { gradeRefereeExamByQuestionIds } from "../src/lib/refereeExamBank.js";
import { DAY_MS, DISPUTE_WINDOW_MINUTES, HOUR_MS, MINUTE_MS, REFEREE_TRUST_MIN } from "../src/lib/constants.js";
import {
  CURRENT_MATCH_SCHEDULED_NOTICE_PREFIXES,
  MATCH_CANCEL_NOTICE_PREFIXES,
  MATCH_POSTGAME_NOTICE_PREFIXES,
  MATCH_SCHEDULED_NOTICE_PREFIXES,
} from "../src/lib/notifications.js";
import {
  getMatchRoomPhase,
  getMatchReservePlayerIds,
  getTournamentMatchDisplayTitle,
  isMatchRecordMatch,
  isTournamentMatchInUserSchedule,
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

const PRODUCTION_SUPABASE_PROJECT_REF = "olzxextphxpniwiiwwda";
const PRODUCTION_API_HOSTS = new Set(["boxtier.kr", "www.boxtier.kr"]);
const MAX_SIMULATION_REPEAT_COUNT = 1;
const MAX_SIMULATION_RETRY_COUNT = 1;

function readCliValue(name) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const matches = process.argv.slice(2).filter((arg) => arg === exact || arg.startsWith(prefix));
  if (matches.length > 1) throw new Error(`duplicate --${name} option`);
  if (matches.length === 0) return undefined;
  if (matches[0] === exact) throw new Error(`--${name} requires a value`);
  const value = matches[0].slice(prefix.length).trim();
  if (!value) throw new Error(`--${name} requires a value`);
  return value;
}

function normalizeProjectRef(value, label) {
  const projectRef = String(value || "").trim().toLowerCase();
  if (!projectRef) return "";
  if (!/^[a-z0-9]+$/.test(projectRef)) throw new Error(`${label} is invalid`);
  return projectRef;
}

function parseTargetUrl(value, label) {
  if (!value) return { hostname: "", isLocal: false, projectRef: "" };
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${label} protocol is invalid`);
  const hostname = parsed.hostname.toLowerCase();
  const projectRefMatch = hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  return {
    hostname,
    isLocal: hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]" || hostname.endsWith(".localhost"),
    projectRef: projectRefMatch?.[1] || "",
  };
}

function parseBoundedInteger(cliName, envName, fallback, maximum) {
  const rawValue = readCliValue(cliName) ?? process.env[envName];
  if (rawValue === undefined || rawValue === "") return fallback;
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${cliName} must be a non-negative integer`);
  if (value > maximum) throw new Error(`${cliName} exceeds hard limit ${maximum}`);
  return value;
}

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
const requestTimeoutMs = Number(process.env.RANKBALL_SIM_TIMEOUT_MS || (usesRemoteApi ? MINUTE_MS : 20_000));
const cleanupTimeoutMs = Number(process.env.RANKBALL_SIM_CLEANUP_TIMEOUT_MS || Math.max(requestTimeoutMs * 6, 120000));
const ensureRemoteTestActors = process.env.RANKBALL_SIM_ENSURE_TEST_ACTORS === "1" || process.env.RANKBALL_SIM_ENSURE_TEST_ACTORS === "true";
const fullSimulation = process.argv.includes("--full") || process.env.RANKBALL_SIM_FULL === "1" || process.env.RANKBALL_SIM_FULL === "true";
const recordPermissionsOnly = process.argv.includes("--record-permissions-only");
const matchRecordOnly = process.argv.includes("--match-record-only");
const mmrOnly = process.argv.includes("--mmr-only");
const tournamentByeOnly = process.argv.includes("--tournament-bye-only");
const tournamentLeagueOnly = process.argv.includes("--tournament-league-only");
const operationalGuardsOnly = process.argv.includes("--operational-guards-only");
const teamEmblemOnly = process.argv.includes("--team-emblem-only");
const tailOnly = process.argv.includes("--tail-only");
const remoteSmokeOnly = usesRemoteApi && !fullSimulation;
const safetyCheckOnly = process.argv.includes("--safety-check-only");

function getSimulationMode() {
  return tournamentByeOnly ? "tournament_bye"
    : tournamentLeagueOnly ? "tournament_league"
      : operationalGuardsOnly ? "operational_guards"
        : teamEmblemOnly ? "team_emblem"
          : mmrOnly ? "mmr"
            : tailOnly ? "tail"
              : recordPermissionsOnly ? "record_permissions"
                : fullSimulation ? "full"
                  : usesRemoteApi ? "remote_smoke"
                    : "local_smoke";
}

function resolveSimulationSafety() {
  const directTarget = parseTargetUrl(url, "Supabase URL");
  const apiTarget = parseTargetUrl(remoteBaseUrl, "remote API base URL");
  const declaredProjectRef = normalizeProjectRef(process.env.SUPABASE_PROJECT_ID, "SUPABASE_PROJECT_ID");
  const declaredRemoteProjectRef = normalizeProjectRef(
    readCliValue("remote-project-ref") ?? process.env.RANKBALL_SIM_REMOTE_PROJECT_REF,
    "remote project ref",
  );
  const urlProjectRef = directTarget.projectRef;
  if (urlProjectRef && declaredProjectRef && urlProjectRef !== declaredProjectRef) {
    throw new Error("SUPABASE_PROJECT_ID does not match the Supabase URL project ref");
  }

  const directProjectRef = urlProjectRef || declaredProjectRef;
  const productionApi = PRODUCTION_API_HOSTS.has(apiTarget.hostname);
  if (usesRemoteApi && !apiTarget.isLocal && !productionApi && !declaredRemoteProjectRef) {
    throw new Error("remote API project ref is required for an unrecognized API host");
  }
  const apiProjectRef = usesRemoteApi
    ? declaredRemoteProjectRef || (productionApi ? PRODUCTION_SUPABASE_PROJECT_REF : "")
    : directProjectRef;
  if (usesRemoteApi && directProjectRef && apiProjectRef && directProjectRef !== apiProjectRef) {
    throw new Error("remote API project ref does not match the direct Supabase project ref");
  }

  const productionTarget = directProjectRef === PRODUCTION_SUPABASE_PROJECT_REF
    || apiProjectRef === PRODUCTION_SUPABASE_PROJECT_REF
    || productionApi;
  const localTarget = directTarget.isLocal && (!usesRemoteApi || apiTarget.isLocal);
  const testTarget = !productionTarget
    && !localTarget
    && Boolean(directProjectRef)
    && (!usesRemoteApi || apiProjectRef === directProjectRef);
  const environment = productionTarget ? "production" : localTarget ? "local" : testTarget ? "test" : "unknown";
  const productionProjectRef = apiProjectRef === PRODUCTION_SUPABASE_PROJECT_REF
    ? apiProjectRef
    : directProjectRef === PRODUCTION_SUPABASE_PROJECT_REF
      ? directProjectRef
      : PRODUCTION_SUPABASE_PROJECT_REF;
  const repeatCount = parseBoundedInteger("repeat", "RANKBALL_SIM_REPEAT", 1, MAX_SIMULATION_REPEAT_COUNT);
  const maxRetries = parseBoundedInteger("max-retries", "RANKBALL_SIM_MAX_RETRIES", 1, MAX_SIMULATION_RETRY_COUNT);
  if (repeatCount !== 1) throw new Error("repeat must be exactly 1");
  const confirmedProductionRef = normalizeProjectRef(readCliValue("confirm-production"), "production confirmation ref");

  return {
    environment,
    directProjectRef,
    apiHost: usesRemoteApi ? apiTarget.hostname : "in-process",
    apiProjectRef,
    productionProjectRef,
    repeatCount,
    maxRetries,
    confirmedProductionRef,
  };
}

let simulationSafety;
try {
  simulationSafety = resolveSimulationSafety();
  console.error(`[rankball-sim-target] ${JSON.stringify({
    environment: simulationSafety.environment,
    directSupabaseRef: simulationSafety.directProjectRef || "unknown",
    apiHost: simulationSafety.apiHost,
    apiProjectRef: simulationSafety.apiProjectRef || "unknown",
    mode: getSimulationMode(),
    repeatCount: simulationSafety.repeatCount,
    cleanupRetryLimit: simulationSafety.maxRetries,
  })}`);
  if (simulationSafety.environment === "unknown") {
    throw new Error("simulation target is unknown; configure a Supabase project ref and remote project ref");
  }
  if (
    simulationSafety.environment === "production"
    && simulationSafety.confirmedProductionRef !== simulationSafety.productionProjectRef
  ) {
    throw new Error(`production simulation requires --confirm-production=${simulationSafety.productionProjectRef}`);
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, stage: "target_guard", error: error.message }, null, 2));
  process.exit(1);
}

if (safetyCheckOnly) process.exit(0);

if (!url || !publishableKey || !serviceRoleKey) {
  const missing = [
    url ? "" : "SUPABASE_URL/VITE_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL",
    publishableKey ? "" : "VITE_SUPABASE_PUBLISHABLE_KEY/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_ANON_KEY",
    serviceRoleKey ? "" : "SUPABASE_SERVICE_ROLE_KEY",
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
const simulationNotificationIds = new Set();
const simulationDiscordDeliveryIds = new Set();
const teamInvitationSimulationIds = new Set();
const teamSimulationIds = new Set();
const courtRequestSimulationIds = new Set();
let simulationCourtId = "";

async function resolveSimulationCourtId() {
  const { data, error } = await supabase
    .from("approved_courts")
    .select("id")
    .or("status.is.null,status.eq.active")
    .is("hidden_at", null)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("simulation court missing");
  simulationCourtId = data.id;
  return simulationCourtId;
}
const approvedCourtSimulationIds = new Set();
const adminAppointmentSimulationIds = new Set();
const adminDisciplinarySimulationIds = new Set();
const adminAuditSimulationIds = new Set();
const temporaryProfileDiscordSnapshots = new Map();
const temporaryProfileIdentitySnapshots = new Map();
const reportSimulationIds = new Set();
const teamEmblemSimulationKeys = new Set();
const refereeSimulationAttemptIds = new Set();
const refereeSimulationRequestIds = new Set();
const profileRatingSnapshots = new Map();
const teamRatingSnapshots = new Map();
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

function getSimulationDisplayTitle(label = "") {
  const scenario = String(label).toLowerCase();
  if (scenario.includes("tournament_representative")) return "테스트 리그";
  if (scenario.includes("tournament")) return "테스트 토너먼트";
  if (scenario.includes("recruiting") || scenario.includes("invite")) return "테스트 매칭방";
  return "테스트 경기";
}

function assertStoredTournamentMatchTitle(match = {}) {
  const expectedTitle = getTournamentMatchDisplayTitle(match, match.title);
  assertFlow(match.title === expectedTitle, "stored tournament match title is not display-safe", {
    matchId: match.id,
    title: match.title,
    expectedTitle,
  });
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

function getTestAuthEmail(testLoginId = "") {
  return `${String(testLoginId).trim().toLowerCase()}@${testAuthEmailDomain}`;
}

async function getAuthToken(testLoginId) {
  const normalizedLoginId = String(testLoginId).trim().toLowerCase();
  if (authTokensByLogin.has(normalizedLoginId)) return authTokensByLogin.get(normalizedLoginId);
  const email = getTestAuthEmail(normalizedLoginId);
  let { data, error } = await authClient.auth.signInWithPassword({
    email,
    password: testAuthPassword,
  });
  if ((error || !data?.session?.access_token) && supabase && /rate limit/i.test(error?.message ?? "")) {
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError || !linkData?.properties?.hashed_token) {
      throw new Error(`test_auth_admin_link_failed:${normalizedLoginId}:${linkError?.message ?? "missing_token"}`);
    }
    ({ data, error } = await authClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    }));
  }
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

async function syncDiscordDeliveriesAs(testLoginId, deliveries = []) {
  return callHandler("/api/discord/sync-deliveries", discordSyncDeliveriesHandler, await getAuthToken(testLoginId), { deliveries });
}

async function syncSettingsAs(testLoginId, settings = {}) {
  return callHandler("/api/settings/sync", settingsSyncHandler, await getAuthToken(testLoginId), { settings });
}

async function assertTerminalFeedRefreshGuard(entityType, entityId) {
  if (!supabase) return { skipped: true };
  const { data: beforeCard, error: beforeCardError } = await supabase
    .from("room_feed_cards")
    .select("updated_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (beforeCardError) throw beforeCardError;
  assertFlow(Boolean(beforeCard?.updated_at), "terminal feed card missing before refresh guard", { entityType, entityId });

  const rpcName = entityType === "match"
    ? "rankball_refresh_match_feed_for_match"
    : "rankball_refresh_recruiting_feed_for_post";
  const rpcArgs = entityType === "match" ? { p_match_id: entityId } : { p_post_id: entityId };
  const { error: refreshError } = await supabase.rpc(rpcName, rpcArgs);
  if (refreshError) throw refreshError;

  const { data: feedRows, error: feedError } = await supabase
    .from("user_room_feed")
    .select("status,is_active")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (feedError) throw feedError;
  assertFlow((feedRows ?? []).length > 0 && (feedRows ?? []).every((row) => row.is_active === false), "terminal feed was reactivated", {
    entityType,
    entityId,
    feedRows,
  });

  const { data: afterCard, error: afterCardError } = await supabase
    .from("room_feed_cards")
    .select("updated_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (afterCardError) throw afterCardError;
  assertFlow(afterCard?.updated_at === beforeCard.updated_at, "terminal feed refresh extended card retention", {
    entityType,
    entityId,
    before: beforeCard.updated_at,
    after: afterCard?.updated_at,
  });
  return { inactive: true, cardTimestampStable: true };
}

async function loadDirectoryAs(testLoginId) {
  const payload = await callHandler("/api/directory/load", directoryLoadHandler, await getAuthToken(testLoginId), {
    includeDemo: false,
  });
  assertFlow(payload?.ok && payload?.state, `directory load failed for ${testLoginId}`, payload);
  return payload.state;
}

async function upsertProfileAs(testLoginId, profile = {}) {
  return callHandler("/api/profile/upsert", profileUpsertHandler, await getAuthToken(testLoginId), { profile });
}

async function submitReportAs(testLoginId, report = {}) {
  return callHandler("/api/reports/submit", submitReportHandler, await getAuthToken(testLoginId), { report, notifications: [] });
}

async function commitAdminAppointmentAs(testLoginId, body = {}) {
  return callHandler("/api/admin/appointment-action", adminAppointmentActionHandler, await getAuthToken(testLoginId), body);
}

async function commitAdminDisciplinaryAs(testLoginId, body = {}) {
  return callHandler("/api/admin/disciplinary-action", adminDisciplinaryActionHandler, await getAuthToken(testLoginId), body);
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readResponseTextWithTimeout(response, label = "response", timeoutMs = requestTimeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_body_timeout`)), timeoutMs);
  });
  return Promise.race([response.text(), timeout]).finally(() => clearTimeout(timeoutId));
}

async function withTimeout(promise, label = "operation", timeoutMs = requestTimeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function assertSchemaHealth() {
  if (!schemaHealthSecret) return { skipped: true, reason: "secret_missing" };
  const body = ensureRemoteTestActors ? { ensureTestActors: true } : {};
  let payload = null;
  if (usesRemoteApi) {
    const response = await fetchWithTimeout(`${remoteBaseUrl}/api/system/schema-health`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${schemaHealthSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await readResponseTextWithTimeout(response, "schema_health");
    payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`/api/system/schema-health failed ${response.status}: ${text}`);
    }
  } else {
    payload = await callHandler("/api/system/schema-health", schemaHealthHandler, schemaHealthSecret, body);
  }
  if (!payload?.ok) {
    const failed = (payload?.checks ?? [])
      .filter((check) => !check.ok)
      .map((check) => `${check.table}: ${check.error}`)
      .join("; ");
    const failedRpcs = (payload?.rpcChecks ?? [])
      .filter((check) => !check.ok)
      .map((check) => `${check.rpc || check.name}: ${check.error}`)
      .join("; ");
    const failedHealthChecks = [
      ["feedTriggers", payload?.feedTriggerCheck],
      ["rlsPolicies", payload?.rlsPolicyCheck],
      ["rpcGrants", payload?.rpcGrantCheck],
      ["matchOverlapPolicy", payload?.matchOverlapPolicyCheck],
      ["disputeWindow", payload?.disputeWindowCheck],
      ["profileIdentity", payload?.profileIdentityCheck],
      ["tournamentInvitations", payload?.tournamentInvitationCheck],
      ["tournamentStartDelivery", payload?.tournamentStartDeliveryCheck],
    ]
      .filter(([, check]) => check && !check.ok)
      .map(([label, check]) => `${label}: ${check.error || JSON.stringify(check.failed ?? check.missing ?? check.checks ?? [])}`)
      .join("; ");
    const seedError = payload?.simulationSeed && !payload.simulationSeed.ok
      ? `simulationSeed: ${payload.simulationSeed.error || JSON.stringify(payload.simulationSeed.checks ?? [])}`
      : "";
    throw new Error(`schema health failed: ${[failed, failedRpcs, failedHealthChecks, seedError].filter(Boolean).join("; ")}`);
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
  const { state } = await loadProfileMeAs(testLoginId);
  const profileId = getProfileId(state, testLoginId) || seededProfileId;
  if (profileId && normalizedLoginId) testLoginsByProfileId.set(profileId, normalizedLoginId);
  return profileId;
}

async function ensureTemporaryProfileDiscordSnapshot(profileId = "") {
  assertFlow(Boolean(supabase), "service role client required for temporary profile snapshot");
  const safeProfileId = String(profileId || "").trim();
  assertFlow(Boolean(safeProfileId), "temporary profile id missing", { profileId });
  if (!temporaryProfileDiscordSnapshots.has(safeProfileId)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,discord_connection,discord_user_id,app_settings")
      .eq("id", safeProfileId)
      .maybeSingle();
    if (error) throw error;
    assertFlow(data?.id === safeProfileId, "temporary discord profile not found", { profileId: safeProfileId });
    temporaryProfileDiscordSnapshots.set(safeProfileId, {
      discord_connection: data.discord_connection ?? null,
      discord_user_id: data.discord_user_id ?? null,
      app_settings: data.app_settings ?? {},
    });
  }
  return temporaryProfileDiscordSnapshots.get(safeProfileId);
}

async function setTemporaryProfileDiscordUser(profileId = "", discordUserId = "", username = "rankball-sim") {
  const safeProfileId = String(profileId || "").trim();
  const safeDiscordUserId = String(discordUserId || "").trim();
  assertFlow(Boolean(safeProfileId && safeDiscordUserId), "temporary discord profile input missing", { profileId, discordUserId });
  await ensureTemporaryProfileDiscordSnapshot(safeProfileId);
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

async function setTemporaryDiscordNotificationSettings(profileId = "", discord = {}) {
  assertFlow(Boolean(supabase), "service role client required for temporary Discord settings");
  await ensureTemporaryProfileDiscordSnapshot(profileId);
  const { data, error } = await supabase
    .from("profiles")
    .select("app_settings")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  const appSettings = data?.app_settings && typeof data.app_settings === "object" ? data.app_settings : {};
  const notificationChannels = appSettings.notificationChannels && typeof appSettings.notificationChannels === "object"
    ? appSettings.notificationChannels
    : {};
  const currentDiscord = notificationChannels.discord && typeof notificationChannels.discord === "object"
    ? notificationChannels.discord
    : {};
  const nextDiscord = {
    ...currentDiscord,
    ...discord,
    events: {
      ...(currentDiscord.events ?? {}),
      ...(discord.events ?? {}),
    },
  };
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      app_settings: {
        ...appSettings,
        notificationChannels: {
          ...notificationChannels,
          discord: nextDiscord,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);
  if (updateError) throw updateError;
}

async function setTemporaryProfilePrivacy(profileId = "", privacy = {}) {
  assertFlow(Boolean(supabase), "service role client required for temporary privacy settings");
  await ensureTemporaryProfileDiscordSnapshot(profileId);
  const { data, error } = await supabase
    .from("profiles")
    .select("app_settings")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  const appSettings = data?.app_settings && typeof data.app_settings === "object" ? data.app_settings : {};
  const currentPrivacy = appSettings.privacy && typeof appSettings.privacy === "object" ? appSettings.privacy : {};
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      app_settings: {
        ...appSettings,
        privacy: { ...currentPrivacy, ...privacy },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);
  if (updateError) throw updateError;
}

async function snapshotTemporaryProfileIdentity(profileId = "") {
  assertFlow(Boolean(supabase), "service role client required for temporary profile identity");
  if (temporaryProfileIdentitySnapshots.has(profileId)) return temporaryProfileIdentitySnapshots.get(profileId);
  const { data, error } = await supabase
    .from("profiles")
    .select("id,name,handle,hashtag,birth_year,age_group,age_group_checked_season,onboarding_complete,handle_locked_at,birth_year_locked_at,name_updated_at,updated_at,test_login_id")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  assertFlow(data?.id === profileId, "temporary profile identity not found", { profileId });
  const stableName = /^rankball-\d+$/i.test(String(data.test_login_id || ""))
    ? String(data.name || "").replace(/(?:\s+SIM)+$/i, "").trim() || data.name
    : data.name;
  const snapshot = { ...data, name: stableName };
  temporaryProfileIdentitySnapshots.set(profileId, snapshot);
  return snapshot;
}

async function restoreTemporaryProfileIdentities() {
  if (!supabase || temporaryProfileIdentitySnapshots.size === 0) return { skipped: true };
  const errors = [];
  for (const [profileId, snapshot] of temporaryProfileIdentitySnapshots.entries()) {
    const { id: _id, ...row } = snapshot;
    const { error } = await supabase.from("profiles").update(row).eq("id", profileId);
    if (error) errors.push({ profileId, message: error.message });
  }
  temporaryProfileIdentitySnapshots.clear();
  return { skipped: false, errors };
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
        app_settings: snapshot.app_settings,
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
      .update({ status: "simulation_closed", available_after: now, payload, updated_at: now })
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

async function clearRefereeSimulationCooldown(profileId = "") {
  if (!supabase || !profileId) return { skipped: true };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("referee_exam_attempts")
    .update({ available_after: now, updated_at: now })
    .eq("user_id", profileId)
    .like("id", "sim_rea_%")
    .gt("available_after", now)
    .select("id");
  if (error) throw error;
  for (const row of data ?? []) {
    if (row?.id) refereeSimulationAttemptIds.add(row.id);
  }
  return { skipped: false, cleared: (data ?? []).length };
}

async function ensureSimulationTrustScore(profileId = "", minimum = 90) {
  if (!supabase || !profileId) return { skipped: true };
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,trust_score")
    .eq("id", profileId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (Number(profile?.trust_score ?? 0) < minimum) {
    await snapshotRatingSubjects([profileId]);
    const { error: trustError } = await supabase
      .from("profiles")
      .update({ trust_score: Math.min(100, minimum + 5), updated_at: new Date().toISOString() })
      .eq("id", profileId);
    if (trustError) throw trustError;
  }
  return { skipped: false, updated: Number(profile?.trust_score ?? 0) < minimum };
}

async function ensureSimulationRefereeEligibility(profileId = "", label = "referee", minimumTermDays = 3) {
  if (!supabase || !profileId) return { skipped: true };
  const nowMs = Date.now();
  const requiredEndsAtMs = nowMs + Math.max(1, Number(minimumTermDays) || 3) * DAY_MS;
  await ensureSimulationTrustScore(profileId, 90);
  const { data: activeRows, error: activeError } = await supabase
    .from("referee_appointments")
    .select("id,ends_at")
    .eq("user_id", profileId)
    .eq("role", "referee")
    .eq("status", "active");
  if (activeError) throw activeError;
  const liveAppointment = (activeRows ?? []).find((row) => !row.ends_at || Date.parse(row.ends_at) > requiredEndsAtMs);
  if (liveAppointment?.id) return { alreadyEligible: true, appointmentId: liveAppointment.id };

  const appointmentId = `sim_referee_appt_${label}_${suffix}`;
  const now = new Date(nowMs).toISOString();
  const endsAt = new Date(requiredEndsAtMs).toISOString();
  const { error: upsertError } = await supabase
    .from("referee_appointments")
    .upsert({
      id: appointmentId,
      user_id: profileId,
      role: "referee",
      grade: "candidate",
      status: "active",
      starts_at: now,
      ends_at: endsAt,
      payload: {
        source: "rankball-sim",
        label,
        suffix,
      },
      created_at: now,
      updated_at: now,
    }, { onConflict: "id" });
  if (upsertError) throw upsertError;
  adminAppointmentSimulationIds.add(appointmentId);
  return { alreadyEligible: false, appointmentId };
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

async function assertProfileRatingsUnchanged(profileIds = []) {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const safeProfileIds = uniqueIds(profileIds);
  const { data, error } = await supabase
    .from("profiles")
    .select("id,ratings,streak")
    .in("id", safeProfileIds);
  if (error) throw error;
  for (const row of data ?? []) {
    const snapshot = profileRatingSnapshots.get(row.id);
    assertFlow(Boolean(snapshot), "rating snapshot missing", { profileId: row.id });
    assertFlow(JSON.stringify(row.ratings ?? null) === JSON.stringify(snapshot.ratings ?? null), "unranked match changed profile ratings", {
      profileId: row.id,
      before: snapshot.ratings,
      after: row.ratings,
    });
    assertFlow(Number(row.streak ?? 0) === Number(snapshot.streak ?? 0), "unranked match changed profile streak", {
      profileId: row.id,
      before: snapshot.streak,
      after: row.streak,
    });
  }
  return { checked: safeProfileIds.length };
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

async function cleanupRegressionSimulationRows() {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const teamInvitationIds = [...teamInvitationSimulationIds];
  const teamIds = [...teamSimulationIds];
  const courtRequestIds = [...courtRequestSimulationIds];
  const approvedCourtIds = [...approvedCourtSimulationIds];
  const adminAppointmentIds = [...adminAppointmentSimulationIds];
  const adminDisciplinaryIds = [...adminDisciplinarySimulationIds];
  const adminAuditIds = [...adminAuditSimulationIds];
  const reportIds = [...reportSimulationIds];
  if (
    !teamInvitationIds.length
    && !teamIds.length
    && !courtRequestIds.length
    && !approvedCourtIds.length
    && !adminAppointmentIds.length
    && !adminDisciplinaryIds.length
    && !adminAuditIds.length
    && !reportIds.length
  ) return { skipped: true };

  const errors = [];
  const deleteRows = async (table, column, values) => {
    if (!values.length) return;
    const { error } = await supabase.from(table).delete().in(column, values);
    if (error && !["42P01", "PGRST205"].includes(error.code)) {
      errors.push({ table, column, message: error.message });
    }
  };

  await deleteRows("notifications", "invitation_id", teamInvitationIds);
  for (const requestId of courtRequestIds) {
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("type", "court_request")
      .contains("payload", { courtRequestId: requestId });
    if (error && !["42P01", "PGRST205"].includes(error.code)) {
      errors.push({ table: "notifications", column: "payload.courtRequestId", message: error.message });
    }
  }
  await deleteRows("admin_audit_log", "request_id", courtRequestIds);
  for (const appointmentId of adminAppointmentIds) {
    const { error } = await supabase
      .from("notifications")
      .delete()
      .contains("payload", { appointmentId });
    if (error && !["42P01", "PGRST205"].includes(error.code)) {
      errors.push({ table: "notifications", column: "payload.appointmentId", message: error.message });
    }
  }
  for (const disciplinaryActionId of adminDisciplinaryIds) {
    const { error } = await supabase
      .from("notifications")
      .delete()
      .contains("payload", { disciplinaryActionId });
    if (error && !["42P01", "PGRST205"].includes(error.code)) {
      errors.push({ table: "notifications", column: "payload.disciplinaryActionId", message: error.message });
    }
  }
  await deleteRows("admin_audit_log", "id", adminAuditIds);
  await deleteRows("reports", "id", reportIds);
  await deleteRows("admin_disciplinary_actions", "id", adminDisciplinaryIds);
  await deleteRows("referee_appointments", "id", adminAppointmentIds);
  await deleteRows("admin_appointments", "id", adminAppointmentIds);
  await deleteRows("court_facility_info", "court_id", approvedCourtIds);
  await deleteRows("court_source_records", "court_id", approvedCourtIds);
  await deleteRows("approved_courts", "id", approvedCourtIds);
  await deleteRows("court_requests", "id", courtRequestIds);
  await deleteRows("team_invitations", "id", teamInvitationIds);
  if (teamIds.length) {
    await deleteRows("team_members", "team_id", teamIds);
    const { error } = await supabase
      .from("teams")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", teamIds)
      .is("deleted_at", null);
    if (error) errors.push({ table: "teams", column: "id", message: error.message });
  }

  teamInvitationSimulationIds.clear();
  teamSimulationIds.clear();
  courtRequestSimulationIds.clear();
  approvedCourtSimulationIds.clear();
  adminAppointmentSimulationIds.clear();
  adminDisciplinarySimulationIds.clear();
  adminAuditSimulationIds.clear();
  reportSimulationIds.clear();
  return {
    skipped: false,
    teamInvitations: teamInvitationIds.length,
    teams: teamIds.length,
    courtRequests: courtRequestIds.length,
    approvedCourts: approvedCourtIds.length,
    adminAppointments: adminAppointmentIds.length,
    adminDisciplinaryActions: adminDisciplinaryIds.length,
    adminAuditRows: adminAuditIds.length,
    reports: reportIds.length,
    errors,
  };
}

async function cleanupTeamEmblemSimulationObjects() {
  const objectKeys = [...teamEmblemSimulationKeys];
  if (!objectKeys.length) return { skipped: true };
  const errors = [];
  let config = null;
  try {
    config = getTeamEmblemR2Config();
  } catch (error) {
    errors.push({ objectKey: "config", message: error.message });
  }
  if (config) {
    for (const objectKey of objectKeys) {
      try {
        await deleteTeamEmblemObject(config, objectKey);
      } catch (error) {
        errors.push({ objectKey, message: error.message });
      }
    }
  }
  teamEmblemSimulationKeys.clear();
  return { skipped: false, objectCount: objectKeys.length, errors };
}

async function cleanupSimulationNotifications() {
  if (!supabase) return { skipped: true };
  const idsToDelete = [...simulationNotificationIds];
  const discordIdsToDelete = [...simulationDiscordDeliveryIds];
  const matchIds = uniqueIds(scenarioIds.flatMap((scenario) => [scenario.matchId, ...(scenario.matchIds ?? [])]));
  const postIds = uniqueIds(scenarioIds.map((scenario) => scenario.postId));
  const tournamentIds = uniqueIds(scenarioIds.map((scenario) => scenario.tournamentId));
  if (!idsToDelete.length && !discordIdsToDelete.length && !matchIds.length && !postIds.length && !tournamentIds.length) return { skipped: true };
  const errors = [];
  let notificationDeleteCount = 0;
  let discordDeliveryDeleteCount = 0;

  if (discordIdsToDelete.length) {
    const { data, error } = await supabase
      .from("discord_notification_deliveries")
      .delete()
      .in("id", discordIdsToDelete)
      .select("id");
    if (error) errors.push({ table: "discord_notification_deliveries", column: "id", message: error.message });
    else discordDeliveryDeleteCount += data?.length ?? 0;
  }

  async function deleteNotificationGroup(column, values) {
    if (!values.length) return;
    const { data: notificationRows, error: selectError } = await supabase
      .from("notifications")
      .select("id")
      .in(column, values);
    if (selectError) {
      errors.push({ table: "notifications", column, message: selectError.message });
      return;
    }
    const notificationIds = uniqueIds((notificationRows ?? []).map((notification) => notification.id));
    if (!notificationIds.length) return;
    const { data: deliveryRows, error: deliveryError } = await supabase
      .from("discord_notification_deliveries")
      .delete()
      .in("notification_id", notificationIds)
      .select("id");
    if (deliveryError) {
      errors.push({ table: "discord_notification_deliveries", column: "notification_id", message: deliveryError.message });
      return;
    }
    discordDeliveryDeleteCount += deliveryRows?.length ?? 0;
    const { data: deletedRows, error: deleteError } = await supabase
      .from("notifications")
      .delete()
      .in("id", notificationIds)
      .select("id");
    if (deleteError) errors.push({ table: "notifications", column, message: deleteError.message });
    else notificationDeleteCount += deletedRows?.length ?? 0;
  }

  for (const [column, values] of [
    ["id", idsToDelete],
    ["match_id", matchIds],
    ["recruiting_post_id", postIds],
  ]) {
    await deleteNotificationGroup(column, values);
  }

  let tournamentNotificationCount = 0;
  for (const tournamentId of tournamentIds) {
    const { data: tournamentNotifications, error } = await supabase
      .from("notifications")
      .select("id")
      .contains("payload", { tournamentId });
    if (error) {
      errors.push({ table: "notifications", column: "payload.tournamentId", message: error.message });
      continue;
    }
    const notificationIds = (tournamentNotifications ?? []).map((notification) => notification.id).filter(Boolean);
    if (!notificationIds.length) continue;
    const beforeDeleteCount = notificationDeleteCount;
    await deleteNotificationGroup("id", notificationIds);
    tournamentNotificationCount += notificationDeleteCount - beforeDeleteCount;
  }

  let remainingNotifications = 0;
  for (const [column, values] of [
    ["id", idsToDelete],
    ["match_id", matchIds],
    ["recruiting_post_id", postIds],
  ]) {
    if (!values.length) continue;
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .in(column, values);
    if (error) errors.push({ table: "notifications", column: `verify:${column}`, message: error.message });
    else remainingNotifications += count ?? 0;
  }
  for (const tournamentId of tournamentIds) {
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .contains("payload", { tournamentId });
    if (error) errors.push({ table: "notifications", column: "verify:payload.tournamentId", message: error.message });
    else remainingNotifications += count ?? 0;
  }
  if (remainingNotifications > 0) errors.push({ table: "notifications", column: "cleanup", message: `remaining_simulation_notifications:${remainingNotifications}` });
  simulationNotificationIds.clear();
  simulationDiscordDeliveryIds.clear();
  return {
    skipped: false,
    explicitIds: idsToDelete.length,
    discordDeliveryIds: discordIdsToDelete.length,
    matchIds: matchIds.length,
    recruitingPostIds: postIds.length,
    tournamentIds: tournamentIds.length,
    deletedNotifications: notificationDeleteCount,
    deletedDiscordDeliveries: discordDeliveryDeleteCount,
    tournamentNotifications: tournamentNotificationCount,
    remainingNotifications,
    errors,
  };
}

async function cleanupSimulationRecruitingPosts() {
  if (!supabase) return { skipped: true };
  const postIds = uniqueIds(scenarioIds.map((scenario) => scenario.postId));
  if (!postIds.length) return { skipped: true };

  const errors = [];
  const deleted = {};
  for (const { table, column, select, filters = [] } of [
    { table: "room_chat_messages", column: "room_id", select: "id", filters: [["room_type", "recruiting"]] },
    { table: "room_discord_links", column: "room_id", select: "id", filters: [["room_type", "recruiting"]] },
    { table: "user_room_feed", column: "entity_id", select: "entity_id", filters: [["entity_type", "recruiting"]] },
    { table: "room_feed_cards", column: "entity_id", select: "entity_id", filters: [["entity_type", "recruiting"]] },
    { table: "recruiting_posts", column: "id", select: "id" },
  ]) {
    let query = supabase.from(table).delete().in(column, postIds);
    for (const [filterColumn, filterValue] of filters) query = query.eq(filterColumn, filterValue);
    const { data, error } = await query.select(select);
    if (error) errors.push({ table, message: error.message });
    else deleted[table] = data?.length ?? 0;
  }

  const { count: remainingPosts, error: verifyError } = await supabase
    .from("recruiting_posts")
    .select("id", { count: "exact", head: true })
    .in("id", postIds);
  if (verifyError) errors.push({ table: "recruiting_posts", column: "verify", message: verifyError.message });
  if ((remainingPosts ?? 0) > 0) {
    errors.push({ table: "recruiting_posts", column: "cleanup", message: `remaining_simulation_recruiting_posts:${remainingPosts}` });
  }

  return {
    skipped: false,
    trackedPosts: postIds.length,
    deleted,
    remainingPosts: remainingPosts ?? 0,
    errors,
  };
}

async function loadProfileMeAs(testLoginId) {
  const payload = await callHandler("/api/profile/me", profileMeHandler, await getAuthToken(testLoginId), {
    includeFavorites: false,
    includeMatchSummary: false,
    includeRecentRecords: false,
  });
  assertFlow(payload?.ok && payload?.state, `profile me failed for ${testLoginId}`, {
    ok: payload?.ok,
    error: payload?.error,
  });
  return payload;
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

async function loadNotificationsAs(testLoginId, options = {}) {
  return callHandler("/api/notifications/list", notificationListHandler, await getAuthToken(testLoginId), options);
}

async function runHomeAlertNotificationScenario({
  label,
  login,
}) {
  ids = makeScenarioIds(label);
  if (!supabase) {
    return { label: ids.label, skipped: true, reason: "service_role_key_missing" };
  }
  const profileId = await step(`${ids.label}:resolveProfile`, () => getProfileIdForLogin(login));
  const now = new Date();
  const dueId = `sim_notice_due_${ids.label}_${suffix}`;
  const futureId = `sim_notice_future_${ids.label}_${suffix}`;
  simulationNotificationIds.add(dueId);
  simulationNotificationIds.add(futureId);
  const rows = [
    {
      id: dueId,
      user_id: profileId,
      target_user_id: profileId,
      title: "Home due alert",
      body: "home alert due",
      tone: "match",
      type: "match_reminder",
      discord_event: "match",
      read_at: null,
      payload: {
        id: dueId,
        targetUserId: profileId,
        sendAt: new Date(now.getTime() - 60_000).toISOString(),
        skipDiscordSync: true,
        simulation: true,
        simulationId: ids.label,
      },
      created_at: new Date(now.getTime() + 2_000).toISOString(),
      updated_at: new Date(now.getTime() + 2_000).toISOString(),
    },
    {
      id: futureId,
      user_id: profileId,
      target_user_id: profileId,
      title: "Home future alert",
      body: "home alert future",
      tone: "match",
      type: "match_reminder",
      discord_event: "match",
      read_at: null,
      payload: {
        id: futureId,
        targetUserId: profileId,
        sendAt: new Date(now.getTime() + HOUR_MS).toISOString(),
        skipDiscordSync: true,
        simulation: true,
        simulationId: ids.label,
      },
      created_at: new Date(now.getTime() + 3_000).toISOString(),
      updated_at: new Date(now.getTime() + 3_000).toISOString(),
    },
  ];
  const { error } = await step(`${ids.label}:insertNotifications`, () => supabase
    .from("notifications")
    .upsert(rows, { onConflict: "id" }));
  if (error) throw error;

  const homeState = await step(`${ids.label}:homeLoad`, () => loadHomeAs(login));
  const notifications = homeState.notifications ?? [];
  assertFlow(notifications.some((notification) => notification.id === dueId), "home due alert missing", notifications);
  assertFlow(!notifications.some((notification) => notification.id === futureId), "home future alert should be hidden", notifications);

  const notificationList = await step(`${ids.label}:notificationList`, () => loadNotificationsAs(login, { limit: 1 }));
  assertFlow(
    notificationList?.notifications?.length === 1 && notificationList.notifications[0]?.id === dueId,
    "future notification consumed the notification list limit",
    notificationList,
  );

  return {
    label: ids.label,
    login,
    profileId,
    dueIncluded: true,
    futureHidden: true,
    futureExcludedBeforeLimit: true,
  };
}

async function assertTournamentInviteNotifications({
  label,
  tournamentId,
  expectedInvites = [],
}) {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const expectedRows = [];
  for (const invite of expectedInvites) {
    const captainId = invite.captainId || await getProfileIdForLogin(invite.captainLogin);
    expectedRows.push({ ...invite, captainId });
  }
  const { data, error } = await supabase
    .from("notifications")
    .select("id,target_user_id,type,read_at,payload")
    .eq("type", "tournament_invite")
    .contains("payload", { tournamentId });
  if (error) throw error;
  const rows = data ?? [];
  for (const expected of expectedRows) {
    const notification = rows.find((row) => (
      row.target_user_id === expected.captainId &&
      row.payload?.teamId === expected.teamId
    ));
    assertFlow(
      notification &&
        !notification.read_at &&
        notification.payload?.actionRequired === true &&
        notification.payload?.homeAction === true &&
        notification.payload?.webPath === `/app/tournaments/${tournamentId}`,
      "tournament captain invite notification missing",
      { tournamentId, expected, notifications: rows },
    );
    simulationNotificationIds.add(notification.id);

    const captainHome = await step(`${label}:loadCaptainHomeInvite:${expected.teamId}`, () => loadHomeAs(expected.captainLogin));
    assertFlow(
      (captainHome.notifications ?? []).some((homeNotification) => (
        homeNotification.id === notification.id &&
        homeNotification.type === "tournament_invite" &&
        homeNotification.tournamentId === tournamentId &&
        homeNotification.teamId === expected.teamId &&
        homeNotification.actionRequired === true &&
        homeNotification.homeAction === true
      )),
      "tournament captain home invite missing",
      { tournamentId, expected, homeNotifications: captainHome.notifications },
    );
  }
  return {
    skipped: false,
    expected: expectedRows.length,
    found: rows.length,
  };
}

async function assertTournamentInviteDiscordDelivery({
  tournamentId,
  targetUserId,
}) {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id,target_user_id,type,payload")
    .eq("type", "tournament_invite")
    .eq("target_user_id", targetUserId)
    .contains("payload", { tournamentId });
  if (error) throw error;
  const notificationIds = (notifications ?? []).map((notification) => notification.id).filter(Boolean);
  assertFlow(notificationIds.length > 0, "tournament invite notification missing before delivery check", {
    tournamentId,
    targetUserId,
  });
  const { data: deliveries, error: deliveryError } = await supabase
    .from("discord_notification_deliveries")
    .select("id,notification_id,target_user_id,event,status,sent_at,payload")
    .in("notification_id", notificationIds)
    .eq("target_user_id", targetUserId);
  if (deliveryError) throw deliveryError;
  const delivery = (deliveries ?? []).find((row) => (
    row.event === "approval" &&
    row.status === "queued" &&
    !row.sent_at &&
    notificationIds.includes(row.notification_id)
  )) ?? deliveries?.[0];
  assertFlow(
    delivery?.event === "approval" && delivery?.status === "queued" && !delivery?.sent_at,
    "tournament invite Discord delivery missing",
    { tournamentId, targetUserId, notificationIds, deliveries },
  );
  simulationDiscordDeliveryIds.add(delivery.id);
  return {
    skipped: false,
    deliveryId: delivery.id,
    notificationIds,
  };
}

async function assertTournamentStartNotificationDelivery({
  tournamentId,
  targetUserId,
  targetLogin,
}) {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id,target_user_id,title,type,discord_event,read_at,payload")
    .eq("type", "tournament")
    .eq("target_user_id", targetUserId)
    .contains("payload", { tournamentId });
  if (error) throw error;
  const notification = (notifications ?? []).find((row) => (
    row.title === "대회 시작" && row.payload?.tournamentStartDeliveryAtomic === true
  ));
  assertFlow(
    notification &&
      !notification.read_at &&
      notification.discord_event === "match" &&
      notification.payload?.skipDiscordSync === true &&
      notification.payload?.webPath === `/app/tournaments/${tournamentId}`,
    "atomic tournament start app notification missing",
    { tournamentId, targetUserId, notifications },
  );
  simulationNotificationIds.add(notification.id);

  if (targetLogin) {
    const homeState = await loadHomeAs(targetLogin);
    assertFlow(
      (homeState.notifications ?? []).some((row) => row.id === notification.id),
      "tournament start app notification missing from home",
      { tournamentId, targetUserId, homeNotifications: homeState.notifications },
    );
  }

  const { data: deliveries, error: deliveryError } = await supabase
    .from("discord_notification_deliveries")
    .select("id,notification_id,target_user_id,event,status,sent_at,payload")
    .eq("notification_id", notification.id)
    .eq("target_user_id", targetUserId);
  if (deliveryError) throw deliveryError;
  const delivery = (deliveries ?? [])[0];
  assertFlow(
    delivery &&
      delivery.event === "match" &&
      !["cancelled", "failed"].includes(delivery.status) &&
      delivery.payload?.tournamentId === tournamentId &&
      delivery.payload?.webPath === `/app/tournaments/${tournamentId}`,
    "atomic tournament start Discord delivery missing",
    { tournamentId, targetUserId, notification, deliveries },
  );
  simulationDiscordDeliveryIds.add(delivery.id);

  return {
    skipped: false,
    notificationId: notification.id,
    deliveryId: delivery.id,
    status: delivery.status,
  };
}

async function assertTournamentInviteNotificationsResolved({
  tournamentId,
  expectedInvites = [],
}) {
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };
  const expectedRows = [];
  for (const invite of expectedInvites) {
    const captainId = invite.captainId || await getProfileIdForLogin(invite.captainLogin);
    expectedRows.push({ ...invite, captainId });
  }
  const { data, error } = await supabase
    .from("notifications")
    .select("id,target_user_id,type,read_at,payload")
    .eq("type", "tournament_invite")
    .contains("payload", { tournamentId });
  if (error) throw error;
  const rows = data ?? [];
  for (const expected of expectedRows) {
    const notification = rows.find((row) => (
      row.target_user_id === expected.captainId &&
      row.payload?.teamId === expected.teamId
    ));
    assertFlow(
      notification &&
        Boolean(notification.read_at) &&
        notification.payload?.actionRequired === false &&
        notification.payload?.homeAction === false &&
        notification.payload?.resolvedStatus === "accepted",
      "tournament captain invite notification not resolved",
      { tournamentId, expected, notifications: rows },
    );
  }
  return {
    skipped: false,
    expected: expectedRows.length,
    resolved: expectedRows.length,
  };
}

async function getCurrentProfileTrustScore(testLoginId, expectedProfileId = "") {
  const { state } = await loadProfileMeAs(testLoginId);
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

async function syncTeamAs(testLoginId, body = {}) {
  return callHandler("/api/teams/sync-team", syncTeamHandler, await getAuthToken(testLoginId), body);
}

async function updateTeamEmblemAs(testLoginId, body = {}) {
  return callHandler("/api/teams/emblem", teamEmblemHandler, await getAuthToken(testLoginId), body);
}

async function commitAdminReviewAs(testLoginId, body = {}) {
  return callHandler("/api/admin/review-action", adminReviewActionHandler, await getAuthToken(testLoginId), body);
}

async function submitCourtRequestAs(testLoginId, request = {}) {
  return callHandler("/api/court-requests/submit", submitCourtRequestHandler, await getAuthToken(testLoginId), { request });
}

async function approveCourtRequestAs(testLoginId, requestId = "", approval = {}) {
  return callHandler("/api/court-requests/approve", approveCourtRequestHandler, await getAuthToken(testLoginId), {
    requestId,
    approval: {
      approvedName: approval.approvedName ?? "",
      addressVerified: approval.addressVerified ?? true,
      multipleCourtsVerified: approval.multipleCourtsVerified ?? false,
    },
  });
}

async function reportCourtRequestAs(testLoginId, requestId = "", reason = "simulation approved court report") {
  return callHandler("/api/court-requests/report", reportCourtRequestHandler, await getAuthToken(testLoginId), {
    requestId,
    reason,
  });
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

async function controlMatchClockAs(testLoginId, matchId, action = "read", payload = {}) {
  return callHandler("/api/matches/clock", matchClockHandler, await getAuthToken(testLoginId), {
    matchId,
    action,
    payload,
  });
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

async function loadMatchesAs(testLoginId, options = {}) {
  const payload = await callHandler("/api/matches/list", matchesListHandler, await getAuthToken(testLoginId), {
    activeOnly: true,
    includeRecentCompleted: true,
    includeClosedNotices: true,
    includeRecruitingSchedule: false,
    adminContext: false,
    limit: 30,
    ...options,
  });
  assertFlow(payload?.ok && payload?.state, `match list load failed for ${testLoginId}`, payload);
  return payload.state;
}

async function runMatchListProfileIntegrityScenario({ label, login }) {
  ids = makeScenarioIds(label);
  const state = await step(`${ids.label}:loadMatches`, () => loadMatchesAs(login));
  const currentUser = (state.users ?? []).find((user) => user.id === state.currentUserId);
  assertFlow(Boolean(
    currentUser?.onboardingComplete
    && currentUser?.birthYear
    && currentUser?.handleLockedAt
    && currentUser?.birthYearLockedAt
    && currentUser?.ageGroupCheckedSeason
    && currentUser?.regionSido
    && currentUser?.regionDistrict
  ), "match list replaced the current profile with a public card", currentUser);
  return {
    label: ids.label,
    login,
    profileId: currentUser.id,
    privateProfilePreserved: true,
  };
}

function getKstFutureSchedule(offsetHours = 48) {
  const date = new Date(Date.now() + Math.max(1, Number(offsetHours) || 48) * HOUR_MS);
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

function getKstCurrentDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function getKstScheduleAt(date) {
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
    scheduledDate: `${parts.year}-${parts.month}-${parts.day}`,
    scheduledTime: `${parts.hour}:${parts.minute}`,
  };
}

function getKstPastSchedule(offsetMinutes = 1) {
  return getKstScheduleAt(new Date(Date.now() - Math.max(1, Number(offsetMinutes) || 1) * MINUTE_MS));
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

function getRpcAffectedCount(result) {
  const rows = Array.isArray(result) ? result : [result];
  return rows.reduce((total, row) => {
    const value = typeof row === "number" || typeof row === "string"
      ? row
      : row?.affected ?? row?.affectedCount ?? row?.affected_count ?? row?.expiredCount;
    const count = Number(value);
    return total + (Number.isFinite(count) ? count : 0);
  }, 0);
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

async function setMatchScoreByIncrements({ label, login, match, scoreA, scoreB }) {
  let currentMatch = match;
  let lastResult = null;
  let iteration = 0;
  while (Number(currentMatch?.result?.scoreA ?? currentMatch?.teamA?.score ?? 0) !== scoreA
    || Number(currentMatch?.result?.scoreB ?? currentMatch?.teamB?.score ?? 0) !== scoreB) {
    iteration += 1;
    assertFlow(iteration <= 100, "score increment iteration limit exceeded", { match: currentMatch, scoreA, scoreB });
    const currentScoreA = Number(currentMatch?.result?.scoreA ?? currentMatch?.teamA?.score ?? 0);
    const currentScoreB = Number(currentMatch?.result?.scoreB ?? currentMatch?.teamB?.score ?? 0);
    const deltaA = Math.sign(scoreA - currentScoreA) * Math.min(3, Math.abs(scoreA - currentScoreA));
    const deltaB = Math.sign(scoreB - currentScoreB) * Math.min(3, Math.abs(scoreB - currentScoreB));
    lastResult = await step(`${label}:incrementMatchScore:${iteration}`, () => syncMatchAs(login, {
      action: "incrementMatchScore",
      matchId: currentMatch.id,
      deltaA,
      deltaB,
      expectedRevisionA: Number(currentMatch?.result?.scoreRevisionA ?? 0),
      expectedRevisionB: Number(currentMatch?.result?.scoreRevisionB ?? 0),
    }));
    assertFlow(Boolean(lastResult?.sqlReducer), "score increment SQL reducer not used", lastResult);
    const nextMatch = await getMatchAfterResult(lastResult, login, `${label}:loadAfterScoreIncrement:${iteration}`);
    assertFlow(
      Number(nextMatch?.result?.scoreA ?? nextMatch?.teamA?.score ?? 0) !== currentScoreA
        || Number(nextMatch?.result?.scoreB ?? nextMatch?.teamB?.score ?? 0) !== currentScoreB,
      "score increment did not advance",
      { before: currentMatch, after: nextMatch },
    );
    currentMatch = nextMatch;
  }
  return { match: currentMatch, lastResult, sqlReducer: Boolean(lastResult?.sqlReducer) };
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

function makePointsOnlyResult(match, scoreA = 21, scoreB = 12) {
  const teamAPlayer = match.teamA?.players?.[0];
  const teamBPlayer = match.teamB?.players?.[0];
  assertFlow(Boolean(teamAPlayer && teamBPlayer), "match players missing", match);
  return {
    scoreA,
    scoreB,
    playerStats: {
      [teamAPlayer]: { points: 21 },
      [teamBPlayer]: { points: 12 },
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

async function cleanupTrackedMatchArtifacts() {
  const trackedMatchIds = uniqueIds(scenarioIds.flatMap((scenario) => [scenario.matchId, ...(scenario.matchIds ?? [])]));
  const trackedTournamentIds = uniqueIds(scenarioIds.map((scenario) => scenario.tournamentId));
  if (!supabase) {
    return {
      ok: true,
      skipped: true,
      reason: "service_role_key_missing",
      remainingMatches: 0,
      remainingTournaments: 0,
      remainingNotifications: 0,
      remainingDiscordDeliveries: 0,
    };
  }

  let tournamentIds = [];
  let tournamentMatchRows = [];
  if (trackedTournamentIds.length) {
    const { data: tournamentRows, error: tournamentError } = await supabase
      .from("tournaments")
      .select("id")
      .in("id", trackedTournamentIds);
    if (tournamentError) throw tournamentError;
    tournamentIds = (tournamentRows ?? []).map((row) => row.id);
  }
  if (tournamentIds.length) {
    const { data, error } = await supabase
      .from("matches")
      .select("id,tournament_id")
      .in("tournament_id", tournamentIds);
    if (error) throw error;
    tournamentMatchRows = data ?? [];
  }
  const tournamentMatchIds = tournamentMatchRows.map((row) => row.id);
  const matchIds = uniqueIds([
    ...trackedMatchIds.filter((matchId) => matchId.startsWith("sim_m_")),
    ...tournamentMatchIds,
  ]);
  if (!matchIds.length && !tournamentIds.length) {
    return {
      ok: true,
      skipped: true,
      reason: "no_tracked_artifacts",
      remainingMatches: 0,
      remainingTournaments: 0,
      remainingNotifications: 0,
      remainingDiscordDeliveries: 0,
    };
  }

  const affectedProfileIds = new Set();
  const affectedCourtIds = new Set();
  let deletedMatches = 0;
  let deletedTournaments = 0;
  let derivedRefreshCompleted = true;
  const tournamentMatchIdSet = new Set(tournamentMatchIds);
  const standaloneMatchIds = matchIds.filter((matchId) => !tournamentMatchIdSet.has(matchId));
  const matchBatches = standaloneMatchIds.length
    ? Array.from({ length: Math.ceil(standaloneMatchIds.length / 10) }, (_, index) => standaloneMatchIds.slice(index * 10, (index + 1) * 10))
    : [];
  const applyCleanupBatch = async (matchBatch, tournamentBatch) => {
    const { data, error } = await supabase.rpc("rankball_cleanup_simulation_artifacts_exact", {
      p_match_ids: matchBatch,
      p_tournament_ids: tournamentBatch,
    });
    if (error) throw error;
    for (const profileId of data?.affectedProfileIds ?? []) affectedProfileIds.add(profileId);
    for (const courtId of data?.affectedCourtIds ?? []) affectedCourtIds.add(courtId);
    deletedMatches += Number(data?.deletedMatches ?? 0);
    deletedTournaments += Number(data?.deletedTournaments ?? 0);
    derivedRefreshCompleted = derivedRefreshCompleted && data?.derivedRefreshCompleted === true;
  };
  for (const matchBatch of matchBatches) {
    await applyCleanupBatch(matchBatch, []);
  }
  for (const tournamentId of tournamentIds) {
    const tournamentMatchIdsForCleanup = tournamentMatchRows
      .filter((row) => row.tournament_id === tournamentId)
      .map((row) => row.id);
    const tournamentMatchBatches = tournamentMatchIdsForCleanup.length
      ? Array.from(
        { length: Math.ceil(tournamentMatchIdsForCleanup.length / 10) },
        (_, index) => tournamentMatchIdsForCleanup.slice(index * 10, (index + 1) * 10),
      )
      : [];
    for (const matchBatch of tournamentMatchBatches) {
      await applyCleanupBatch(matchBatch, [tournamentId]);
    }
    await applyCleanupBatch([], [tournamentId]);
  }
  if (!derivedRefreshCompleted) {
    for (const profileId of affectedProfileIds) {
      const { error } = await supabase.rpc("rankball_rebuild_profile_match_summary", { p_profile_id: profileId });
      if (error) throw error;
    }
    for (const courtId of affectedCourtIds) {
      const { error } = await supabase.rpc("rankball_refresh_court_metrics", { p_court_id: courtId });
      if (error) throw error;
    }
  }

  let remainingMatches = 0;
  if (matchIds.length) {
    const { count, error } = await supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .in("id", matchIds);
    if (error) throw error;
    remainingMatches = Number(count ?? 0);
  }
  let remainingTournaments = 0;
  if (tournamentIds.length) {
    const { count, error } = await supabase
      .from("tournaments")
      .select("id", { count: "exact", head: true })
      .in("id", tournamentIds);
    if (error) throw error;
    remainingTournaments = Number(count ?? 0);
  }
  return {
    ok: remainingMatches === 0 && remainingTournaments === 0,
    deletedMatches,
    deletedTournaments,
    refreshedProfiles: affectedProfileIds.size,
    refreshedCourts: affectedCourtIds.size,
    derivedRefreshCompleted,
    remainingMatches,
    remainingTournaments,
    remainingNotifications: 0,
    remainingDiscordDeliveries: 0,
  };
}

async function cleanup() {
  const profileDiscordRestore = await restoreTemporaryProfileDiscordUsers();
  const profileIdentityRestore = await restoreTemporaryProfileIdentities();
  const refereeSimulationCleanup = await cleanupRefereeSimulationRows();
  const ratingRestore = await restoreRatingSnapshots();
  if (keepRows) {
    return {
      skipped: true,
      reason: "keep_requested",
      profileDiscordRestore,
      profileIdentityRestore,
      refereeSimulationCleanup,
      ratingRestore,
      teamEmblemObjectCleanup: { skipped: true, reason: "keep_requested" },
      notificationCleanup: { skipped: true, reason: "keep_requested" },
      recruitingCleanup: { skipped: true, reason: "keep_requested" },
      regressionCleanup: { skipped: true, reason: "keep_requested" },
    };
  }
  const teamEmblemObjectCleanup = await cleanupTeamEmblemSimulationObjects();
  const notificationCleanup = await cleanupSimulationNotifications();
  const regressionCleanup = await cleanupRegressionSimulationRows();
  if (!supabase) return { skipped: true, reason: "service_role_key_missing", profileDiscordRestore, profileIdentityRestore, refereeSimulationCleanup, ratingRestore, teamEmblemObjectCleanup, notificationCleanup, regressionCleanup };

  const artifactCleanup = await cleanupTrackedMatchArtifacts();
  const errors = artifactCleanup.ok === false
    ? [{ table: "tracked_artifacts", message: "tracked simulation artifact cleanup failed" }]
    : [];
  const recruitingCleanup = await cleanupSimulationRecruitingPosts();
  return {
    skipped: false,
    errors,
    artifactCleanup,
    profileDiscordRestore,
    profileIdentityRestore,
    refereeSimulationCleanup,
    ratingRestore,
    teamEmblemObjectCleanup,
    notificationCleanup,
    recruitingCleanup,
    regressionCleanup,
  };
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
  verifyUnrankedNoRating = false,
  serverGeneratedPostId = false,
  verifyRefereeAbsence = false,
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
    await step(`${ids.label}:ensureRefereeEligible`, () => ensureSimulationRefereeEligibility(refereeId, ids.label));
  }
  if (verifyRatingCommit || verifyUnrankedNoRating) {
    await step(`${ids.label}:snapshotRatingSubjects`, () => snapshotRatingSubjects([hostId, opponentId]));
  }

  const scheduleDraft = scheduledOffsetHours > 0 ? getKstFutureSchedule(scheduledOffsetHours) : { timingType: "instant" };
  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    ...(!serverGeneratedPostId ? { preferredPostId: ids.postId } : {}),
    draft: {
      ...(!serverGeneratedPostId ? { id: ids.postId } : {}),
      title: getSimulationDisplayTitle(ids.label),
      visibility: "public",
      hostJoinMode: "player",
      matchPurpose: ranked ? "competitive" : "friendly",
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
      courtId: simulationCourtId,
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        matchPurpose: ranked ? "competitive" : "friendly",
        formationMode: "prearranged",
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  if (serverGeneratedPostId) {
    assertFlow(/^q_[a-z0-9_]+$/i.test(createResult?.postId ?? ""), "server-generated recruiting post id missing", createResult);
    ids.postId = createResult.postId;
  }
  let post = createResult?.post;
  assertFlow(post?.id === ids.postId, "created post not returned", createResult);
  assertFlow(post.ownerId === hostId || post.playerId === hostId, "created post owner mismatch", { hostId, post });
  assertFlow(
    Number(createResult?.discordDeliveryCount ?? 0) === 0 && createResult?.discordDeliveryDeferred !== true,
    "room creation must not queue Discord opening delivery",
    createResult,
  );

  if (refereeWanted) {
    const refereeInviteResult = await step(`${ids.label}:inviteRecruitingReferee`, () => syncRecruitingAs(hostLogin, {
      action: "inviteRecruitingReferee",
      postId: ids.postId,
      refereeId,
    }));
    assertFlow(refereeInviteResult?.sqlReducer === true, "referee invitation did not use SQL reducer", refereeInviteResult);
    post = await getRecruitingPostAfterResult(refereeInviteResult, hostLogin, `${ids.label}:loadAfterRefereeInvite`);
    const refereeInvitation = post?.roomState?.invitations?.find((item) => (
      item.targetUserId === refereeId && item.role === "referee" && item.status === "pending"
    ));
    assertFlow(Boolean(refereeInvitation?.id), "referee invitation not persisted", { refereeId, post });
    const refereeAcceptResult = await step(`${ids.label}:acceptRecruitingInvitation:referee`, () => syncRecruitingAs(refereeLogin, {
      action: "acceptRecruitingInvitation",
      postId: ids.postId,
      invitationId: refereeInvitation.id,
    }));
    assertFlow(refereeAcceptResult?.sqlReducer === true, "referee invitation accept did not use SQL reducer", refereeAcceptResult);
    post = await getRecruitingPostAfterResult(refereeAcceptResult, refereeLogin, `${ids.label}:loadAfterRefereeAccept`);
    assertFlow(post?.refereeId === refereeId, "referee invitation accept not persisted", { refereeId, post });
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
  assertFlow(confirmResult?.confirmationAtomic === true, "recruiting confirmation was not atomic", confirmResult);
  let match = confirmResult?.createdMatch;
  assertFlow(match?.id === ids.matchId, "confirmed match not returned", confirmResult);
  assertFlow(match?.recruitingPostId === ids.postId, "confirmed match recruiting post link not persisted", { postId: ids.postId, match });
  if (refereeWanted) assertFlow(match.refereeId === refereeId, "match referee not persisted", { refereeId, match });
  assertFlow(match.teamA?.players?.includes(hostId), "host missing from teamA", match);
  assertFlow(match.teamB?.players?.includes(opponentId), "opponent missing from teamB", match);

  if (verifyRefereeAbsence) {
    const requestResult = await step(`${ids.label}:requestMatchRefereeAbsence`, () => syncMatchAs(hostLogin, {
      action: "requestMatchRefereeAbsence",
      matchId: ids.matchId,
    }));
    assertFlow(requestResult?.sqlReducer === true && requestResult?.advisoryLocked === true, "referee absence request SQL reducer not used", requestResult);
    match = await getMatchAfterResult(requestResult, hostLogin, `${ids.label}:loadAfterRefereeAbsenceRequest`);
    assertFlow(match?.refereeAbsenceRequest?.status === "pending", "referee absence request not persisted", match);
    const confirmAbsenceResult = await step(`${ids.label}:confirmMatchRefereeAbsence`, () => syncMatchAs(opponentLogin, {
      action: "confirmMatchRefereeAbsence",
      matchId: ids.matchId,
    }));
    assertFlow(confirmAbsenceResult?.sqlReducer === true && confirmAbsenceResult?.advisoryLocked === true, "referee absence confirm SQL reducer not used", confirmAbsenceResult);
    match = await getMatchAfterResult(confirmAbsenceResult, opponentLogin, `${ids.label}:loadAfterRefereeAbsenceConfirm`);
    assertFlow(!match?.refereeId && match?.formerRefereeId === refereeId && match?.refereeAbsenceRequest?.status === "confirmed", "referee absence confirmation not persisted", match);
    return {
      label: ids.label,
      hostLogin,
      opponentLogin,
      refereeLogin,
      hostId,
      opponentId,
      refereeId,
      postId: ids.postId,
      matchId: ids.matchId,
      finalStatus: match.status,
      refereeAbsenceConfirmed: true,
      sqlReducers: {
        inviteRecruitingReferee: true,
        requestMatchRefereeAbsence: true,
        confirmMatchRefereeAbsence: true,
      },
    };
  }

  const reminderChecks = {};
  if (scheduledOffsetHours > 0) {
    reminderChecks.afterConfirm = await step(`${ids.label}:remindersAfterConfirm`, () => assertPendingMatchNotices(
      ids.matchId,
      CURRENT_MATCH_SCHEDULED_NOTICE_PREFIXES,
      { minNotifications: 1 },
    ));
  }

  let agreeASqlReducer = false;
  let agreeBSqlReducer = false;
  if (!match.agreements?.teamA?.includes(hostId)) {
    const agreeAResult = await step(`${ids.label}:agreeMatch:teamA`, () => syncMatchAs(hostLogin, {
      action: "agreeMatch",
      matchId: ids.matchId,
      sideName: "teamA",
      playerId: hostId,
    }));
    agreeASqlReducer = Boolean(agreeAResult?.sqlReducer);
    assertFlow(agreeASqlReducer, "teamA agreement operation-only SQL reducer not used", agreeAResult);
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
  }, refereeWanted ? { match: matchWithOpponentAttendance } : {}));
  if (!refereeWanted) assertFlow(Boolean(checkInBResult?.sqlReducer), "teamB check-in operation-only SQL reducer not used", checkInBResult);
  match = await getMatchAfterResult(checkInBResult, operatorLogin, `${ids.label}:loadAfterCheckInTeamB`);
  assertFlow(match?.attendance?.teamB?.includes(opponentId), "teamB check-in not persisted", match);

  const matchWithStart = withStartedMatch(match, operatorLogin === hostLogin ? hostId : refereeId);
  const startResult = await step(`${ids.label}:startMatch`, () => syncMatchAs(operatorLogin, {
    action: "startMatch",
    matchId: ids.matchId,
  }, refereeWanted ? { match: matchWithStart } : {}));
  if (!refereeWanted) assertFlow(Boolean(startResult?.sqlReducer), "start operation-only SQL reducer not used", startResult);
  match = await getMatchAfterResult(startResult, operatorLogin, `${ids.label}:loadAfterStartMatch`);
  assertFlow(Boolean(match?.startedAt), "match start not persisted", match);
  if (scheduledOffsetHours > 0) {
    reminderChecks.afterStart = await step(`${ids.label}:remindersAfterStart`, () => assertPendingMatchNotices(
      ids.matchId,
      MATCH_SCHEDULED_NOTICE_PREFIXES,
      { maxNotifications: 0 },
    ));
  }

  let scoreWrite = null;
  if (!refereeWanted) {
    scoreWrite = await setMatchScoreByIncrements({
      label: ids.label,
      login: operatorLogin,
      match,
      scoreA: 21,
      scoreB: 12,
    });
    match = scoreWrite.match;
    assertFlow(match?.result?.scoreA === 21 && match?.result?.scoreB === 12, "team score result not persisted", match);
  }

  const matchWithEnd = withEndedMatch(match);
  const endResult = await step(`${ids.label}:endMatch`, () => syncMatchAs(operatorLogin, {
    action: "endMatch",
    matchId: ids.matchId,
  }, refereeWanted ? { match: matchWithEnd } : {}));
  if (!refereeWanted) assertFlow(Boolean(endResult?.sqlReducer), "end operation-only SQL reducer not used", endResult);
  match = await getMatchAfterResult(endResult, operatorLogin, `${ids.label}:loadAfterEndMatch`);
  assertFlow(Boolean(match?.endedAt), "match end not persisted", match);
  reminderChecks.afterEnd = await step(`${ids.label}:postgameAfterEnd`, () => assertPendingMatchNotices(
    ids.matchId,
    MATCH_POSTGAME_NOTICE_PREFIXES,
    { minNotifications: 1 },
  ));

  let latePlayerSqlReducers = null;
  if (includeLatePlayer && !refereeWanted) {
    await expectRejected(`${ids.label}:addMatchLatePlayer:retired`, () => syncMatchAs(operatorLogin, {
      action: "addMatchLatePlayer",
      matchId: ids.matchId,
      draft: {
        sideName: "teamA",
        name: "Backend Anonymous",
      },
    }), ["unsupported_match_operation"]);
    latePlayerSqlReducers = {
      add: false,
      remove: false,
      retired: true,
    };
  }

  if (refereeWanted) {
    scoreWrite = await setMatchScoreByIncrements({
      label: ids.label,
      login: operatorLogin,
      match,
      scoreA: 21,
      scoreB: 12,
    });
    match = scoreWrite.match;
    assertFlow(match?.result?.scoreA === 21 && match?.result?.scoreB === 12, "team score result not persisted", match);

    const resultSubmit = await step(`${ids.label}:submitMatchResult`, () => syncMatchAs(operatorLogin, {
      action: "submitMatchResult",
      matchId: ids.matchId,
      result: makeResult(match),
    }));
    match = resultSubmit?.match;
    assertFlow(Boolean(match?.endedAt && match?.result && !match?.confirmedAt), "referee match result not persisted", match);
    assertFlow(match.result.scoreA === 21 && match.result.scoreB === 12, "referee stats submission changed team score", match.result);
    assertFlow(match.result.submittedBy === refereeId, "referee result submitter not persisted", { refereeId, result: match.result });
  } else {
    assertFlow(Object.keys(match?.result?.playerStats ?? {}).length === 0, "no-referee match persisted personal stats", match);
  }

  const finalizeResult = await step(`${ids.label}:finalizeMatch`, () => syncMatchAs(operatorLogin, {
    action: "finalizeMatch",
    matchId: ids.matchId,
  }));
  match = await getMatchAfterResult(finalizeResult, operatorLogin, `${ids.label}:loadAfterFinalizeMatch`);
  assertFlow(match?.status === "confirmed", "authority finalization did not confirm match", match);
  assertFlow(Boolean(finalizeResult?.sqlReducer), "finalize SQL reducer not used", finalizeResult);
  reminderChecks.afterSubmitResult = await step(`${ids.label}:postgameAfterFinalize`, () => assertPendingMatchNotices(
    ids.matchId,
    MATCH_POSTGAME_NOTICE_PREFIXES,
    { maxNotifications: 0 },
  ));

  if (verifyRatingCommit) {
    assertFlow(finalizeResult?.ratingCommitted === true, "rating commit RPC was not used", finalizeResult);
    assertFlow(finalizeResult?.ratingAtomic === true, "match confirmation and rating commit were not atomic", finalizeResult);
    assertFlow(Array.isArray(match?.ratingResult) && match.ratingResult.length > 0, "rating result missing after ranked confirmation", match);
    const responseUserIds = new Set((finalizeResult?.state?.users ?? []).map((user) => user.id));
    assertFlow(responseUserIds.has(hostId) && responseUserIds.has(opponentId), "rating commit response missing DB users", {
      hostId,
      opponentId,
      users: finalizeResult?.state?.users,
    });
  }
  if (verifyUnrankedNoRating) {
    assertFlow(ranked === false && match?.ranked === false, "unranked rating verification requires friendly match", match);
    assertFlow(finalizeResult?.ratingCommitted === true && finalizeResult?.ratingAtomic === true, "unranked confirmation was not atomic", finalizeResult);
    assertFlow(Array.isArray(match?.ratingResult) && match.ratingResult.length === 0, "unranked match produced rating changes", match);
    await step(`${ids.label}:assertUnrankedRatingsUnchanged`, () => assertProfileRatingsUnchanged([hostId, opponentId]));
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
    ratingCommitted: verifyRatingCommit ? Boolean(finalizeResult?.ratingCommitted) : undefined,
    ratingAtomic: verifyRatingCommit ? Boolean(finalizeResult?.ratingAtomic) : undefined,
    sqlReducers: {
      setRecruitingReady: Boolean(readyResult?.sqlReducer),
      agreeMatch: agreeASqlReducer || agreeBSqlReducer,
      checkInMatchPlayer: Boolean(checkInBResult?.sqlReducer),
      startMatch: Boolean(startResult?.sqlReducer),
      endMatch: Boolean(endResult?.sqlReducer),
      incrementMatchScore: Boolean(scoreWrite?.sqlReducer),
      finalizeMatch: Boolean(finalizeResult?.sqlReducer),
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
      title: getSimulationDisplayTitle(ids.label),
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
      courtId: simulationCourtId,
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
  assertFlow(confirmResult?.confirmationAtomic === true, "recruiting confirmation was not atomic", confirmResult);
  let match = confirmResult?.createdMatch;
  assertFlow(match?.id === ids.matchId, "reminder match not returned", confirmResult);

  const reminderChecks = {
    afterConfirm: await step(`${ids.label}:remindersAfterConfirm`, () => assertPendingMatchNotices(
      ids.matchId,
      CURRENT_MATCH_SCHEDULED_NOTICE_PREFIXES,
      { minNotifications: 1 },
    )),
  };

  const cancelResult = await step(`${ids.label}:cancelMatch`, () => syncMatchAs(hostLogin, {
    action: "cancelMatch",
    matchId: ids.matchId,
  }));
  assertFlow(cancelResult?.sqlReducer === true, "match cancel did not use SQL reducer", cancelResult);
  match = await getMatchAfterResult(cancelResult, hostLogin, `${ids.label}:loadAfterCancelMatch`);
  assertFlow(match?.status === "cancelled", "reminder match not cancelled", match);
  const hostMatchState = await step(`${ids.label}:matchesListAfterCancel`, () => loadMatchesAs(hostLogin, {
    includeRecentCompleted: false,
    includeClosedNotices: true,
    includeRecordRooms: false,
  }));
  const closedListMatch = (hostMatchState.matches ?? []).find((item) => item.id === ids.matchId);
  const leakedMatchRecord = (hostMatchState.matches ?? []).find((item) => isMatchRecordMatch(item));
  assertFlow(closedListMatch?.status === "cancelled", "cancelled match missing from closed notice list", {
    matchId: ids.matchId,
    returnedStatus: closedListMatch?.status,
  });
  assertFlow(!leakedMatchRecord, "match record leaked into normal match list", {
    matchId: leakedMatchRecord?.id,
  });
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
    closedListChecks: {
      cancelledIncluded: true,
      matchRecordExcluded: true,
    },
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
      title: getSimulationDisplayTitle(ids.label),
      visibility: "private",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      timingType: "instant",
      ranked: false,
      mmrLimitMode: "off",
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: simulationCourtId,
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        matchPurpose: "friendly",
        formationMode: "prearranged",
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

  let inviteResult = await step(`${ids.label}:inviteRecruitingPlayers:invitee`, () => syncRecruitingAs(hostLogin, {
    action: "inviteRecruitingPlayers",
    postId: ids.postId,
    invite: {
      side: "teamB",
      reserve: false,
      joinMode: "player",
      playerIds: [inviteeId],
    },
  }));
  assertFlow(inviteResult?.sqlReducer === true, "player invitation did not use SQL reducer", inviteResult);
  post = await getRecruitingPostAfterResult(inviteResult, hostLogin, `${ids.label}:loadAfterInvite`);
  assertStateIncludesUsers(inviteResult, [hostId, inviteeId], "invite mutation response missing feed users");
  let invitation = post?.roomState?.invitations?.find((item) => (
    item.targetUserId === inviteeId &&
    item.status === "pending" &&
    item.role !== "referee"
  ));
  assertFlow(Boolean(invitation), "player invitation not persisted", { inviteeId, post });

  const declineResult = await step(`${ids.label}:declineRecruitingInvitation`, () => syncRecruitingAs(inviteeLogin, {
    action: "declineRecruitingInvitation",
    postId: ids.postId,
    invitationId: invitation.id,
  }));
  assertFlow(declineResult?.sqlReducer === true, "player invitation decline did not use SQL reducer", declineResult);
  post = await getRecruitingPostAfterResult(declineResult, inviteeLogin, `${ids.label}:loadAfterDecline`);
  assertFlow(!hasPendingInvitationFor(post, inviteeId), "declined invitation still pending", { inviteeId, post });

  inviteResult = await step(`${ids.label}:inviteRecruitingPlayers:invitee:again`, () => syncRecruitingAs(hostLogin, {
    action: "inviteRecruitingPlayers",
    postId: ids.postId,
    invite: {
      side: "teamB",
      reserve: false,
      joinMode: "player",
      playerIds: [inviteeId],
    },
  }));
  assertFlow(inviteResult?.sqlReducer === true, "reissued player invitation did not use SQL reducer", inviteResult);
  post = await getRecruitingPostAfterResult(inviteResult, hostLogin, `${ids.label}:loadAfterReinvite`);
  invitation = post?.roomState?.invitations?.find((item) => (
    item.targetUserId === inviteeId &&
    item.status === "pending" &&
    item.role !== "referee"
  ));
  assertFlow(Boolean(invitation), "reissued player invitation not persisted", { inviteeId, post });

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
  assertFlow(acceptResult?.sqlReducer === true, "player invitation accept did not use SQL reducer", acceptResult);
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
  assertFlow(confirmResult?.confirmationAtomic === true, "recruiting confirmation was not atomic", confirmResult);
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
    inviteDeclined: true,
    matchCreated: true,
    sqlReducers: {
      invite: true,
      decline: true,
      accept: true,
    },
  };
}

async function runMatchAgreeSqlReducerScenario({
  label,
  hostLogin,
  teamALogin,
  teamBLogins = [],
}) {
  ids = makeScenarioIds(label);
  if (!supabase) {
    return { label: ids.label, skipped: true, reason: "service_role_key_missing" };
  }
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const teamAPlayerId = await step(`${ids.label}:resolveProfile:teamA`, () => getProfileIdForLogin(teamALogin));
  const teamBPlayers = [];
  for (const login of teamBLogins) {
    teamBPlayers.push({
      login,
      id: await step(`${ids.label}:resolveProfile:${login}`, () => getProfileIdForLogin(login)),
    });
  }
  const allIds = [hostId, teamAPlayerId, ...teamBPlayers.map((player) => player.id)];
  assertFlow(new Set(allIds).size === allIds.length && teamBPlayers.length === 2, "agree SQL reducer scenario needs four unique profiles", {
    hostId,
    teamAPlayerId,
    teamBPlayers,
  });

  const now = new Date().toISOString();
  let match = {
    id: ids.matchId,
    title: getSimulationDisplayTitle(ids.label),
    mode: "2v2",
    courtId: simulationCourtId,
    court: "Backend Simulation Court",
    scheduledDate: "",
    scheduledTime: "",
    scheduledAt: "instant",
    timingType: "instant",
    visibility: "private",
    status: "agreed",
    ranked: false,
    official: false,
    preRegistered: true,
    refereeId: "",
    refereeTrustMin: 90,
    statEntryMinutes: 60,
    disputeMinutes: 120,
    memo: "Backend simulation agree SQL reducer row. Safe to delete.",
    stakes: "Backend simulation",
    mmrLimitMode: "off",
    rules: {
      targetScore: 21,
      timeLimit: 12,
      winByTwo: true,
      ball: "7",
      timingType: "instant",
      visibility: "private",
      mmrRangeMode: "off",
      playedPlayerIds: { teamA: [], teamB: [] },
      mmrExcludedPlayerIds: [],
    },
    createdBy: hostId,
    agreedAt: now,
    createdAt: now,
    updatedAt: now,
    teamA: { name: "Team A", teamId: null, players: [hostId, teamAPlayerId], score: 0 },
    teamB: { name: "Team B", teamId: null, players: teamBPlayers.map((player) => player.id), score: 0 },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    playedPlayerIds: { teamA: [], teamB: [] },
    reservePlayers: { teamA: [], teamB: [] },
    promotedReserveIds: { teamA: [], teamB: [] },
    attendance: { teamA: [], teamB: [] },
    result: null,
  };
  await step(`${ids.label}:persistMatch`, () => persistMatchSnapshot(
    { supabase, profileId: hostId },
    { match, notifications: [], action: "createMatch", body: {}, trustedServerCreate: true },
  ));

  const playerLogins = new Map([
    [hostId, hostLogin],
    [teamAPlayerId, teamALogin],
    ...teamBPlayers.map((player) => [player.id, player.login]),
  ]);
  const candidates = ["teamA", "teamB"].flatMap((sideName) => (
    (match[sideName]?.players ?? []).map((playerId) => ({
      sideName,
      playerId,
      login: playerLogins.get(playerId),
      agreed: false,
    }))
  ));
  const remaining = candidates.filter((candidate) => !candidate.agreed && candidate.login);
  assertFlow(remaining.length > 1, "agree SQL scenario needs more than one remaining agreement", { match, candidates });
  const target = remaining[0];
  const agreeResult = await step(`${ids.label}:agreeMatch:${target.sideName}`, () => syncMatchAs(target.login, {
    action: "agreeMatch",
    matchId: ids.matchId,
    sideName: target.sideName,
    playerId: target.playerId,
  }));
  assertFlow(Boolean(agreeResult?.sqlReducer), "agreeMatch SQL reducer not used", agreeResult);
  match = await getMatchAfterResult(agreeResult, target.login, `${ids.label}:loadAfterAgree`);
  assertFlow((match.agreements?.[target.sideName] ?? []).includes(target.playerId), "agree SQL agreement not persisted", match);

  return {
    label: ids.label,
    postId: ids.postId,
    matchId: ids.matchId,
    agreedPlayerId: target.playerId,
    agreedSide: target.sideName,
    sqlReducer: true,
  };
}

async function runPublicTeamRegionFeedScenario({
  label,
  hostLogin,
  teammateLogin,
  teamId,
  opponentCaptainLogin,
  opponentMemberLogin,
  opponentTeamId,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const teammateId = await step(`${ids.label}:resolveProfile:teammate`, () => getProfileIdForLogin(teammateLogin));
  const opponentCaptainId = await step(`${ids.label}:resolveProfile:opponentCaptain`, () => getProfileIdForLogin(opponentCaptainLogin));
  const opponentMemberId = await step(`${ids.label}:resolveProfile:opponentMember`, () => getProfileIdForLogin(opponentMemberLogin));
  assertFlow(hostId !== teammateId, "public team host and teammate must be different profiles", { hostId, teammateId });
  assertFlow(opponentCaptainId !== opponentMemberId, "public team opponent captain and member must be different profiles", {
    opponentCaptainId,
    opponentMemberId,
  });
  const resolvedTeamId = await step(`${ids.label}:resolveTeam`, () => resolveTeamIdForMembers(hostLogin, [hostId, teammateId], teamId));
  const resolvedOpponentTeamId = await step(`${ids.label}:resolveOpponentTeam`, () => resolveTeamIdForMembers(
    opponentCaptainLogin,
    [opponentCaptainId, opponentMemberId],
    opponentTeamId,
  ));
  assertFlow(resolvedTeamId !== resolvedOpponentTeamId, "public team scenario requires different teams", {
    resolvedTeamId,
    resolvedOpponentTeamId,
  });

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: getSimulationDisplayTitle(ids.label),
      visibility: "public",
      hostJoinMode: "team",
      matchIntent: "friendly",
      matchPurpose: "friendly",
      formationMode: "prearranged",
      mode: "2v2",
      sideCapacity: 2,
      timingType: "instant",
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: true,
      refereeWanted: false,
      region: "마포",
      courtId: simulationCourtId,
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation row. Safe to delete.",
      rules: {
        matchIntent: "friendly",
        matchPurpose: "friendly",
        formationMode: "prearranged",
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  const createdPost = createResult?.post;
  assertFlow(createdPost?.id === ids.postId, "created public team post not returned", createResult);
  assertFlow(
    createdPost.visibility === "public"
      && createdPost.hostJoinMode === "team"
      && !createdPost.teamId
      && !(createdPost.playerIds ?? []).length,
    "public team room must start without a selected team or roster",
    createdPost,
  );
  const teamSelectionResult = await step(`${ids.label}:selectHostTeam`, () => syncRecruitingAs(hostLogin, {
    action: "setRecruitingRoomTeam",
    postId: ids.postId,
    side: "teamA",
    teamId: resolvedTeamId,
  }));
  const selectedPost = await getRecruitingPostAfterResult(teamSelectionResult, hostLogin, `${ids.label}:loadAfterHostTeamSelection`);
  assertFlow(
    selectedPost.teamId === resolvedTeamId
      && (selectedPost.playerIds ?? []).length === 1
      && selectedPost.playerIds[0] === hostId,
    "public team room host selection did not persist one captain representative",
    selectedPost,
  );
  const regionResult = await step(`${ids.label}:regionFeed:createdRegion`, () => loadRecruitingRegionAs(hostLogin, {
    regionKey: selectedPost.region,
    startFilter: "instant",
  }));
  assertFlow(Boolean(regionResult.post), "public team post missing from its canonical court region feed", {
    postId: ids.postId,
    region: selectedPost.region,
    page: regionResult.payload?.page,
  });
  assertFlow(regionResult.payload?.page?.feedCounts == null, "region feed unexpectedly loaded profile feed counts", {
    page: regionResult.payload?.page,
  });
  assertFlow((regionResult.payload?.state?.teams ?? []).some((team) => team.id === resolvedTeamId), "public team region feed missing host team attachment", {
    teamId: resolvedTeamId,
    teams: regionResult.payload?.state?.teams ?? [],
  });

  const partyJoinResult = await step(`${ids.label}:joinRecruitingSideParty:teammate`, () => syncRecruitingAs(teammateLogin, {
    action: "joinRecruitingSideParty",
    postId: ids.postId,
    teamId: resolvedTeamId,
    sideName: "teamA",
    entryId: "host",
  }));
  let joinedPost = await getRecruitingPostAfterResult(partyJoinResult, teammateLogin, `${ids.label}:loadAfterPartyJoin`);
  assertFlow((joinedPost.playerIds ?? []).includes(teammateId), "public team member did not join the host party", {
    teammateId,
    playerIds: joinedPost.playerIds ?? [],
    partyReserves: joinedPost.roomState?.partyReserves ?? {},
  });
  assertFlow(!(joinedPost.applicants ?? []).some((applicant) => applicant.playerId === teammateId && applicant.kind === "team"), "party join created a duplicate team application", {
    teammateId,
    applicants: joinedPost.applicants ?? [],
  });

  const reserveResult = await step(`${ids.label}:setRecruitingPartyPlayerReserve:true`, () => syncRecruitingAs(teammateLogin, {
    action: "setRecruitingPartyPlayerReserve",
    postId: ids.postId,
    entryId: "host",
    playerId: teammateId,
    reserve: true,
  }));
  assertFlow(reserveResult?.sqlReducer === true && reserveResult?.advisoryLocked === true, "party reserve SQL reducer not used", reserveResult);
  joinedPost = await getRecruitingPostAfterResult(reserveResult, teammateLogin, `${ids.label}:loadAfterPartyReserve`);
  assertFlow((joinedPost?.roomState?.partyReserves?.host ?? []).includes(teammateId), "party reserve not persisted", joinedPost);

  const activeResult = await step(`${ids.label}:setRecruitingPartyPlayerReserve:false`, () => syncRecruitingAs(teammateLogin, {
    action: "setRecruitingPartyPlayerReserve",
    postId: ids.postId,
    entryId: "host",
    playerId: teammateId,
    reserve: false,
  }));
  assertFlow(activeResult?.sqlReducer === true && activeResult?.advisoryLocked === true, "party active SQL reducer not used", activeResult);
  joinedPost = await getRecruitingPostAfterResult(activeResult, teammateLogin, `${ids.label}:loadAfterPartyActive`);
  assertFlow(!(joinedPost?.roomState?.partyReserves?.host ?? []).includes(teammateId) && (joinedPost?.playerIds ?? []).includes(teammateId), "party active placement not persisted", joinedPost);

  const nonCaptainJoin = await expectRejected(
    `${ids.label}:rejectOpponentNonCaptainRepresentative`,
    () => syncRecruitingAs(opponentMemberLogin, {
      action: "interestRecruitingPost",
      postId: ids.postId,
      joinMode: "team",
      application: {
        joinMode: "team",
        teamId: resolvedOpponentTeamId,
        side: "teamB",
        playerIds: [opponentMemberId],
      },
    }),
    ["recruiting_team_captain_required"],
  );
  assertFlow(nonCaptainJoin.rejected, "public team room accepted a non-captain representative", nonCaptainJoin);

  const opponentJoinResult = await step(`${ids.label}:joinOpponentRepresentative`, () => syncRecruitingAs(opponentCaptainLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    joinMode: "team",
    application: {
      joinMode: "team",
      teamId: resolvedOpponentTeamId,
      side: "teamB",
      playerIds: [opponentCaptainId, opponentMemberId],
      reservePlayerIds: [opponentMemberId],
      reserve: true,
    },
  }));
  joinedPost = await getRecruitingPostAfterResult(opponentJoinResult, opponentCaptainLogin, `${ids.label}:loadAfterOpponentJoin`);
  const opponentApplication = (joinedPost.applicants ?? []).find((applicant) => (
    applicant.kind === "team" && applicant.teamId === resolvedOpponentTeamId
  ));
  assertFlow(
    opponentApplication?.playerId === opponentCaptainId
      && opponentApplication.side === "teamB"
      && opponentApplication.reserve === false
      && JSON.stringify(opponentApplication.playerIds ?? []) === JSON.stringify([opponentCaptainId]),
    "public team opponent application was not normalized to one captain representative",
    opponentApplication,
  );
  assertFlow(
    !((joinedPost.roomState?.partyReserves?.[`team:${resolvedOpponentTeamId}`] ?? []).length),
    "public team representative join persisted reserve players",
    joinedPost.roomState?.partyReserves,
  );

  return {
    label: ids.label,
    hostLogin,
    teammateLogin,
    teamId: resolvedTeamId,
    hostId,
    teammateId,
    opponentCaptainId,
    opponentMemberId,
    postId: ids.postId,
    publicRegionFeed: true,
    partyJoin: true,
    partyReserveRoundTrip: true,
    opponentRepresentativeJoin: true,
  };
}

async function runTeamMembershipInviteScenario({
  label,
  captainLogin,
  targetLogin,
  teamId,
}) {
  ids = makeScenarioIds(label);
  assertFlow(Boolean(supabase), "team membership invite scenario requires service role client");
  const captainId = await step(`${ids.label}:resolveProfile:captain`, () => getProfileIdForLogin(captainLogin));
  const targetId = await step(`${ids.label}:resolveProfile:target`, () => getProfileIdForLogin(targetLogin));
  assertFlow(captainId !== targetId, "team invite captain and target must be different profiles", { captainId, targetId });

  const { data: captainMemberships, error: captainMembershipError } = await step(`${ids.label}:verifyCaptain`, () => supabase
    .from("team_members")
    .select("team_id,user_id,role")
    .eq("user_id", captainId)
    .eq("role", "captain"));
  if (captainMembershipError) throw captainMembershipError;
  const captainMembership = (captainMemberships ?? []).find((membership) => membership.team_id === teamId)
    ?? (captainMemberships ?? [])[0];
  const resolvedTeamId = captainMembership?.team_id;
  assertFlow(Boolean(resolvedTeamId), "team invite actor is not captain", { captainId, teamId });

  const [{ data: existingMember, error: existingMemberError }, { data: existingPending, error: existingPendingError }] = await step(
    `${ids.label}:verifyTargetAvailable`,
    () => Promise.all([
      supabase.from("team_members").select("team_id,user_id").eq("team_id", resolvedTeamId).eq("user_id", targetId).maybeSingle(),
      supabase.from("team_invitations").select("id").eq("team_id", resolvedTeamId).eq("target_user_id", targetId).eq("status", "pending").limit(1).maybeSingle(),
    ]),
  );
  if (existingMemberError) throw existingMemberError;
  if (existingPendingError) throw existingPendingError;
  assertFlow(!existingMember && !existingPending, "team invite target is not clean", {
    targetId,
    teamId: resolvedTeamId,
    existingMember: Boolean(existingMember),
    existingPendingInvitation: Boolean(existingPending),
  });

  const invitationId = `sim_ti_${ids.label}_${suffix}`;
  teamInvitationSimulationIds.add(invitationId);
  simulationNotificationIds.add(`n_${invitationId}`);
  const inviteResult = await step(`${ids.label}:inviteTeamMember`, () => syncTeamAs(captainLogin, {
    teamInviteAction: "invite",
    teamId: resolvedTeamId,
    targetUserId: targetId,
    invitationId,
    role: "regular",
  }));
  assertFlow(inviteResult?.ok && inviteResult?.invitationId === invitationId, "team invitation result mismatch", {
    ok: inviteResult?.ok,
    invitationId: inviteResult?.invitationId,
  });

  const profileResult = await step(`${ids.label}:profileMe:pendingInvite`, () => loadProfileMeAs(targetLogin));
  const pendingInvitation = (profileResult.state.teamInvitations ?? []).find((invitation) => invitation.id === invitationId);
  assertFlow(
    profileResult.state.currentUserId === targetId &&
      pendingInvitation?.teamId === resolvedTeamId &&
      pendingInvitation?.targetUserId === targetId &&
      pendingInvitation?.status === "pending" &&
      (profileResult.state.teams ?? []).some((team) => team.id === resolvedTeamId),
    "profile me pending team invitation mismatch",
    {
      currentUserId: profileResult.state.currentUserId,
      targetId,
      invitationStatus: pendingInvitation?.status,
      invitationTeamId: pendingInvitation?.teamId,
    },
  );

  const declineResult = await step(`${ids.label}:declineTeamInvitation`, () => syncTeamAs(targetLogin, {
    teamInviteAction: "decline",
    invitationId,
  }));
  assertFlow(declineResult?.ok && declineResult?.status === "declined", "team invitation decline result mismatch", {
    ok: declineResult?.ok,
    status: declineResult?.status,
    invitationId: declineResult?.invitationId,
  });

  const { data: invitationRow, error: invitationRowError } = await step(`${ids.label}:verifyDeclinedRow`, () => supabase
    .from("team_invitations")
    .select("id,team_id,target_user_id,status")
    .eq("id", invitationId)
    .maybeSingle());
  if (invitationRowError) throw invitationRowError;
  assertFlow(invitationRow?.status === "declined", "declined team invitation not persisted", {
    invitationId,
    status: invitationRow?.status,
  });

  return {
    label: ids.label,
    teamId: resolvedTeamId,
    captainId,
    targetId,
    invitationId,
    profilePendingState: true,
    response: "declined",
  };
}

async function runTeamLifecycleScenario({
  label,
  captainLogin,
  acceptedMemberLogin,
  cancelledInviteLogin,
}) {
  ids = makeScenarioIds(label);
  const captainId = await step(`${ids.label}:resolveProfile:captain`, () => getProfileIdForLogin(captainLogin));
  const acceptedMemberId = await step(`${ids.label}:resolveProfile:acceptedMember`, () => getProfileIdForLogin(acceptedMemberLogin));
  const cancelledInviteId = await step(`${ids.label}:resolveProfile:cancelledInvite`, () => getProfileIdForLogin(cancelledInviteLogin));
  assertFlow(new Set([captainId, acceptedMemberId, cancelledInviteId]).size === 3, "team lifecycle profiles must be unique", {
    captainId,
    acceptedMemberId,
    cancelledInviteId,
  });
  const teamId = `sim_team_${ids.label}_${suffix}`;
  teamSimulationIds.add(teamId);
  const forcedInitialMember = await expectRejected(`${ids.label}:rejectForcedInitialMember`, () => syncTeamAs(captainLogin, {
    team: {
      id: teamId,
      name: `SIM-G-${suffix.slice(-6)}`,
      region: "Backend Simulation",
      homeCourt: "Backend Simulation Court",
      accent: "#58d2c0",
      members: [
        { userId: captainId, role: "captain" },
        { userId: acceptedMemberId, role: "regular" },
      ],
    },
  }), ["team_initial_member_must_be_actor_captain"]);
  assertFlow(forcedInitialMember.rejected, "new team accepted a member without an invitation", forcedInitialMember);
  const createResult = await step(`${ids.label}:createTeam`, () => syncTeamAs(captainLogin, {
    team: {
      id: teamId,
      name: `SIM-A-${suffix.slice(-6)}`,
      region: "서울특별시 마포구",
      homeCourt: "Backend Simulation Court",
      accent: "#58d2c0",
      members: [{ userId: captainId, role: "captain" }],
    },
  }));
  assertFlow(createResult?.ok && createResult?.teamId === teamId, "team create failed", createResult);

  const acceptedInvitationId = `sim_ti_${ids.label}_accept_${suffix}`;
  teamInvitationSimulationIds.add(acceptedInvitationId);
  const inviteResult = await step(`${ids.label}:inviteAcceptedMember`, () => syncTeamAs(captainLogin, {
    teamInviteAction: "invite",
    teamId,
    targetUserId: acceptedMemberId,
    invitationId: acceptedInvitationId,
    role: "regular",
  }));
  assertFlow(inviteResult?.ok && inviteResult?.invitationId === acceptedInvitationId, "team member invitation failed", inviteResult);
  const acceptResult = await step(`${ids.label}:acceptTeamInvitation`, () => syncTeamAs(acceptedMemberLogin, {
    teamInviteAction: "accept",
    invitationId: acceptedInvitationId,
  }));
  assertFlow(acceptResult?.ok && acceptResult?.status === "accepted", "team invitation accept failed", acceptResult);

  const updateResult = await step(`${ids.label}:updateTeam`, () => syncTeamAs(captainLogin, {
    team: {
      id: teamId,
      name: `SIM-B-${suffix.slice(-6)}`,
      region: "서울특별시 성동구",
      homeCourt: "Updated Simulation Court",
      accent: "#f05d4f",
      members: [
        { userId: captainId, role: "captain" },
        { userId: acceptedMemberId, role: "regular" },
      ],
    },
  }));
  assertFlow(updateResult?.ok && updateResult?.teamId === teamId, "team update failed", updateResult);
  const updatedTeams = await step(`${ids.label}:loadUpdatedTeam`, () => loadTeamsAs(captainLogin));
  const updatedTeam = (updatedTeams.teams ?? []).find((team) => team.id === teamId);
  assertFlow(updatedTeam?.name?.startsWith("SIM-B-") && teamHasMembers(updatedTeam, [captainId, acceptedMemberId]), "updated team state mismatch", updatedTeam);

  const cancelledInvitationId = `sim_ti_${ids.label}_cancel_${suffix}`;
  teamInvitationSimulationIds.add(cancelledInvitationId);
  await step(`${ids.label}:inviteCancelledMember`, () => syncTeamAs(captainLogin, {
    teamInviteAction: "invite",
    teamId,
    targetUserId: cancelledInviteId,
    invitationId: cancelledInvitationId,
    role: "mercenary",
  }));
  const cancelResult = await step(`${ids.label}:cancelTeamInvitation`, () => syncTeamAs(captainLogin, {
    teamInviteAction: "cancel",
    invitationId: cancelledInvitationId,
  }));
  assertFlow(cancelResult?.ok && cancelResult?.status === "cancelled", "team invitation cancel failed", cancelResult);

  const recruitingResult = await step(`${ids.label}:createActiveTeamRecruitingPost`, () => syncRecruitingAs(captainLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: getSimulationDisplayTitle(`${ids.label}_active_reference`),
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
      region: "서울특별시 성동구",
      courtId: simulationCourtId,
      court: "Backend Simulation Court",
      teamId,
      playerIds: [captainId, acceptedMemberId],
      position: "PG",
      memo: "Backend simulation active team reference guard.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  assertFlow(recruitingResult?.post?.id === ids.postId, "active team recruiting reference creation failed", recruitingResult);
  const selectRoomTeamResult = await step(`${ids.label}:selectActiveRecruitingTeam`, () => syncRecruitingAs(captainLogin, {
    action: "setRecruitingRoomTeam",
    postId: ids.postId,
    side: "teamA",
    teamId,
  }));
  assertFlow(
    selectRoomTeamResult?.ok && selectRoomTeamResult?.teamId === teamId,
    "active team recruiting reference team selection failed",
    selectRoomTeamResult,
  );
  const activeReferenceDelete = await expectRejected(
    `${ids.label}:deleteTeamWithActiveReference`,
    () => syncTeamAs(captainLogin, { deletedTeamId: teamId }),
    ["team_has_active_references"],
  );
  assertFlow(activeReferenceDelete.rejected, "team deletion ignored an active recruiting reference", activeReferenceDelete);
  const closeRecruitingResult = await step(`${ids.label}:closeActiveTeamRecruitingPost`, () => syncRecruitingAs(captainLogin, {
    action: "closeRecruitingPost",
    postId: ids.postId,
  }));
  assertFlow(closeRecruitingResult?.ok, "active team recruiting reference close failed", closeRecruitingResult);

  const deleteResult = await step(`${ids.label}:deleteTeam`, () => syncTeamAs(captainLogin, { deletedTeamId: teamId }));
  assertFlow(deleteResult?.ok && deleteResult?.deleted === true, "team soft delete failed", deleteResult);
  const { data: deletedTeam, error: deletedTeamError } = await supabase
    .from("teams")
    .select("id,deleted_at")
    .eq("id", teamId)
    .maybeSingle();
  if (deletedTeamError) throw deletedTeamError;
  assertFlow(Boolean(deletedTeam?.deleted_at), "team deleted_at missing", deletedTeam);

  return {
    label: ids.label,
    teamId,
    actorLogins: [captainLogin, acceptedMemberLogin, cancelledInviteLogin],
    created: true,
    invitationAccepted: true,
    updated: true,
    invitationCancelled: true,
    initialMemberGuard: true,
    activeReferenceGuard: true,
    deleted: true,
  };
}

async function runTeamEmblemModerationScenario({
  label,
  captainLogin,
  reporterLogin,
  adminLogin,
}) {
  ids = makeScenarioIds(label);
  const captainId = await step(`${ids.label}:resolveProfile:captain`, () => getProfileIdForLogin(captainLogin));
  const reporterId = await step(`${ids.label}:resolveProfile:reporter`, () => getProfileIdForLogin(reporterLogin));
  assertFlow(captainId !== reporterId, "team emblem reporter must differ from captain", { captainId, reporterId });

  const teamId = `team_qa_emblem_${suffix}`;
  const staleReportId = `sim_report_${ids.label}_stale_${suffix}`;
  const reportId = `sim_report_${ids.label}_active_${suffix}`;
  teamSimulationIds.add(teamId);
  reportSimulationIds.add(staleReportId);
  reportSimulationIds.add(reportId);

  const createResult = await step(`${ids.label}:createTeam`, () => syncTeamAs(captainLogin, {
    team: {
      id: teamId,
      name: `RB-QA-${suffix.slice(-6)}`,
      region: "서울특별시 마포구",
      homeCourt: "Backend Simulation Court",
      accent: "#58d2c0",
      members: [{ userId: captainId, role: "captain" }],
    },
  }));
  assertFlow(createResult?.ok && createResult?.teamId === teamId, "team emblem simulation team create failed", createResult);

  const firstImageBase64 = readFileSync("public/assets/tier-emblems/tier-rookie-v5.webp").toString("base64");
  const activeImageBase64 = readFileSync("public/assets/tier-emblems/tier-bronze-v5.webp").toString("base64");
  const firstUploadResult = await step(`${ids.label}:uploadFirstEmblem`, () => updateTeamEmblemAs(captainLogin, {
    action: "upload",
    teamId,
    imageBase64: firstImageBase64,
  }));
  assertFlow(firstUploadResult?.ok && firstUploadResult?.emblemKey && firstUploadResult?.emblemSource === "upload", "first team emblem upload failed", firstUploadResult);
  teamEmblemSimulationKeys.add(firstUploadResult.emblemKey);

  const staleReportResult = await step(`${ids.label}:submitStaleReport`, () => submitReportAs(reporterLogin, {
    id: staleReportId,
    type: "team_emblem",
    targetId: teamId,
    reason: "simulation stale team emblem report",
  }));
  assertFlow(staleReportResult?.ok && staleReportResult?.reportId === staleReportId, "stale team emblem report failed", staleReportResult);

  const { data: storedReport, error: storedReportError } = await supabase
    .from("reports")
    .select("id,type,target_id,user_id,reported_user_ids,status,payload")
    .eq("id", staleReportId)
    .maybeSingle();
  if (storedReportError) throw storedReportError;
  assertFlow(
    storedReport?.type === "team_emblem" &&
      storedReport?.target_id === teamId &&
      storedReport?.user_id === reporterId &&
      storedReport?.reported_user_ids?.includes(captainId) &&
      storedReport?.payload?.emblemKey === firstUploadResult.emblemKey,
    "team emblem report snapshot mismatch",
    storedReport,
  );

  const unauthorizedModeration = await expectRejected(`${ids.label}:rejectUnauthorizedModeration`, () => commitAdminReviewAs(reporterLogin, {
    reportId: staleReportId,
    actionType: "resetTeamEmblem",
    reason: "simulation unauthorized moderation",
  }), ["team_emblem_moderation_permission_required"]);
  assertFlow(unauthorizedModeration.rejected, "non-admin moderated a team emblem", unauthorizedModeration);

  const activeUploadResult = await step(`${ids.label}:uploadReplacementEmblem`, () => updateTeamEmblemAs(captainLogin, {
    action: "upload",
    teamId,
    imageBase64: activeImageBase64,
  }));
  assertFlow(
    activeUploadResult?.ok &&
      activeUploadResult?.emblemKey &&
      activeUploadResult?.emblemKey !== firstUploadResult.emblemKey &&
      activeUploadResult?.emblemCanRestore === true &&
      activeUploadResult?.storageCleanupPending === false,
    "replacement team emblem upload failed",
    activeUploadResult,
  );
  teamEmblemSimulationKeys.add(activeUploadResult.emblemKey);

  const restoreFirstResult = await step(`${ids.label}:restoreFirstEmblem`, () => updateTeamEmblemAs(captainLogin, {
    action: "restore",
    teamId,
  }));
  assertFlow(
    restoreFirstResult?.ok &&
      restoreFirstResult?.emblemKey === firstUploadResult.emblemKey &&
      restoreFirstResult?.emblemCanRestore === true &&
      restoreFirstResult?.emblemUploadCount === activeUploadResult.emblemUploadCount,
    "team emblem previous photo restore failed",
    restoreFirstResult,
  );

  const restoreActiveResult = await step(`${ids.label}:restoreActiveEmblem`, () => updateTeamEmblemAs(captainLogin, {
    action: "restore",
    teamId,
  }));
  assertFlow(
    restoreActiveResult?.ok &&
      restoreActiveResult?.emblemKey === activeUploadResult.emblemKey &&
      restoreActiveResult?.emblemCanRestore === true &&
      restoreActiveResult?.emblemUploadCount === activeUploadResult.emblemUploadCount,
    "team emblem restore swap failed",
    restoreActiveResult,
  );

  const staleModeration = await expectRejected(`${ids.label}:rejectStaleModeration`, () => commitAdminReviewAs(adminLogin, {
    reportId: staleReportId,
    actionType: "resetTeamEmblem",
    reason: "simulation stale moderation",
  }), ["team_emblem_report_stale"]);
  assertFlow(staleModeration.rejected, "changed team emblem was moderated from a stale report", staleModeration);

  const staleDismissResult = await step(`${ids.label}:dismissStaleReport`, () => commitAdminReviewAs(adminLogin, {
    reportId: staleReportId,
    actionType: "dismissReport",
    reason: "simulation emblem changed after report",
  }));
  assertFlow(staleDismissResult?.ok && staleDismissResult?.status === "dismissed", "stale team emblem report dismissal failed", staleDismissResult);
  if (staleDismissResult.auditId) adminAuditSimulationIds.add(staleDismissResult.auditId);
  const { data: staleNotificationRows, error: staleNotificationError } = await supabase
    .from("notifications")
    .select("id")
    .contains("payload", { reportId: staleReportId });
  if (staleNotificationError) throw staleNotificationError;
  (staleNotificationRows ?? []).forEach((notification) => simulationNotificationIds.add(notification.id));

  const reportResult = await step(`${ids.label}:submitActiveReport`, () => submitReportAs(reporterLogin, {
    id: reportId,
    type: "team_emblem",
    targetId: teamId,
    reason: "simulation team emblem moderation",
  }));
  assertFlow(reportResult?.ok && reportResult?.reportId === reportId, "active team emblem report failed", reportResult);

  const moderationResult = await step(`${ids.label}:moderateEmblem`, () => commitAdminReviewAs(adminLogin, {
    reportId,
    actionType: "resetTeamEmblem",
    reason: "simulation confirmed violation",
    feedback: "simulation moderation completed",
  }));
  assertFlow(
    moderationResult?.ok &&
      moderationResult?.teamId === teamId &&
      moderationResult?.emblemSource === "initial" &&
      moderationResult?.emblemKey == null &&
      moderationResult?.emblemViolationCount === 1 &&
      moderationResult?.blockDays === 30 &&
      moderationResult?.storageCleanupPending === false,
    "team emblem moderation result mismatch",
    moderationResult,
  );
  teamEmblemSimulationKeys.delete(activeUploadResult.emblemKey);
  if (moderationResult.auditId) adminAuditSimulationIds.add(moderationResult.auditId);

  const { data: notificationRows, error: notificationError } = await supabase
    .from("notifications")
    .select("id,target_user_id,type,payload")
    .contains("payload", { reportId });
  if (notificationError) throw notificationError;
  (notificationRows ?? []).forEach((notification) => simulationNotificationIds.add(notification.id));
  assertFlow(
    (notificationRows ?? []).some((notification) => notification.target_user_id === reporterId) &&
      (notificationRows ?? []).some((notification) => notification.target_user_id === captainId && notification.type === "team_emblem_moderation"),
    "team emblem moderation notifications missing",
    notificationRows,
  );

  const { data: moderatedTeam, error: moderatedTeamError } = await supabase
    .from("teams")
    .select("id,emblem_key,emblem_source,emblem_violation_count,emblem_upload_blocked_until")
    .eq("id", teamId)
    .maybeSingle();
  if (moderatedTeamError) throw moderatedTeamError;
  assertFlow(
    moderatedTeam?.emblem_key == null &&
      moderatedTeam?.emblem_source === "initial" &&
      moderatedTeam?.emblem_violation_count === 1 &&
      new Date(moderatedTeam?.emblem_upload_blocked_until).getTime() > Date.now(),
    "team emblem moderation state mismatch",
    moderatedTeam,
  );

  const blockedUpload = await expectRejected(`${ids.label}:rejectBlockedUpload`, () => updateTeamEmblemAs(captainLogin, {
    action: "upload",
    teamId,
    imageBase64: activeImageBase64,
  }), ["team_emblem_moderation_blocked"]);
  assertFlow(blockedUpload.rejected, "moderated team uploaded an emblem during the block", blockedUpload);

  const blockedRestore = await expectRejected(`${ids.label}:rejectBlockedRestore`, () => updateTeamEmblemAs(captainLogin, {
    action: "restore",
    teamId,
  }), ["team_emblem_moderation_blocked"]);
  assertFlow(blockedRestore.rejected, "moderated team restored an emblem during the block", blockedRestore);

  const deleteResult = await step(`${ids.label}:deleteTeam`, () => syncTeamAs(captainLogin, { deletedTeamId: teamId }));
  assertFlow(deleteResult?.ok && deleteResult?.deleted === true, "team emblem simulation team delete failed", deleteResult);

  return {
    label: ids.label,
    teamId,
    staleReportId,
    reportId,
    actorLogins: [captainLogin, reporterLogin, adminLogin],
    uploadVerified: true,
    restoreVerified: true,
    reportSnapshotVerified: true,
    unauthorizedModerationBlocked: true,
    staleReportGuardVerified: true,
    defaultResetVerified: true,
    violationCount: 1,
    blockDays: 30,
    notificationCount: notificationRows?.length ?? 0,
    blockedUploadVerified: true,
    blockedRestoreVerified: true,
    storageCleanupVerified: true,
    deleted: true,
  };
}

async function runRawTableRlsScenario({
  label,
  login,
}) {
  ids = makeScenarioIds(label);
  assertFlow(Boolean(supabase), "RLS scenario requires service role client for cleanup");
  const profileId = await step(`${ids.label}:resolveProfile`, () => getProfileIdForLogin(login));
  const accessToken = await getAuthToken(login);
  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
  const probePrefix = `sim_rls_${ids.label}_${suffix}`;
  const writeProbes = [
    ["admin_audit_log", { id: `${probePrefix}_audit`, type: "simulation_probe", status: "probe", created_by: profileId }],
    ["admin_appointments", { id: `${probePrefix}_appointment`, user_id: profileId, role: "admin", status: "active" }],
    ["admin_disciplinary_actions", { id: `${probePrefix}_discipline`, user_id: profileId, type: "suspension", action_type: "suspendTarget", status: "active" }],
    ["matches", { id: `${probePrefix}_match`, title: "RLS write probe", mode: "1v1", status: "contract" }],
    ["recruiting_posts", { id: `${probePrefix}_post`, title: "RLS write probe", player_id: profileId, room_state: { ownerId: profileId } }],
    ["reports", { id: `${probePrefix}_report`, type: "player", target_id: profileId, user_id: profileId, reason: "RLS write probe" }],
    ["court_requests", { id: `${probePrefix}_court`, requested_by: profileId, name: "RLS write probe", address_text: "RLS write probe" }],
  ];
  const deniedTables = [];
  for (const [table, row] of writeProbes) {
    const { error } = await step(`${ids.label}:denyRawWrite:${table}`, () => client.from(table).insert(row));
    if (!error) {
      await supabase.from(table).delete().eq("id", row.id);
    }
    const denied = Boolean(error) && (
      error.code === "42501"
      || /permission denied|row-level security|violates row-level security/i.test(String(error.message || ""))
    );
    assertFlow(denied, `raw browser write was not rejected by permission policy: ${table}`, {
      table,
      code: error?.code,
      message: error?.message,
    });
    deniedTables.push(table);
  }

  const { data: auditRows, error: auditReadError } = await step(`${ids.label}:denyRawAdminAuditRead`, () => client
    .from("admin_audit_log")
    .select("id")
    .limit(1));
  assertFlow(Boolean(auditReadError) || (auditRows ?? []).length === 0, "ordinary user could read admin audit rows", {
    count: (auditRows ?? []).length,
    error: auditReadError?.message,
  });

  return {
    label: ids.label,
    login,
    profileId,
    deniedTables,
    adminAuditReadDenied: true,
  };
}

async function runAdminControlScenario({
  label,
  adminLogin,
  targetLogin,
}) {
  ids = makeScenarioIds(label);
  assertFlow(Boolean(supabase), "admin control scenario requires service role client");
  const adminId = await step(`${ids.label}:resolveProfile:admin`, () => getProfileIdForLogin(adminLogin));
  const targetId = await step(`${ids.label}:resolveProfile:target`, () => getProfileIdForLogin(targetLogin));
  assertFlow(adminId !== targetId, "admin control target must differ from actor", { adminId, targetId });

  const { data: activeAppointments, error: activeAppointmentError } = await supabase
    .from("referee_appointments")
    .select("id,status,ends_at")
    .eq("user_id", targetId)
    .eq("status", "active");
  if (activeAppointmentError) throw activeAppointmentError;
  const nowMs = Date.now();
  const liveAppointments = (activeAppointments ?? []).filter((row) => !row.ends_at || Date.parse(row.ends_at) >= nowMs);
  assertFlow(liveAppointments.length === 0, "admin simulation target already has an active referee appointment", {
    targetLogin,
    appointments: liveAppointments.map((row) => row.id),
  });

  const appointed = await step(`${ids.label}:appointReferee`, () => commitAdminAppointmentAs(adminLogin, {
    actionType: "appointReferee",
    targetUserId: targetId,
    refereeGrade: "candidate",
    termDays: 3,
    reason: `simulation:${suffix}`,
  }));
  assertFlow(appointed?.ok && appointed?.appointmentId, "admin referee appointment failed", appointed);
  adminAppointmentSimulationIds.add(appointed.appointmentId);

  const { data: appointmentRow, error: appointmentError } = await supabase
    .from("referee_appointments")
    .select("id,user_id,status,grade")
    .eq("id", appointed.appointmentId)
    .maybeSingle();
  if (appointmentError) throw appointmentError;
  assertFlow(appointmentRow?.user_id === targetId && appointmentRow?.status === "active", "referee appointment not persisted", appointmentRow);

  const revoked = await step(`${ids.label}:revokeReferee`, () => commitAdminAppointmentAs(adminLogin, {
    actionType: "revokeAppointment",
    appointmentId: appointed.appointmentId,
    reason: `simulation cleanup:${suffix}`,
  }));
  assertFlow(revoked?.ok && revoked?.appointmentId === appointed.appointmentId, "admin referee revocation failed", revoked);
  const { data: revokedRow, error: revokedError } = await supabase
    .from("referee_appointments")
    .select("status")
    .eq("id", appointed.appointmentId)
    .maybeSingle();
  if (revokedError) throw revokedError;
  assertFlow(revokedRow?.status === "revoked", "referee appointment was not revoked", revokedRow);

  const disciplined = await step(`${ids.label}:disciplineTarget`, () => commitAdminDisciplinaryAs(adminLogin, {
    actionType: "suspendTarget",
    targetUserId: targetId,
    type: "suspension",
    durationDays: 3,
    reason: `simulation:${suffix}`,
  }));
  assertFlow(disciplined?.ok && disciplined?.disciplinaryActionId, "admin disciplinary action failed", disciplined);
  adminDisciplinarySimulationIds.add(disciplined.disciplinaryActionId);
  const { data: disciplinaryRow, error: disciplinaryError } = await supabase
    .from("admin_disciplinary_actions")
    .select("id,user_id,status,action_type")
    .eq("id", disciplined.disciplinaryActionId)
    .maybeSingle();
  if (disciplinaryError) throw disciplinaryError;
  assertFlow(disciplinaryRow?.user_id === targetId && disciplinaryRow?.status === "active", "disciplinary action not persisted", disciplinaryRow);

  const { data: auditRows, error: auditError } = await supabase
    .from("admin_audit_log")
    .select("id,appointment_id,target_user_id,payload,created_at")
    .eq("created_by", adminId)
    .eq("target_user_id", targetId);
  if (auditError) throw auditError;
  const scenarioAuditRows = (auditRows ?? []).filter((row) => (
    row.appointment_id === appointed.appointmentId
    || row.payload?.disciplinaryActionId === disciplined.disciplinaryActionId
  ));
  assertFlow(scenarioAuditRows.length >= 3, "admin audit rows missing", {
    count: scenarioAuditRows.length,
    appointmentId: appointed.appointmentId,
    disciplinaryActionId: disciplined.disciplinaryActionId,
  });
  scenarioAuditRows.forEach((row) => adminAuditSimulationIds.add(row.id));

  return {
    label: ids.label,
    adminLogin,
    targetLogin,
    appointmentId: appointed.appointmentId,
    appointmentRevoked: true,
    disciplinaryActionId: disciplined.disciplinaryActionId,
    auditRows: scenarioAuditRows.length,
  };
}

async function runProfilePrivacyScenario({
  label,
  ownerLogin,
  viewerLogin,
}) {
  ids = makeScenarioIds(label);
  const ownerId = await step(`${ids.label}:resolveProfile:owner`, () => getProfileIdForLogin(ownerLogin));
  const viewerId = await step(`${ids.label}:resolveProfile:viewer`, () => getProfileIdForLogin(viewerLogin));
  assertFlow(ownerId !== viewerId, "privacy owner and viewer must differ", { ownerId, viewerId });

  await step(`${ids.label}:disablePrivacy`, () => setTemporaryProfilePrivacy(ownerId, {
    regionRanking: false,
    teamHistory: false,
    statSummary: false,
  }));
  const viewerDirectory = await step(`${ids.label}:loadDirectory:viewer`, () => loadDirectoryAs(viewerLogin));
  const privateProfile = (viewerDirectory.users ?? []).find((user) => user.id === ownerId);
  assertFlow(privateProfile && privateProfile.privacy?.regionRanking === false, "region ranking privacy not mapped", privateProfile);
  assertFlow(privateProfile.privacy?.teamHistory === false && privateProfile.privacy?.statSummary === false, "profile privacy flags not mapped", privateProfile);
  assertFlow(!Object.prototype.hasOwnProperty.call(privateProfile, "appSettings") && !Object.prototype.hasOwnProperty.call(privateProfile, "app_settings"), "private app settings leaked in directory response", Object.keys(privateProfile));

  const ownerDirectory = await step(`${ids.label}:loadDirectory:owner`, () => loadDirectoryAs(ownerLogin));
  const ownProfile = (ownerDirectory.users ?? []).find((user) => user.id === ownerId);
  assertFlow(ownProfile?.privacy?.regionRanking === false, "owner privacy state missing", ownProfile);

  await step(`${ids.label}:enablePrivacy`, () => setTemporaryProfilePrivacy(ownerId, {
    regionRanking: true,
    teamHistory: true,
    statSummary: true,
  }));
  const publicDirectory = await step(`${ids.label}:loadDirectory:public`, () => loadDirectoryAs(viewerLogin));
  const publicProfile = (publicDirectory.users ?? []).find((user) => user.id === ownerId);
  assertFlow(publicProfile?.privacy?.regionRanking === true && publicProfile?.privacy?.teamHistory === true && publicProfile?.privacy?.statSummary === true, "public privacy flags not mapped", publicProfile);

  return {
    label: ids.label,
    ownerLogin,
    viewerLogin,
    ownerId,
    viewerId,
    privateFlagsMapped: true,
    publicFlagsMapped: true,
    rawSettingsHidden: true,
  };
}

async function runProfileIdentityLockScenario({
  label,
  login,
}) {
  ids = makeScenarioIds(label);
  const profileId = await step(`${ids.label}:resolveProfile`, () => getProfileIdForLogin(login));
  const snapshot = await step(`${ids.label}:snapshotProfile`, () => snapshotTemporaryProfileIdentity(profileId));
  const lockedHashtag = String(snapshot.hashtag || snapshot.handle || "").trim();
  assertFlow(Boolean(lockedHashtag && snapshot.birth_year && snapshot.age_group_checked_season), "profile lock fixture is incomplete", {
    profileId,
    hashtag: lockedHashtag,
    birthYear: snapshot.birth_year,
    season: snapshot.age_group_checked_season,
  });
  const resetAt = Date.now();
  const { error: resetError } = await supabase
    .from("profiles")
    .update({
      onboarding_complete: false,
      handle_locked_at: null,
      birth_year_locked_at: null,
      name_updated_at: null,
    })
    .eq("id", profileId);
  if (resetError) throw resetError;

  const temporaryName = `${String(snapshot.name || "Player").slice(0, 10)} ${suffix.slice(-6)}`.slice(0, 20);
  const maliciousTimestamp = "2001-01-01T00:00:00.000Z";
  const firstResult = await step(`${ids.label}:completeOnboarding`, () => upsertProfileAs(login, {
    name: temporaryName,
    hashtag: lockedHashtag,
    birthYear: snapshot.birth_year,
    ageGroup: snapshot.age_group || "open",
    ageGroupCheckedSeason: snapshot.age_group_checked_season,
    onboardingComplete: true,
    handleLockedAt: maliciousTimestamp,
    birthYearLockedAt: maliciousTimestamp,
    nameUpdatedAt: maliciousTimestamp,
  }));
  assertFlow(firstResult?.ok, "profile onboarding upsert failed", firstResult);
  const { data: lockedRow, error: lockedError } = await supabase
    .from("profiles")
    .select("name,hashtag,birth_year,onboarding_complete,handle_locked_at,birth_year_locked_at,name_updated_at")
    .eq("id", profileId)
    .maybeSingle();
  if (lockedError) throw lockedError;
  for (const field of ["handle_locked_at", "birth_year_locked_at", "name_updated_at"]) {
    const valueMs = Date.parse(lockedRow?.[field]);
    assertFlow(Number.isFinite(valueMs) && valueMs >= resetAt - 2000, `profile lock timestamp is not server-owned: ${field}`, {
      field,
      value: lockedRow?.[field],
      maliciousTimestamp,
    });
  }
  assertFlow(lockedRow?.onboarding_complete === true && lockedRow?.name === temporaryName, "profile onboarding state not committed", lockedRow);

  const blockedName = `${String(snapshot.name || "Player").slice(0, 10)} BLOCK`;
  const secondResult = await step(`${ids.label}:rejectLockedChanges`, () => upsertProfileAs(login, {
    name: blockedName,
    hashtag: `#blocked_${suffix.slice(-6)}`,
    birthYear: Number(snapshot.birth_year) === 1900 ? 1901 : Number(snapshot.birth_year) - 1,
    ageGroup: snapshot.age_group || "open",
    ageGroupCheckedSeason: snapshot.age_group_checked_season,
    onboardingComplete: false,
    handleLockedAt: null,
    birthYearLockedAt: null,
    nameUpdatedAt: null,
  }));
  assertFlow(secondResult?.ok, "profile locked update request failed unexpectedly", secondResult);
  const { data: protectedRow, error: protectedError } = await supabase
    .from("profiles")
    .select("name,hashtag,birth_year,onboarding_complete,handle_locked_at,birth_year_locked_at,name_updated_at")
    .eq("id", profileId)
    .maybeSingle();
  if (protectedError) throw protectedError;
  assertFlow(protectedRow?.name === temporaryName, "name cooldown was bypassed", protectedRow);
  assertFlow(protectedRow?.hashtag === lockedHashtag && Number(protectedRow?.birth_year) === Number(snapshot.birth_year), "locked identity fields changed", protectedRow);
  assertFlow(protectedRow?.onboarding_complete === true, "onboarding completion was downgraded", protectedRow);
  assertFlow(protectedRow?.handle_locked_at === lockedRow.handle_locked_at && protectedRow?.birth_year_locked_at === lockedRow.birth_year_locked_at && protectedRow?.name_updated_at === lockedRow.name_updated_at, "client lock timestamps replaced server values", {
    before: lockedRow,
    after: protectedRow,
  });

  return {
    label: ids.label,
    login,
    profileId,
    serverOwnedLockTimestamps: true,
    hashtagLocked: true,
    birthYearLocked: true,
    nameCooldown: true,
    onboardingMonotonic: true,
  };
}

async function runPlayerReportScenario({
  label,
  reporterLogin,
  targetLogin,
  outsiderLogin,
  sourceMatchId,
}) {
  ids = makeScenarioIds(label);
  const reporterId = await step(`${ids.label}:resolveProfile:reporter`, () => getProfileIdForLogin(reporterLogin));
  const targetId = await step(`${ids.label}:resolveProfile:target`, () => getProfileIdForLogin(targetLogin));
  const outsiderId = await step(`${ids.label}:resolveProfile:outsider`, () => getProfileIdForLogin(outsiderLogin));
  assertFlow(new Set([reporterId, targetId, outsiderId]).size === 3, "report scenario profiles must be unique", {
    reporterId,
    targetId,
    outsiderId,
  });
  const staleReports = await step(`${ids.label}:cleanupStalePlayerReports`, async () => {
    if (!supabase) return { skipped: true };
    const { data, error } = await supabase
      .from("reports")
      .select("id")
      .eq("type", "player")
      .eq("user_id", reporterId)
      .eq("target_id", targetId)
      .like("reason", "simulation shared match report%");
    if (error) throw error;
    const staleIds = (data ?? []).map((row) => row.id).filter(Boolean);
    if (!staleIds.length) return { deleted: 0 };
    const { error: deleteError } = await supabase.from("reports").delete().in("id", staleIds);
    if (deleteError) throw deleteError;
    return { deleted: staleIds.length };
  });
  const reportBase = {
    type: "player",
    targetId,
    sourceMatchId,
    reason: `simulation shared match report ${suffix}`,
  };
  const concurrentReports = await step(`${ids.label}:submitConcurrentPlayerReports`, () => Promise.all([
    submitReportAs(reporterLogin, { ...reportBase, id: `sim_report_${ids.label}_a_${suffix}` }),
    submitReportAs(reporterLogin, { ...reportBase, id: `sim_report_${ids.label}_b_${suffix}` }),
  ]));
  const first = concurrentReports.find((result) => result?.duplicate !== true);
  const duplicate = concurrentReports.find((result) => result?.duplicate === true);
  assertFlow(first?.ok && first?.reportId && first?.duplicate !== true, "new player report was not created", first);
  reportSimulationIds.add(first.reportId);
  assertFlow(duplicate?.ok && duplicate?.duplicate === true && duplicate?.reportId === first.reportId, "duplicate report did not return original id", {
    first,
    duplicate,
  });
  const outsider = await expectRejected(`${ids.label}:rejectUnrelatedPlayerReport`, () => submitReportAs(outsiderLogin, {
    ...reportBase,
    id: `sim_report_${ids.label}_outsider_${suffix}`,
  }), ["report_permission_denied"]);
  assertFlow(outsider.rejected, "unrelated player report was not rejected", outsider);

  return {
    label: ids.label,
    reporterLogin,
    targetLogin,
    outsiderLogin,
    reportId: first.reportId,
    staleReports,
    recentSharedMatchRequired: true,
    duplicateIdempotent: true,
    concurrentDuplicateGuard: true,
    unrelatedReporterBlocked: true,
  };
}

async function runCourtRegistrationScenario({
  label,
  requesterLogin,
  adminLogin,
}) {
  ids = makeScenarioIds(label);
  assertFlow(Boolean(supabase), "court registration scenario requires service role client");
  const requesterId = await step(`${ids.label}:resolveProfile:requester`, () => getProfileIdForLogin(requesterLogin));
  const adminId = await step(`${ids.label}:resolveProfile:admin`, () => getProfileIdForLogin(adminLogin));
  assertFlow(requesterId !== adminId, "court requester and admin must be different profiles", { requesterId, adminId });

  const requestId = `sim_cr_${ids.label}_${suffix}`;
  const expectedCourtId = `court_${requestId}`;
  courtRequestSimulationIds.add(requestId);
  approvedCourtSimulationIds.add(expectedCourtId);

  const { data: requesterProfile, error: requesterProfileError } = await step(`${ids.label}:verifyRequester`, () => supabase
    .from("profiles")
    .select("id,trust_score")
    .eq("id", requesterId)
    .maybeSingle());
  if (requesterProfileError) throw requesterProfileError;
  assertFlow(Number(requesterProfile?.trust_score ?? 0) >= 70, "court requester trust score too low", {
    requesterId,
    trustScore: requesterProfile?.trust_score,
  });

  const addressText = `Backend simulation address ${suffix}`;
  const missingPinRequestId = `${requestId}_missing_pin`;
  courtRequestSimulationIds.add(missingPinRequestId);
  await expectRejected(`${ids.label}:rejectCourtWithoutPin`, () => submitCourtRequestAs(requesterLogin, {
    id: missingPinRequestId,
    name: `Backend Simulation Missing Pin ${suffix}`,
    addressText: `${addressText} missing pin`,
    roadAddress: `${addressText} missing pin`,
    region: "서울특별시 마포구",
    sido: "서울특별시",
    sigungu: "마포구",
    facilityName: "Backend Simulation Missing Pin",
    type: "outdoor",
  }), ["court_pin_required", "court_requests_pending_pin_required"]);

  const submitResult = await step(`${ids.label}:submitCourtRequest`, () => submitCourtRequestAs(requesterLogin, {
    id: requestId,
    name: `Backend Simulation Regression Court ${suffix}`,
    hashtag: `#simcourt${Date.now().toString(36)}`,
    addressText,
    roadAddress: addressText,
    jibunAddress: "",
    zonecode: String(Date.now()).slice(-5),
    lat: 37.5563,
    lng: 126.9236,
    region: "서울특별시 마포구",
    sido: "서울특별시",
    sigungu: "마포구",
    facilityName: "Backend Simulation Regression Court",
    type: "outdoor",
    baseName: "Backend Simulation Regression Court",
    courtUnit: `Simulation ${suffix}`,
    courtKind: "street_hoop",
    surfaceType: "urethane",
    courtLayout: "full",
    paid: false,
  }));
  assertFlow(submitResult?.ok && submitResult?.requestId === requestId, "court request submit result mismatch", {
    ok: submitResult?.ok,
    requestId: submitResult?.requestId,
  });

  const { data: pendingRequest, error: pendingRequestError } = await step(`${ids.label}:verifyPendingCourtRequest`, () => supabase
    .from("court_requests")
    .select("id,requested_by,status")
    .eq("id", requestId)
    .maybeSingle());
  if (pendingRequestError) throw pendingRequestError;
  assertFlow(pendingRequest?.requested_by === requesterId && pendingRequest?.status === "pending", "pending court request mismatch", {
    requestId,
    requestedBy: pendingRequest?.requested_by,
    status: pendingRequest?.status,
  });

  const approveResult = await step(`${ids.label}:approveCourtRequest`, () => approveCourtRequestAs(adminLogin, requestId));
  const approvedCourtId = String(approveResult?.approvedCourtId || expectedCourtId);
  approvedCourtSimulationIds.add(approvedCourtId);
  assertFlow(approveResult?.ok && approveResult?.requestId === requestId && approvedCourtId === expectedCourtId, "court request approval result mismatch", {
    ok: approveResult?.ok,
    requestId: approveResult?.requestId,
    approvedCourtId,
  });

  const [requestRead, courtRead, notificationRead] = await step(`${ids.label}:verifyApprovedCourt`, () => Promise.all([
    supabase.from("court_requests").select("id,requested_by,status,payload").eq("id", requestId).maybeSingle(),
    supabase.from("approved_courts").select("id,source_request_id,approved_by,status").eq("id", approvedCourtId).maybeSingle(),
    supabase
      .from("notifications")
      .select("id,user_id,target_user_id,type,payload")
      .eq("type", "court_request")
      .eq("target_user_id", requesterId)
      .contains("payload", { courtRequestId: requestId }),
  ]));
  if (requestRead.error) throw requestRead.error;
  if (courtRead.error) throw courtRead.error;
  if (notificationRead.error) throw notificationRead.error;
  (notificationRead.data ?? []).forEach((notification) => simulationNotificationIds.add(notification.id));
  const approvalNotification = (notificationRead.data ?? []).find((notification) => (
    notification.user_id === requesterId &&
    notification.target_user_id === requesterId &&
    notification.payload?.approvedCourtId === approvedCourtId
  ));
  assertFlow(
    requestRead.data?.status === "approved" &&
      requestRead.data?.payload?.approvedCourtId === approvedCourtId &&
      courtRead.data?.source_request_id === requestId &&
      courtRead.data?.approved_by === adminId &&
      courtRead.data?.status === "active" &&
      Boolean(approvalNotification),
    "approved court persistence mismatch",
    {
      requestStatus: requestRead.data?.status,
      requestApprovedCourtId: requestRead.data?.payload?.approvedCourtId,
      approvedCourtId: courtRead.data?.id,
      sourceRequestId: courtRead.data?.source_request_id,
      approvedBy: courtRead.data?.approved_by,
      notificationFound: Boolean(approvalNotification),
    },
  );

  const trustBeforeBlockedReport = await step(`${ids.label}:trustBeforeApprovedReport`, () => getCurrentProfileTrustScore(adminLogin, adminId));
  const approvedReport = await expectRejected(
    `${ids.label}:rejectApprovedCourtReport`,
    () => reportCourtRequestAs(adminLogin, requestId),
    ["approved_court_request_cannot_be_reported", "court_request_not_reportable"],
  );
  const [{ data: requestAfterReport, error: requestAfterReportError }, trustAfterBlockedReport] = await step(
    `${ids.label}:verifyApprovedReportRollback`,
    () => Promise.all([
      supabase.from("court_requests").select("id,status").eq("id", requestId).maybeSingle(),
      getCurrentProfileTrustScore(adminLogin, adminId),
    ]),
  );
  if (requestAfterReportError) throw requestAfterReportError;
  assertFlow(
    approvedReport.rejected &&
      requestAfterReport?.status === "approved" &&
      trustAfterBlockedReport === trustBeforeBlockedReport,
    "approved court report changed status or trust",
    { approvedReport, requestAfterReport, trustBeforeBlockedReport, trustAfterBlockedReport },
  );

  return {
    label: ids.label,
    requestId,
    approvedCourtId,
    requesterId,
    adminId,
    requestStatus: "approved",
    notificationVerified: true,
    approvedReportBlocked: true,
  };
}

async function runRecruitingRoomExpiryScenario({
  label,
  hostLogin,
  inviteeLogin,
}) {
  ids = makeScenarioIds(label);
  assertFlow(Boolean(supabase), "recruiting room expiry scenario requires service role client");
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const inviteeId = await step(`${ids.label}:resolveProfile:invitee`, () => getProfileIdForLogin(inviteeLogin));
  assertFlow(hostId !== inviteeId, "expiry room host and invitee must be different profiles", { hostId, inviteeId });

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: getSimulationDisplayTitle(ids.label),
      visibility: "private",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      timingType: "instant",
      ranked: false,
      mmrLimitMode: "off",
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: simulationCourtId,
      court: "Backend Simulation Court",
      position: "PG",
      memo: "Backend simulation expiry row. Safe to clean.",
      rules: {
        targetScore: 21,
        timeLimit: 12,
        winByTwo: true,
        ball: "7",
      },
    },
  }));
  assertFlow(createResult?.post?.id === ids.postId && createResult?.post?.status === "open", "expiry room create mismatch", {
    postId: createResult?.post?.id,
    status: createResult?.post?.status,
  });

  const inviteResult = await step(`${ids.label}:inviteRecruitingPlayer`, () => syncRecruitingAs(hostLogin, {
    action: "inviteRecruitingPlayers",
    postId: ids.postId,
    invite: {
      side: "teamB",
      reserve: false,
      joinMode: "player",
      playerIds: [inviteeId],
    },
  }));
  const invitedPost = await getRecruitingPostAfterResult(inviteResult, hostLogin, `${ids.label}:loadPendingInvitation`);
  const pendingInvitation = (invitedPost.roomState?.invitations ?? []).find((invitation) => (
    invitation.targetUserId === inviteeId && invitation.status === "pending"
  ));
  assertFlow(inviteResult?.sqlReducer === true && Boolean(pendingInvitation?.id), "expiry room pending invitation missing", {
    sqlReducer: inviteResult?.sqlReducer,
    inviteeId,
  });

  const staleCreatedAt = new Date(Date.now() - 3 * HOUR_MS).toISOString();
  const { error: staleCreatedAtError } = await step(`${ids.label}:backdateTestRoom`, () => supabase
    .from("recruiting_posts")
    .update({ created_at: staleCreatedAt })
    .eq("id", ids.postId));
  if (staleCreatedAtError) throw staleCreatedAtError;

  const expiryNow = new Date().toISOString();
  const firstExpiry = await step(`${ids.label}:expireRecruitingRooms:first`, () => supabase.rpc("rankball_expire_recruiting_rooms", {
    p_now: expiryNow,
  }));
  if (firstExpiry.error) throw firstExpiry.error;
  const firstAffected = getRpcAffectedCount(firstExpiry.data);
  assertFlow(firstAffected >= 1, "recruiting room expiry did not affect test room", { affected: firstAffected });

  const { data: expiredRow, error: expiredRowError } = await step(`${ids.label}:verifyExpiredRoom`, () => supabase
    .from("recruiting_posts")
    .select("id,status,room_state")
    .eq("id", ids.postId)
    .maybeSingle());
  if (expiredRowError) throw expiredRowError;
  const expiredInvitation = (expiredRow?.room_state?.invitations ?? []).find((invitation) => invitation.id === pendingInvitation.id);
  assertFlow(expiredRow?.status === "cancelled" && expiredInvitation?.status === "expired", "expired room persistence mismatch", {
    postId: ids.postId,
    status: expiredRow?.status,
    invitationId: pendingInvitation.id,
    invitationStatus: expiredInvitation?.status,
  });
  const terminalFeedGuard = await step(`${ids.label}:terminalFeedRefreshGuard`, () => assertTerminalFeedRefreshGuard("recruiting", ids.postId));

  const secondExpiry = await step(`${ids.label}:expireRecruitingRooms:second`, () => supabase.rpc("rankball_expire_recruiting_rooms", {
    p_now: expiryNow,
  }));
  if (secondExpiry.error) throw secondExpiry.error;
  const secondAffected = getRpcAffectedCount(secondExpiry.data);
  assertFlow(secondAffected === 0, "recruiting room expiry is not idempotent", { affected: secondAffected });

  return {
    label: ids.label,
    postId: ids.postId,
    hostId,
    inviteeId,
    invitationId: pendingInvitation.id,
    status: "cancelled",
    invitationStatus: "expired",
    firstAffected,
    secondAffected,
    terminalFeedGuard,
  };
}

async function runDisputeResumeThumbsScenario({
  label,
  hostLogin,
  opponentLogin,
  voidAfterDispute = false,
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
      title: getSimulationDisplayTitle(ids.label),
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
      courtId: simulationCourtId,
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
  assertFlow(confirmResult?.confirmationAtomic === true, "recruiting confirmation was not atomic", confirmResult);
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

  await expectRejected(`${ids.label}:incrementMatchScore:beforeStartBlocked`, () => syncMatchAs(hostLogin, {
    action: "incrementMatchScore",
    matchId: ids.matchId,
    deltaA: 1,
    deltaB: 0,
    expectedRevisionA: 0,
    expectedRevisionB: 0,
  }), ["match_score_update_locked", "match_score_clock_controller_required"]);

  await expectRejected(`${ids.label}:endMatch:beforeStartBlocked`, () => syncMatchAs(hostLogin, {
    action: "endMatch",
    matchId: ids.matchId,
  }), ["match_not_started"]);

  const startResult = await step(`${ids.label}:startMatch`, () => syncMatchAs(hostLogin, {
    action: "startMatch",
    matchId: ids.matchId,
  }, { match: withStartedMatch(match, hostId) }));
  match = await getMatchAfterResult(startResult, hostLogin, `${ids.label}:loadAfterStartMatch`);
  assertFlow(Boolean(match?.startedAt), "dispute match start not persisted", match);

  await expectRejected(`${ids.label}:submitMatchResult:noRefereeStatsBlocked`, () => syncMatchAs(hostLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: {
      scoreA: 999,
      scoreB: 888,
      playerStats: { [opponentId]: { rebounds: 1 } },
    },
  }), ["no_referee_personal_stats_forbidden"]);

  const scoreWrite = await setMatchScoreByIncrements({
    label: ids.label,
    login: hostLogin,
    match,
    scoreA: 3,
    scoreB: 12,
  });
  match = scoreWrite.match;
  assertFlow(
    match?.status === "agreed"
      && !match?.endedAt
      && getMatchRoomPhase(match).phase === "live"
      && match?.result?.scoreA === 3
      && match?.result?.scoreB === 12
      && Object.keys(match?.result?.playerStats ?? {}).length === 0,
    "live score-only result was not persisted",
    match,
  );

  const endResult = await step(`${ids.label}:endMatch`, () => syncMatchAs(hostLogin, {
    action: "endMatch",
    matchId: ids.matchId,
  }, { match: withEndedMatch(match) }));
  match = await getMatchAfterResult(endResult, hostLogin, `${ids.label}:loadAfterEndMatch`);
  assertFlow(Boolean(match?.endedAt), "dispute match end not persisted", match);

  await expectRejected(`${ids.label}:submitMatchResult:postgameStatsBlocked`, () => syncMatchAs(hostLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: {
      scoreA: 999,
      scoreB: 888,
      playerStats: { [opponentId]: { points: 12, rebounds: 1 } },
    },
  }), ["no_referee_personal_stats_forbidden"]);

  await expectRejected(`${ids.label}:disputeMatch:scoreOutOfRange`, () => syncMatchAs(opponentLogin, {
    action: "disputeMatch",
    matchId: ids.matchId,
    reason: {
      kind: "team_scores",
      requestedScoreA: 3,
      requestedScoreB: 1000,
      baseRevision: Math.max(
        Number(match?.result?.revision ?? 0),
        Number(match?.result?.scoreRevisionA ?? 0),
        Number(match?.result?.scoreRevisionB ?? 0),
      ),
      reason: "Backend simulation invalid dispute score",
    },
  }), ["match_score_dispute_request_invalid"]);

  const disputeResult = await step(`${ids.label}:disputeMatch`, () => syncMatchAs(opponentLogin, {
    action: "disputeMatch",
    matchId: ids.matchId,
    reason: {
      kind: "team_scores",
      requestedScoreA: 3,
      requestedScoreB: 15,
      baseRevision: Math.max(
        Number(match?.result?.revision ?? 0),
        Number(match?.result?.scoreRevisionA ?? 0),
        Number(match?.result?.scoreRevisionB ?? 0),
      ),
      reason: "Backend simulation dispute",
    },
  }));
  assertFlow(disputeResult?.sqlReducer === true, "match dispute did not use SQL reducer", disputeResult);
  match = disputeResult?.match;
  const openedDispute = (match?.disputes ?? []).find((item) => item.by === opponentId && item.status === "open");
  assertFlow(match?.status === "disputed" && openedDispute, "dispute not persisted", match);
  assertFlow(
    openedDispute?.request?.kind === "team_scores"
      && Number(openedDispute?.request?.requestedScoreA) === 3
      && Number(openedDispute?.request?.requestedScoreB) === 15
      && match?.disputeDraftResult?.scoreB === 12,
    "open dispute mutated the draft before the host ruling",
    { openedDispute, disputeDraftResult: match?.disputeDraftResult },
  );

  if (voidAfterDispute) {
    const voidResult = await step(`${ids.label}:voidMatch`, () => syncMatchAs(hostLogin, {
      action: "voidMatch",
      matchId: ids.matchId,
      reason: "원격 흐름 검증을 위한 경기 무효 처리 사유입니다.",
    }));
    assertFlow(voidResult?.sqlReducer === true, "match void SQL reducer not used", voidResult);
    match = await getMatchAfterResult(voidResult, hostLogin, `${ids.label}:loadAfterVoid`);
    assertFlow(match?.status === "void" && match?.ranked === false, "disputed match void not persisted", match);
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
      voided: true,
      sqlReducers: {
        disputeMatch: Boolean(disputeResult?.sqlReducer),
        voidMatch: Boolean(voidResult?.sqlReducer),
      },
    };
  }

  const openDisputeId = match?.disputes?.find((item) => item.status === "open")?.id;
  assertFlow(Boolean(openDisputeId), "open dispute id missing before ruling", match?.disputes);

  await expectRejected(`${ids.label}:resolveMatchDispute:participantBlocked`, () => syncMatchAs(opponentLogin, {
    action: "resolveMatchDispute",
    matchId: ids.matchId,
    disputeId: openDisputeId,
    decision: "rejected",
    resolutionReason: "참가자에게는 이의신청 판정 권한이 없습니다.",
  }), ["match_host_required", "match_dispute_host_required"]);

  const resolveResult = await step(`${ids.label}:resolveMatchDispute`, () => syncMatchAs(hostLogin, {
    action: "resolveMatchDispute",
    matchId: ids.matchId,
    disputeId: openDisputeId,
    decision: "accepted",
    resolutionReason: "현장 합의에 따라 요청 점수로 정정합니다.",
  }));
  assertFlow(resolveResult?.sqlReducer === true, "match dispute ruling did not use SQL reducer", resolveResult);
  match = await getMatchAfterResult(resolveResult, hostLogin, `${ids.label}:loadAfterDisputeRuling`);
  assertFlow(match?.status === "approval" && !match?.confirmedAt, "last dispute ruling did not return match to approval", match);
  assertFlow(match?.result?.scoreA === 3 && match?.result?.scoreB === 15, "accepted score dispute was not committed", match);
  assertFlow(Object.keys(match?.result?.playerStats ?? {}).length === 0, "no-referee dispute created personal stats", match);
  assertFlow((match?.approvals?.teamA ?? []).length === 0 && (match?.approvals?.teamB ?? []).length === 0, "stale approvals survived dispute resolution", match);

  await expectRejected(`${ids.label}:submitMatchResult:noRefereePostDisputeBlocked`, () => syncMatchAs(hostLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: {
      scoreA: 999,
      scoreB: 888,
      playerStats: { [hostId]: { points: 999 } },
    },
  }), ["no_referee_personal_stats_forbidden"]);

  const finalizeResult = await step(`${ids.label}:finalizeMatch`, () => syncMatchAs(hostLogin, {
    action: "finalizeMatch",
    matchId: ids.matchId,
  }));
  assertFlow(finalizeResult?.sqlReducer === true, "match finalization did not use SQL reducer", finalizeResult);
  match = await getMatchAfterResult(finalizeResult, hostLogin, `${ids.label}:loadAfterFinalization`);
  assertFlow(match?.status === "confirmed" && Boolean(match?.confirmedAt), "host finalization did not confirm match", match);

  await step(`${ids.label}:snapshotTrustSubjects`, () => snapshotRatingSubjects([opponentId]));
  const opponentTrustBeforeThumbs = await step(`${ids.label}:loadTrustBeforeThumbs`, () => getCurrentProfileTrustScore(opponentLogin, opponentId));
  const thumbsResult = await step(`${ids.label}:submitMatchThumbs`, () => syncMatchAs(hostLogin, {
    action: "submitMatchThumbs",
    matchId: ids.matchId,
    targetUserIds: [opponentId],
  }));
  match = await getMatchAfterResult(thumbsResult, hostLogin, `${ids.label}:loadAfterMatchThumbs`);
  assertFlow((match?.trustFeedback?.stars?.[hostId] ?? []).includes(opponentId), "match thumbs not persisted", {
    hostId,
    opponentId,
    match,
  });
  assertFlow(Boolean(thumbsResult?.sqlReducer), "match thumbs SQL reducer not used", thumbsResult);
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

  const toggleClearResult = await step(`${ids.label}:toggleMatchStar:clear`, () => syncMatchAs(hostLogin, {
    action: "toggleMatchStar",
    matchId: ids.matchId,
    targetUserId: opponentId,
  }));
  match = await getMatchAfterResult(toggleClearResult, hostLogin, `${ids.label}:loadAfterStarClear`);
  assertFlow(Boolean(toggleClearResult?.sqlReducer), "match star toggle clear SQL reducer not used", toggleClearResult);
  assertFlow(!(match?.trustFeedback?.stars?.[hostId] ?? []).includes(opponentId), "match star toggle clear not persisted", {
    hostId,
    opponentId,
    match,
  });

  const toggleRestoreResult = await step(`${ids.label}:toggleMatchStar:restore`, () => syncMatchAs(hostLogin, {
    action: "toggleMatchStar",
    matchId: ids.matchId,
    targetUserId: opponentId,
  }));
  match = await getMatchAfterResult(toggleRestoreResult, hostLogin, `${ids.label}:loadAfterStarRestore`);
  assertFlow(Boolean(toggleRestoreResult?.sqlReducer), "match star toggle restore SQL reducer not used", toggleRestoreResult);
  assertFlow((match?.trustFeedback?.stars?.[hostId] ?? []).includes(opponentId), "match star toggle restore not persisted", {
    hostId,
    opponentId,
    match,
  });

  let clearThumbsResult = null;
  let opponentTrustAfterClear = opponentTrustAfterThumbs;
  if (opponentTrustBeforeThumbs < 100) {
    clearThumbsResult = await step(`${ids.label}:submitMatchThumbs:clear`, () => syncMatchAs(hostLogin, {
      action: "submitMatchThumbs",
      matchId: ids.matchId,
      targetUserIds: [],
    }));
    match = await getMatchAfterResult(clearThumbsResult, hostLogin, `${ids.label}:loadAfterMatchThumbsClear`);
    assertFlow((match?.trustFeedback?.stars?.[hostId] ?? []).length === 0, "match thumbs clear not persisted", {
      hostId,
      match,
    });
    assertFlow(Boolean(clearThumbsResult?.sqlReducer), "match thumbs clear SQL reducer not used", clearThumbsResult);
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
      submitMatchThumbs: Boolean(thumbsResult?.sqlReducer),
      toggleMatchStarClear: Boolean(toggleClearResult?.sqlReducer),
      toggleMatchStarRestore: Boolean(toggleRestoreResult?.sqlReducer),
      clearMatchThumbs: clearThumbsResult ? Boolean(clearThumbsResult?.sqlReducer) : null,
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
      title: getSimulationDisplayTitle(ids.label),
      visibility: "public",
      hostJoinMode: "player",
      mode: "2v2",
      sideCapacity: 2,
      ...getKstFutureSchedule(24),
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: simulationCourtId,
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

  const rulesResult = await step(`${ids.label}:updateRecruitingRoomRules`, () => syncRecruitingAs(hostLogin, {
    action: "updateRecruitingRoomRules",
    postId: ids.postId,
    patch: {
      sideCapacity: 2,
      targetScore: 15,
      periodCount: 1,
      periodMinutes: 10,
      winByTwo: false,
      meetingPoint: "정문",
    },
  }));
  assertFlow(rulesResult?.sqlReducer === true && rulesResult?.advisoryLocked === true, "recruiting room rules SQL reducer not used", rulesResult);
  post = await getRecruitingPostAfterResult(rulesResult, hostLogin, `${ids.label}:loadAfterRulesUpdate`);
  assertFlow(post?.rules?.targetScore === 15 && post?.rules?.timeLimit === 10 && post?.rules?.winByTwo === false, "recruiting room rules not persisted", post);

  const hostReserveResult = await step(`${ids.label}:setRecruitingApplicantPlacement:hostReserve`, () => syncRecruitingAs(hostLogin, {
    action: "setRecruitingApplicantPlacement",
    postId: ids.postId,
    playerId: hostId,
    placement: { side: "teamA", reserve: true },
  }));
  post = await getRecruitingPostAfterResult(hostReserveResult, hostLogin, `${ids.label}:loadAfterHostReserve`);
  assertFlow(post?.roomState?.hostReserve === true, "host reserve placement not persisted", post);

  const hostActiveResult = await step(`${ids.label}:setRecruitingApplicantPlacement:hostActive`, () => syncRecruitingAs(hostLogin, {
    action: "setRecruitingApplicantPlacement",
    postId: ids.postId,
    playerId: hostId,
    placement: { side: "teamA", reserve: false },
  }));
  post = await getRecruitingPostAfterResult(hostActiveResult, hostLogin, `${ids.label}:loadAfterHostActive`);
  assertFlow(post?.roomState?.hostReserve === false, "host active placement not persisted", post);

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

  const reserveResult = await step(`${ids.label}:setRecruitingApplicantReserve`, () => syncRecruitingAs(opponentLogin, {
    action: "setRecruitingApplicantReserve",
    postId: ids.postId,
    playerId: opponentId,
    reserve: true,
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

  const cancelResult = await step(`${ids.label}:cancelRecruitingParticipation`, () => syncRecruitingAs(opponentLogin, {
    action: "cancelRecruitingParticipation",
    postId: ids.postId,
  }));
  assertFlow(cancelResult?.sqlReducer === true && cancelResult?.advisoryLocked === true, "recruiting participation cancel SQL reducer not used", cancelResult);
  post = await getRecruitingPostAfterResult(cancelResult, hostLogin, `${ids.label}:loadAfterParticipationCancel`);
  assertFlow(!(post?.applicants ?? []).some((item) => item.playerId === opponentId), "cancelled recruiting participant still present", { opponentId, post });

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
      updateRecruitingRoomRules: Boolean(rulesResult?.sqlReducer),
      hostReservePlacement: Boolean(hostReserveResult?.sqlReducer),
      hostActivePlacement: Boolean(hostActiveResult?.sqlReducer),
      setRecruitingSlotPosition: Boolean(positionResult?.sqlReducer),
      reservePlacement: Boolean(reserveResult?.sqlReducer),
      activePlacement: Boolean(activeResult?.sqlReducer),
      cancelRecruitingParticipation: Boolean(cancelResult?.sqlReducer),
    },
  };
}

async function runLiveSubstitutionScenario({
  label,
  hostLogin,
  teamAReserveLogin,
  teamBActiveLogin,
  removableReserveLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const teamAReserveId = await step(`${ids.label}:resolveProfile:teamAReserve`, () => getProfileIdForLogin(teamAReserveLogin));
  const teamBActiveId = await step(`${ids.label}:resolveProfile:teamBActive`, () => getProfileIdForLogin(teamBActiveLogin));
  const removableReserveId = await step(`${ids.label}:resolveProfile:removableReserve`, () => getProfileIdForLogin(removableReserveLogin));
  assertFlow(
    new Set([hostId, teamAReserveId, teamBActiveId, removableReserveId]).size === 4,
    "live substitution profiles must be unique",
    { hostId, teamAReserveId, teamBActiveId, removableReserveId },
  );

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: getSimulationDisplayTitle(ids.label),
      visibility: "public",
      hostJoinMode: "player",
      mode: "1v1",
      sideCapacity: 1,
      ...getKstFutureSchedule(24),
      ranked: false,
      official: false,
      preRegistered: true,
      teamOnly: false,
      refereeWanted: false,
      region: "Backend Simulation",
      courtId: simulationCourtId,
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
  assertFlow(post?.id === ids.postId, "created live substitution post not returned", createResult);

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

  const joinRemovableReserveResult = await step(`${ids.label}:interestRecruitingPost:removableReserve`, () => syncRecruitingAs(removableReserveLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamB",
      reserve: true,
      position: "C",
    },
    joinMode: "player",
  }));
  post = await getRecruitingPostAfterResult(joinRemovableReserveResult, removableReserveLogin, `${ids.label}:loadAfterRemovableReserve`);
  assertFlow(post?.applicants?.some((applicant) => applicant.playerId === removableReserveId && applicant.side === "teamB" && applicant.reserve === true), "removable reserve join not persisted", post);

  const confirmResult = await step(`${ids.label}:confirmRecruitingMatch`, () => syncRecruitingAs(hostLogin, {
    action: "confirmRecruitingMatch",
    postId: ids.postId,
    preferredMatchId: ids.matchId,
  }));
  assertFlow(confirmResult?.confirmationAtomic === true, "recruiting confirmation was not atomic", confirmResult);
  let match = confirmResult?.createdMatch;
  assertFlow(match?.id === ids.matchId, "live substitution match not returned", confirmResult);
  assertFlow((match.teamA?.players ?? []).includes(hostId), "teamA active roster mismatch", match);
  assertFlow((match.teamB?.players ?? []).includes(teamBActiveId), "teamB active roster mismatch", match);
  assertFlow((match.reservePlayers?.teamA ?? []).includes(teamAReserveId), "teamA reserve not persisted", match);
  assertFlow((match.reservePlayers?.teamB ?? []).includes(removableReserveId), "removable teamB reserve not persisted", match);
  assertFlow(!(match.teamA?.players ?? []).includes(teamAReserveId), "teamA reserve leaked into active roster", match);
  assertFlow(!(match.teamB?.players ?? []).includes(removableReserveId), "teamB reserve leaked into active roster", match);

  await expectRejected(`${ids.label}:updateMatchRoomRules:nonOperatorBlocked`, () => syncMatchAs(teamBActiveLogin, {
    action: "updateMatchRoomRules",
    matchId: ids.matchId,
    patch: { targetScore: 7, meetingPoint: "정문" },
  }), ["match_room_operator_required"]);

  const rulesResult = await step(`${ids.label}:updateMatchRoomRules`, () => syncMatchAs(hostLogin, {
    action: "updateMatchRoomRules",
    matchId: ids.matchId,
    patch: {
      sideCapacity: 1,
      targetScore: 15,
      periodCount: 1,
      periodMinutes: 10,
      winByTwo: false,
      meetingPoint: "정문",
    },
  }));
  assertFlow(rulesResult?.sqlReducer === true && rulesResult?.advisoryLocked === true, "match room rules SQL reducer not used", rulesResult);
  match = await getMatchAfterResult(rulesResult, hostLogin, `${ids.label}:loadAfterMatchRules`);
  assertFlow(match?.rules?.targetScore === 15 && match?.rules?.timeLimit === 10 && match?.rules?.winByTwo === false, "match room rules not persisted", match);

  const ruleAckResults = [];
  for (const [role, login, playerId] of [
    ["teamAReserve", teamAReserveLogin, teamAReserveId],
    ["teamBActive", teamBActiveLogin, teamBActiveId],
    ["removableReserve", removableReserveLogin, removableReserveId],
  ]) {
    if (!(match.rules?.ruleAcknowledgementRequiredIds ?? []).includes(playerId)
      || (match.rules?.ruleAcknowledgedIds ?? []).includes(playerId)) continue;
    const ackResult = await step(`${ids.label}:acknowledgeMatchRoomRules:${role}`, () => syncMatchAs(login, {
      action: "acknowledgeMatchRoomRules",
      matchId: ids.matchId,
      revision: Number(match.rules?.ruleRevision ?? 0),
    }));
    ruleAckResults.push(ackResult);
    match = await getMatchAfterResult(ackResult, login, `${ids.label}:loadAfterRuleAck:${role}`);
    assertFlow((match.rules?.ruleAcknowledgedIds ?? []).includes(playerId), `${role} rule acknowledgement not persisted`, match);
  }

  const moveToTeamBResult = await step(`${ids.label}:setMatchRoomPlayerPlacement:teamBReserve`, () => syncMatchAs(hostLogin, {
    action: "setMatchRoomPlayerPlacement",
    matchId: ids.matchId,
    playerId: teamAReserveId,
    placement: { side: "teamB", reserve: true },
  }));
  assertFlow(moveToTeamBResult?.sqlReducer === true && moveToTeamBResult?.advisoryLocked === true, "match player placement SQL reducer not used", moveToTeamBResult);
  match = await getMatchAfterResult(moveToTeamBResult, hostLogin, `${ids.label}:loadAfterMoveToTeamBReserve`);
  assertFlow((match?.reservePlayers?.teamB ?? []).includes(teamAReserveId), "match reserve side move not persisted", match);

  const moveBackResult = await step(`${ids.label}:setMatchRoomPlayerPlacement:teamAReserve`, () => syncMatchAs(hostLogin, {
    action: "setMatchRoomPlayerPlacement",
    matchId: ids.matchId,
    playerId: teamAReserveId,
    placement: { side: "teamA", reserve: true },
  }));
  assertFlow(moveBackResult?.sqlReducer === true && moveBackResult?.advisoryLocked === true, "match player placement return SQL reducer not used", moveBackResult);
  match = await getMatchAfterResult(moveBackResult, hostLogin, `${ids.label}:loadAfterMoveBackToTeamAReserve`);
  assertFlow((match?.reservePlayers?.teamA ?? []).includes(teamAReserveId) && !(match?.reservePlayers?.teamB ?? []).includes(teamAReserveId), "match reserve return move not persisted", match);

  const removeResult = await step(`${ids.label}:removeMatchRoomPlayer`, () => syncMatchAs(hostLogin, {
    action: "removeMatchRoomPlayer",
    matchId: ids.matchId,
    playerId: removableReserveId,
  }));
  assertFlow(removeResult?.sqlReducer === true && removeResult?.advisoryLocked === true, "match room player removal SQL reducer not used", removeResult);
  match = await getMatchAfterResult(removeResult, hostLogin, `${ids.label}:loadAfterRoomPlayerRemoval`);
  assertFlow(!(match?.reservePlayers?.teamB ?? []).includes(removableReserveId), "removed match reserve still present", match);

  const playableSchedule = getKstPastSchedule();
  await step(`${ids.label}:moveMatchIntoCheckInWindow`, async () => {
    const { error } = await supabase
      .from("matches")
      .update({
        scheduled_date: playableSchedule.scheduledDate,
        scheduled_time: playableSchedule.scheduledTime,
        scheduled_at: `${playableSchedule.scheduledDate} ${playableSchedule.scheduledTime}`,
      })
      .eq("id", ids.matchId);
    if (error) throw error;
  });
  match = await step(`${ids.label}:loadAfterCheckInSchedule`, () => loadMatchAs(hostLogin, ids.matchId));

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
  assertFlow((match.attendance?.teamB ?? []).includes(teamBActiveId), "live substitution teamB check-in not persisted", match);

  const checkInReserveResult = await step(`${ids.label}:checkInMatchPlayer:teamAReserve`, () => syncMatchAs(hostLogin, {
    action: "checkInMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamA",
    playerId: teamAReserveId,
  }));
  match = await getMatchAfterResult(checkInReserveResult, hostLogin, `${ids.label}:loadAfterCheckInTeamAReserve`);
  assertFlow((match.attendance?.teamA ?? []).includes(teamAReserveId), "live substitution teamA reserve check-in not persisted", match);

  const startResult = await step(`${ids.label}:startMatch`, () => syncMatchAs(hostLogin, {
    action: "startMatch",
    matchId: ids.matchId,
  }));
  match = await getMatchAfterResult(startResult, hostLogin, `${ids.label}:loadAfterStartMatch`);
  assertFlow(Boolean(match?.startedAt), "live substitution match start not persisted", match);

  const clockTransferResult = await step(`${ids.label}:transferMatchClock:teamAReserve`, () => controlMatchClockAs(
    hostLogin,
    ids.matchId,
    "transfer",
    { controllerId: teamAReserveId },
  ));
  assertFlow(
    clockTransferResult?.clock?.controllerId === teamAReserveId
      && clockTransferResult?.activePlayers?.some((player) => (
        player.id === teamAReserveId && player.role === "reserve"
      )),
    "reserve player did not receive match clock control",
    clockTransferResult,
  );

  await expectRejected(`${ids.label}:submitMatchResult:reserveOwnRowBlocked`, () => syncMatchAs(teamAReserveLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: {
      playerStats: { [teamAReserveId]: { points: 1 } },
    },
  }), ["no_referee_personal_stats_forbidden"]);

  await expectRejected(`${ids.label}:submitMatchResult:noRefereeStatsBlocked`, () => syncMatchAs(hostLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: {
      scoreA: 999,
      scoreB: 888,
      playerStats: { [hostId]: { points: 4 } },
    },
  }), ["no_referee_personal_stats_forbidden"]);

  await expectRejected(`${ids.label}:incrementMatchScore:nonControllerBlocked`, () => syncMatchAs(hostLogin, {
    action: "incrementMatchScore",
    matchId: ids.matchId,
    deltaA: 1,
    deltaB: 0,
    expectedRevisionA: Number(match?.result?.scoreRevisionA ?? 0),
    expectedRevisionB: Number(match?.result?.scoreRevisionB ?? 0),
  }), ["match_score_clock_controller_required"]);

  const clockScoreWrite = await setMatchScoreByIncrements({
    label: `${ids.label}:clockController`,
    login: teamAReserveLogin,
    match,
    scoreA: 4,
    scoreB: 0,
  });
  match = clockScoreWrite.match;
  assertFlow(
    match?.status === "agreed" && !match?.endedAt && getMatchRoomPhase(match).phase === "live" && match?.result?.scoreA === 4 && match?.result?.scoreB === 0,
    "clock controller score increment did not persist",
    match,
  );

  const reserveSelfSubResult = await step(`${ids.label}:substituteMatchPlayer:reserveSelf`, () => syncMatchAs(teamAReserveLogin, {
    action: "substituteMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamA",
    activePlayerId: hostId,
    reservePlayerId: teamAReserveId,
    reason: "self",
  }));
  match = await getMatchAfterResult(reserveSelfSubResult, teamAReserveLogin, `${ids.label}:loadAfterReserveSelfSubstitution`);
  assertFlow((match.teamA?.players ?? []).includes(teamAReserveId) && !(match.teamA?.players ?? []).includes(hostId), "reserve self-substitution active roster mismatch", match);
  assertFlow((match.reservePlayers?.teamA ?? []).includes(hostId) && !(match.reservePlayers?.teamA ?? []).includes(teamAReserveId), "reserve self-substitution reserve roster mismatch", match);
  assertFlow((match.playedPlayerIds?.teamA ?? []).includes(hostId) && (match.playedPlayerIds?.teamA ?? []).includes(teamAReserveId), "reserve self-substitution played ids missing", match);
  assertFlow(Boolean(reserveSelfSubResult?.sqlReducer), "reserve self-substitution SQL reducer not used", reserveSelfSubResult);

  const substituteResult = await step(`${ids.label}:substituteMatchPlayer`, () => syncMatchAs(hostLogin, {
    action: "substituteMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamA",
    activePlayerId: teamAReserveId,
    reservePlayerId: hostId,
    reason: "self",
  }));
  match = await getMatchAfterResult(substituteResult, hostLogin, `${ids.label}:loadAfterSubstitution`);
  assertFlow(Boolean(substituteResult?.sqlReducer), "substitution SQL reducer not used", substituteResult);
  assertFlow((match.teamA?.players ?? []).includes(hostId) && !(match.teamA?.players ?? []).includes(teamAReserveId), "substitution did not promote reserve", match);
  assertFlow((match.reservePlayers?.teamA ?? []).includes(teamAReserveId) && !(match.reservePlayers?.teamA ?? []).includes(hostId), "substitution reserve roster mismatch", match);
  assertFlow((match.playedPlayerIds?.teamA ?? []).includes(hostId) && (match.playedPlayerIds?.teamA ?? []).includes(teamAReserveId), "substitution played ids missing", match);

  return {
    label: ids.label,
    hostLogin,
    reserveLogin: teamAReserveLogin,
    clockControllerLogin: teamAReserveLogin,
    postId: ids.postId,
    matchId: ids.matchId,
    swapped: true,
    sqlReducers: {
      teamAReserveJoin: Boolean(joinTeamAReserveResult?.sqlReducer),
      teamBActiveJoin: Boolean(joinTeamBActiveResult?.sqlReducer),
      removableReserveJoin: Boolean(joinRemovableReserveResult?.sqlReducer),
      updateMatchRoomRules: Boolean(rulesResult?.sqlReducer),
      acknowledgeMatchRoomRules: ruleAckResults.every((result) => Boolean(result?.sqlReducer)),
      setMatchRoomPlayerPlacement: Boolean(moveToTeamBResult?.sqlReducer && moveBackResult?.sqlReducer),
      removeMatchRoomPlayer: Boolean(removeResult?.sqlReducer),
      checkInMatchPlayer: Boolean(checkInBResult?.sqlReducer),
      checkInReservePlayer: Boolean(checkInReserveResult?.sqlReducer),
      startMatch: Boolean(startResult?.sqlReducer),
      transferMatchClock: clockTransferResult?.clock?.controllerId === teamAReserveId,
      clockScore: Boolean(clockScoreWrite?.sqlReducer),
      reserveSelfSubstitution: Boolean(reserveSelfSubResult?.sqlReducer),
      substituteMatchPlayer: Boolean(substituteResult?.sqlReducer),
    },
  };
}

async function runDiscordRoomChatBridgeScenario({
  label,
  hostLogin,
  guestLogin,
}) {
  ids = makeScenarioIds(label);
  if (!supabase) {
    return { label: ids.label, skipped: true, reason: "service_role_key_missing" };
  }

  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const guestId = await step(`${ids.label}:resolveProfile:guest`, () => getProfileIdForLogin(guestLogin));
  assertFlow(hostId !== guestId, "discord room chat host and guest must be different profiles", { hostId, guestId });
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
      title: getSimulationDisplayTitle(ids.label),
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
      courtId: simulationCourtId,
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

  const joinResult = await step(`${ids.label}:interestRecruitingPost:guest`, () => syncRecruitingAs(guestLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamB",
      position: "SG",
    },
    joinMode: "player",
  }));
  const joinedPost = await getRecruitingPostAfterResult(joinResult, guestLogin, `${ids.label}:loadAfterGuestJoin`);
  assertFlow(joinedPost?.applicants?.some((item) => item.playerId === guestId), "discord room chat guest join not persisted", { guestId, joinedPost });

  await step(`${ids.label}:setTemporaryDiscordUser`, () => setTemporaryProfileDiscordUser(guestId, discordUserId, "rankball-sim-chat"));

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
  assertFlow(bridgeResult?.message?.userId === guestId && bridgeResult.message.body === bridgePayload.body, "discord bridge message payload mismatch", bridgeResult);

  const duplicateResult = await step(`${ids.label}:discordRoomChatBridge:duplicate`, () => syncDiscordRoomChatBridge(bridgePayload));
  assertFlow(duplicateResult?.ok && duplicateResult?.duplicate === true, "discord bridge duplicate not detected", duplicateResult);

  const botResult = await step(`${ids.label}:discordRoomChatBridge:botSkip`, () => syncDiscordRoomChatBridge({
    ...bridgePayload,
    messageId: botMessageId,
    body: "discord bot echo",
    authorBot: true,
  }));
  assertFlow(botResult?.ok && botResult?.skipped === "bot_or_webhook_message", "discord bridge bot echo not skipped", botResult);

  let webChatResult = null;
  if (!usesRemoteApi) {
    const previousDryRun = process.env.DISCORD_CHAT_SYNC_DRY_RUN;
    process.env.DISCORD_CHAT_SYNC_DRY_RUN = "1";
    try {
      webChatResult = await step(`${ids.label}:webRoomChatToDiscord`, () => syncRecruitingAs(hostLogin, {
        action: "sendRecruitingChat",
        postId: ids.postId,
        body: "web bridge ping",
      }));
    } finally {
      if (previousDryRun === undefined) {
        delete process.env.DISCORD_CHAT_SYNC_DRY_RUN;
      } else {
        process.env.DISCORD_CHAT_SYNC_DRY_RUN = previousDryRun;
      }
    }
    assertFlow(webChatResult?.message?.body === "web bridge ping", "web chat message not persisted", webChatResult);
    assertFlow(webChatResult?.discordChatSync?.sent === true && webChatResult.discordChatSync.dryRun === true, "web chat Discord dry-run sync not used", webChatResult);
  }

  const loadedPost = await loadRecruitingPostAs(hostLogin, ids.postId);
  const chatMessages = loadedPost?.roomState?.chatMessages ?? [];
  assertFlow(chatMessages.some((message) => message.id === bridgeResult.message.id && message.userId === guestId && message.body === bridgePayload.body), "discord bridge chat not visible in room detail", chatMessages);
  if (webChatResult) {
    assertFlow(chatMessages.some((message) => message.id === webChatResult.message.id && message.userId === hostId && message.body === webChatResult.message.body), "web bridge chat not visible in room detail", chatMessages);
  }
  assertFlow(!chatMessages.some((message) => message.body === "discord bot echo"), "discord bridge bot echo persisted", chatMessages);

  return {
    label: ids.label,
    hostLogin,
    guestLogin,
    postId: ids.postId,
    discordThreadNormalized: true,
    duplicateBlocked: true,
    botEchoSkipped: true,
    webToDiscordDryRun: Boolean(webChatResult?.discordChatSync?.dryRun),
    messageId: bridgeResult.message.id,
  };
}

async function runDiscordNotificationOptInScenario({
  label,
  login,
}) {
  const ids = makeScenarioIds(label);
  if (!supabase) return { label: ids.label, skipped: true, reason: "service_role_key_missing" };
  const profileId = await step(`${ids.label}:resolveProfile`, () => getProfileIdForLogin(login));
  const discordUserId = makeDiscordSnowflake(401);
  const notificationId = `sim_notice_discord_opt_in_${ids.label}_${suffix}`;
  const deliveryId = `discord-${profileId}-${notificationId}`;
  simulationNotificationIds.add(notificationId);
  simulationDiscordDeliveryIds.add(deliveryId);
  await step(`${ids.label}:createNotification`, async () => {
    const now = new Date().toISOString();
    const { error } = await supabase.from("notifications").insert({
      id: notificationId,
      user_id: profileId,
      target_user_id: profileId,
      title: "Backend simulation Discord opt-in",
      body: "Discord opt-in guard",
      tone: "blue",
      type: "match",
      discord_event: "match",
      payload: {
        id: notificationId,
        targetUserId: profileId,
        title: "Backend simulation Discord opt-in",
        body: "Discord opt-in guard",
        tone: "blue",
        type: "match",
        discordEvent: "match",
      },
      created_at: now,
      updated_at: now,
    });
    if (error) throw error;
  });
  await step(`${ids.label}:setTemporaryDiscordUser`, () => setTemporaryProfileDiscordUser(profileId, discordUserId, "rankball-sim-opt-in"));
  await step(`${ids.label}:disableDiscordNotifications`, () => setTemporaryDiscordNotificationSettings(profileId, {
    enabled: false,
    events: { match: true },
  }));

  const disabledProfiles = await step(`${ids.label}:getDisabledDiscordProfiles`, () => getDiscordProfiles(supabase, [profileId], "match"));
  assertFlow(disabledProfiles.length === 0, "disabled Discord profile entered server delivery targets", disabledProfiles);
  const delivery = {
    id: `client-${deliveryId}`,
    notificationId,
    targetUserId: profileId,
    event: "match",
    title: "Backend simulation Discord opt-in",
    body: "Discord opt-in guard",
    queuedAt: new Date().toISOString(),
    sendAt: new Date(Date.now() + HOUR_MS).toISOString(),
  };
  const disabledSync = await step(`${ids.label}:syncDisabledDelivery`, () => syncDiscordDeliveriesAs(login, [delivery]));
  assertFlow(disabledSync?.ok && disabledSync?.count === 0, "disabled Discord delivery was accepted", disabledSync);

  await step(`${ids.label}:enableDiscordMatchNotifications`, () => setTemporaryDiscordNotificationSettings(profileId, {
    enabled: true,
    events: { match: true },
  }));
  const enabledProfiles = await step(`${ids.label}:getEnabledDiscordProfiles`, () => getDiscordProfiles(supabase, [profileId], "match"));
  assertFlow(enabledProfiles.length === 1 && enabledProfiles[0].id === profileId, "enabled Discord profile missing from server targets", enabledProfiles);
  const forgedSync = await step(`${ids.label}:rejectForgedDelivery`, () => syncDiscordDeliveriesAs(login, [{
    ...delivery,
    id: `forged-${deliveryId}`,
    notificationId: `missing-${notificationId}`,
  }]));
  assertFlow(forgedSync?.ok && forgedSync?.count === 0, "forged Discord delivery was accepted", forgedSync);
  const enabledSync = await step(`${ids.label}:syncEnabledDelivery`, () => syncDiscordDeliveriesAs(login, [delivery]));
  assertFlow(enabledSync?.ok && enabledSync?.count === 1, "enabled Discord delivery was not accepted", enabledSync);

  const { data: queuedDelivery, error: queuedError } = await supabase
    .from("discord_notification_deliveries")
    .select("id,status,attempt_count")
    .eq("id", deliveryId)
    .maybeSingle();
  if (queuedError) throw queuedError;
  assertFlow(queuedDelivery?.status === "queued" && queuedDelivery?.attempt_count === 0, "Discord delivery retry state was not initialized", queuedDelivery);

  const disableResult = await step(`${ids.label}:disableMatchEventThroughSettingsApi`, () => syncSettingsAs(login, {
    notificationChannels: { discord: { events: { match: false } } },
  }));
  assertFlow(disableResult?.ok && disableResult?.settings?.notificationChannels?.discord?.events?.match === false, "Discord event opt-out was not saved", disableResult);
  const { data: cancelledDelivery, error: cancelledError } = await supabase
    .from("discord_notification_deliveries")
    .select("id,status,last_error")
    .eq("id", deliveryId)
    .maybeSingle();
  if (cancelledError) throw cancelledError;
  assertFlow(cancelledDelivery?.status === "cancelled" && cancelledDelivery?.last_error === "discord_notification_disabled", "queued Discord delivery survived opt-out", cancelledDelivery);

  await step(`${ids.label}:deleteNotification`, async () => {
    const { error } = await supabase.from("notifications").delete().eq("id", notificationId);
    if (error) throw error;
  });
  const { data: orphanDelivery, error: orphanError } = await supabase
    .from("discord_notification_deliveries")
    .select("id")
    .eq("id", deliveryId)
    .maybeSingle();
  if (orphanError) throw orphanError;
  assertFlow(!orphanDelivery, "Discord delivery survived notification deletion", orphanDelivery);

  return {
    label: ids.label,
    login,
    profileId,
    disabledBlocked: true,
    forgedBlocked: true,
    enabledQueued: true,
    queuedCancelledOnOptOut: true,
    notificationDeleteCascaded: true,
  };
}

async function runDiscordUniqueProfileScenario({
  label,
  linkedLogin,
  duplicateLogin,
}) {
  ids = makeScenarioIds(label);
  const linkedProfileId = await step(`${ids.label}:resolveProfile:linked`, () => getProfileIdForLogin(linkedLogin));
  const duplicateProfileId = await step(`${ids.label}:resolveProfile:duplicate`, () => getProfileIdForLogin(duplicateLogin));
  assertFlow(linkedProfileId !== duplicateProfileId, "Discord unique profiles must differ", { linkedProfileId, duplicateProfileId });
  const discordUserId = makeDiscordSnowflake(402);
  await step(`${ids.label}:linkSourceProfile`, () => setTemporaryProfileDiscordUser(linkedProfileId, discordUserId, "rankball-sim-unique"));

  const rejected = await expectRejected(`${ids.label}:rejectDuplicateDiscordLink`, () => upsertProfileAs(duplicateLogin, {
    discordConnection: {
      provider: "discord",
      status: "linked",
      userId: discordUserId,
      username: "rankball-sim-duplicate",
    },
  }), ["discord_user_already_linked", "discord_oauth_proof_required"]);
  assertFlow(rejected.rejected, "duplicate Discord profile link was not rejected", rejected);

  return {
    label: ids.label,
    linkedLogin,
    duplicateLogin,
    linkedProfileId,
    duplicateProfileId,
    uniqueLinkEnforced: true,
  };
}

async function runRefereeExamServerScenario({
  label,
  login,
}) {
  ids = makeScenarioIds(label);
  const profileId = await step(`${ids.label}:resolveProfile`, () => getProfileIdForLogin(login));
  await step(`${ids.label}:ensureExamTrustScore`, () => ensureSimulationTrustScore(profileId, REFEREE_TRUST_MIN));
  await step(`${ids.label}:clearSimulationCooldown`, () => clearRefereeSimulationCooldown(profileId));
  const attemptId = `sim_rea_${ids.label}_${suffix}`;
  const secondAttemptId = `sim_rea_${ids.label}_concurrent_${suffix}`;
  const cooldownAttemptId = `sim_rea_${ids.label}_cooldown_${suffix}`;
  const requestId = `sim_rr_${ids.label}_${suffix}`;
  refereeSimulationAttemptIds.add(attemptId);
  refereeSimulationAttemptIds.add(secondAttemptId);
  refereeSimulationAttemptIds.add(cooldownAttemptId);
  refereeSimulationRequestIds.add(requestId);

  const concurrentStarts = await step(`${ids.label}:startExamConcurrent`, () => Promise.allSettled([
    syncRefereeAs(login, { action: "startExam", attempt: { id: attemptId } }),
    syncRefereeAs(login, { action: "startExam", attempt: { id: secondAttemptId } }),
  ]));
  const successfulStart = concurrentStarts.find((result) => result.status === "fulfilled");
  const blockedStart = concurrentStarts.find((result) => result.status === "rejected");
  assertFlow(
    concurrentStarts.filter((result) => result.status === "fulfilled").length === 1 &&
      concurrentStarts.filter((result) => result.status === "rejected").length === 1 &&
      String(blockedStart?.reason?.message || blockedStart?.reason || "").includes("referee_exam_cooldown_active"),
    "concurrent referee exam starts were not serialized",
    concurrentStarts,
  );
  const startResult = successfulStart.value;
  const activeAttemptId = startResult.attemptId;
  const attempt = startResult?.attempt ?? {};
  assertFlow(startResult?.ok && [attemptId, secondAttemptId].includes(activeAttemptId), "referee exam start failed", startResult);
  assertFlow(attempt.userId === profileId && attempt.status === "started", "referee exam start payload mismatch", attempt);
  assertFlow(Array.isArray(attempt.questionIds) && attempt.questionIds.length === attempt.total, "referee exam question ids missing", attempt);
  assertFlow((attempt.questions ?? []).length === attempt.total, "referee exam public questions missing", attempt);
  assertFlow((attempt.questions ?? []).every((question) => question.answerIndex === undefined && question.explanation === undefined), "referee exam leaked answer data", attempt.questions);

  const duplicateStart = await step(`${ids.label}:startExamDuplicate`, () => syncRefereeAs(login, {
    action: "startExam",
    attempt: { id: activeAttemptId },
  }));
  assertFlow(duplicateStart?.duplicate === true && duplicateStart?.attempt?.id === activeAttemptId, "referee exam duplicate start mismatch", duplicateStart);

  const answerKey = getRefereeExamAnswerKey(attempt.questionIds);
  const finishResult = await step(`${ids.label}:finishExam`, () => syncRefereeAs(login, {
    action: "finishExam",
    attempt: {
      id: activeAttemptId,
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
      examAttemptId: activeAttemptId,
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
      attempt: { id: cooldownAttemptId },
    }),
    ["referee_exam_cooldown_active"],
  );

  return {
    label: ids.label,
    login,
    profileId,
    attemptId: activeAttemptId,
    requestId,
    publicQuestionsOnly: true,
    serverGraded: true,
    requestAccepted: true,
    concurrentStartGuard: true,
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
      title: getSimulationDisplayTitle(ids.label),
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
      courtId: simulationCourtId,
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
      title: getSimulationDisplayTitle(ids.label),
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
      courtId: simulationCourtId,
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

  const createResult = await step(`${ids.label}:createRecruitingPost`, () => syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: getSimulationDisplayTitle(ids.label),
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
      courtId: simulationCourtId,
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

  const inviteBTeamResult = await step(`${ids.label}:inviteTeamB:players`, () => syncRecruitingAs(hostLogin, {
    action: "inviteRecruitingPlayers",
    postId: ids.postId,
    invite: {
      side: "teamB",
      reserve: false,
      joinMode: "player",
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
        ...teamInviteIds.map((profileId) => ({ profileId, side: "teamB", reserve: false, kind: "player" })),
        ...inviteAActiveIds.slice(0, 4).map((profileId) => ({ profileId, side: "teamA", reserve: false, kind: "player" })),
        ...inviteAActiveIds.slice(4, 6).map((profileId) => ({ profileId, side: "teamA", reserve: true, kind: "player" })),
        ...inviteBActiveIds.slice(0, 3).map((profileId) => ({ profileId, side: "teamB", reserve: false, kind: "player" })),
        ...inviteBActiveIds.slice(3, 5).map((profileId) => ({ profileId, side: "teamB", reserve: true, kind: "player" })),
      ]
    : [
        ...teamInviteIds.map((profileId) => ({ profileId, side: "teamB", reserve: false, kind: "player" })),
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
        placement?.kind === expected.kind,
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

  let partySqlReducers;
  if (!overflow) {
    const kickedReserveId = inviteBReserveIds[0];
    const kickReserveResult = await step(`${ids.label}:kickRecruitingApplicant:freeReserve`, () => syncRecruitingAs(hostLogin, {
      action: "kickRecruitingApplicant",
      postId: ids.postId,
      playerId: kickedReserveId,
    }));
    assertFlow(kickReserveResult?.sqlReducer === true, "reserve kick SQL reducer not used", kickReserveResult);
    post = await getRecruitingPostAfterResult(kickReserveResult, hostLogin, `${ids.label}:loadAfterReserveKick`);
    assertFlow(!(post?.applicants ?? []).some((item) => item.playerId === kickedReserveId), "kicked reserve applicant still persisted", post);
    partySqlReducers = {
      personalRoomOnly: true,
      kick: Boolean(kickReserveResult?.sqlReducer),
    };
  }

  let closeSqlReducer;
  let closePenalty;
  if (overflow) {
    await step(`${ids.label}:snapshotClosePenaltyProfile`, () => snapshotRatingSubjects([hostId]));
    const trustBeforeClose = await step(`${ids.label}:trustBeforeClose`, () => getCurrentProfileTrustScore(hostLogin, hostId));
    const closeResult = await step(`${ids.label}:closeRecruitingPost`, () => syncRecruitingAs(hostLogin, {
      action: "closeRecruitingPost",
      postId: ids.postId,
    }));
    assertFlow(closeResult?.sqlReducer === true, "recruiting close SQL reducer not used", closeResult);
    post = await getRecruitingPostAfterResult(closeResult, hostLogin, `${ids.label}:loadAfterClose`);
    const trustAfterClose = await step(`${ids.label}:trustAfterClose`, () => getCurrentProfileTrustScore(hostLogin, hostId));
    closePenalty = Number(closeResult?.penalty ?? 0);
    assertFlow(post.status === "closed", "recruiting post did not close", post);
    assertFlow(trustAfterClose === Math.max(0, trustBeforeClose - closePenalty), "recruiting close penalty mismatch", {
      trustBeforeClose,
      trustAfterClose,
      closePenalty,
    });
    closeSqlReducer = true;
  }

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
    partySqlReducers,
    closeSqlReducer,
    closePenalty,
  };
}

async function runSoloRecordScenario({
  label,
  hostLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const recordSchedule = getKstPastSchedule(1);

  const createResult = await step(`${ids.label}:createSoloRecord`, () => syncMatchAs(hostLogin, {
    action: "createMatch",
    preferredMatchId: ids.matchId,
    draft: {
      id: ids.matchId,
      recordType: "solo",
      recordEntryMode: "named",
      visibility: "public",
      title: getSimulationDisplayTitle(ids.label),
      courtId: simulationCourtId,
      court: "Backend Simulation Court",
      scheduledDate: recordSchedule.scheduledDate,
      scheduledTime: recordSchedule.scheduledTime,
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
  assertFlow(match?.visibility === "public" && match?.rules?.visibility === "public", "solo record visibility missing", match);
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

  const deleteResult = await step(`${ids.label}:deleteSoloRecord`, () => syncMatchAs(hostLogin, {
    action: "deleteSoloRecord",
    matchId: ids.matchId,
  }));
  const deletedMatch = await getMatchAfterResult(deleteResult, hostLogin, `${ids.label}:loadAfterDeleteSoloRecord`);
  assertFlow(deleteResult?.sqlReducer === true, "solo record delete did not use SQL reducer", deleteResult);
  assertFlow(deletedMatch?.status === "cancelled", "solo record delete not persisted", deletedMatch);
  const terminalFeedGuard = await step(`${ids.label}:terminalFeedRefreshGuard`, () => assertTerminalFeedRefreshGuard("match", ids.matchId));

  return {
    label: ids.label,
    hostLogin,
    hostId,
    matchId: ids.matchId,
    opponentId,
    score: `${match.result.scoreA}:${match.result.scoreB}`,
    mmrExcluded: true,
    deleted: true,
    sqlReducer: true,
    terminalFeedGuard,
  };
}

async function runMatchRecordRosterScenario({
  label,
  teamIds = ["team-rb-01", "team-rb-02", "team-rb-03", "team-rb-04"],
}) {
  ids = makeScenarioIds(label);
  const fixtures = (await resolveTournamentTeamFixtures(process.env.RANKBALL_SIM_TOURNAMENT_CREATOR || "rankball-001", teamIds))
    .filter((fixture) => (fixture.team.members ?? []).length >= 2)
    .slice(0, 2);
  assertFlow(fixtures.length === 2, "match record roster teams missing", fixtures);

  const [teamAFixture, teamBFixture] = fixtures;
  const teamAPlayerIds = uniqueIds((teamAFixture.team.members ?? []).map((member) => member.userId));
  const teamBPlayerIds = uniqueIds((teamBFixture.team.members ?? []).map((member) => member.userId));
  const teamASecondId = teamAPlayerIds.find((userId) => userId !== teamAFixture.captainId) ?? "";
  const teamBSecondId = teamBPlayerIds.find((userId) => userId !== teamBFixture.captainId) ?? "";
  assertFlow(Boolean(teamASecondId && teamBSecondId), "match record roster member missing", {
    teamA: teamAFixture.team,
    teamB: teamBFixture.team,
  });

  const recordSchedule = getKstPastSchedule(1);
  const createResult = await step(`${ids.label}:createMatchRecord`, () => syncMatchAs(teamAFixture.captainLogin, {
    action: "createMatch",
    preferredMatchId: ids.matchId,
    draft: {
      id: ids.matchId,
      recordType: "match_record",
      recordComposition: "team",
      title: getSimulationDisplayTitle(ids.label),
      visibility: "private",
      hostJoinMode: "team",
      teamOnly: true,
      mode: "2v2",
      playerIds: [teamAFixture.captainId],
      opponentPlayerIds: [],
      scheduledDate: recordSchedule.scheduledDate,
      scheduledTime: recordSchedule.scheduledTime,
      ranked: false,
      official: false,
    },
  }));
  let match = await getMatchAfterResult(createResult, teamAFixture.captainLogin, `${ids.label}:loadAfterCreateMatchRecord`);
  assertFlow(match?.rules?.recordType === "match_record", "match record type missing", match);
  if (supabase) {
    const { data: feedCard, error: feedCardError } = await supabase
      .from("room_feed_cards")
      .select("card_json")
      .eq("entity_type", "match")
      .eq("entity_id", ids.matchId)
      .maybeSingle();
    if (feedCardError) throw feedCardError;
    assertFlow(feedCard?.card_json?.recordType === "match_record", "match record feed card type missing", feedCard);
  }
  const standardMatchState = await loadMatchesAs(teamAFixture.captainLogin, {
    activeOnly: false,
    includeRecentCompleted: false,
    includeClosedNotices: false,
  });
  assertFlow(
    !(standardMatchState.matches ?? []).some((item) => item.id === ids.matchId),
    "match record leaked into the standard match list",
    standardMatchState.matches,
  );
  const playMatchState = await loadMatchesAs(teamAFixture.captainLogin, {
    playOnly: true,
    activeOnly: true,
    includeRecentCompleted: false,
    includeClosedNotices: false,
  });
  assertFlow(
    (playMatchState.matches ?? []).some((item) => item.id === ids.matchId),
    "match record missing from the play list",
    playMatchState.matches,
  );
  assertFlow((match.teamA?.players ?? []).length === 1 && match.teamA.players[0] === teamAFixture.captainId, "match record creator seed mismatch", match);
  assertFlow((match.teamB?.players ?? []).length === 0, "match record must not invite teamB during creation", match);
  assertFlow(match.rules?.recordSetupReady === false, "match record must start without configured participants", match);

  const setupResult = await step(`${ids.label}:setMatchRecordParticipants`, () => syncMatchAs(teamAFixture.captainLogin, {
    action: "setMatchRecordParticipants",
    matchId: ids.matchId,
    setup: {
      composition: "team",
      teamAId: teamAFixture.team.id,
      teamBId: teamBFixture.team.id,
    },
  }));
  assertFlow(
    setupResult?.sqlReducer === true && setupResult?.advisoryLocked === true,
    "team match record participant setup SQL reducer not used",
    setupResult,
  );
  match = await getMatchAfterResult(setupResult, teamAFixture.captainLogin, `${ids.label}:loadAfterParticipantSetup`);
  assertFlow(match.teamA?.teamId === teamAFixture.team.id && match.teamB?.teamId === teamBFixture.team.id, "match record team setup missing", match);
  assertFlow((match.teamA?.players ?? [])[0] === teamAFixture.captainId && (match.teamB?.players ?? [])[0] === teamBFixture.captainId, "match record captain setup mismatch", match);

  const teamAResult = await step(`${ids.label}:setMatchRecordTeamRoster:teamA`, () => syncMatchAs(teamAFixture.captainLogin, {
    action: "setMatchRecordTeamRoster",
    matchId: ids.matchId,
    sideName: "teamA",
    roster: {
      playerIds: [teamAFixture.captainId, teamASecondId],
      reservePlayerIds: [],
    },
  }));
  match = await getMatchAfterResult(teamAResult, teamAFixture.captainLogin, `${ids.label}:loadAfterTeamARoster`);
  assertFlow((match.teamA?.players ?? []).includes(teamASecondId), "teamA record roster operation-only update missing", match);

  const teamBResult = await step(`${ids.label}:setMatchRecordTeamRoster:teamB`, () => syncMatchAs(teamBFixture.captainLogin, {
    action: "setMatchRecordTeamRoster",
    matchId: ids.matchId,
    sideName: "teamB",
    roster: {
      playerIds: [teamBFixture.captainId, teamBSecondId],
      reservePlayerIds: [],
    },
  }));
  match = await getMatchAfterResult(teamBResult, teamBFixture.captainLogin, `${ids.label}:loadAfterTeamBRoster`);
  assertFlow((match.teamB?.players ?? []).includes(teamBSecondId), "teamB record roster operation-only update missing", match);

  await expectRejected(
    `${ids.label}:setMatchRecordTeamRoster:wrongSideBlocked`,
    () => syncMatchAs(teamAFixture.captainLogin, {
      action: "setMatchRecordTeamRoster",
      matchId: ids.matchId,
      sideName: "teamB",
      roster: {
        playerIds: [teamBFixture.captainId],
        reservePlayerIds: [],
      },
    }),
    ["match_operation_noop", "match_sync_permission_denied"],
  );

  return {
    label: ids.label,
    matchId: ids.matchId,
    teamAId: teamAFixture.team.id,
    teamBId: teamBFixture.team.id,
    teamAPlayers: match.teamA?.players ?? [],
    teamBPlayers: match.teamB?.players ?? [],
    wrongSideBlocked: true,
  };
}

async function runOneOnOneMatchRecordScenario({
  label,
  hostLogin,
  opponentLogin,
}) {
  ids = makeScenarioIds(label);
  const hostId = await step(`${ids.label}:resolveProfile:host`, () => getProfileIdForLogin(hostLogin));
  const opponentId = await step(`${ids.label}:resolveProfile:opponent`, () => getProfileIdForLogin(opponentLogin));
  const recordSchedule = getKstPastSchedule(1);
  const makeRecordDraft = (schedule) => ({
    id: ids.matchId,
    recordType: "match_record",
    recordComposition: "individual",
    title: getSimulationDisplayTitle(ids.label),
    visibility: "private",
    hostJoinMode: "player",
    teamOnly: false,
    mode: "1v1",
    playerIds: [hostId],
    opponentPlayerIds: [],
    opponentLeaderId: "",
    scheduledDate: schedule.scheduledDate,
    scheduledTime: schedule.scheduledTime,
    ranked: true,
    official: true,
    preRegistered: true,
    mmrLimitMode: "block",
    ageRestriction: "open",
    courtReserved: true,
    courtFee: "50000",
    stakes: "malicious pregame payload",
    objectionWindow: "1시간",
  });

  await expectRejected(`${ids.label}:rejectFutureRecord`, () => syncMatchAs(hostLogin, {
    action: "createMatch",
    preferredMatchId: ids.matchId,
    draft: makeRecordDraft(getKstScheduleAt(new Date(Date.now() + 2 * MINUTE_MS))),
  }), ["match_operation_noop"]);
  await expectRejected(`${ids.label}:rejectExpiredRecord`, () => syncMatchAs(hostLogin, {
    action: "createMatch",
    preferredMatchId: ids.matchId,
    draft: makeRecordDraft(getKstScheduleAt(new Date(Date.now() - DAY_MS - MINUTE_MS))),
  }), ["match_operation_noop"]);

  const createResult = await step(`${ids.label}:createMatchRecord1v1`, () => syncMatchAs(hostLogin, {
    action: "createMatch",
    preferredMatchId: ids.matchId,
    draft: makeRecordDraft(recordSchedule),
  }));
  let match = await getMatchAfterResult(createResult, hostLogin, `${ids.label}:loadAfterCreateMatchRecord1v1`);

  assertFlow(match?.rules?.recordType === "match_record", "1v1 match record type missing", match);
  assertFlow(match?.mode === "1v1", "1v1 match record mode mismatch", match);
  assertFlow((match?.teamA?.players ?? []).length === 1 && match.teamA.players[0] === hostId, "1v1 match record host roster mismatch", match);
  assertFlow((match?.teamB?.players ?? []).length === 0, "1v1 match record must not invite during creation", match);
  assertFlow(!match?.teamA?.teamId && !match?.teamB?.teamId, "1v1 match record should not bind teams", match);
  assertFlow(match?.ranked === false && match?.official === false && match?.preRegistered === false, "1v1 match record pregame flags not disabled", match);
  assertFlow(match?.mmrLimitMode === "off" && Number(match?.ratingScale ?? 0) === 0, "1v1 match record MMR policy not disabled", match);
  assertFlow(match?.rules?.ageRestriction === "any" && match?.rules?.courtReserved === false, "1v1 match record eligibility or reservation not disabled", match?.rules);
  assertFlow(!match?.stakes, "1v1 match record pregame stakes should be empty", match);
  assertFlow(
    Number(match?.disputeMinutes) === DISPUTE_WINDOW_MINUTES && match?.objectionWindow === `${DISPUTE_WINDOW_MINUTES}분`,
    "1v1 match record dispute window mismatch",
    match,
  );

  const setupResult = await step(`${ids.label}:setMatchRecordParticipants`, () => syncMatchAs(hostLogin, {
    action: "setMatchRecordParticipants",
    matchId: ids.matchId,
    setup: {
      composition: "individual",
      teamAPlayerIds: [hostId],
      teamBPlayerIds: [opponentId],
    },
  }));
  assertFlow(
    setupResult?.sqlReducer === true && setupResult?.advisoryLocked === true,
    "individual match record participant setup SQL reducer not used",
    setupResult,
  );
  match = await getMatchAfterResult(setupResult, hostLogin, `${ids.label}:loadAfterParticipantSetup1v1`);
  assertFlow((match?.teamB?.players ?? []).length === 1 && match.teamB.players[0] === opponentId, "1v1 match record opponent setup mismatch", match);
  assertFlow(match?.rules?.recordSetupReady === true, "1v1 match record setup not marked ready", match);

  const hostPlayState = await loadMatchesAs(hostLogin, {
    playOnly: true,
    activeOnly: true,
    includeRecentCompleted: false,
    includeClosedNotices: false,
  });
  const opponentPlayState = await loadMatchesAs(opponentLogin, {
    playOnly: true,
    activeOnly: true,
    includeRecentCompleted: false,
    includeClosedNotices: false,
  });
  assertFlow((hostPlayState.matches ?? []).some((item) => item.id === ids.matchId), "1v1 match record missing from host play list", hostPlayState.matches);
  assertFlow((opponentPlayState.matches ?? []).some((item) => item.id === ids.matchId), "1v1 match record missing from opponent play list", opponentPlayState.matches);

  if (supabase) {
    const { data: notificationRows, error: notificationError } = await supabase
      .from("notifications")
      .select("target_user_id,payload")
      .eq("match_id", ids.matchId);
    if (notificationError) throw notificationError;
    assertFlow(
      (notificationRows ?? []).some((row) => row.target_user_id === opponentId && row.payload?.fromUserId === hostId),
      "1v1 match record confirmation notification missing",
      notificationRows,
    );
  }

  return {
    label: ids.label,
    matchId: ids.matchId,
    hostId,
    opponentId,
    ranked: match.ranked,
    ratingScale: match.ratingScale,
    hostPlayVisible: true,
    opponentPlayVisible: true,
  };
}

function getTeamCaptainId(team = {}) {
  return (team.members ?? []).find((member) => member.role === "captain")?.userId
    || team.members?.[0]?.userId
    || "";
}

async function resolveTournamentTeamFixtures(login, preferredTeamIds = []) {
  const requiredTeamCount = Math.max(2, preferredTeamIds.length || 4);
  if (supabase) {
    let { data: teamRows, error: teamError } = await supabase
      .from("teams")
      .select("id,name,home_court,region,mmr,wins,losses,accent,created_at,updated_at")
      .in("id", preferredTeamIds)
      .is("deleted_at", null);
    if (teamError) throw teamError;
    const fallback = await supabase
      .from("teams")
      .select("id,name,home_court,region,mmr,wins,losses,accent,created_at,updated_at")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .limit(40);
    if (fallback.error) throw fallback.error;
    const preferredOrder = new Map(preferredTeamIds.map((teamId, index) => [teamId, index]));
    const byId = new Map([...(teamRows ?? []), ...(fallback.data ?? [])].map((team) => [team.id, team]));
    teamRows = [...byId.values()].sort((a, b) => (
      (preferredOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (preferredOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      || String(a.id).localeCompare(String(b.id))
    ));
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
    const candidates = (teamRows ?? [])
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
      .filter((fixture) => fixture.team.members.length && fixture.captainId && fixture.captainLogin);
    const fixtures = [];
    const usedCaptainIds = new Set();
    for (const fixture of candidates) {
      const { data: representativeTeamId, error: representativeError } = await supabase.rpc("rankball_profile_representative_team_id", {
        p_profile_id: fixture.captainId,
      });
      if (representativeError) throw representativeError;
      if (representativeTeamId !== fixture.team.id || usedCaptainIds.has(fixture.captainId)) continue;
      fixtures.push(fixture);
      usedCaptainIds.add(fixture.captainId);
      if (fixtures.length >= requiredTeamCount) break;
    }
    assertFlow(fixtures.length >= requiredTeamCount, "tournament DB fixture teams missing", {
      requiredTeamCount,
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

async function prepareTournamentMatchRosters({
  label,
  creatorLogin,
  tournamentId,
  matchId,
  fixtures,
  scheduledDate,
  scheduledTime,
  verifyNotifications = false,
}) {
  const scheduleResult = await step(`${label}:updateSchedule`, () => syncMatchAs(creatorLogin, {
    action: "updateTournamentMatchSchedule",
    tournamentId,
    matchId,
    schedule: { scheduledDate, scheduledTime },
  }));
  assertFlow(scheduleResult?.sqlReducer === true && scheduleResult?.advisoryLocked === true, "tournament schedule SQL reducer not used", scheduleResult);

  const scheduledMatch = await step(`${label}:loadScheduled`, () => loadMatchAs(creatorLogin, matchId));
  assertFlow(scheduledMatch?.scheduledDate === scheduledDate && scheduledMatch?.scheduledTime === scheduledTime, "tournament schedule not persisted", scheduledMatch);
  assertFlow(
    (scheduledMatch?.teamA?.players ?? []).length === 0 && (scheduledMatch?.teamB?.players ?? []).length === 0,
    "tournament match must not auto-select players",
    { matchId, teamAPlayers: scheduledMatch?.teamA?.players, teamBPlayers: scheduledMatch?.teamB?.players },
  );

  const sideFixtures = [];
  for (const sideName of ["teamA", "teamB"]) {
    const teamId = scheduledMatch?.[sideName]?.teamId ?? "";
    const fixture = fixtures.find((item) => item.team.id === teamId);
    const snapshotIds = scheduledMatch?.rules?.teamRosterSnapshot?.teams?.[teamId]?.eligiblePlayerIds ?? [];
    let playerId = "";
    let playerLogin = "";
    for (const candidateId of [
      ...snapshotIds.filter((candidateId) => candidateId !== fixture?.captainId),
      ...snapshotIds.filter((candidateId) => candidateId === fixture?.captainId),
    ]) {
      const candidateLogin = candidateId === fixture?.captainId
        ? fixture?.captainLogin
        : await getTestLoginForProfileId(candidateId);
      if (candidateLogin) {
        playerId = candidateId;
        playerLogin = candidateLogin;
        break;
      }
    }
    assertFlow(Boolean(fixture?.captainLogin && playerId && playerLogin), "tournament snapshot side fixture missing", {
      sideName,
      teamId,
      captainId: fixture?.captainId,
      snapshotIds,
    });
    sideFixtures.push({ sideName, fixture, playerId, playerLogin });
  }

  if (verifyNotifications) {
    for (const { sideName, fixture } of sideFixtures) {
      const captainHome = await step(`${label}:loadCaptainHome:${sideName}`, () => loadHomeAs(fixture.captainLogin));
      assertFlow(
        (captainHome.notifications ?? []).some((notification) => (
          notification.type === "tournament_match_schedule" &&
          notification.matchId === scheduledMatch.id &&
          notification.actionRequired !== false
        )),
        "tournament captain schedule notification missing",
        { sideName, captainId: fixture.captainId, notifications: captainHome.notifications },
      );
      const captainMatches = await step(`${label}:loadCaptainMatches:${sideName}`, () => loadMatchesAs(fixture.captainLogin));
      assertFlow(
        (captainMatches.tournaments ?? []).some((tournament) => tournament.id === tournamentId),
        "related private tournament missing from captain match response",
        { sideName, captainId: fixture.captainId, tournamentIds: (captainMatches.tournaments ?? []).map((tournament) => tournament.id) },
      );
      const captainMatch = (captainMatches.matches ?? []).find((match) => match.id === scheduledMatch.id);
      assertFlow(
        Boolean(captainMatch?.__feedRelations?.includes("tournament_captain")),
        "tournament captain cannot load private fixture detail",
        { sideName, captainId: fixture.captainId, matchIds: (captainMatches.matches ?? []).map((match) => match.id) },
      );
      assertFlow(
        !isTournamentMatchInUserSchedule(captainMatch, fixture.captainId),
        "captain must not receive an unassigned tournament match as personal schedule",
        { sideName, captainId: fixture.captainId, captainMatch },
      );
    }
  }

  await expectRejected(
    `${label}:startBeforeRosterBlocked`,
    () => syncMatchAs(creatorLogin, { action: "startMatch", matchId }),
    ["tournament_roster_not_ready"],
  );
  const rosterOrder = [...sideFixtures].reverse();
  for (const [index, { sideName, fixture, playerId }] of rosterOrder.entries()) {
    const rosterResult = await step(`${label}:setRoster:${sideName}`, () => syncMatchAs(fixture.captainLogin, {
      action: "setMatchRecordTeamRoster",
      matchId,
      sideName,
      roster: { playerIds: [playerId], reservePlayerIds: [] },
    }));
    assertFlow(
      rosterResult?.sqlReducer === true && rosterResult?.rosterReady === true && rosterResult?.representativeRosterSnapshot === true,
      "tournament snapshot roster SQL reducer not used",
      rosterResult,
    );
    if (index === 0) {
      const firstReadyMatch = await step(`${label}:loadFirstRoster`, () => loadMatchAs(creatorLogin, matchId));
      assertFlow(
        firstReadyMatch?.teamA?.teamId === fixture.team.id &&
          firstReadyMatch?.createdBy === fixture.captainId &&
          firstReadyMatch?.rules?.tournamentHostPlayerId === fixture.captainId &&
          firstReadyMatch?.rules?.tournamentHostTeamId === fixture.team.id &&
          firstReadyMatch?.rules?.tournamentHostSide === "teamA" &&
          firstReadyMatch?.rules?.tournamentSideAssignmentLocked === true &&
          firstReadyMatch?.rules?.tournamentHostRosterSelected === (playerId === fixture.captainId) &&
          (playerId === fixture.captainId || !getMatchReservePlayerIds(firstReadyMatch, "teamA").includes(fixture.captainId)),
        "first tournament roster did not claim A side and host",
        { fixture, firstReadyMatch },
      );
      const afterDeadline = new Date(`${scheduledDate}T${scheduledTime}:00+09:00`);
      afterDeadline.setMinutes(afterDeadline.getMinutes() + 1);
      assertFlow(
        getMatchRoomPhase(firstReadyMatch, afterDeadline).phase === "locked",
        "single tournament lineup must stay locked after scheduled time",
        { phase: getMatchRoomPhase(firstReadyMatch, afterDeadline), firstReadyMatch },
      );
    }
  }
  const rosterReadyMatch = await step(`${label}:loadRosterReady`, () => loadMatchAs(creatorLogin, matchId));
  assertFlow(
    rosterReadyMatch?.rules?.rosterReady?.teamA === true && rosterReadyMatch?.rules?.rosterReady?.teamB === true,
    "tournament roster readiness not persisted",
    rosterReadyMatch?.rules,
  );
  const afterDeadline = new Date(`${scheduledDate}T${scheduledTime}:00+09:00`);
  afterDeadline.setMinutes(afterDeadline.getMinutes() + 1);
  assertFlow(
    getMatchRoomPhase(rosterReadyMatch, afterDeadline).phase === "checkin",
    "two timely tournament lineups must enter checkin",
    { phase: getMatchRoomPhase(rosterReadyMatch, afterDeadline), rosterReadyMatch },
  );
  if (verifyNotifications) {
    const reminderCheck = await step(`${label}:assertScheduledReminders`, () => assertPendingMatchNotices(
      rosterReadyMatch.id,
      CURRENT_MATCH_SCHEDULED_NOTICE_PREFIXES,
      { minNotifications: CURRENT_MATCH_SCHEDULED_NOTICE_PREFIXES.length },
    ));
    for (const prefix of CURRENT_MATCH_SCHEDULED_NOTICE_PREFIXES) {
      assertFlow(
        Number(reminderCheck?.notifications?.counts?.[prefix] ?? 0) > 0,
        "tournament schedule reminder was not regenerated after roster update",
        { matchId: rosterReadyMatch.id, prefix, reminderCheck },
      );
    }
    for (const { sideName, playerId, playerLogin } of sideFixtures) {
      const playerMatches = await step(`${label}:loadRosterPlayerMatches:${sideName}`, () => loadMatchesAs(playerLogin));
      const listedMatch = (playerMatches.matches ?? []).find((match) => match.id === rosterReadyMatch.id);
      assertFlow(
        Boolean(listedMatch && isTournamentMatchInUserSchedule(listedMatch, playerId)),
        "assigned tournament roster player missing from personal schedule",
        { sideName, playerId, matchIds: (playerMatches.matches ?? []).map((match) => match.id) },
      );
    }
  }
  return rosterReadyMatch;
}

async function playTournamentMatchToConfirmed({ label, matchId, operatorLogin }) {
  let match = await step(`${label}:loadMatch`, () => loadMatchAs(operatorLogin, matchId));
  const teamAPlayerId = match.teamA?.players?.[0] ?? "";
  const teamBPlayerId = match.teamB?.players?.[0] ?? "";
  const teamALogin = await getTestLoginForProfileId(teamAPlayerId);
  const teamBLogin = await getTestLoginForProfileId(teamBPlayerId);
  const hostPlayerId = match.rules?.tournamentHostPlayerId ?? match.createdBy ?? "";
  const refereeId = match.refereeId ?? "";
  const resultOperatorLogin = await getTestLoginForProfileId(refereeId);
  assertFlow(Boolean(teamAPlayerId && teamBPlayerId && teamALogin && teamBLogin && resultOperatorLogin), "tournament match player or referee login missing", {
    matchId,
    teamAPlayerId,
    teamBPlayerId,
    hostPlayerId,
    refereeId,
  });

  assertFlow(
    match.createdBy === hostPlayerId
      && match.rules?.tournamentHostTeamId === match.teamA?.teamId
      && match.rules?.tournamentHostSide === "teamA",
    "tournament A-side captain is not the match host",
    {
    matchId,
    createdBy: match.createdBy,
    teamAPlayerId,
    hostPlayerId,
    teamAId: match.teamA?.teamId,
    hostTeamId: match.rules?.tournamentHostTeamId,
  });
  const playableSchedule = getKstPastSchedule();
  const rosterReadyAt = new Date(`${playableSchedule.scheduledDate}T${playableSchedule.scheduledTime}:00+09:00`);
  rosterReadyAt.setMinutes(rosterReadyAt.getMinutes() - 1);
  const { error: scheduleError } = await supabase
    .from("matches")
    .update({
      scheduled_date: playableSchedule.scheduledDate,
      scheduled_time: playableSchedule.scheduledTime,
      scheduled_at: `${playableSchedule.scheduledDate} ${playableSchedule.scheduledTime}`,
      rules: {
        ...(match.rules ?? {}),
        rosterReadyAt: {
          teamA: rosterReadyAt.toISOString(),
          teamB: rosterReadyAt.toISOString(),
        },
      },
    })
    .eq("id", matchId);
  if (scheduleError) throw scheduleError;
  match = await step(`${label}:loadPlayableSchedule`, () => loadMatchAs(resultOperatorLogin, matchId));

  const checkInAResult = await step(`${label}:checkInMatchPlayer:teamA`, () => syncMatchAs(resultOperatorLogin, {
    action: "checkInMatchPlayer",
    matchId,
    sideName: "teamA",
    playerId: teamAPlayerId,
  }));
  match = await getMatchAfterResult(checkInAResult, resultOperatorLogin, `${label}:loadAfterCheckInTeamA`);
  const checkInBResult = await step(`${label}:checkInMatchPlayer:teamB`, () => syncMatchAs(resultOperatorLogin, {
    action: "checkInMatchPlayer",
    matchId,
    sideName: "teamB",
    playerId: teamBPlayerId,
  }));
  match = await getMatchAfterResult(checkInBResult, resultOperatorLogin, `${label}:loadAfterCheckInTeamB`);
  const startResult = await step(`${label}:startMatch`, () => syncMatchAs(resultOperatorLogin, {
    action: "startMatch",
    matchId,
  }));
  match = await getMatchAfterResult(startResult, resultOperatorLogin, `${label}:loadAfterStart`);
  assertFlow(Boolean(match?.startedAt), "tournament match start not persisted", match);
  const endResult = await step(`${label}:endMatch`, () => syncMatchAs(resultOperatorLogin, {
    action: "endMatch",
    matchId,
  }));
  match = await getMatchAfterResult(endResult, resultOperatorLogin, `${label}:loadAfterEnd`);
  assertFlow(Boolean(match?.endedAt), "tournament match end not persisted", match);

  const scoreWrite = await setMatchScoreByIncrements({
    label,
    login: resultOperatorLogin,
    match,
    scoreA: 21,
    scoreB: 12,
  });
  match = scoreWrite.match;
  const result = makePointsOnlyResult(match);

  const resultSubmit = await step(`${label}:submitMatchResult`, () => syncMatchAs(resultOperatorLogin, {
    action: "submitMatchResult",
    matchId,
    result,
  }));
  match = resultSubmit?.match;
  assertFlow(Boolean(match?.endedAt && match?.result && !match?.confirmedAt), "tournament match result not persisted", match);
  assertFlow(match.result.scoreA === 21 && match.result.scoreB === 12, "tournament stats submission changed team score", match.result);

  const finalizeResult = await step(`${label}:finalizeMatch`, () => syncMatchAs(resultOperatorLogin, {
    action: "finalizeMatch",
    matchId,
  }));
  match = await getMatchAfterResult(finalizeResult, resultOperatorLogin, `${label}:loadAfterFinalize`);
  assertFlow(match?.status === "confirmed", "tournament referee finalization did not confirm match", match);

  return { match, result: finalizeResult, teamAPlayerId, teamBPlayerId };
}

async function prepareSimulationTournamentReferees({
  label,
  creatorId,
  refereeLogin,
}) {
  const refereeId = await step(`${label}:resolveProfile:tournamentReferee`, () => getProfileIdForLogin(refereeLogin));
  assertFlow(creatorId && refereeId && creatorId !== refereeId, "tournament referee fixture must be distinct from creator", {
    creatorId,
    refereeId,
  });
  await step(`${label}:ensureCreatorRefereeEligibility`, () => ensureSimulationRefereeEligibility(creatorId, `${label}_creator`, 7));
  await step(`${label}:ensureNeutralRefereeEligibility`, () => ensureSimulationRefereeEligibility(refereeId, `${label}_neutral`, 7));
  return { refereeId, refereeIds: [creatorId, refereeId] };
}

async function approveSimulationTournamentReferee({
  label,
  tournamentId,
  refereeLogin,
  refereeId,
}) {
  const result = await step(`${label}:approveTournamentReferee`, () => syncTournamentAs(refereeLogin, {
    action: "approveTournamentReferee",
    tournamentId,
  }));
  assertFlow(
    result?.ok && result?.refereeId === refereeId && result?.tournamentSqlReducer === true,
    "tournament referee approval failed",
    result,
  );
  return result;
}

async function runTournamentFollowupRoundScenario({
  label,
  creatorLogin,
  refereeLogin = process.env.RANKBALL_SIM_TOURNAMENT_REFEREE || "rankball-048",
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
  const tournamentReferees = await prepareSimulationTournamentReferees({
    label: ids.label,
    creatorId,
    refereeLogin,
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
      title: getSimulationDisplayTitle(ids.label),
      tournamentFormat: "tournament",
      teamIds: selectedTeamIds,
      mode: "1v1",
      ranked: false,
      official: false,
      scheduledDate: startDate,
      tournamentEndDate: startDate,
      refereeIds: tournamentReferees.refereeIds,
      courtId: simulationCourtId,
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
  await approveSimulationTournamentReferee({
    label: ids.label,
    tournamentId: ids.tournamentId,
    refereeLogin,
    refereeId: tournamentReferees.refereeId,
  });

  for (const fixture of fixtures.slice(1)) {
    await step(`${ids.label}:approveTournamentTeam:${fixture.team.id}`, () => syncTournamentAs(fixture.captainLogin, {
      action: "approveTournamentTeam",
      tournamentId: ids.tournamentId,
      teamId: fixture.team.id,
      preferredMatchIds: firstRoundMatchIds,
    }));
  }
  const startResult = await step(`${ids.label}:startCommunityTournament`, () => syncTournamentAs(effectiveCreatorLogin, {
    action: "startCommunityTournament",
    tournamentId: ids.tournamentId,
    preferredMatchIds: firstRoundMatchIds,
  }));
  assertFlow(Number(startResult?.createdMatchCount ?? 0) === firstRoundMatchIds.length, "tournament first round was not generated", startResult);

  const firstRoundMatches = [];
  for (const matchId of firstRoundMatchIds) {
    const match = await step(`${ids.label}:loadFirstRound:${matchId}`, () => loadMatchAs(effectiveCreatorLogin, matchId));
    assertFlow(match?.tournamentId === ids.tournamentId && Number(match?.tournamentRound) === 1, "first round match metadata mismatch", match);
    assertStoredTournamentMatchTitle(match);
    firstRoundMatches.push(match);
  }

  for (const [index, match] of firstRoundMatches.entries()) {
    await prepareTournamentMatchRosters({
      label: `${ids.label}:prepareRound1Fixture${index + 1}`,
      creatorLogin: effectiveCreatorLogin,
      tournamentId: ids.tournamentId,
      matchId: match.id,
      fixtures,
      scheduledDate: startDate,
      scheduledTime: index === 0 ? "21:15" : "21:45",
      verifyNotifications: index === 0,
    });
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
  assertStoredTournamentMatchTitle(persistedFinal);
  assertFlow(
    persistedFinal?.tournamentId === ids.tournamentId &&
      Number(persistedFinal?.tournamentRound) === 2 &&
      Number(persistedFinal?.tournamentFixture) === 1,
    "persisted follow-up final metadata mismatch",
    persistedFinal,
  );
  assertFlow(
    (persistedFinal?.teamA?.players ?? []).length === 0 && (persistedFinal?.teamB?.players ?? []).length === 0,
    "follow-up tournament match must wait for roster selection",
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

async function runTournamentByeRoundScenario({
  label,
  creatorLogin,
  refereeLogin = process.env.RANKBALL_SIM_TOURNAMENT_REFEREE || "rankball-048",
  teamIds = ["team-rb-01", "team-rb-02", "team-rb-03"],
}) {
  ids = makeScenarioIds(label);
  const fixtures = await step(`${ids.label}:resolveTournamentTeams`, () => resolveTournamentTeamFixtures(creatorLogin, teamIds));
  const effectiveCreatorLogin = fixtures[0]?.captainLogin || creatorLogin;
  const selectedTeamIds = fixtures.map((fixture) => fixture.team.id);
  const creatorId = await step(`${ids.label}:resolveProfile:creator`, () => getProfileIdForLogin(effectiveCreatorLogin));
  assertFlow(fixtures.length === 3 && fixtures[0]?.captainId === creatorId, "three-team tournament fixture mismatch", {
    creatorId,
    selectedTeamIds,
  });
  const tournamentReferees = await prepareSimulationTournamentReferees({
    label: ids.label,
    creatorId,
    refereeLogin,
  });

  const firstRoundMatchId = `${ids.matchId}_r1`;
  ids.matchIds = [firstRoundMatchId];
  const startDate = getKstFutureSchedule(96).scheduledDate;
  const createResult = await step(`${ids.label}:createTournament`, () => syncTournamentAs(effectiveCreatorLogin, {
    action: "createTournament",
    preferredTournamentId: ids.tournamentId,
    preferredMatchIds: [firstRoundMatchId],
    draft: {
      id: ids.tournamentId,
      title: getSimulationDisplayTitle(ids.label),
      tournamentFormat: "tournament",
      teamIds: selectedTeamIds,
      mode: "1v1",
      ranked: false,
      official: false,
      scheduledDate: startDate,
      tournamentEndDate: startDate,
      refereeIds: tournamentReferees.refereeIds,
      courtId: simulationCourtId,
      court: "Backend Simulation Court",
      region: "Backend Simulation",
      mmrLimitMode: "warn",
      targetScore: 21,
      timeLimit: 12,
      winByTwo: true,
      memo: "Backend simulation three-team tournament row. Safe to close.",
    },
  }));
  assertFlow(createResult?.ok && Number(createResult?.createdMatchCount ?? 0) === 0, "three-team tournament create failed", createResult);
  await approveSimulationTournamentReferee({
    label: ids.label,
    tournamentId: ids.tournamentId,
    refereeLogin,
    refereeId: tournamentReferees.refereeId,
  });

  for (const fixture of fixtures.slice(1)) {
    await step(`${ids.label}:approveTournamentTeam:${fixture.team.id}`, () => syncTournamentAs(fixture.captainLogin, {
      action: "approveTournamentTeam",
      tournamentId: ids.tournamentId,
      teamId: fixture.team.id,
      preferredMatchIds: [firstRoundMatchId],
    }));
  }
  const startResult = await step(`${ids.label}:startCommunityTournament`, () => syncTournamentAs(effectiveCreatorLogin, {
    action: "startCommunityTournament",
    tournamentId: ids.tournamentId,
    preferredMatchIds: [firstRoundMatchId],
  }));
  assertFlow(Number(startResult?.createdMatchCount ?? 0) === 1, "three-team first round match count mismatch", startResult);
  const tournament = startResult?.tournament;
  const firstRound = tournament?.bracket?.firstRound ?? [];
  const byeEntries = firstRound.filter((entry) => entry?.byeTeamId);
  assertFlow(firstRound.length === 2 && byeEntries.length === 1, "three-team bye bracket mismatch", tournament?.bracket);

  const firstRoundMatch = await step(`${ids.label}:loadFirstRound`, () => loadMatchAs(effectiveCreatorLogin, firstRoundMatchId));
  assertStoredTournamentMatchTitle(firstRoundMatch);
  assertFlow(
    firstRoundMatch?.tournamentId === ids.tournamentId &&
      Number(firstRoundMatch?.tournamentRound) === 1,
    "three-team first round metadata mismatch",
    firstRoundMatch,
  );
  await prepareTournamentMatchRosters({
    label: `${ids.label}:prepareRound1`,
    creatorLogin: effectiveCreatorLogin,
    tournamentId: ids.tournamentId,
    matchId: firstRoundMatchId,
    fixtures,
    scheduledDate: startDate,
    scheduledTime: "20:45",
  });
  const confirmed = await playTournamentMatchToConfirmed({
    label: `${ids.label}:round1`,
    matchId: firstRoundMatchId,
    operatorLogin: effectiveCreatorLogin,
  });
  assertFlow(Number(confirmed.result?.createdTournamentMatchCount ?? 0) === 1, "three-team bye final was not generated", confirmed.result);
  const finalMatch = (confirmed.result?.state?.matches ?? []).find((match) => (
    match.tournamentId === ids.tournamentId &&
    Number(match.tournamentRound) === 2 &&
    Number(match.tournamentFixture) === 1
  ));
  assertFlow(Boolean(finalMatch?.id), "three-team bye final missing", confirmed.result?.state);
  assertStoredTournamentMatchTitle(finalMatch);
  assertFlow(
    (finalMatch?.teamA?.players ?? []).length === 0 && (finalMatch?.teamB?.players ?? []).length === 0,
    "three-team bye final must wait for roster selection",
    finalMatch,
  );
  ids.matchIds = uniqueIds([...ids.matchIds, finalMatch.id]);

  return {
    label: ids.label,
    creatorLogin: effectiveCreatorLogin,
    tournamentId: ids.tournamentId,
    teamIds: selectedTeamIds,
    byeTeamId: byeEntries[0].byeTeamId,
    firstRoundMatchId,
    followupMatchId: finalMatch.id,
    createdTournamentMatchCount: Number(confirmed.result?.createdTournamentMatchCount ?? 0),
  };
}

async function runTournamentRepresentativeTeamGuardScenario({
  label,
  creatorLogin = "rankball-001",
  refereeLogin = process.env.RANKBALL_SIM_TOURNAMENT_REFEREE || "rankball-048",
  teamBCaptainLogin = "rankball-006",
  teamCCaptainLogin = "rankball-011",
  representativeTeamId = "team-rb-01",
  nonRepresentativeTeamId = "t_mr5xqkth_akz6c",
  teamBId = "team-rb-02",
  teamCId = "team-rb-03",
}) {
  ids = makeScenarioIds(label);
  const creatorId = await step(`${ids.label}:resolveProfile:creator`, () => getProfileIdForLogin(creatorLogin));
  const tournamentReferees = await prepareSimulationTournamentReferees({
    label: ids.label,
    creatorId,
    refereeLogin,
  });
  const automaticForfeitSchedule = getKstFutureSchedule(120);
  const startDate = automaticForfeitSchedule.scheduledDate;
  await expectRejected(
    `${ids.label}:nonRepresentativeTeamCreateBlocked`,
    () => syncTournamentAs(creatorLogin, {
      action: "createTournament",
      preferredTournamentId: `${ids.tournamentId}_blocked`,
      draft: {
        id: `${ids.tournamentId}_blocked`,
        title: `${getSimulationDisplayTitle(ids.label)} 차단 검증`,
        tournamentFormat: "league",
        teamIds: [representativeTeamId, nonRepresentativeTeamId, teamBId],
        mode: "1v1",
        ranked: false,
        official: false,
        scheduledDate: startDate,
        tournamentEndDate: startDate,
        courtId: simulationCourtId,
        court: "Backend Simulation Court",
        mmrLimitMode: "warn",
        rules: { sideCapacity: 1, mmrLimitMode: "warn", mmrRangeMode: "narrow", allowedAgeGroups: [] },
      },
    }),
    ["tournament_team_representative_required"],
  );

  const teamBCaptainId = await step(`${ids.label}:resolveTeamBCaptain`, () => getProfileIdForLogin(teamBCaptainLogin));
  const teamCCaptainId = await step(`${ids.label}:resolveTeamCCaptain`, () => getProfileIdForLogin(teamCCaptainLogin));
  if (supabase) {
    await step(`${ids.label}:setTeamBCaptainDiscord`, () => setTemporaryProfileDiscordUser(
      teamBCaptainId,
      makeDiscordSnowflake(820),
      "rankball-sim-tournament-invite",
    ));
    await step(`${ids.label}:enableTeamBCaptainApprovalDiscord`, () => setTemporaryDiscordNotificationSettings(teamBCaptainId, {
      enabled: true,
      events: { approval: true },
    }));
    await step(`${ids.label}:setTournamentCreatorDiscord`, () => setTemporaryProfileDiscordUser(
      creatorId,
      makeDiscordSnowflake(821),
      "rankball-sim-tournament-start",
    ));
    await step(`${ids.label}:enableTournamentCreatorMatchDiscord`, () => setTemporaryDiscordNotificationSettings(creatorId, {
      enabled: true,
      events: { match: true },
    }));
  }

  const matchIds = [1, 2, 3].map((fixture) => `${ids.matchId}_l1_${fixture}`);
  ids.matchIds = matchIds;
  const createResult = await step(`${ids.label}:createValidLeague`, () => syncTournamentAs(creatorLogin, {
    action: "createTournament",
    preferredTournamentId: ids.tournamentId,
    preferredMatchIds: matchIds,
    draft: {
      id: ids.tournamentId,
      title: getSimulationDisplayTitle(ids.label),
      tournamentFormat: "league",
      teamIds: [representativeTeamId, teamBId, teamCId],
      mode: "1v1",
      ranked: false,
      official: false,
      scheduledDate: startDate,
      tournamentEndDate: startDate,
      refereeIds: tournamentReferees.refereeIds,
      courtId: simulationCourtId,
      court: "Backend Simulation Court",
      mmrLimitMode: "warn",
      rules: { sideCapacity: 1, mmrLimitMode: "warn", mmrRangeMode: "narrow", allowedAgeGroups: [] },
    },
  }));
  assertFlow(createResult?.ok && Number(createResult?.createdMatchCount ?? 0) === 0, "representative league create failed", createResult);
  await approveSimulationTournamentReferee({
    label: ids.label,
    tournamentId: ids.tournamentId,
    refereeLogin,
    refereeId: tournamentReferees.refereeId,
  });

  const expectedInvites = [
    { teamId: teamBId, captainLogin: teamBCaptainLogin, captainId: teamBCaptainId },
    { teamId: teamCId, captainLogin: teamCCaptainLogin, captainId: teamCCaptainId },
  ];
  const inviteNotificationCheck = await step(`${ids.label}:assertCaptainInvites`, () => assertTournamentInviteNotifications({
    label: ids.label,
    tournamentId: ids.tournamentId,
    expectedInvites,
  }));
  const inviteDiscordDeliveryCheck = await step(`${ids.label}:assertCaptainInviteDiscordDelivery`, () => assertTournamentInviteDiscordDelivery({
    tournamentId: ids.tournamentId,
    targetUserId: teamBCaptainId,
  }));

  const invitedLoadResult = await step(`${ids.label}:loadTournament:invitedCaptain`, () => syncTournamentAs(teamBCaptainLogin, {
    action: "loadTournament",
    tournamentId: ids.tournamentId,
  }));
  assertFlow(
    invitedLoadResult?.ok && invitedLoadResult?.state?.tournaments?.some((item) => item?.id === ids.tournamentId),
    "invited captain tournament load failed",
    invitedLoadResult,
  );

  await step(`${ids.label}:approveTeamB`, () => syncTournamentAs(teamBCaptainLogin, {
    action: "approveTournamentTeam",
    tournamentId: ids.tournamentId,
    teamId: teamBId,
    preferredMatchIds: matchIds,
  }));
  await step(`${ids.label}:approveTeamC`, () => syncTournamentAs(teamCCaptainLogin, {
    action: "approveTournamentTeam",
    tournamentId: ids.tournamentId,
    teamId: teamCId,
    preferredMatchIds: matchIds,
  }));
  const conflictMatch = await step(`${ids.label}:findPreferredMatchConflict`, async () => {
    const { data, error } = await supabase
      .from("matches")
      .select("id,tournament_id,tournament_round,tournament_fixture")
      .limit(50);
    if (error) throw error;
    return (data ?? []).find((match) => !matchIds.includes(match.id) && (
      match.tournament_id !== ids.tournamentId ||
      Number(match.tournament_round) !== 1 ||
      Number(match.tournament_fixture) !== 1
    ));
  });
  assertFlow(Boolean(conflictMatch?.id), "preferred match conflict fixture missing", conflictMatch);
  const conflictingMatchIds = [conflictMatch.id, matchIds[1], matchIds[2]];
  const apiConflict = await expectRejected(`${ids.label}:rejectPreferredMatchConflictApi`, () => syncTournamentAs(creatorLogin, {
    action: "startCommunityTournament",
    tournamentId: ids.tournamentId,
    preferredMatchIds: conflictingMatchIds,
  }), ["tournament_preferred_match_id_conflict"]);
  assertFlow(apiConflict.rejected, "tournament API accepted another match id", apiConflict);
  const approvalReadiness = await step(`${ids.label}:assertTournamentApprovalReady`, async () => {
    const [{ data: tournamentRow, error: tournamentError }, { data: teamRows, error: teamError }] = await Promise.all([
      supabase
        .from("tournaments")
        .select("referee_ids,referee_statuses,sanction_status,end_date")
        .eq("id", ids.tournamentId)
        .maybeSingle(),
      supabase
        .from("tournament_teams")
        .select("team_id,status")
        .eq("tournament_id", ids.tournamentId),
    ]);
    if (tournamentError) throw tournamentError;
    if (teamError) throw teamError;
    const refereeIds = tournamentRow?.referee_ids ?? [];
    const [{ data: appointments, error: appointmentError }, { data: profiles, error: profileError }, { data: refereeTeams, error: refereeTeamError }] = await Promise.all([
      supabase
        .from("referee_appointments")
        .select("user_id,status,starts_at,ends_at")
        .in("user_id", refereeIds),
      supabase
        .from("profiles")
        .select("id,trust_score")
        .in("id", refereeIds),
      supabase
        .from("team_members")
        .select("user_id,team_id")
        .in("user_id", refereeIds)
        .in("team_id", [representativeTeamId, teamBId, teamCId]),
    ]);
    if (appointmentError) throw appointmentError;
    if (profileError) throw profileError;
    if (refereeTeamError) throw refereeTeamError;
    const ready = teamRows?.every((row) => row.status === "accepted")
      && refereeIds.length >= 2
      && refereeIds.every((refereeId) => tournamentRow?.referee_statuses?.[refereeId] === "accepted");
    return { ready, tournamentRow, teamRows, appointments, profiles, refereeTeams };
  });
  assertFlow(approvalReadiness.ready === true, "tournament approval fixture is not ready", approvalReadiness);
  const dbConflict = await step(`${ids.label}:rejectPreferredMatchConflictDb`, async () => {
    const { error } = await supabase.rpc("rankball_tournament_operation_action", {
      p_actor_profile_id: creatorId,
      p_operation: {
        action: "startCommunityTournament",
        tournamentId: ids.tournamentId,
        preferredMatchIds: conflictingMatchIds,
      },
    });
    return { rejected: Boolean(error), message: error?.message ?? "" };
  });
  assertFlow(
    dbConflict.rejected && dbConflict.message.includes("tournament_preferred_match_id_conflict"),
    "tournament DB reducer accepted another match id",
    { dbConflict, approvalReadiness },
  );
  const finalApproval = await step(`${ids.label}:startCommunityTournament`, () => syncTournamentAs(creatorLogin, {
    action: "startCommunityTournament",
    tournamentId: ids.tournamentId,
    preferredMatchIds: matchIds,
  }));
  assertFlow(Number(finalApproval?.createdMatchCount ?? 0) === 3, "representative league fixture count mismatch", finalApproval);
  assertFlow(
    (finalApproval?.createdMatches ?? []).every((match) => match.disputeMinutes === DISPUTE_WINDOW_MINUTES),
    "tournament matches must use the canonical dispute window",
    finalApproval?.createdMatches,
  );
  const tournamentStartDeliveryCheck = await step(`${ids.label}:assertTournamentStartDelivery`, () => assertTournamentStartNotificationDelivery({
    tournamentId: ids.tournamentId,
    targetUserId: creatorId,
    targetLogin: creatorLogin,
  }));
  const inviteResolutionCheck = await step(`${ids.label}:assertCaptainInvitesResolved`, () => assertTournamentInviteNotificationsResolved({
    tournamentId: ids.tournamentId,
    expectedInvites,
  }));
  assertFlow(
    Object.keys(finalApproval?.tournament?.rules?.teamRosterSnapshot?.teams ?? {}).length === 3,
    "representative league snapshot team count mismatch",
    finalApproval?.tournament?.rules,
  );

  const matches = [];
  for (const matchId of matchIds) {
    const match = await step(`${ids.label}:loadLeagueMatch:${matchId}`, () => loadMatchAs(creatorLogin, matchId));
    assertFlow(
      match?.tournamentId === ids.tournamentId &&
        (match?.teamA?.players ?? []).length === 0 &&
        (match?.teamB?.players ?? []).length === 0,
      "league match must wait for snapshot roster selection",
      match,
    );
    matches.push(match);
  }
  const participatingTeamIds = uniqueIds(matches.flatMap((match) => [match.teamA?.teamId, match.teamB?.teamId]));
  assertFlow(
    participatingTeamIds.length === 3 && !participatingTeamIds.includes(nonRepresentativeTeamId),
    "non-representative team entered valid league",
    { participatingTeamIds, nonRepresentativeTeamId },
  );
  const tournamentFixtures = await step(`${ids.label}:resolveLineupFixtures`, () => resolveTournamentTeamFixtures(
    creatorLogin,
    [representativeTeamId, teamBId, teamCId],
  ));
  const fixtureByTeamId = new Map(tournamentFixtures.map((fixture) => [fixture.team.id, fixture]));

  await expectRejected(
    `${ids.label}:rejectUnapprovedCourt`,
    () => syncMatchAs(creatorLogin, {
      action: "updateTournamentMatchSchedule",
      tournamentId: ids.tournamentId,
      matchId: matches[0].id,
      schedule: { scheduledDate: getKstCurrentDate(), scheduledTime: "00:00", courtId: "court-not-allowed" },
    }),
    ["tournament_court_not_allowed"],
  );
  await step(`${ids.label}:scheduleForfeitFixture`, () => syncMatchAs(creatorLogin, {
    action: "updateTournamentMatchSchedule",
    tournamentId: ids.tournamentId,
    matchId: matches[0].id,
    schedule: { ...automaticForfeitSchedule, courtId: simulationCourtId },
  }));
  await step(`${ids.label}:scheduleFutureFixture`, () => syncMatchAs(creatorLogin, {
    action: "updateTournamentMatchSchedule",
    tournamentId: ids.tournamentId,
    matchId: matches[1].id,
    schedule: { scheduledDate: startDate, scheduledTime: "23:59", courtId: simulationCourtId },
  }));
  await expectRejected(
    `${ids.label}:rejectForfeitBeforeStart`,
    () => syncMatchAs(creatorLogin, {
      action: "forfeitTournamentMatch",
      tournamentId: ids.tournamentId,
      matchId: matches[1].id,
      losingSide: "teamA",
      reason: "팀 불참",
    }),
    ["tournament_match_forfeit_before_start"],
  );
  await expectRejected(
    `${ids.label}:rejectForfeitByNonOwner`,
    () => syncMatchAs(teamBCaptainLogin, {
      action: "forfeitTournamentMatch",
      tournamentId: ids.tournamentId,
      matchId: matches[1].id,
      losingSide: "teamA",
      reason: "팀 불참",
    }),
    ["tournament_owner_required"],
  );

  const scheduledForfeitMatch = await step(`${ids.label}:loadScheduledForfeit`, () => loadMatchAs(creatorLogin, matches[0].id));
  const firstReadyTeamId = scheduledForfeitMatch.teamB?.teamId;
  const firstReadyFixture = fixtureByTeamId.get(firstReadyTeamId);
  const snapshotPlayerIds = scheduledForfeitMatch.rules?.teamRosterSnapshot?.teams?.[firstReadyTeamId]?.eligiblePlayerIds ?? [];
  let firstReadyPlayerId = "";
  for (const candidateId of [
    ...snapshotPlayerIds.filter((candidateId) => candidateId !== firstReadyFixture?.captainId),
    ...snapshotPlayerIds.filter((candidateId) => candidateId === firstReadyFixture?.captainId),
  ]) {
    if (await getTestLoginForProfileId(candidateId)) {
      firstReadyPlayerId = candidateId;
      break;
    }
  }
  assertFlow(Boolean(firstReadyFixture?.captainLogin && firstReadyPlayerId), "automatic forfeit ready-side fixture missing", {
    firstReadyTeamId,
    firstReadyFixture,
    snapshotPlayerIds,
  });
  const firstRosterResult = await step(`${ids.label}:setOnlyTeamBRoster`, () => syncMatchAs(firstReadyFixture.captainLogin, {
    action: "setMatchRecordTeamRoster",
    matchId: scheduledForfeitMatch.id,
    sideName: "teamB",
    roster: { playerIds: [firstReadyPlayerId], reservePlayerIds: [] },
  }));
  assertFlow(
    firstRosterResult?.sqlReducer === true && firstRosterResult?.sideName === "teamA" && firstRosterResult?.tournamentHostTeamId === firstReadyTeamId,
    "first B-side lineup did not claim A-side host",
    firstRosterResult,
  );

  const oneReadyMatch = await step(`${ids.label}:loadOneReady`, () => loadMatchAs(creatorLogin, matches[0].id));
  const deadlineNow = new Date(`${automaticForfeitSchedule.scheduledDate}T${automaticForfeitSchedule.scheduledTime}:00+09:00`);
  deadlineNow.setMinutes(deadlineNow.getMinutes() + 1);
  assertFlow(
    oneReadyMatch.teamA?.teamId === firstReadyTeamId &&
      getMatchRoomPhase(oneReadyMatch, deadlineNow).phase === "locked" &&
      oneReadyMatch.rules?.tournamentHostRosterSelected === (firstReadyPlayerId === firstReadyFixture.captainId) &&
      (firstReadyPlayerId === firstReadyFixture.captainId || !getMatchReservePlayerIds(oneReadyMatch, "teamA").includes(firstReadyFixture.captainId)),
    "single lineup tournament match must remain locked",
    { firstReadyTeamId, oneReadyMatch, phase: getMatchRoomPhase(oneReadyMatch, deadlineNow) },
  );
  const { data: forfeitResult, error: forfeitError } = await step(`${ids.label}:automaticLineupForfeit`, () => supabase.rpc(
    "rankball_tournament_match_lineup_deadline_action",
    { p_match_id: oneReadyMatch.id, p_now: deadlineNow.toISOString() },
  ));
  if (forfeitError) throw forfeitError;
  assertFlow(
    forfeitResult?.status === "forfeit" && forfeitResult?.losingSide === "teamB" && forfeitResult?.sqlReducer === true,
    "automatic tournament lineup forfeit SQL reducer not used",
    forfeitResult,
  );
  const { data: retryResult, error: retryError } = await step(`${ids.label}:automaticLineupForfeitRetry`, () => supabase.rpc(
    "rankball_tournament_match_lineup_deadline_action",
    { p_match_id: oneReadyMatch.id, p_now: deadlineNow.toISOString() },
  ));
  if (retryError) throw retryError;
  assertFlow(retryResult?.idempotent === true && retryResult?.processed === false, "automatic lineup forfeit retry was not idempotent", retryResult);

  const forfeitedMatch = await step(`${ids.label}:loadForfeitedMatch`, () => loadMatchAs(creatorLogin, matches[0].id));
  assertFlow(
    forfeitedMatch?.status === "confirmed" &&
      forfeitedMatch?.forfeitSide === "teamB" &&
      forfeitedMatch?.result?.scoreA === 1 &&
      forfeitedMatch?.result?.scoreB === 0 &&
      forfeitedMatch?.ratingResult == null &&
      forfeitedMatch?.teamRatingResult == null,
    "automatic tournament forfeit result or MMR exclusion mismatch",
    forfeitedMatch,
  );
  const { data: staleScheduleRows, error: staleScheduleError } = await supabase
    .from("notifications")
    .select("id,read_at,payload")
    .eq("match_id", forfeitedMatch.id)
    .eq("type", "tournament_match_schedule");
  if (staleScheduleError) throw staleScheduleError;
  assertFlow(
    (staleScheduleRows ?? []).length > 0 && (staleScheduleRows ?? []).every((row) => row.read_at && row.payload?.actionRequired === false),
    "automatic forfeit left stale schedule notifications",
    staleScheduleRows,
  );
  const captainLoginByTeamId = new Map([
    [representativeTeamId, creatorLogin],
    [teamBId, teamBCaptainLogin],
    [teamCId, teamCCaptainLogin],
  ]);
  for (const teamId of [forfeitedMatch.teamA?.teamId, forfeitedMatch.teamB?.teamId]) {
    const captainLogin = captainLoginByTeamId.get(teamId);
    const captainHome = await step(`${ids.label}:loadForfeitCaptainHome:${teamId}`, () => loadHomeAs(captainLogin));
    assertFlow(
      (captainHome.notifications ?? []).some((notification) => notification.type === "tournament_match_lineup_deadline" && notification.matchId === forfeitedMatch.id),
      "automatic tournament forfeit captain notification missing",
      { teamId, notifications: captainHome.notifications },
    );
  }

  const leagueConfirmationResults = [];
  for (const [index, leagueMatch] of matches.slice(1).entries()) {
    await prepareTournamentMatchRosters({
      label: `${ids.label}:prepareLeagueFixture${index + 2}`,
      creatorLogin,
      tournamentId: ids.tournamentId,
      matchId: leagueMatch.id,
      fixtures: tournamentFixtures,
      scheduledDate: startDate,
      scheduledTime: index === 0 ? "21:15" : "21:45",
      verifyNotifications: index === 0,
    });
    leagueConfirmationResults.push(await playTournamentMatchToConfirmed({
      label: `${ids.label}:confirmLeagueFixture${index + 2}`,
      matchId: leagueMatch.id,
      operatorLogin: creatorLogin,
    }));
  }

  const confirmedLeagueMatches = [];
  for (const leagueMatch of matches) {
    confirmedLeagueMatches.push(await step(`${ids.label}:loadConfirmedLeagueMatch:${leagueMatch.id}`, () => loadMatchAs(creatorLogin, leagueMatch.id)));
  }
  assertFlow(
    confirmedLeagueMatches.every((leagueMatch) => leagueMatch?.status === "confirmed"),
    "league fixtures were not all confirmed",
    confirmedLeagueMatches,
  );

  const expectedStandings = new Map(tournamentFixtures.map((fixture) => [fixture.team.id, {
    teamId: fixture.team.id,
    teamName: fixture.team.name,
    wins: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  }]));
  for (const leagueMatch of confirmedLeagueMatches) {
    const teamAId = leagueMatch.teamA?.teamId ?? "";
    const teamBId = leagueMatch.teamB?.teamId ?? "";
    const scoreA = Number(leagueMatch.result?.scoreA ?? leagueMatch.teamA?.score ?? 0);
    const scoreB = Number(leagueMatch.result?.scoreB ?? leagueMatch.teamB?.score ?? 0);
    const teamAStanding = expectedStandings.get(teamAId);
    const teamBStanding = expectedStandings.get(teamBId);
    assertFlow(Boolean(teamAStanding && teamBStanding && scoreA !== scoreB), "league fixture result is invalid", leagueMatch);
    teamAStanding.pointsFor += scoreA;
    teamAStanding.pointsAgainst += scoreB;
    teamBStanding.pointsFor += scoreB;
    teamBStanding.pointsAgainst += scoreA;
    if (scoreA > scoreB) teamAStanding.wins += 1;
    else teamBStanding.wins += 1;
  }
  const expectedLeagueChampion = [...expectedStandings.values()].sort((left, right) => (
    right.wins - left.wins ||
    (right.pointsFor - right.pointsAgainst) - (left.pointsFor - left.pointsAgainst) ||
    right.pointsFor - left.pointsFor ||
    left.teamName.localeCompare(right.teamName, "ko") ||
    left.teamId.localeCompare(right.teamId)
  ))[0];
  const closedLeague = await step(`${ids.label}:loadClosedLeague`, () => loadTournamentRow(ids.tournamentId));
  assertFlow(
    closedLeague?.status === "closed" &&
      closedLeague?.bracket?.championTeamId === expectedLeagueChampion?.teamId &&
      Boolean(closedLeague?.bracket?.completedAt) &&
      closedLeague?.bracket?.standings?.length === tournamentFixtures.length,
    "league did not close with authoritative standings",
    { closedLeague, expectedLeagueChampion },
  );

  const expectedCompletionRecipients = new Set(tournamentFixtures.map((fixture) => fixture.captainId));
  const { data: completionNotifications, error: completionNotificationError } = await supabase
    .from("notifications")
    .select("id,target_user_id,type,payload")
    .eq("type", "tournament_completed")
    .contains("payload", { tournamentId: ids.tournamentId });
  if (completionNotificationError) throw completionNotificationError;
  assertFlow(
    [...expectedCompletionRecipients].every((profileId) => (
      (completionNotifications ?? []).some((notification) => notification.target_user_id === profileId)
    )),
    "league completion notification missing",
    { expectedCompletionRecipients: [...expectedCompletionRecipients], completionNotifications },
  );

  return {
    label: ids.label,
    tournamentId: ids.tournamentId,
    actorLogins: [creatorLogin, teamBCaptainLogin, teamCCaptainLogin, refereeLogin],
    participatingTeamIds,
    blockedTeamId: nonRepresentativeTeamId,
    createdMatchCount: matches.length,
    autoSelectedPlayerCount: 0,
    forfeitMatchId: forfeitedMatch.id,
    forfeitScore: `${forfeitedMatch.result.scoreA}:${forfeitedMatch.result.scoreB}`,
    forfeitMmrCommitted: Boolean(forfeitedMatch.ratingResult || forfeitedMatch.teamRatingResult),
    automaticForfeitIdempotent: retryResult?.idempotent === true,
    leagueClosed: closedLeague.status === "closed",
    leagueChampionTeamId: closedLeague.bracket.championTeamId,
    leagueConfirmedMatchCount: confirmedLeagueMatches.length,
    leagueCompletionNotificationCount: completionNotifications?.length ?? 0,
    leagueConfirmationResults: leagueConfirmationResults.length,
    preferredMatchIdGuard: true,
    inviteNotificationCheck,
    inviteDiscordDeliveryCheck,
    inviteResolutionCheck,
    tournamentStartDeliveryCheck,
  };
}

async function main() {
  const schemaHealth = await assertSchemaHealth();
  await step("init:resolveSimulationCourt", () => resolveSimulationCourtId());
  const basicHostLogin = process.env.RANKBALL_SIM_HOST || "rankball-010";
  const basicOpponentLogin = process.env.RANKBALL_SIM_OPPONENT || "rankball-011";
  const refereeHostLogin = process.env.RANKBALL_SIM_REF_HOST || "rankball-012";
  const refereeOpponentLogin = process.env.RANKBALL_SIM_REF_OPPONENT || "rankball-013";
  const refereeLogin = process.env.RANKBALL_SIM_REFEREE || "rankball-001";
  const actorHostLogin = process.env.RANKBALL_SIM_ACTOR_HOST || "rankball-014";
  const actorOpponentLogin = process.env.RANKBALL_SIM_ACTOR_OPPONENT || "rankball-015";
  const liveSubstitutionHostLogin = process.env.RANKBALL_SIM_LIVE_SUBSTITUTION_HOST || "rankball-032";
  const liveSubstitutionTeamAReserveLogin = process.env.RANKBALL_SIM_LIVE_SUBSTITUTION_TEAM_A_RESERVE || "rankball-034";
  const liveSubstitutionTeamBActiveLogin = process.env.RANKBALL_SIM_LIVE_SUBSTITUTION_TEAM_B_ACTIVE || "rankball-036";
  const liveSubstitutionRemovableReserveLogin = process.env.RANKBALL_SIM_LIVE_SUBSTITUTION_REMOVABLE_RESERVE || "rankball-042";
  const discordChatHostLogin = process.env.RANKBALL_SIM_DISCORD_CHAT_HOST || "rankball-033";
  const discordChatGuestLogin = process.env.RANKBALL_SIM_DISCORD_CHAT_GUEST || "rankball-035";
  const discordOptInLogin = process.env.RANKBALL_SIM_DISCORD_OPT_IN_LOGIN || "rankball-043";
  const refereeExamLogin = process.env.RANKBALL_SIM_REFEREE_EXAM_LOGIN || "rankball-034";
  const tournamentCreatorLogin = process.env.RANKBALL_SIM_TOURNAMENT_CREATOR || "rankball-001";
  const teamBlockedHostLogin = process.env.RANKBALL_SIM_SOLO_BLOCK_HOST || "rankball-014";
  const teamBlockedLogin = process.env.RANKBALL_SIM_SOLO_BLOCK_TEAM_LOGIN || "rankball-001";
  const teamBlockedTeamId = process.env.RANKBALL_SIM_SOLO_BLOCK_TEAM_ID || "t1";
  const refereeBlockedHostLogin = process.env.RANKBALL_SIM_REF_BLOCK_HOST || "rankball-014";
  const refereeBlockedLogin = process.env.RANKBALL_SIM_REF_BLOCK_CANDIDATE || "rankball-015";
  const inviteHostLogin = process.env.RANKBALL_SIM_INVITE_HOST || "rankball-016";
  const inviteeLogin = process.env.RANKBALL_SIM_INVITEE || "rankball-015";
  const agreeSqlHostLogin = process.env.RANKBALL_SIM_AGREE_SQL_HOST || "rankball-017";
  const agreeSqlTeamALogin = process.env.RANKBALL_SIM_AGREE_SQL_TEAM_A || "rankball-018";
  const agreeSqlTeamBLogins = (process.env.RANKBALL_SIM_AGREE_SQL_TEAM_B || "rankball-019,rankball-020").split(",").map((item) => item.trim()).filter(Boolean);
  const publicTeamHostLogin = process.env.RANKBALL_SIM_PUBLIC_TEAM_HOST || "rankball-001";
  const publicTeamTeammateLogin = process.env.RANKBALL_SIM_PUBLIC_TEAM_TEAMMATE || "rankball-002";
  const publicTeamId = process.env.RANKBALL_SIM_PUBLIC_TEAM_ID || "t1";
  const publicTeamOpponentCaptainLogin = process.env.RANKBALL_SIM_PUBLIC_TEAM_OPPONENT_CAPTAIN || "rankball-006";
  const publicTeamOpponentMemberLogin = process.env.RANKBALL_SIM_PUBLIC_TEAM_OPPONENT_MEMBER || "rankball-007";
  const publicTeamOpponentTeamId = process.env.RANKBALL_SIM_PUBLIC_TEAM_OPPONENT_ID || "team-rb-02";
  const homeAlertLogin = process.env.RANKBALL_SIM_HOME_ALERT_LOGIN || "rankball-010";
  const bulkInviteHostLogin = process.env.RANKBALL_SIM_BULK_INVITE_HOST || "rankball-020";
  const disputeHostLogin = process.env.RANKBALL_SIM_DISPUTE_HOST || "rankball-010";
  const disputeOpponentLogin = process.env.RANKBALL_SIM_DISPUTE_OPPONENT || "rankball-011";
  const refereeAbsenceHostLogin = process.env.RANKBALL_SIM_REF_ABSENCE_HOST || "rankball-037";
  const refereeAbsenceOpponentLogin = process.env.RANKBALL_SIM_REF_ABSENCE_OPPONENT || "rankball-038";
  const voidHostLogin = process.env.RANKBALL_SIM_VOID_HOST || "rankball-039";
  const voidOpponentLogin = process.env.RANKBALL_SIM_VOID_OPPONENT || "rankball-040";
  const soloRecordLogin = process.env.RANKBALL_SIM_SOLO_RECORD_HOST || "rankball-010";
  const mmrCommitHostLogin = process.env.RANKBALL_SIM_MMR_COMMIT_HOST || "rankball-021";
  const mmrCommitOpponentLogin = process.env.RANKBALL_SIM_MMR_COMMIT_OPPONENT || "rankball-022";
  const teamInviteCaptainLogin = process.env.RANKBALL_SIM_TEAM_INVITE_CAPTAIN || "rankball-001";
  const teamInviteTargetLogin = process.env.RANKBALL_SIM_TEAM_INVITE_TARGET || "rankball-050";
  const teamInviteTeamId = process.env.RANKBALL_SIM_TEAM_INVITE_TEAM_ID || "t1";
  const teamLifecycleCaptainLogin = process.env.RANKBALL_SIM_TEAM_LIFECYCLE_CAPTAIN || "rankball-044";
  const teamLifecycleAcceptedLogin = process.env.RANKBALL_SIM_TEAM_LIFECYCLE_ACCEPTED || "rankball-045";
  const teamLifecycleCancelledLogin = process.env.RANKBALL_SIM_TEAM_LIFECYCLE_CANCELLED || "rankball-046";
  const rlsProbeLogin = process.env.RANKBALL_SIM_RLS_PROBE_LOGIN || "rankball-047";
  const adminControlLogin = process.env.RANKBALL_SIM_ADMIN_CONTROL_LOGIN || "rankball-001";
  const adminControlTargetLogin = process.env.RANKBALL_SIM_ADMIN_CONTROL_TARGET || "rankball-047";
  const privacyOwnerLogin = process.env.RANKBALL_SIM_PRIVACY_OWNER || "rankball-041";
  const privacyViewerLogin = process.env.RANKBALL_SIM_PRIVACY_VIEWER || "rankball-042";
  const profileLockLogin = process.env.RANKBALL_SIM_PROFILE_LOCK_LOGIN || "rankball-031";
  const discordUniqueLinkedLogin = process.env.RANKBALL_SIM_DISCORD_UNIQUE_LINKED || "rankball-041";
  const discordUniqueDuplicateLogin = process.env.RANKBALL_SIM_DISCORD_UNIQUE_DUPLICATE || "rankball-042";
  const reportOutsiderLogin = process.env.RANKBALL_SIM_REPORT_OUTSIDER || "rankball-049";
  const courtRequesterLogin = process.env.RANKBALL_SIM_COURT_REQUESTER || "rankball-049";
  const courtAdminLogin = process.env.RANKBALL_SIM_COURT_ADMIN || "rankball-001";
  const expiryRoomHostLogin = process.env.RANKBALL_SIM_EXPIRY_HOST || "rankball-048";
  const expiryRoomInviteeLogin = process.env.RANKBALL_SIM_EXPIRY_INVITEE || "rankball-050";

  const scenarios = [];
  if (matchRecordOnly) {
    scenarios.push(await runMatchRecordRosterScenario({
      label: "match_record_roster_operation",
    }));
    scenarios.push(await runOneOnOneMatchRecordScenario({
      label: "match_record_1v1_postgame",
      hostLogin: basicHostLogin,
      opponentLogin: basicOpponentLogin,
    }));
  } else if (tournamentByeOnly) {
    scenarios.push(await runTournamentByeRoundScenario({
      label: "tournament_bye_round",
      creatorLogin: tournamentCreatorLogin,
    }));
  } else if (tournamentLeagueOnly) {
    scenarios.push(await runTournamentRepresentativeTeamGuardScenario({
      label: "tournament_representative_team_guard",
    }));
  } else if (operationalGuardsOnly) {
    scenarios.push(await runHomeAlertNotificationScenario({
      label: "home_alert_notifications",
      login: homeAlertLogin,
    }));
    scenarios.push(await runTeamLifecycleScenario({
      label: "team_lifecycle_reference_guard",
      captainLogin: teamLifecycleCaptainLogin,
      acceptedMemberLogin: teamLifecycleAcceptedLogin,
      cancelledInviteLogin: teamLifecycleCancelledLogin,
    }));
    scenarios.push(await runMatchListProfileIntegrityScenario({
      label: "match_list_profile_integrity",
      login: homeAlertLogin,
    }));
  } else if (teamEmblemOnly) {
    scenarios.push(await runTeamEmblemModerationScenario({
      label: "team_emblem_moderation",
      captainLogin: teamLifecycleCaptainLogin,
      reporterLogin: teamLifecycleCancelledLogin,
      adminLogin: adminControlLogin,
    }));
  } else if (mmrOnly) {
    scenarios.push(await runOneOnOneScenario({
      label: "ranked_mmr_commit_1v1",
      hostLogin: mmrCommitHostLogin,
      opponentLogin: mmrCommitOpponentLogin,
      ranked: true,
      includeLatePlayer: false,
      verifyRatingCommit: true,
    }));
  } else if (tailOnly) {
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
    scenarios.push(await runPublicTeamRegionFeedScenario({
      label: "public_team_region_feed",
      hostLogin: publicTeamHostLogin,
      teammateLogin: publicTeamTeammateLogin,
      teamId: publicTeamId,
      opponentCaptainLogin: publicTeamOpponentCaptainLogin,
      opponentMemberLogin: publicTeamOpponentMemberLogin,
      opponentTeamId: publicTeamOpponentTeamId,
    }));
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
    const basicScenario = await runOneOnOneScenario({
      label: "basic_1v1_no_referee",
      hostLogin: basicHostLogin,
      opponentLogin: basicOpponentLogin,
      verifyUnrankedNoRating: true,
      serverGeneratedPostId: true,
    });
    scenarios.push(basicScenario);
    scenarios.push(await runPlayerReportScenario({
      label: "player_report_scope_dedup",
      reporterLogin: basicHostLogin,
      targetLogin: basicOpponentLogin,
      outsiderLogin: reportOutsiderLogin,
      sourceMatchId: basicScenario.matchId,
    }));
    scenarios.push(await runDisputeResumeThumbsScenario({
      label: "dispute_resume_thumbs",
      hostLogin: disputeHostLogin,
      opponentLogin: disputeOpponentLogin,
    }));
    scenarios.push(await runDisputeResumeThumbsScenario({
      label: "dispute_void",
      hostLogin: voidHostLogin,
      opponentLogin: voidOpponentLogin,
      voidAfterDispute: true,
    }));
    scenarios.push(await runOneOnOneScenario({
      label: "referee_1v1",
      hostLogin: refereeHostLogin,
      opponentLogin: refereeOpponentLogin,
      refereeLogin,
      refereeWanted: true,
    }));
  } else if (recordPermissionsOnly) {
    scenarios.push(await runDisputeResumeThumbsScenario({
      label: "record_permission_matrix",
      hostLogin: disputeHostLogin,
      opponentLogin: disputeOpponentLogin,
    }));
    scenarios.push(await runOneOnOneScenario({
      label: "record_permission_referee",
      hostLogin: refereeHostLogin,
      opponentLogin: refereeOpponentLogin,
      refereeLogin,
      refereeWanted: true,
    }));
    scenarios.push(await runLiveSubstitutionScenario({
      label: "record_permission_live_substitution",
      hostLogin: liveSubstitutionHostLogin,
      teamAReserveLogin: liveSubstitutionTeamAReserveLogin,
      teamBActiveLogin: liveSubstitutionTeamBActiveLogin,
      removableReserveLogin: liveSubstitutionRemovableReserveLogin,
    }));
  } else {
  scenarios.push(await runSoloRecordScenario({
    label: "solo_record",
    hostLogin: soloRecordLogin,
  }));
  if (!remoteSmokeOnly) {
    scenarios.push(await runMatchRecordRosterScenario({
      label: "match_record_roster_operation",
    }));
    scenarios.push(await runOneOnOneMatchRecordScenario({
      label: "match_record_1v1_postgame",
      hostLogin: basicHostLogin,
      opponentLogin: basicOpponentLogin,
    }));
  }
  if (fullSimulation) {
    scenarios.push(await runTeamMembershipInviteScenario({
      label: "team_membership_invite_decline",
      captainLogin: teamInviteCaptainLogin,
      targetLogin: teamInviteTargetLogin,
      teamId: teamInviteTeamId,
    }));
    scenarios.push(await runTeamLifecycleScenario({
      label: "team_lifecycle",
      captainLogin: teamLifecycleCaptainLogin,
      acceptedMemberLogin: teamLifecycleAcceptedLogin,
      cancelledInviteLogin: teamLifecycleCancelledLogin,
    }));
    scenarios.push(await runRawTableRlsScenario({
      label: "raw_table_rls",
      login: rlsProbeLogin,
    }));
    scenarios.push(await runAdminControlScenario({
      label: "admin_appointment_discipline",
      adminLogin: adminControlLogin,
      targetLogin: adminControlTargetLogin,
    }));
    scenarios.push(await runProfilePrivacyScenario({
      label: "profile_privacy",
      ownerLogin: privacyOwnerLogin,
      viewerLogin: privacyViewerLogin,
    }));
    scenarios.push(await runProfileIdentityLockScenario({
      label: "profile_identity_lock",
      login: profileLockLogin,
    }));
    scenarios.push(await runMatchListProfileIntegrityScenario({
      label: "match_list_profile_integrity",
      login: homeAlertLogin,
    }));
    scenarios.push(await runCourtRegistrationScenario({
      label: "court_request_approval",
      requesterLogin: courtRequesterLogin,
      adminLogin: courtAdminLogin,
    }));
    scenarios.push(await runRecruitingRoomExpiryScenario({
      label: "recruiting_room_expiry",
      hostLogin: expiryRoomHostLogin,
      inviteeLogin: expiryRoomInviteeLogin,
    }));
  }
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
  if (!remoteSmokeOnly) {
    scenarios.push(await runMatchAgreeSqlReducerScenario({
      label: "match_agree_sql_reducer",
      hostLogin: agreeSqlHostLogin,
      teamALogin: agreeSqlTeamALogin,
      teamBLogins: agreeSqlTeamBLogins,
    }));
  }
  scenarios.push(await runPublicTeamRegionFeedScenario({
    label: "public_team_region_feed",
    hostLogin: publicTeamHostLogin,
    teammateLogin: publicTeamTeammateLogin,
    teamId: publicTeamId,
    opponentCaptainLogin: publicTeamOpponentCaptainLogin,
    opponentMemberLogin: publicTeamOpponentMemberLogin,
    opponentTeamId: publicTeamOpponentTeamId,
  }));
  if (!remoteSmokeOnly) {
    scenarios.push(await runHomeAlertNotificationScenario({
      label: "home_alert_notifications",
      login: homeAlertLogin,
    }));
  }
  scenarios.push(await runBulkHomeInviteAcceptScenario({
    label: "bulk_home_invite_accept_5v5",
    hostLogin: bulkInviteHostLogin,
  }));
  if (!remoteSmokeOnly) {
    scenarios.push(await runBulkHomeInviteAcceptScenario({
      label: "bulk_home_invite_overflow_5v5",
      hostLogin: bulkInviteHostLogin,
      overflow: true,
    }));
    scenarios.push(await runRecruitingActorScenario({
      label: "recruiting_actor_join_position",
      hostLogin: actorHostLogin,
      opponentLogin: actorOpponentLogin,
    }));
    scenarios.push(await runLiveSubstitutionScenario({
      label: "live_substitution_1v1",
      hostLogin: liveSubstitutionHostLogin,
      teamAReserveLogin: liveSubstitutionTeamAReserveLogin,
      teamBActiveLogin: liveSubstitutionTeamBActiveLogin,
      removableReserveLogin: liveSubstitutionRemovableReserveLogin,
    }));
    scenarios.push(await runOneOnOneScenario({
      label: "referee_absence_confirmation",
      hostLogin: refereeAbsenceHostLogin,
      opponentLogin: refereeAbsenceOpponentLogin,
      refereeLogin,
      refereeWanted: true,
      includeLatePlayer: false,
      verifyRefereeAbsence: true,
    }));
    scenarios.push(await runDiscordRoomChatBridgeScenario({
      label: "discord_room_chat_bridge",
      hostLogin: discordChatHostLogin,
      guestLogin: discordChatGuestLogin,
    }));
    scenarios.push(await runDiscordNotificationOptInScenario({
      label: "discord_notification_opt_in",
      login: discordOptInLogin,
    }));
    scenarios.push(await runDiscordUniqueProfileScenario({
      label: "discord_unique_profile",
      linkedLogin: discordUniqueLinkedLogin,
      duplicateLogin: discordUniqueDuplicateLogin,
    }));
    scenarios.push(await runRefereeExamServerScenario({
      label: "referee_exam_server",
      login: refereeExamLogin,
    }));
    scenarios.push(await runTournamentRepresentativeTeamGuardScenario({
      label: "tournament_representative_team_guard",
    }));
    scenarios.push(await runTournamentFollowupRoundScenario({
      label: "tournament_followup_round",
      creatorLogin: tournamentCreatorLogin,
    }));
    scenarios.push(await runTournamentByeRoundScenario({
      label: "tournament_bye_round",
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
  const basicScenario = await runOneOnOneScenario({
    label: "basic_1v1_no_referee",
    hostLogin: basicHostLogin,
    opponentLogin: basicOpponentLogin,
    verifyUnrankedNoRating: true,
    serverGeneratedPostId: true,
  });
  scenarios.push(basicScenario);
  if (!remoteSmokeOnly) {
    scenarios.push(await runPlayerReportScenario({
      label: "player_report_scope_dedup",
      reporterLogin: basicHostLogin,
      targetLogin: basicOpponentLogin,
      outsiderLogin: reportOutsiderLogin,
      sourceMatchId: basicScenario.matchId,
    }));
    scenarios.push(await runDisputeResumeThumbsScenario({
      label: "dispute_resume_thumbs",
      hostLogin: disputeHostLogin,
      opponentLogin: disputeOpponentLogin,
    }));
    scenarios.push(await runDisputeResumeThumbsScenario({
      label: "dispute_void",
      hostLogin: voidHostLogin,
      opponentLogin: voidOpponentLogin,
      voidAfterDispute: true,
    }));
    scenarios.push(await runOneOnOneScenario({
      label: "referee_1v1",
      hostLogin: refereeHostLogin,
      opponentLogin: refereeOpponentLogin,
      refereeLogin,
      refereeWanted: true,
    }));
  }
  }

  const cleanupResult = await cleanupWithAttemptLimit();
  const cleanupSucceeded = (cleanupResult?.skipped === true && cleanupResult?.reason === "keep_requested") || (
    cleanupResult?.skipped !== true
    && cleanupResult?.ok !== false
    && Number(cleanupResult?.failedCount ?? 0) === 0
    && (cleanupResult?.errors ?? []).length === 0
    && (cleanupResult?.notificationCleanup?.errors ?? []).length === 0
    && (cleanupResult?.recruitingCleanup?.errors ?? []).length === 0
    && (cleanupResult?.regressionCleanup?.errors ?? []).length === 0
    && (cleanupResult?.profileDiscordRestore?.errors ?? []).length === 0
    && (cleanupResult?.profileIdentityRestore?.errors ?? []).length === 0
    && (cleanupResult?.ratingRestore?.errors ?? []).length === 0
    && (cleanupResult?.teamEmblemObjectCleanup?.errors ?? []).length === 0
    && (cleanupResult?.refereeSimulationCleanup?.errors ?? []).length === 0
    && Number(cleanupResult?.notificationCleanup?.remainingNotifications ?? 0) === 0
    && Number(cleanupResult?.artifactCleanup?.remainingNotifications ?? 0) === 0
    && Number(cleanupResult?.artifactCleanup?.remainingDiscordDeliveries ?? 0) === 0
    && Number(cleanupResult?.recruitingCleanup?.remainingPosts ?? 0) === 0
    && Number(cleanupResult?.artifactCleanup?.remainingMatches ?? 0) === 0
    && Number(cleanupResult?.artifactCleanup?.remainingTournaments ?? 0) === 0
  );
  assertFlow(cleanupSucceeded, "simulation cleanup verification failed", cleanupResult);

  console.log(JSON.stringify({
    ok: true,
    mode: getSimulationMode(),
    scenarios,
    schemaHealth: schemaHealth?.skipped ? { status: "skipped", reason: schemaHealth.reason } : "ok",
    verificationWarnings: [
      schemaHealth?.skipped ? `schema_health_skipped:${schemaHealth.reason}` : "",
      usesRemoteApi ? "" : "api_handlers_called_in_process",
    ].filter(Boolean),
    maintenance: remoteSmokeOnly
      ? { skipped: true, reason: "remote_smoke" }
      : await runSystemMaintenanceProbe(),
    cleanup: cleanupResult,
  }, null, 2));
}

let cleanupAttemptCount = 0;

async function cleanupWithAttemptLimit() {
  const maxAttempts = simulationSafety.maxRetries + 1;
  if (cleanupAttemptCount >= maxAttempts) {
    throw new Error(`cleanup retry limit exceeded (${simulationSafety.maxRetries})`);
  }
  cleanupAttemptCount += 1;
  return cleanup();
}

try {
  for (let runIndex = 0; runIndex < simulationSafety.repeatCount; runIndex += 1) {
    await main();
  }
} catch (error) {
  const failure = {
    ok: false,
    postId: ids.postId,
    matchId: ids.matchId,
    step: currentStep,
    error: error.message,
  };
  console.error(JSON.stringify({ ...failure, cleanup: "pending" }, null, 2));
  const cleanupResult = await withTimeout(cleanupWithAttemptLimit(), "cleanup", cleanupTimeoutMs).catch((cleanupError) => ({ failed: cleanupError.message }));
  console.error(JSON.stringify({ ...failure, cleanup: cleanupResult }, null, 2));
  process.exit(1);
}
