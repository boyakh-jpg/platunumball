import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { createMatchAttendanceQr, verifyMatchAttendanceQr } from "./_attendanceQr.js";
import {
  queueMatchDiscordDeliveries,
  reconcileMatchAttendanceNotifications,
} from "./sync-match.js";

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
  return Number.isFinite(scheduledAtMs) && nowMs >= scheduledAtMs - (20 * 60 * 1000);
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
  const currentRosterIds = new Set(uniqueRoster.map((entry) => entry.playerId));
  return {
    entries: (entries || []).filter((entry) => currentRosterIds.has(entry.player_id)),
    roster: uniqueRoster,
  };
}

async function loadMatch(context, matchId) {
  const { data: match, error } = await context.supabase
    .from("matches")
    .select("id,title,mode,court_name,visibility,status,created_by,referee_id,rules,reserve_players,attendance,scheduled_date,scheduled_time,started_at,ended_at,cancelled_at,voided_at,tournament_id")
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
  if (
    match.ended_at
    || match.cancelled_at
    || match.voided_at
    || ["approval", "confirmed", "cancelled", "void"].includes(match.status)
  ) {
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

function toNotificationMatch(match = {}, roster = []) {
  return {
    id: match.id,
    title: match.title,
    mode: match.mode,
    court: match.court_name,
    status: match.status,
    createdBy: match.created_by,
    refereeId: match.referee_id,
    scheduledAt: match.rules?.timingType === "instant"
      ? "즉시"
      : [match.scheduled_date, String(match.scheduled_time || "").slice(0, 5)].filter(Boolean).join(" "),
    startedAt: match.started_at,
    endedAt: match.ended_at,
    rules: match.rules ?? {},
    reservePlayers: match.reserve_players ?? {},
    attendance: match.attendance ?? {},
    teamA: { players: roster.filter((entry) => entry.side === "teamA" && entry.role === "active").map((entry) => entry.playerId) },
    teamB: { players: roster.filter((entry) => entry.side === "teamB" && entry.role === "active").map((entry) => entry.playerId) },
  };
}

export function getStartStatus(match = {}, entries = [], nowMs = Date.now()) {
  const requiredEntries = entries.filter((entry) => entry.player_id !== match.referee_id);
  const checkedInCount = requiredEntries.filter((entry) => ["on_time", "late"].includes(entry.status)).length;
  const requiredCount = requiredEntries.length;
  const missingCount = Math.max(0, requiredCount - checkedInCount);
  const checkinOpen = isAttendanceCheckinOpen(match, nowMs);
  const scheduledAtMs = match.rules?.timingType === "instant"
    ? nowMs
    : Date.parse(`${match.scheduled_date}T${match.scheduled_time}+09:00`);
  const serverTimeAvailable = match.rules?.timingType === "instant" || Number.isFinite(scheduledAtMs);
  const scheduledStartReached = serverTimeAvailable && nowMs >= scheduledAtMs;
  const allCheckedIn = requiredCount > 0 && missingCount === 0;
  const canStartEarly = checkinOpen && !scheduledStartReached && allCheckedIn;
  const canStart = scheduledStartReached || canStartEarly;
  const blockReason = canStart
    ? ""
    : !serverTimeAvailable
      ? "server_time_unavailable"
      : !checkinOpen
        ? "attendance_not_open"
        : missingCount > 0
          ? "attendance_pending"
          : "match_state_mismatch";
  return {
    serverNow: new Date(nowMs).toISOString(),
    checkinOpen,
    scheduledStartReached,
    allCheckedIn,
    canStartEarly,
    canStart,
    blockReason,
    requiredCount,
    checkedInCount,
    missingCount,
  };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

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
      const updatedMatch = await loadMatch(context, matchId);
      const attendanceState = await syncAttendanceEntries(context, updatedMatch);
      const notificationMatch = toNotificationMatch(updatedMatch, attendanceState.roster);
      let notificationState = null;
      try {
        notificationState = await reconcileMatchAttendanceNotifications(
          context.supabase,
          notificationMatch,
          context.profileId,
        );
        await queueMatchDiscordDeliveries(
          context.supabase,
          notificationMatch,
          "attendanceRefresh",
        );
      } catch (notificationError) {
        console.error("QR attendance notification reconciliation failed.", notificationError);
      }
      sendJson(response, 200, {
        ok: true,
        ...data,
        matchId,
        startStatus: getStartStatus(updatedMatch, attendanceState.entries),
        notificationState,
      });
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
      const updatedMatch = await loadMatch(context, matchId);
      const attendanceState = await syncAttendanceEntries(context, updatedMatch);
      try {
        await queueMatchDiscordDeliveries(
          context.supabase,
          toNotificationMatch(updatedMatch, attendanceState.roster),
          "sync",
        );
      } catch (notificationError) {
        console.error("Attendance resize notification reconciliation failed.", notificationError);
      }
      sendJson(response, 200, { ok: true, ...data, matchId });
      return;
    }

    const attendanceState = await syncAttendanceEntries(context, match);
    const summary = getAttendanceSummary(attendanceState.entries, match.mode);
    const requiresCleanup = MATCH_SIDES.some((side) => (
      Number(summary.bySide?.[side]?.pending || 0) > 0
    ));
    const startStatus = getStartStatus(match, attendanceState.entries);
    try {
      const notificationMatch = toNotificationMatch(match, attendanceState.roster);
      await reconcileMatchAttendanceNotifications(
        context.supabase,
        notificationMatch,
      );
      await queueMatchDiscordDeliveries(
        context.supabase,
        notificationMatch,
        "attendanceRefresh",
      );
    } catch (notificationError) {
      console.error("QR attendance notification reconciliation failed.", notificationError);
    }
    sendJson(response, 200, {
      ok: true,
      matchId,
      qr: startStatus.checkinOpen ? createMatchAttendanceQr(matchId, request) : null,
      summary,
      requiresCleanup,
      checkinOpen: startStatus.checkinOpen,
      startStatus,
      canResize: !match.started_at
        && !isTournamentMatch(match)
        && startStatus.checkinOpen
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
