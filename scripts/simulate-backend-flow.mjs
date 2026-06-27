import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import loadStateHandler from "../server/api/state/load.js";
import syncRecruitingPostHandler from "../server/api/recruiting/sync-post.js";
import syncMatchHandler from "../server/api/matches/sync-match.js";

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
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const requestTimeoutMs = Number(process.env.RANKBALL_SIM_TIMEOUT_MS || 20000);

if (!process.env.RANKBALL_ENABLE_TEST_LOGIN && !process.env.VITE_DEMO_LOGIN) {
  process.env.RANKBALL_ENABLE_TEST_LOGIN = "true";
}

if (!usesRemoteApi && (!url || !serviceRoleKey)) {
  const missing = [
    url ? "" : "SUPABASE_URL/VITE_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL",
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

const keepRows = process.argv.includes("--keep") || process.env.RANKBALL_SIM_KEEP === "1";
const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const scenarioIds = [];

function makeScenarioIds(label) {
  const safeLabel = String(label || "scenario").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
  const nextIds = {
    label: safeLabel,
    postId: `sim_q_${safeLabel}_${suffix}`,
    matchId: `sim_m_${safeLabel}_${suffix}`,
  };
  scenarioIds.push(nextIds);
  return nextIds;
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

function token(testLoginId) {
  return `test-token-${testLoginId}`;
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
    body: JSON.stringify({ ensureTestActors: true }),
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

async function getProfileIdForLogin(testLoginId) {
  const seededProfileId = getSeededProfileId(testLoginId);
  if (seededProfileId) return seededProfileId;
  const state = await loadStateAs(testLoginId);
  return getProfileId(state, testLoginId);
}

async function loadStateAs(testLoginId) {
  const payload = await callHandler("/api/state/load", loadStateHandler, token(testLoginId));
  assertFlow(payload?.ok && payload?.state, `state load failed for ${testLoginId}`, payload);
  return payload.state;
}

async function syncRecruitingAs(testLoginId, operation) {
  return callHandler("/api/recruiting/sync-post", syncRecruitingPostHandler, token(testLoginId), { operation });
}

async function syncMatchAs(testLoginId, operation, extra = {}) {
  return callHandler("/api/matches/sync-match", syncMatchHandler, token(testLoginId), { operation, ...extra });
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

function findPost(state) {
  return (state.recruitingPosts ?? []).find((post) => post.id === ids.postId);
}

function findMatch(state) {
  return (state.matches ?? []).find((match) => match.id === ids.matchId);
}

function uniqueIds(values = []) {
  return [...new Set(values.filter(Boolean))];
}

async function getRecruitingPostAfterResult(result, login, label) {
  if (result?.post) return result.post;
  const state = await step(label, () => loadStateAs(login));
  return findPost(state);
}

async function getMatchAfterResult(result, login, label) {
  if (result?.match) return result.match;
  const state = await step(label, () => loadStateAs(login));
  return findMatch(state);
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

async function cleanup() {
  if (keepRows) return { skipped: true, reason: "keep_requested" };
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
    if (!response.ok) return { skipped: true, reason: `remote_cleanup_failed:${response.status}:${text}` };
    return text ? JSON.parse(text) : { ok: true };
  }
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };

  const closedAt = new Date().toISOString();
  const closures = scenarioIds.flatMap((scenario) => [
    ["matches", "id", scenario.matchId],
    ["recruiting_posts", "id", scenario.postId],
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
  return { skipped: false, errors };
}

async function runOneOnOneScenario({
  label,
  hostLogin,
  opponentLogin,
  refereeLogin = "",
  refereeWanted = false,
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
      refereeWanted,
      refereeTrustMin: 70,
      region: "Backend Simulation",
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

  const readyResult = await step(`${ids.label}:setRecruitingReady`, () => syncRecruitingAs(opponentLogin, {
    action: "setRecruitingReady",
    postId: ids.postId,
    ready: true,
  }));
  post = await getRecruitingPostAfterResult(readyResult, opponentLogin, `${ids.label}:loadAfterReady`);
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
    match = await getMatchAfterResult(agreeAResult, hostLogin, `${ids.label}:loadAfterAgreeTeamA`);
    assertFlow(match?.agreements?.teamA?.includes(hostId), "teamA agreement not persisted", match);
  }

  if (!match.agreements?.teamB?.includes(opponentId)) {
    const agreeBResult = await step(`${ids.label}:agreeMatch:teamB`, () => syncMatchAs(opponentLogin, {
      action: "agreeMatch",
      matchId: ids.matchId,
      sideName: "teamB",
      playerId: opponentId,
    }));
    agreeBSqlReducer = Boolean(agreeBResult?.sqlReducer);
    match = await getMatchAfterResult(agreeBResult, opponentLogin, `${ids.label}:loadAfterAgreeTeamB`);
    assertFlow(match?.agreements?.teamB?.includes(opponentId), "teamB agreement not persisted", match);
  }

  if (refereeWanted) {
    const checkInAResult = await step(`${ids.label}:checkInMatchPlayer:teamA`, () => syncMatchAs(operatorLogin, {
      action: "checkInMatchPlayer",
      matchId: ids.matchId,
      sideName: "teamA",
      playerId: hostId,
    }));
    match = await getMatchAfterResult(checkInAResult, operatorLogin, `${ids.label}:loadAfterCheckInTeamA`);
    assertFlow(match?.attendance?.teamA?.includes(hostId), "teamA check-in not persisted", match);
  }

  const checkInBResult = await step(`${ids.label}:checkInMatchPlayer:teamB`, () => syncMatchAs(operatorLogin, {
    action: "checkInMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: opponentId,
  }));
  match = await getMatchAfterResult(checkInBResult, operatorLogin, `${ids.label}:loadAfterCheckInTeamB`);
  assertFlow(match?.attendance?.teamB?.includes(opponentId), "teamB check-in not persisted", match);

  const startResult = await step(`${ids.label}:startMatch`, () => syncMatchAs(operatorLogin, {
    action: "startMatch",
    matchId: ids.matchId,
  }));
  match = await getMatchAfterResult(startResult, operatorLogin, `${ids.label}:loadAfterStartMatch`);
  assertFlow(Boolean(match?.startedAt), "match start not persisted", match);

  const matchWithEnd = withEndedMatch(match);
  const endResult = await step(`${ids.label}:endMatch`, () => syncMatchAs(operatorLogin, {
    action: "endMatch",
    matchId: ids.matchId,
  }, { match: matchWithEnd }));
  match = await getMatchAfterResult(endResult, operatorLogin, `${ids.label}:loadAfterEndMatch`);
  assertFlow(Boolean(match?.endedAt), "match end not persisted", match);

  let latePlayerSqlReducers = null;
  if (!refereeWanted) {
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

  const approveBResult = await step(`${ids.label}:approveMatch:teamB`, () => syncMatchAs(opponentLogin, {
    action: "approveMatch",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: opponentId,
  }));
  match = approveBResult?.match;
  assertFlow(match?.status === "confirmed", "match approval not confirmed", match);

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
    sqlReducers: {
      setRecruitingReady: Boolean(readyResult?.sqlReducer),
      agreeMatch: agreeASqlReducer || agreeBSqlReducer,
      checkInMatchPlayer: Boolean(checkInBResult?.sqlReducer),
      startMatch: Boolean(startResult?.sqlReducer),
      endMatch: Boolean(endResult?.sqlReducer),
      latePlayer: latePlayerSqlReducers,
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
  const stateAfterPosition = await step(`${ids.label}:loadAfterPosition`, () => loadStateAs(opponentLogin));
  const reloadedPostAfterPosition = findPost(stateAfterPosition);
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
        teamId,
        side: "teamB",
        playerIds: [teamActorId],
        position: "PG",
      },
      joinMode: "team",
    }),
    ["solo_room_team_party_not_allowed", "recruiting_operation_blocked", "recruiting_sync_permission_denied", "recruiting_operation_noop"],
  );

  const stateAfterReject = await step(`${ids.label}:loadAfterReject`, () => loadStateAs(hostLogin));
  const post = findPost(stateAfterReject);
  const applications = post?.applicants ?? [];
  assertFlow(Boolean(post), "solo block post missing after rejection", stateAfterReject);
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
    teamId,
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

  const stateAfterReject = await step(`${ids.label}:loadAfterReject`, () => loadStateAs(hostLogin));
  const post = findPost(stateAfterReject);
  assertFlow(Boolean(post), "referee block post missing after rejection", stateAfterReject);
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

async function main() {
  const schemaHealth = await assertRemoteSchemaHealth();
  const basicHostLogin = process.env.RANKBALL_SIM_HOST || "rankball-010";
  const basicOpponentLogin = process.env.RANKBALL_SIM_OPPONENT || "rankball-011";
  const refereeHostLogin = process.env.RANKBALL_SIM_REF_HOST || "rankball-012";
  const refereeOpponentLogin = process.env.RANKBALL_SIM_REF_OPPONENT || "rankball-013";
  const refereeLogin = process.env.RANKBALL_SIM_REFEREE || "rankball-001";
  const actorHostLogin = process.env.RANKBALL_SIM_ACTOR_HOST || "rankball-014";
  const actorOpponentLogin = process.env.RANKBALL_SIM_ACTOR_OPPONENT || "rankball-015";
  const teamBlockedHostLogin = process.env.RANKBALL_SIM_SOLO_BLOCK_HOST || "rankball-014";
  const teamBlockedLogin = process.env.RANKBALL_SIM_SOLO_BLOCK_TEAM_LOGIN || "rankball-001";
  const teamBlockedTeamId = process.env.RANKBALL_SIM_SOLO_BLOCK_TEAM_ID || "t1";
  const refereeBlockedHostLogin = process.env.RANKBALL_SIM_REF_BLOCK_HOST || "rankball-014";
  const refereeBlockedLogin = process.env.RANKBALL_SIM_REF_BLOCK_CANDIDATE || "rankball-015";

  const scenarios = [];
  scenarios.push(await runRecruitingActorScenario({
    label: "recruiting_actor_join_position",
    hostLogin: actorHostLogin,
    opponentLogin: actorOpponentLogin,
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
  scenarios.push(await runOneOnOneScenario({
    label: "basic_1v1_no_referee",
    hostLogin: basicHostLogin,
    opponentLogin: basicOpponentLogin,
  }));
  scenarios.push(await runOneOnOneScenario({
    label: "referee_1v1",
    hostLogin: refereeHostLogin,
    opponentLogin: refereeOpponentLogin,
    refereeLogin,
    refereeWanted: true,
  }));

  console.log(JSON.stringify({
    ok: true,
    scenarios,
    schemaHealth: schemaHealth?.skipped ? "skipped" : "ok",
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
