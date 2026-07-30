import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import attendanceQrHandler from "../server/api/matches/attendance-qr.js";
import { persistMatchSnapshot } from "../server/api/matches/sync-match.js";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...valueParts] = line.split("=");
    if (!key || process.env[key]) continue;
    process.env[key] = valueParts.join("=").replace(/^["']|["']$/gu, "");
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env.production");

const PRODUCTION_PROJECT_REF = "olzxextphxpniwiiwwda";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const testPassword = process.env.RANKBALL_TEST_PASSWORD || process.env.VITE_TEST_AUTH_PASSWORD || "test-0000";
const testEmailDomain = process.env.RANKBALL_TEST_AUTH_EMAIL_DOMAIN
  || process.env.VITE_TEST_AUTH_EMAIL_DOMAIN
  || "rankball.test";
const confirmation = String(
  process.argv.find((arg) => arg.startsWith("--confirm-production="))?.split("=")[1] || "",
).trim();
const holdMs = Number(
  process.argv.find((arg) => arg.startsWith("--hold-ms="))?.split("=")[1] || 0,
);

if (!url || !publishableKey || !serviceRoleKey) {
  throw new Error("match_attendance_simulation_env_missing");
}
if (!Number.isSafeInteger(holdMs) || holdMs < 0 || holdMs > 300_000) {
  throw new Error("match_attendance_simulation_hold_invalid");
}
const projectRef = new URL(url).hostname.match(/^([a-z0-9]+)\.supabase\.co$/u)?.[1] || "";
if (!projectRef) throw new Error("match_attendance_simulation_target_unknown");
if (projectRef === PRODUCTION_PROJECT_REF && confirmation !== projectRef) {
  throw new Error(`production simulation requires --confirm-production=${projectRef}`);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const auth = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const matchIds = [
  `sim_m_qr_attendance_${suffix}`,
  `sim_m_qr_no_referee_${suffix}`,
];
const authTokens = new Map();
let currentStage = "init";

function makeRequest(token, body) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      host: "boxtier.kr",
      "x-forwarded-host": "boxtier.kr",
      "x-forwarded-proto": "https",
    },
    body,
  };
}

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
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

async function callAttendance(loginId, body) {
  const response = makeResponse();
  await attendanceQrHandler(makeRequest(await getAuthToken(loginId), body), response);
  return response;
}

async function getAuthToken(loginId) {
  if (authTokens.has(loginId)) return authTokens.get(loginId);
  const email = `${loginId}@${testEmailDomain}`;
  let { data, error } = await auth.auth.signInWithPassword({ email, password: testPassword });
  if (error || !data?.session?.access_token) {
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError || !linkData?.properties?.hashed_token) {
      throw new Error(`test_auth_failed:${loginId}:${error?.message || linkError?.message || "missing_token"}`);
    }
    ({ data, error } = await auth.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    }));
  }
  if (error || !data?.session?.access_token) throw new Error(`test_auth_failed:${loginId}`);
  authTokens.set(loginId, data.session.access_token);
  return data.session.access_token;
}

async function rpc(name, args) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw error;
  return data;
}

async function expectRpcError(name, args, expected) {
  const { error } = await admin.rpc(name, args);
  assert.ok(error, `${name} should fail`);
  assert.match(`${error.code || ""}:${error.message || ""}`, expected);
}

async function loadMatch(matchId) {
  const { data, error } = await admin
    .from("matches")
    .select("id,mode,status,created_by,referee_id,rules,reserve_players,attendance,played_player_ids,mmr_excluded_player_ids,anonymous_players,started_at,ended_at")
    .eq("id", matchId)
    .single();
  if (error) throw error;
  return data;
}

async function loadActivePlayers(matchId) {
  const { data, error } = await admin
    .from("match_players")
    .select("user_id,side,slot_order")
    .eq("match_id", matchId)
    .order("side")
    .order("slot_order");
  if (error) throw error;
  return data || [];
}

async function setClockActiveElapsed(matchId, activeElapsedMs, periodTotalMs = 12 * 60 * 1000) {
  const { error } = await admin
    .from("match_clock_sessions")
    .update({
      status: "paused",
      active_elapsed_ms: activeElapsedMs,
      period_remaining_ms: Math.max(0, periodTotalMs - activeElapsedMs),
      last_resumed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("match_id", matchId);
  if (error) throw error;
}

function makeMatch({
  id,
  hostId,
  refereeId = "",
  court,
  mode,
  teamA,
  teamB,
  parties = [],
}) {
  const sideCapacity = Number.parseInt(mode, 10);
  const now = new Date().toISOString();
  return {
    id,
    title: "QR 출석 시뮬레이션",
    mode,
    courtId: court.id,
    court: court.name,
    scheduledDate: "",
    scheduledTime: "",
    scheduledAt: "instant",
    timingType: "instant",
    visibility: "public",
    status: "agreed",
    ranked: true,
    official: false,
    preRegistered: true,
    refereeId,
    refereeTrustMin: 70,
    statEntryMinutes: 60,
    disputeMinutes: 15,
    memo: "자동 시뮬레이션. 종료 후 삭제.",
    stakes: "",
    mmrLimitMode: "off",
    rules: {
      recordType: "match",
      visibility: "public",
      matchPurpose: "competitive",
      formationMode: "prearranged",
      timingType: "instant",
      gameClockEnabled: true,
      qrAttendanceEnabled: true,
      sideCapacity,
      benchCapacity: 0,
      periodCount: 1,
      periodMinutes: 12,
      timeLimit: 12,
      targetScore: 21,
      statRecorders: {},
      playedPlayerIds: { teamA: [], teamB: [] },
      mmrExcludedPlayerIds: [],
      parties,
    },
    createdBy: hostId,
    agreedAt: now,
    createdAt: now,
    updatedAt: now,
    teamA: { name: "A", teamId: null, players: teamA, score: 0 },
    teamB: { name: "B", teamId: null, players: teamB, score: 0 },
    agreements: { teamA: teamA, teamB },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    playedPlayerIds: { teamA: [], teamB: [] },
    reservePlayers: { teamA: [], teamB: [] },
    promotedReserveIds: { teamA: [], teamB: [] },
    attendance: { teamA: [], teamB: [] },
    result: null,
  };
}

async function persistMatch(match) {
  const assignedRefereeId = match.refereeId;
  await persistMatchSnapshot(
    { supabase: admin, profileId: match.createdBy },
    {
      match: { ...match, refereeId: "" },
      notifications: [],
      action: "createMatch",
      body: {},
      trustedServerCreate: true,
    },
  );
  if (assignedRefereeId) {
    const { error } = await admin
      .from("matches")
      .update({ referee_id: assignedRefereeId })
      .eq("id", match.id);
    if (error) throw error;
  }
}

async function cleanup() {
  for (const table of ["user_room_feed", "room_feed_cards"]) {
    const { error } = await admin
      .from(table)
      .delete()
      .eq("entity_type", "match")
      .in("entity_id", matchIds);
    if (error) throw error;
  }
  for (const table of ["match_record_refresh_queue", "match_record_archives"]) {
    const { error } = await admin.from(table).delete().in("match_id", matchIds);
    if (error) throw error;
  }
  const { error } = await admin.from("matches").delete().in("id", matchIds);
  if (error) throw error;
  for (const table of ["user_room_feed", "room_feed_cards"]) {
    const { error: feedError } = await admin
      .from(table)
      .delete()
      .eq("entity_type", "match")
      .in("entity_id", matchIds);
    if (feedError) throw feedError;
  }
  for (const table of ["match_record_refresh_queue", "match_record_archives"]) {
    const { error: archiveError } = await admin.from(table).delete().in("match_id", matchIds);
    if (archiveError) throw archiveError;
  }
  for (const [table, column] of [
    ["matches", "id"],
    ["user_room_feed", "entity_id"],
    ["room_feed_cards", "entity_id"],
    ["match_record_archives", "match_id"],
  ]) {
    let query = admin.from(table).select(column, { count: "exact", head: true }).in(column, matchIds);
    if (table === "user_room_feed" || table === "room_feed_cards") query = query.eq("entity_type", "match");
    const { count, error: verifyError } = await query;
    if (verifyError) throw verifyError;
    assert.equal(count, 0, `${table} simulation cleanup failed`);
  }
}

async function main() {
  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .select("id,test_login_id")
    .not("test_login_id", "is", null)
    .order("test_login_id")
    .limit(12);
  if (profileError) throw profileError;
  const profiles = (profileRows || []).filter((profile) => profile.id && profile.test_login_id);
  assert.ok(profiles.length >= 10, "QR attendance simulation needs 10 test profiles");
  const referee = profiles.find((profile) => profile.test_login_id === "rankball-001");
  assert.ok(referee?.id, "QR attendance simulation needs an appointed referee profile");
  const playerProfiles = profiles.filter((profile) => profile.id !== referee.id);
  const [
    host,
    regularA,
    lateA,
    regularB,
    regularB2,
    lateB,
    extraRegistered,
    noRefHost,
    noRefOpponent,
  ] = playerProfiles;
  const { data: courtRows, error: courtError } = await admin
    .from("approved_courts")
    .select("id,name")
    .or("status.is.null,status.eq.active")
    .is("hidden_at", null)
    .limit(1);
  if (courtError) throw courtError;
  const court = courtRows?.[0];
  assert.ok(court?.id, "simulation court missing");

  const primaryMatch = makeMatch({
    id: matchIds[0],
    hostId: host.id,
    refereeId: referee.id,
    court,
    mode: "3v3",
    teamA: [host.id, regularA.id, lateA.id],
    teamB: [regularB.id, regularB2.id, lateB.id],
    parties: [{ id: "sim-party", leaderId: regularA.id, playerIds: [regularA.id, lateA.id] }],
  });
  currentStage = "persist_primary_match";
  await persistMatch(primaryMatch);

  currentStage = "issue_qr_as_referee";
  const issue = await callAttendance(referee.test_login_id, {
    action: "issue",
    matchId: primaryMatch.id,
  });
  assert.equal(issue.statusCode, 200);
  assert.ok(issue.payload?.qr?.token);

  const forbiddenIssue = await callAttendance(regularA.test_login_id, {
    action: "issue",
    matchId: primaryMatch.id,
  });
  assert.equal(forbiddenIssue.statusCode, 403);

  for (const profile of [host, regularA, regularB, regularB2]) {
    currentStage = `scan_on_time:${profile.test_login_id}`;
    const scan = await callAttendance(profile.test_login_id, {
      action: "scan",
      matchId: primaryMatch.id,
      token: issue.payload.qr.token,
    });
    assert.equal(scan.statusCode, 200);
    assert.equal(scan.payload?.attendanceStatus, "on_time");
  }

  const forbiddenResize = await callAttendance(regularA.test_login_id, {
    action: "resize",
    matchId: primaryMatch.id,
  });
  assert.equal(forbiddenResize.statusCode, 403);

  currentStage = "resize_as_referee";
  const resize = await callAttendance(referee.test_login_id, {
    action: "resize",
    matchId: primaryMatch.id,
  });
  assert.equal(resize.statusCode, 200);
  assert.equal(resize.payload?.toMode, "2v2");
  assert.equal(resize.payload?.roomEditCountConsumed, false);
  let match = await loadMatch(primaryMatch.id);
  assert.equal(match.mode, "2v2");
  assert.equal((await loadActivePlayers(primaryMatch.id)).length, 4);

  currentStage = "start_as_referee";
  await rpc("rankball_match_start_action_guarded", {
    p_actor_profile_id: referee.id,
    p_match_id: primaryMatch.id,
    p_started_at: "",
    p_agreed_at: "",
    p_attendance: match.attendance,
  });
  const adjustedStartedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { error: startAdjustError } = await admin
    .from("matches")
    .update({ started_at: adjustedStartedAt })
    .eq("id", primaryMatch.id);
  if (startAdjustError) throw startAdjustError;
  currentStage = "start_game_clock";
  await rpc("rankball_match_clock_action", {
    p_actor_profile_id: host.id,
    p_match_id: primaryMatch.id,
    p_action: "read",
    p_payload: {},
  });
  await rpc("rankball_match_clock_action", {
    p_actor_profile_id: host.id,
    p_match_id: primaryMatch.id,
    p_action: "start",
    p_payload: {},
  });
  await setClockActiveElapsed(primaryMatch.id, 0);

  for (const profile of [lateA, lateB]) {
    currentStage = `scan_late:${profile.test_login_id}`;
    const lateScan = await callAttendance(profile.test_login_id, {
      action: "scan",
      matchId: primaryMatch.id,
      token: issue.payload.qr.token,
    });
    assert.equal(lateScan.statusCode, 200);
    assert.equal(lateScan.payload?.attendanceStatus, "late");
    assert.equal(lateScan.payload?.reserveRegistered, true);
  }

  match = await loadMatch(primaryMatch.id);
  assert.ok(match.reserve_players.teamA.includes(lateA.id));
  assert.ok(match.reserve_players.teamB.includes(lateB.id));
  const { error: recorderError } = await admin
    .from("matches")
    .update({
      stat_recorders: { teamB: lateB.id },
      rules: { ...match.rules, statRecorders: { teamB: lateB.id } },
    })
    .eq("id", primaryMatch.id);
  if (recorderError) throw recorderError;

  currentStage = "deny_party_leader_substitution";
  await expectRpcError("rankball_match_roster_transition_action", {
    p_actor_profile_id: regularA.id,
    p_action: "substituteMatchPlayer",
    p_match_id: primaryMatch.id,
    p_side: "teamA",
    p_active_player_id: regularA.id,
    p_reserve_player_id: lateA.id,
    p_next_recorder_id: "",
    p_reason: "late",
  }, /42501|match_substitution_permission_denied/u);

  currentStage = "deny_side_recorder_substitution_with_referee";
  await expectRpcError("rankball_match_roster_transition_action", {
    p_actor_profile_id: lateB.id,
    p_action: "substituteMatchPlayer",
    p_match_id: primaryMatch.id,
    p_side: "teamB",
    p_active_player_id: regularB2.id,
    p_reserve_player_id: lateB.id,
    p_next_recorder_id: "",
    p_reason: "operator",
  }, /42501|match_substitution_permission_denied/u);

  currentStage = "substitute_team_b_as_referee";
  const substitutionB = await rpc("rankball_match_roster_transition_action", {
    p_actor_profile_id: referee.id,
    p_action: "substituteMatchPlayer",
    p_match_id: primaryMatch.id,
    p_side: "teamB",
    p_active_player_id: regularB2.id,
    p_reserve_player_id: lateB.id,
    p_next_recorder_id: "",
    p_reason: "late",
  });
  assert.equal(substitutionB.substitutionEventSaved, true);
  assert.equal(substitutionB.clockActiveElapsedMs, 0);

  await setClockActiveElapsed(primaryMatch.id, 90_000);
  currentStage = "substitute_as_referee";
  const substitutionA = await rpc("rankball_match_roster_transition_action", {
    p_actor_profile_id: referee.id,
    p_action: "substituteMatchPlayer",
    p_match_id: primaryMatch.id,
    p_side: "teamA",
    p_active_player_id: regularA.id,
    p_reserve_player_id: lateA.id,
    p_next_recorder_id: "",
    p_reason: "late",
  });
  assert.equal(substitutionA.substitutionEventSaved, true);
  assert.equal(substitutionA.clockActiveElapsedMs, 90_000);

  await setClockActiveElapsed(primaryMatch.id, 120_000);
  const endAt = Date.now();
  currentStage = "end_and_calculate_minimum_play";
  const { error: endError } = await admin
    .from("matches")
    .update({ ended_at: new Date(endAt).toISOString() })
    .eq("id", primaryMatch.id);
  if (endError) throw endError;

  match = await loadMatch(primaryMatch.id);
  assert.ok(match.mmr_excluded_player_ids.includes(lateA.id));
  assert.ok(!match.mmr_excluded_player_ids.includes(lateB.id));
  const { data: intervalRows, error: intervalError } = await admin
    .from("match_play_intervals")
    .select("player_id,started_active_elapsed_ms,ended_active_elapsed_ms")
    .eq("match_id", primaryMatch.id)
    .in("player_id", [lateA.id, lateB.id]);
  if (intervalError) throw intervalError;
  const intervalByPlayerId = Object.fromEntries((intervalRows || []).map((row) => [row.player_id, row]));
  assert.equal(intervalByPlayerId[lateA.id]?.started_active_elapsed_ms, 90_000);
  assert.equal(intervalByPlayerId[lateA.id]?.ended_active_elapsed_ms, 120_000);
  assert.equal(intervalByPlayerId[lateB.id]?.started_active_elapsed_ms, 0);
  assert.equal(intervalByPlayerId[lateB.id]?.ended_active_elapsed_ms, 120_000);

  currentStage = "postgame_permission_and_additions";
  await expectRpcError("rankball_match_postgame_roster_action", {
    p_actor_profile_id: regularA.id,
    p_action: "addMatchLatePlayer",
    p_match_id: primaryMatch.id,
    p_player_id: extraRegistered.id,
    p_side: "teamA",
    p_anonymous_name: "",
  }, /42501|permission denied|function .* does not exist/u);
  await expectRpcError("rankball_match_postgame_roster_action", {
    p_actor_profile_id: host.id,
    p_action: "addMatchLatePlayer",
    p_match_id: primaryMatch.id,
    p_player_id: extraRegistered.id,
    p_side: "teamA",
    p_anonymous_name: "",
  }, /42501|permission denied|function .* does not exist/u);
  await expectRpcError("rankball_match_postgame_roster_action", {
    p_actor_profile_id: referee.id,
    p_action: "addMatchLatePlayer",
    p_match_id: primaryMatch.id,
    p_player_id: "",
    p_side: "teamB",
    p_anonymous_name: "현장 선수",
  }, /42501|permission denied|function .* does not exist/u);
  await expectRpcError("rankball_match_postgame_roster_action", {
    p_actor_profile_id: referee.id,
    p_action: "removeMatchLatePlayer",
    p_match_id: primaryMatch.id,
    p_player_id: extraRegistered.id,
    p_side: "",
    p_anonymous_name: "",
  }, /42501|permission denied|function .* does not exist/u);

  const noRefMatch = makeMatch({
    id: matchIds[1],
    hostId: noRefHost.id,
    court,
    mode: "1v1",
    teamA: [noRefHost.id],
    teamB: [noRefOpponent.id],
  });
  currentStage = "persist_no_referee_match";
  await persistMatch(noRefMatch);
  currentStage = "issue_no_referee_qr";
  const noRefIssue = await callAttendance(noRefHost.test_login_id, {
    action: "issue",
    matchId: noRefMatch.id,
  });
  assert.equal(noRefIssue.statusCode, 200);
  currentStage = "scan_no_referee_opponent";
  const noRefOpponentScan = await callAttendance(noRefOpponent.test_login_id, {
    action: "scan",
    matchId: noRefMatch.id,
    token: noRefIssue.payload.qr.token,
  });
  assert.equal(noRefOpponentScan.statusCode, 200);
  if (holdMs > 0) {
    console.log(JSON.stringify({
      fixtureReady: true,
      matchId: noRefMatch.id,
      loginId: noRefHost.test_login_id,
      holdMs,
    }));
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  }
  currentStage = "deny_resize_without_host_attendance";
  const noRefResize = await callAttendance(noRefHost.test_login_id, {
    action: "resize",
    matchId: noRefMatch.id,
  });
  assert.equal(noRefResize.statusCode, 409);
  currentStage = "start_without_host_attendance";
  await rpc("rankball_match_start_action_guarded", {
    p_actor_profile_id: noRefHost.id,
    p_match_id: noRefMatch.id,
    p_started_at: "",
    p_agreed_at: "",
    p_attendance: (await loadMatch(noRefMatch.id)).attendance,
  });

  return {
    ok: true,
    target: projectRef === PRODUCTION_PROJECT_REF ? "production" : "test",
    checks: {
      operatorIssue: true,
      regularDenied: true,
      onTimeScan: true,
      attendanceResize: true,
      refereeStart: true,
      lateReserve: true,
      partyLeaderDenied: true,
      refereeSubstitution: true,
      sideRecorderDeniedWithReferee: true,
      minimumPlayExclusion: true,
      postgameRegisteredAndAnonymous: true,
      hostWithoutReferee: true,
    },
  };
}

let output;
try {
  output = await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code || null,
    error: error?.message || String(error),
  }, null, 2));
  throw error;
} finally {
  await cleanup();
}
console.log(JSON.stringify(output, null, 2));
