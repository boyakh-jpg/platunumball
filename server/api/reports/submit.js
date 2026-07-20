import { randomUUID } from "node:crypto";
import { getAuthenticatedContext, readJsonBody, sendJson, toArray } from "../_supabaseAdmin.js";
import { getMatchScheduledDate } from "../../../src/lib/matchUtils.js";

const REPORT_MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REPORT_MATCH_QUERY_PAGE_SIZE = 200;
const ALLOWED_REPORT_TYPES = new Set(["match", "player", "court", "court_review", "team_emblem"]);

function uniqueStrings(values) {
  return Array.from(new Set(toArray(values).map((value) => String(value).trim()).filter(Boolean)));
}

function includesProfile(value, profileId) {
  if (!profileId || value == null) return false;
  if (Array.isArray(value)) return value.some((item) => includesProfile(item, profileId));
  if (typeof value === "object") return Object.values(value).some((item) => includesProfile(item, profileId));
  return String(value) === profileId;
}

function getReportableMatchTimeMs(match = {}) {
  if (match.ended_at) return new Date(match.ended_at).getTime();
  if (match.confirmed_at) return new Date(match.confirmed_at).getTime();
  if (match.scheduled_date || match.scheduled_at) return getMatchScheduledDate({
    scheduledDate: match.scheduled_date,
    scheduledTime: match.scheduled_time ? String(match.scheduled_time).slice(0, 5) : "00:00",
    scheduledAt: match.scheduled_at,
  })?.getTime() ?? 0;
  if (match.created_at) return new Date(match.created_at).getTime();
  return 0;
}

function isReportWindowOpen(match = {}, nowMs = Date.now()) {
  const reportTime = getReportableMatchTimeMs(match);
  return Number.isFinite(reportTime) && reportTime >= nowMs - REPORT_MATCH_WINDOW_MS && reportTime <= nowMs;
}

function toNotificationRows(notifications = [], profileId = "", report = {}) {
  return toArray(notifications).map((notification) => {
    const targetUserId = notification.targetUserId || profileId;
    if (targetUserId !== profileId) return null;
    return {
      id: notification.id,
      user_id: profileId,
      target_user_id: targetUserId,
      title: notification.title || "신고 접수",
      body: notification.body || "",
      tone: notification.tone || "match",
      type: notification.type || "report",
      match_id: notification.matchId || (report.type === "match" ? report.targetId : null),
      recruiting_post_id: notification.recruitingPostId || null,
      invitation_id: notification.invitationId || null,
      discord_event: notification.discordEvent || notification.eventType || null,
      read_at: notification.readAt || null,
      payload: notification,
      created_at: notification.createdAt || report.createdAt || new Date().toISOString(),
      updated_at: notification.updatedAt || notification.createdAt || report.createdAt || new Date().toISOString(),
    };
  }).filter((row) => row?.id);
}

async function assertCanSubmitMatchReport(context, targetId, reportedUserIds) {
  const { data: match, error: matchError } = await context.supabase
    .from("matches")
    .select("id, created_by, referee_id, former_referee_id, stat_recorders, scheduled_at, scheduled_date, scheduled_time, confirmed_at, ended_at, created_at, reserve_players, played_player_ids, attendance")
    .eq("id", targetId)
    .maybeSingle();
  if (matchError) throw matchError;
  if (!match) {
    const error = new Error("match_not_found");
    error.statusCode = 404;
    throw error;
  }

  const { data: players, error: playerError } = await context.supabase
    .from("match_players")
    .select("user_id")
    .eq("match_id", targetId);
  if (playerError) throw playerError;

  const participantIds = new Set([
    match.created_by,
    match.referee_id,
    match.former_referee_id,
    ...flattenProfileValues(match.stat_recorders),
    ...(players ?? []).map((player) => player.user_id),
  ].filter(Boolean));
  const actorInJson = includesProfile(match.reserve_players, context.profileId)
    || includesProfile(match.played_player_ids, context.profileId)
    || includesProfile(match.attendance, context.profileId);
  if (!participantIds.has(context.profileId) && !actorInJson) {
    const error = new Error("report_permission_denied");
    error.statusCode = 403;
    throw error;
  }
  if (!isReportWindowOpen(match)) {
    const error = new Error("report_window_closed");
    error.statusCode = 400;
    throw error;
  }

  const allowedReportedIds = new Set([...participantIds]);
  for (const value of [match.stat_recorders, match.reserve_players, match.played_player_ids, match.attendance]) {
    uniqueStrings(flattenProfileValues(value)).forEach((profileId) => allowedReportedIds.add(profileId));
  }
  return reportedUserIds.filter((profileId) => allowedReportedIds.has(profileId));
}

function flattenProfileValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenProfileValues);
  if (typeof value === "object") return Object.values(value).flatMap(flattenProfileValues);
  return [String(value)];
}

function getMatchPlayerIds(match = {}, playerRows = []) {
  return new Set(uniqueStrings([
    ...playerRows.map((player) => player.user_id),
    ...flattenProfileValues(match.reserve_players),
    ...flattenProfileValues(match.played_player_ids),
    ...flattenProfileValues(match.rules?.reservePlayers),
    ...flattenProfileValues(match.rules?.playedPlayerIds),
  ]));
}

async function hasRecentSharedPlayerMatch(context, targetId) {
  const nowMs = Date.now();
  const cutoffIso = new Date(nowMs - REPORT_MATCH_WINDOW_MS).toISOString();
  const cutoffDate = cutoffIso.slice(0, 10);
  const recentMatchFilter = [
    `ended_at.gte.${cutoffIso}`,
    `confirmed_at.gte.${cutoffIso}`,
    `scheduled_at.gte.${cutoffIso}`,
    `scheduled_date.gte.${cutoffDate}`,
    `created_at.gte.${cutoffIso}`,
  ].join(",");

  for (let offset = 0; ; offset += REPORT_MATCH_QUERY_PAGE_SIZE) {
    const { data: matches, error: matchError } = await context.supabase
      .from("matches")
      .select("id, scheduled_at, scheduled_date, scheduled_time, confirmed_at, ended_at, created_at, reserve_players, played_player_ids, rules")
      .or(recentMatchFilter)
      .order("id", { ascending: true })
      .range(offset, offset + REPORT_MATCH_QUERY_PAGE_SIZE - 1);
    if (matchError) throw matchError;

    const matchRows = matches ?? [];
    const reportableMatches = matchRows.filter((match) => isReportWindowOpen(match, nowMs));
    const matchIds = reportableMatches.map((match) => match.id).filter(Boolean);
    if (matchIds.length) {
      const { data: players, error: playerError } = await context.supabase
        .from("match_players")
        .select("match_id, user_id")
        .in("match_id", matchIds)
        .in("user_id", [context.profileId, targetId]);
      if (playerError) throw playerError;

      const playerRowsByMatch = new Map();
      for (const player of players ?? []) {
        const rows = playerRowsByMatch.get(player.match_id) ?? [];
        rows.push(player);
        playerRowsByMatch.set(player.match_id, rows);
      }
      for (const match of reportableMatches) {
        const playerIds = getMatchPlayerIds(match, playerRowsByMatch.get(match.id));
        if (playerIds.has(context.profileId) && playerIds.has(targetId)) return true;
      }
    }

    if (matchRows.length < REPORT_MATCH_QUERY_PAGE_SIZE) return false;
  }
}

async function assertCanSubmitPlayerReport(context, targetId) {
  if (targetId === context.profileId) {
    const error = new Error("cannot_report_self");
    error.statusCode = 400;
    throw error;
  }
  const { data: profile, error: profileError } = await context.supabase
    .from("profiles")
    .select("id")
    .eq("id", targetId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    const error = new Error("profile_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (!await hasRecentSharedPlayerMatch(context, targetId)) {
    const error = new Error("report_permission_denied");
    error.statusCode = 403;
    throw error;
  }
  return [targetId];
}

async function assertCanSubmitCourtReport(context, targetId) {
  const { data: court, error: courtError } = await context.supabase
    .from("approved_courts")
    .select("id, source_request_id, status")
    .eq("id", targetId)
    .maybeSingle();
  if (courtError) throw courtError;
  if (!court) {
    const error = new Error("court_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (court.status && court.status !== "active") {
    const error = new Error("court_hidden");
    error.statusCode = 400;
    throw error;
  }

  if (!court.source_request_id) return [];
  const { data: request, error: requestError } = await context.supabase
    .from("court_requests")
    .select("requested_by")
    .eq("id", court.source_request_id)
    .maybeSingle();
  if (requestError) throw requestError;
  return request?.requested_by && request.requested_by !== context.profileId ? [request.requested_by] : [];
}

async function assertCanSubmitCourtReviewReport(context, targetId) {
  const { data: review, error: reviewError } = await context.supabase
    .from("court_reviews")
    .select("id, reviewer_id, status")
    .eq("id", targetId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (!review) {
    const error = new Error("court_review_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (review.status && review.status !== "active") {
    const error = new Error("court_review_hidden");
    error.statusCode = 400;
    throw error;
  }
  if (review.reviewer_id === context.profileId) {
    const error = new Error("cannot_report_self");
    error.statusCode = 400;
    throw error;
  }
  return [review.reviewer_id].filter(Boolean);
}

async function assertCanSubmitTeamEmblemReport(context, targetId) {
  const [{ data: team, error: teamError }, { data: captain, error: captainError }] = await Promise.all([
    context.supabase
      .from("teams")
      .select("id,name,emblem_key,emblem_source,emblem_updated_at,deleted_at")
      .eq("id", targetId)
      .is("deleted_at", null)
      .maybeSingle(),
    context.supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", targetId)
      .eq("role", "captain")
      .limit(1)
      .maybeSingle(),
  ]);
  if (teamError) throw teamError;
  if (captainError) throw captainError;
  if (!team?.id) {
    const error = new Error("team_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (!captain?.user_id) {
    const error = new Error("team_captain_not_found");
    error.statusCode = 404;
    throw error;
  }
  if (captain.user_id === context.profileId) {
    const error = new Error("cannot_report_own_team_emblem");
    error.statusCode = 400;
    throw error;
  }
  if (team.emblem_source !== "upload" || !team.emblem_key) {
    const error = new Error("team_emblem_not_reportable");
    error.statusCode = 400;
    throw error;
  }
  return {
    reportedUserIds: [captain.user_id],
    verifiedPayload: {
      teamName: team.name,
      captainId: captain.user_id,
      emblemKey: team.emblem_key,
      emblemSource: team.emblem_source,
      emblemUpdatedAt: team.emblem_updated_at,
    },
  };
}

async function buildReportRow(context, report = {}) {
  const type = String(report.type || "").trim();
  const targetId = String(report.targetId || report.target_id || "").trim();
  if (!ALLOWED_REPORT_TYPES.has(type)) {
    const error = new Error("unsupported_report_type");
    error.statusCode = 400;
    throw error;
  }
  if (!targetId) {
    const error = new Error("missing_report_target");
    error.statusCode = 400;
    throw error;
  }

  const rawReportedUserIds = uniqueStrings(report.reportedUserIds || report.reported_user_ids);
  let reportedUserIds = [];
  let verifiedPayload = {};
  if (type === "match") reportedUserIds = await assertCanSubmitMatchReport(context, targetId, rawReportedUserIds);
  if (type === "player") reportedUserIds = await assertCanSubmitPlayerReport(context, targetId);
  if (type === "court") reportedUserIds = await assertCanSubmitCourtReport(context, targetId);
  if (type === "court_review") reportedUserIds = await assertCanSubmitCourtReviewReport(context, targetId);
  if (type === "team_emblem") {
    const verified = await assertCanSubmitTeamEmblemReport(context, targetId);
    reportedUserIds = verified.reportedUserIds;
    verifiedPayload = verified.verifiedPayload;
  }
  const now = new Date().toISOString();
  const createdAt = now;
  const id = String(report.id || `r_${randomUUID()}`).trim();
  const reason = String(report.reason || "기타 운영 확인 필요").trim().slice(0, 500) || "기타 운영 확인 필요";
  return {
    id,
    type,
    target_id: targetId,
    user_id: context.profileId,
    reported_user_ids: reportedUserIds,
    reason,
    status: "open",
    resolved_at: null,
    resolved_by: null,
    resolution: null,
    payload: {
      ...report,
      ...verifiedPayload,
      id,
      type,
      targetId,
      by: context.profileId,
      reportedUserIds,
      reason,
      status: "open",
      createdAt,
    },
    created_at: createdAt,
    updated_at: now,
  };
}

async function getActiveReport(context, reportRow) {
  const { data, error } = await context.supabase
    .from("reports")
    .select("id, status")
    .eq("type", reportRow.type)
    .eq("target_id", reportRow.target_id)
    .eq("user_id", context.profileId)
    .neq("status", "resolved")
    .neq("status", "dismissed")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const report = body.report && typeof body.report === "object" ? body.report : {};
    const context = await getAuthenticatedContext(request);
    const reportRow = await buildReportRow(context, report);

    const existingReport = await getActiveReport(context, reportRow);
    if (existingReport) {
      sendJson(response, 200, {
        ok: true,
        duplicate: true,
        reportId: existingReport.id,
        status: existingReport.status,
      });
      return;
    }

    const { error: reportError } = await context.supabase.from("reports").insert(reportRow);
    if (reportError) {
      if (
        ["match", "player", "team_emblem"].includes(reportRow.type)
        && String(reportError.message || "").includes("active_report_duplicate")
      ) {
        const concurrentReport = await getActiveReport(context, reportRow);
        if (concurrentReport) {
          sendJson(response, 200, {
            ok: true,
            duplicate: true,
            reportId: concurrentReport.id,
            status: concurrentReport.status,
          });
          return;
        }
      }
      throw reportError;
    }

    const notificationRows = toNotificationRows(body.notifications, context.profileId, reportRow.payload);
    if (notificationRows.length) {
      const { error: notificationError } = await context.supabase
        .from("notifications")
        .upsert(notificationRows, { onConflict: "id" });
      if (notificationError) throw notificationError;
    }

    sendJson(response, 200, { ok: true, reportId: reportRow.id, notificationCount: notificationRows.length });
  } catch (error) {
    console.error("Report submit failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "report_submit_failed" });
  }
}
