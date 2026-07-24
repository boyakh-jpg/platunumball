import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

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

    const [{ data: result, error: resultError }, { data: playerRows, error: playerError }] = await Promise.all([
      context.supabase
        .from("match_results")
        .select("score_a,score_b,submitted_at")
        .eq("match_id", matchId)
        .maybeSingle(),
      context.supabase
        .from("match_players")
        .select("user_id,side,slot_order")
        .eq("match_id", matchId)
        .order("side")
        .order("slot_order"),
    ]);
    if (resultError) throw resultError;
    if (playerError) throw playerError;

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
      clock,
      score: {
        a: Number(result?.score_a || 0),
        b: Number(result?.score_b || 0),
        updatedAt: result?.submitted_at || null,
      },
      activePlayers: (playerRows || []).map((player) => ({
        id: player.user_id,
        name: nameById[player.user_id] || "출전 선수",
        side: player.side,
        slotOrder: Number(player.slot_order || 0),
      })),
    });
  } catch (error) {
    sendJson(response, getStatusCode(error), {
      error: error.message || "match_clock_failed",
      code: error.code || null,
    });
  }
}
