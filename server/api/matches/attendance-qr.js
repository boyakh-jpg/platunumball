import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { createMatchAttendanceQr, verifyMatchAttendanceQr } from "./_attendanceQr.js";

const MATCH_SIDES = ["teamA", "teamB"];
const SUPPORTED_SIDE_SIZES = [5, 3, 2, 1];

function getStatusCode(error = {}) {
  const message = String(error?.message || "");
  if (error?.code === "42501" || message.includes("forbidden") || message.includes("permission")) return 403;
  if (error?.code === "P0002" || message.includes("not_found")) return 404;
  if (
    error?.code === "23514"
    || message.includes("locked")
    || message.includes("expired")
    || message.includes("not_checkin")
    || message.includes("full")
  ) return 409;
  if (error?.code === "22023" || message.includes("invalid") || message.includes("required")) return 400;
  return error?.statusCode || 500;
}

function isTrue(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function isTournamentMatch(match = {}) {
  return Boolean(match.tournament_id) || match.visibility === "tournament";
}

function getSideSize(mode = "") {
  const size = Number.parseInt(String(mode), 10);
  return SUPPORTED_SIDE_SIZES.includes(size) ? size : 5;
}

export function getRecommendedSideSize(entries = [], currentMode = "") {
  const currentSideSize = getSideSize(currentMode);
  const attendedBySide = Object.fromEntries(MATCH_SIDES.map((side) => [
    side,
    entries.filter((entry) => entry.side === side && ["on_time", "late"].includes(entry.status)).length,
  ]));
  const size = SUPPORTED_SIDE_SIZES.find((candidate) => (
    candidate <= currentSideSize
    && MATCH_SIDES.every((side) => (
      attendedBySide[side] >= candidate
      && attendedBySide[side] <= candidate + 3
    ))
  )) || 0;
  return {
    attendedBySide,
    currentSideSize,
    recommendedSideSize: size,
    recommendedMode: size ? `${size}v${size}` : "",
  };
}

export function isAttendanceCheckinOpen(match = {}, nowMs = Date.now()) {
  if (match.started_at || match.rules?.timingType === "instant") return true;
  if (!match.scheduled_date || !match.scheduled_time) return false;
  const scheduledAtMs = Date.parse(`${match.scheduled_date}T${match.scheduled_time}+09:00`);
  return Number.isFinite(scheduledAtMs) && nowMs >= scheduledAtMs - (10 * 60 * 1000);
}

function getAttendanceSummary(entries = [], currentMode = "") {
  const bySide = Object.fromEntries(MATCH_SIDES.map((side) => {
    const sideEntries = entries.filter((entry) => entry.side === side);
    return [side, {
      total: sideEntries.length,
      onTime: sideEntries.filter((entry) => entry.status === "on_time").length,
      late: sideEntries.filter((entry) => entry.status === "late").length,
      pending: sideEntries.filter((entry) => entry.status === "pending").length,
      noShow: sideEntries.filter((entry) => entry.status === "no_show").length,
    }];
  }));
  return { bySide, ...getRecommendedSideSize(entries, currentMode) };
}

function getReserveIds(match = {}) {
  return MATCH_SIDES.flatMap((side) => {
    const values = match?.reserve_players?.[side];
    return Array.isArray(values) ? values.map((playerId) => ({ playerId, side, role: "reserve" })) : [];
  });
}

async function syncAttendanceEntries(context, match) {
  const { data: activeRows, error: activeError } = await context.supabase
    .from("match_players")
    .select("user_id,side")
    .eq("match_id", match.id)
    .in("side", MATCH_SIDES);
  if (activeError) throw activeError;

  const attended = new Set(MATCH_SIDES.flatMap((side) => (
    Array.isArray(match?.attendance?.[side]) ? match.attendance[side] : []
  )));
  const roster = [
    ...(activeRows || []).map((row) => ({ playerId: row.user_id, side: row.side, role: "active" })),
    ...getReserveIds(match),
  ].filter((entry) => entry.playerId && MATCH_SIDES.includes(entry.side));
  const uniqueRoster = [...new Map(roster.map((entry) => [entry.playerId, entry])).values()];
  if (uniqueRoster.length) {
    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("match_attendance_entries")
      .upsert(uniqueRoster.map((entry) => ({
        match_id: match.id,
        player_id: entry.playerId,
        side: entry.side,
        original_role: entry.role,
        status: attended.has(entry.playerId) ? "on_time" : "pending",
        method: attended.has(entry.playerId) ? "operator" : null,
        checked_in_at: attended.has(entry.playerId) ? now : null,
        updated_at: now,
      })), { onConflict: "match_id,player_id", ignoreDuplicates: true });
    if (error) throw error;
  }

  const { data: entries, error: entryError } = await context.supabase
    .from("match_attendance_entries")
    .select("player_id,side,original_role,status,method,checked_in_at,updated_at")
    .eq("match_id", match.id)
    .order("side")
    .order("updated_at");
  if (entryError) throw entryError;
  return entries || [];
}

async function loadMatch(context, matchId) {
  const { data: match, error } = await context.supabase
    .from("matches")
    .select("id,mode,visibility,status,created_by,referee_id,rules,reserve_players,attendance,scheduled_date,scheduled_time,started_at,ended_at,tournament_id")
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw error;
  if (!match) throw new Error("match_not_found");
  return match;
}

function assertQrMatch(match) {
  const qrEligible = match.visibility === "public" || isTournamentMatch(match);
  if (
    !qrEligible
    || !["", "match"].includes(String(match.rules?.recordType || ""))
    || !isTrue(match.rules?.qrAttendanceEnabled)
  ) {
    throw new Error("match_attendance_qr_disabled");
  }
  if (match.ended_at || ["approval", "confirmed", "cancelled", "void"].includes(match.status)) {
    throw new Error("match_attendance_qr_locked");
  }
}

function assertOperator(match, profileId) {
  const operatorIds = isTournamentMatch(match)
    ? [match.referee_id].filter(Boolean)
    : [match.created_by, match.referee_id].filter(Boolean);
  if (!operatorIds.includes(profileId)) {
    const error = new Error("match_attendance_qr_permission_denied");
    error.code = "42501";
    throw error;
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const matchId = String(body.matchId || "").trim();
    const action = String(body.action || "issue").trim();
    if (!matchId) throw new Error("match_id_required");
    if (!["issue", "scan", "resize"].includes(action)) throw new Error("invalid_match_attendance_qr_action");

    const context = await getAuthenticatedContext(request);
    const match = await loadMatch(context, matchId);
    assertQrMatch(match);

    if (action === "scan") {
      verifyMatchAttendanceQr(String(body.token || ""), matchId);
      const { data, error } = await context.supabase.rpc("rankball_match_attendance_qr_action", {
        p_actor_profile_id: context.profileId,
        p_match_id: matchId,
      });
      if (error) throw error;
      sendJson(response, 200, { ok: true, ...data, matchId });
      return;
    }

    assertOperator(match, context.profileId);
    if (action === "resize") {
      if (isTournamentMatch(match)) throw new Error("match_attendance_resize_tournament_locked");
      const { data, error } = await context.supabase.rpc("rankball_match_attendance_resize_action", {
        p_actor_profile_id: context.profileId,
        p_match_id: matchId,
      });
      if (error) throw error;
      sendJson(response, 200, { ok: true, ...data, matchId });
      return;
    }

    const entries = await syncAttendanceEntries(context, match);
    const summary = getAttendanceSummary(entries, match.mode);
    const requiresCleanup = MATCH_SIDES.some((side) => (
      Number(summary.bySide?.[side]?.pending || 0) > 0
    ));
    const checkinOpen = isAttendanceCheckinOpen(match);
    sendJson(response, 200, {
      ok: true,
      matchId,
      qr: createMatchAttendanceQr(matchId, request),
      summary,
      requiresCleanup,
      checkinOpen,
      canResize: !match.started_at
        && !isTournamentMatch(match)
        && checkinOpen
        && Boolean(summary.recommendedMode)
        && (summary.recommendedMode !== match.mode || requiresCleanup),
    });
  } catch (error) {
    sendJson(response, getStatusCode(error), {
      error: error.message || "match_attendance_qr_failed",
      code: error.code || null,
    });
  }
}
