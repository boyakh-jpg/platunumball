import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { createMatchAttendanceQr } from "./_attendanceQr.js";
import { isPracticeId, PRACTICE_LOCAL_ONLY_ERROR } from "../../../src/lib/practiceMode.js";

const ALLOWED_ACTIONS = new Set([
  "read",
  "configure",
  "start",
  "pause",
  "resume",
  "resetShot",
  "endPeriod",
  "startPeriod",
  "startOvertime",
  "transfer",
  "endClock",
]);

function getStatusCode(error = {}) {
  const message = String(error.message || "");
  if (error.code === "42501" || message.includes("forbidden")) return 403;
  if (error.code === "P0002" || message.includes("not_found")) return 404;
  if (error.code === "55000") return 409;
  if (error.code === "22023" || message.includes("invalid") || message.includes("required")) return 400;
  return error.statusCode || 500;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const matchId = String(body.matchId || "").trim();
    const action = String(body.action || "read").trim();
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    if (!matchId) {
      sendJson(response, 400, { error: "match_id_required" });
      return;
    }
    if (isPracticeId(matchId)) {
      sendJson(response, 400, { error: PRACTICE_LOCAL_ONLY_ERROR });
      return;
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      sendJson(response, 400, { error: "invalid_match_clock_action" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const { data: clock, error: clockError } = await context.supabase.rpc("rankball_match_clock_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_action: action,
      p_payload: payload,
    });
    if (clockError) throw clockError;

    const breakEventRequest = clock?.status === "break"
      ? context.supabase
        .from("match_clock_events")
        .select("created_at")
        .eq("match_id", matchId)
        .eq("action", "endPeriod")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const [
      { data: result, error: resultError },
      { data: playerRows, error: playerError },
      { data: breakEvent, error: breakEventError },
      { data: matchRow, error: matchError },
    ] = await Promise.all([
      context.supabase
        .from("match_results")
        .select("score_a,score_b,score_revision_a,score_revision_b,submitted_at")
        .eq("match_id", matchId)
        .maybeSingle(),
      context.supabase
        .from("match_players")
        .select("user_id,side,slot_order")
        .eq("match_id", matchId)
        .order("side")
        .order("slot_order"),
      breakEventRequest,
      context.supabase
        .from("matches")
        .select("visibility,rules,ended_at,tournament_id,updated_at")
        .eq("id", matchId)
        .maybeSingle(),
    ]);
    if (resultError) throw resultError;
    if (playerError) throw playerError;
    if (breakEventError) throw breakEventError;
    if (matchError) throw matchError;

    const playerIds = [...new Set((playerRows || []).map((row) => row.user_id).filter(Boolean))];
    let profileRows = [];
    if (playerIds.length) {
      const { data, error } = await context.supabase
        .from("profiles")
        .select("id,name")
        .in("id", playerIds);
      if (error) throw error;
      profileRows = data || [];
    }
    const nameById = Object.fromEntries(profileRows.map((profile) => [profile.id, profile.name]));

    sendJson(response, 200, {
      ok: true,
      clock: {
        ...clock,
        breakStartedAt: clock?.status === "break"
          ? breakEvent?.created_at || clock.serverNow
          : null,
      },
      score: {
        a: Number(result?.score_a || 0),
        b: Number(result?.score_b || 0),
        updatedAt: result?.submitted_at || null,
        revisionA: Number(result?.score_revision_a || 0),
        revisionB: Number(result?.score_revision_b || 0),
      },
      rosterRevision: matchRow?.updated_at || null,
      activePlayers: (playerRows || []).map((player) => ({
        id: player.user_id,
        name: nameById[player.user_id] || "출전 선수",
        side: player.side,
        slotOrder: Number(player.slot_order || 0),
      })),
      attendanceQr: (
        (clock?.canControl || clock?.canManage)
        && matchRow?.visibility === "public"
        && !matchRow?.ended_at
        && !matchRow?.tournament_id
        && ["", "match"].includes(String(matchRow?.rules?.recordType || ""))
        && (
          matchRow?.rules?.qrAttendanceEnabled === true
          || matchRow?.rules?.qrAttendanceEnabled === "true"
        )
      ) ? createMatchAttendanceQr(matchId, request) : null,
    });
  } catch (error) {
    sendJson(response, getStatusCode(error), {
      error: error.message || "match_clock_failed",
      code: error.code || null,
    });
  }
}
