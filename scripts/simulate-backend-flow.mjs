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
const ids = {
  postId: `sim_q_${suffix}`,
  matchId: `sim_m_${suffix}`,
};

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
    const response = await fetch(`${remoteBaseUrl}${route}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
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

async function assertRemoteSchemaHealth() {
  if (!usesRemoteApi || !schemaHealthSecret) return { skipped: true };
  const response = await fetch(`${remoteBaseUrl}/api/system/schema-health`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${schemaHealthSecret}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`/api/system/schema-health failed ${response.status}: ${text}`);
  }
  if (!payload?.ok) {
    const failed = (payload?.checks ?? [])
      .filter((check) => !check.ok)
      .map((check) => `${check.table}: ${check.error}`)
      .join("; ");
    throw new Error(`schema health failed: ${failed}`);
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

async function loadStateAs(testLoginId) {
  const payload = await callHandler("/api/state/load", loadStateHandler, token(testLoginId));
  assertFlow(payload?.ok && payload?.state, `state load failed for ${testLoginId}`, payload);
  return payload.state;
}

async function syncRecruitingAs(testLoginId, operation) {
  return callHandler("/api/recruiting/sync-post", syncRecruitingPostHandler, token(testLoginId), { operation });
}

async function syncMatchAs(testLoginId, operation) {
  return callHandler("/api/matches/sync-match", syncMatchHandler, token(testLoginId), { operation });
}

function findPost(state) {
  return (state.recruitingPosts ?? []).find((post) => post.id === ids.postId);
}

function findMatch(state) {
  return (state.matches ?? []).find((match) => match.id === ids.matchId);
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

async function cleanup() {
  if (keepRows) return { skipped: true, reason: "keep_requested" };
  if (!supabase) return { skipped: true, reason: "service_role_key_missing" };

  const deletions = [
    ["discord_notification_deliveries", "match_id", ids.matchId],
    ["notifications", "match_id", ids.matchId],
    ["notifications", "recruiting_post_id", ids.postId],
    ["player_match_stats", "match_id", ids.matchId],
    ["match_results", "match_id", ids.matchId],
    ["match_disputes", "match_id", ids.matchId],
    ["match_approvals", "match_id", ids.matchId],
    ["match_agreements", "match_id", ids.matchId],
    ["match_players", "match_id", ids.matchId],
    ["matches", "id", ids.matchId],
    ["recruiting_applications", "post_id", ids.postId],
    ["recruiting_posts", "id", ids.postId],
  ];

  const errors = [];
  for (const [table, column, value] of deletions) {
    const { error } = await supabase.from(table).delete().eq(column, value);
    if (error && !String(error.message || "").includes("does not exist")) {
      errors.push({ table, message: error.message });
    }
  }
  return { skipped: false, errors };
}

async function main() {
  const hostLogin = process.env.RANKBALL_SIM_HOST || "rankball-010";
  const opponentLogin = process.env.RANKBALL_SIM_OPPONENT || "rankball-011";
  const schemaHealth = await assertRemoteSchemaHealth();

  const hostInitialState = await loadStateAs(hostLogin);
  const opponentInitialState = await loadStateAs(opponentLogin);
  const hostId = getProfileId(hostInitialState, hostLogin);
  const opponentId = getProfileId(opponentInitialState, opponentLogin);

  assertFlow(hostId !== opponentId, "host and opponent must be different profiles", { hostId, opponentId });

  await syncRecruitingAs(hostLogin, {
    action: "createRecruitingPost",
    preferredPostId: ids.postId,
    draft: {
      id: ids.postId,
      title: "Backend simulation 1v1",
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
  });

  let hostState = await loadStateAs(hostLogin);
  let opponentState = await loadStateAs(opponentLogin);
  assertFlow(Boolean(findPost(hostState)), "created post not visible to host");
  assertFlow(Boolean(findPost(opponentState)), "public post not visible to opponent");

  await syncRecruitingAs(opponentLogin, {
    action: "interestRecruitingPost",
    postId: ids.postId,
    application: {
      joinMode: "player",
      side: "teamB",
      position: "PG",
    },
    joinMode: "player",
  });

  hostState = await loadStateAs(hostLogin);
  const joinedPost = findPost(hostState);
  assertFlow(joinedPost?.applicants?.some((applicant) => applicant.playerId === opponentId), "opponent join not persisted", joinedPost);

  await syncRecruitingAs(opponentLogin, {
    action: "setRecruitingReady",
    postId: ids.postId,
    ready: true,
  });

  await syncRecruitingAs(hostLogin, {
    action: "confirmRecruitingMatch",
    postId: ids.postId,
    preferredMatchId: ids.matchId,
  });

  hostState = await loadStateAs(hostLogin);
  opponentState = await loadStateAs(opponentLogin);
  let match = findMatch(hostState);
  assertFlow(Boolean(match), "confirmed match not visible to host");
  assertFlow(Boolean(findMatch(opponentState)), "confirmed match not visible to opponent");
  assertFlow(match.teamA?.players?.includes(hostId), "host missing from teamA", match);
  assertFlow(match.teamB?.players?.includes(opponentId), "opponent missing from teamB", match);

  await syncMatchAs(hostLogin, {
    action: "agreeMatch",
    matchId: ids.matchId,
    sideName: "teamA",
    playerId: hostId,
  });

  await syncMatchAs(opponentLogin, {
    action: "agreeMatch",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: opponentId,
  });

  await syncMatchAs(hostLogin, {
    action: "checkInMatchPlayer",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: opponentId,
  });

  await syncMatchAs(hostLogin, {
    action: "startMatch",
    matchId: ids.matchId,
  });

  hostState = await loadStateAs(hostLogin);
  match = findMatch(hostState);
  assertFlow(Boolean(match?.startedAt), "match start not persisted", match);

  await syncMatchAs(hostLogin, {
    action: "endMatch",
    matchId: ids.matchId,
  });

  hostState = await loadStateAs(hostLogin);
  match = findMatch(hostState);
  assertFlow(Boolean(match?.endedAt), "match end not persisted", match);

  await syncMatchAs(hostLogin, {
    action: "submitMatchResult",
    matchId: ids.matchId,
    result: makeResult(match),
  });

  hostState = await loadStateAs(hostLogin);
  match = findMatch(hostState);
  assertFlow(match?.status === "approval" && match?.result, "match result not persisted", match);

  await syncMatchAs(hostLogin, {
    action: "approveMatch",
    matchId: ids.matchId,
    sideName: "teamA",
    playerId: hostId,
  });

  await syncMatchAs(opponentLogin, {
    action: "approveMatch",
    matchId: ids.matchId,
    sideName: "teamB",
    playerId: opponentId,
  });

  hostState = await loadStateAs(hostLogin);
  match = findMatch(hostState);
  assertFlow(match?.status === "confirmed", "match approval not confirmed", match);

  console.log(JSON.stringify({
    ok: true,
    hostLogin,
    opponentLogin,
    hostId,
    opponentId,
    postId: ids.postId,
    matchId: ids.matchId,
    finalStatus: match.status,
    schemaHealth: schemaHealth?.skipped ? "skipped" : "ok",
    cleanup: await cleanup(),
  }, null, 2));
}

try {
  await main();
} catch (error) {
  const cleanupResult = await cleanup().catch((cleanupError) => ({ failed: cleanupError.message }));
  console.error(JSON.stringify({
    ok: false,
    postId: ids.postId,
    matchId: ids.matchId,
    error: error.message,
    cleanup: cleanupResult,
  }, null, 2));
  process.exit(1);
}
