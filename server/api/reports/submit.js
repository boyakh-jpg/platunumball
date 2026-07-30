import { randomUUID } from "node:crypto";
import {
  flattenPlayerIdValues,
  projectPersistedMatchReportParticipantIds,
} from "../../../shared/lib/playerIds.js";
import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson, toArray } from "../_supabaseAdmin.js";
import { getMatchScheduledDate } from "../../../shared/lib/matchUtils.js";
import { REPORT_MATCH_WINDOW_MS } from "../../../shared/lib/constants.js";
import { VOID_MATCH_RESTORE_REPORT_REASON } from "../../../shared/lib/reportReasons.js";
import {
  uniqueStrings,
  assertCanSubmitCourtReport,
  assertCanSubmitCourtReviewReport,
  assertCanSubmitTeamEmblemReport,
  assertCanSubmitTeamNameReport,
  assertCanSubmitAffiliationNameReport,
} from "./submitCourtTeamPolicy.js";
export { normalizeCourtCorrection } from "./submitCourtTeamPolicy.js";


const ALLOWED_REPORT_TYPES = new Set(["match", "player", "court", "court_review", "team_emblem", "team_name", "affiliation_name"]);





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
  return toArray(notifications).slice(0, 3).map((notification) => {
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

export function isActiveReportInsertConflict(error = {}) {
  return error?.code === "23505" || String(error?.message || "").includes("active_report_duplicate");
}

async function assertCanSubmitMatchReport(context, targetId, reportedUserIds, reason = "") {
  const { data: match, error: matchError } = await context.supabase
    .from("matches")
    .select("id, status, created_by, referee_id, former_referee_id, stat_recorders, scheduled_at, scheduled_date, scheduled_time, confirmed_at, ended_at, created_at, reserve_players, played_player_ids, attendance, voided_at, void_reason, voided_by")
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
    ...flattenPlayerIdValues(match.stat_recorders),
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
  const isVoidRestoreRequest = String(reason).startsWith(VOID_MATCH_RESTORE_REPORT_REASON);
  if (isVoidRestoreRequest) {
    const restoreDetail = String(reason).slice(VOID_MATCH_RESTORE_REPORT_REASON.length).replace(/^\s*:\s*/, "").trim();
    if (restoreDetail.length < 10) {
      const error = new Error("void_restore_reason_length_invalid");
      error.statusCode = 400;
      throw error;
    }
  }
  const reportWindowOpen = isVoidRestoreRequest && match.voided_at
    ? Date.parse(match.voided_at) >= Date.now() - REPORT_MATCH_WINDOW_MS && Date.parse(match.voided_at) <= Date.now()
    : isReportWindowOpen(match);
  if (!reportWindowOpen) {
    const error = new Error("report_window_closed");
    error.statusCode = 400;
    throw error;
  }

  const allowedReportedIds = new Set([...participantIds]);
  for (const value of [match.stat_recorders, match.reserve_players, match.played_player_ids, match.attendance]) {
    uniqueStrings(flattenPlayerIdValues(value)).forEach((profileId) => allowedReportedIds.add(profileId));
  }
  if (isVoidRestoreRequest) {
    const voidedBy = String(match.voided_by || match.created_by || "").trim();
    if (match.status !== "void") {
      const error = new Error("void_match_required");
      error.statusCode = 400;
      throw error;
    }
    if (!voidedBy || voidedBy === context.profileId) {
      const error = new Error("void_restore_report_permission_denied");
      error.statusCode = 403;
      throw error;
    }
    return {
      reportedUserIds: [voidedBy],
      verifiedPayload: {
        matchReviewType: "void_restore",
        voidReason: match.void_reason || "",
        voidedBy,
        matchHostId: match.created_by || "",
        voidedAt: match.voided_at || null,
      },
    };
  }
  return {
    reportedUserIds: reportedUserIds.filter((profileId) => allowedReportedIds.has(profileId)),
    verifiedPayload: {},
  };
}

async function hasRecentSharedPlayerMatch(context, targetId, sourceMatchId) {
  const requestedMatchId = String(sourceMatchId ?? "").trim();
  if (!requestedMatchId) return false;
  const nowMs = Date.now();
  const { data: match, error: matchError } = await context.supabase
    .from("matches")
    .select("id, scheduled_at, scheduled_date, scheduled_time, confirmed_at, ended_at, created_at, reserve_players, played_player_ids, rules")
    .eq("id", requestedMatchId)
    .maybeSingle();
  if (matchError) throw matchError;
  if (!match || !isReportWindowOpen(match, nowMs)) return false;

  const { data: players, error: playerError } = await context.supabase
    .from("match_players")
    .select("match_id, user_id")
    .eq("match_id", requestedMatchId)
    .in("user_id", [context.profileId, targetId]);
  if (playerError) throw playerError;

  const playerIds = new Set(projectPersistedMatchReportParticipantIds(match, players ?? []));
  return playerIds.has(context.profileId) && playerIds.has(targetId) ? match.id : false;
}

async function assertCanSubmitPlayerReport(context, targetId, sourceMatchId) {
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
  const verifiedSourceMatchId = await hasRecentSharedPlayerMatch(context, targetId, sourceMatchId);
  if (!verifiedSourceMatchId) {
    const error = new Error("report_permission_denied");
    error.statusCode = 403;
    throw error;
  }
  return {
    reportedUserIds: [targetId],
    verifiedPayload: { sourceMatchId: verifiedSourceMatchId },
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
  let reason = String(report.reason || "기타 운영 확인 필요").trim().slice(0, 500) || "기타 운영 확인 필요";
  let reportedUserIds = [];
  let verifiedPayload = {};
  if (type === "match") {
    const verified = await assertCanSubmitMatchReport(context, targetId, rawReportedUserIds, reason);
    reportedUserIds = verified.reportedUserIds;
    verifiedPayload = verified.verifiedPayload;
  }
  if (type === "player") {
    const verified = await assertCanSubmitPlayerReport(context, targetId, report.sourceMatchId ?? report.payload?.sourceMatchId);
    reportedUserIds = verified.reportedUserIds;
    verifiedPayload = verified.verifiedPayload;
  }
  if (type === "court") {
    const verified = await assertCanSubmitCourtReport(context, targetId, report.courtCorrection);
    reportedUserIds = verified.reportedUserIds;
    verifiedPayload = verified.verifiedPayload;
    reason = verified.verifiedReason;
  }
  if (type === "court_review") reportedUserIds = await assertCanSubmitCourtReviewReport(context, targetId);
  if (type === "team_emblem") {
    const verified = await assertCanSubmitTeamEmblemReport(context, targetId);
    reportedUserIds = verified.reportedUserIds;
    verifiedPayload = verified.verifiedPayload;
  }
  if (type === "team_name") {
    const verified = await assertCanSubmitTeamNameReport(context, targetId);
    reportedUserIds = verified.reportedUserIds;
    verifiedPayload = verified.verifiedPayload;
  }
  if (type === "affiliation_name") {
    const verified = await assertCanSubmitAffiliationNameReport(context, targetId);
    reportedUserIds = verified.reportedUserIds;
    verifiedPayload = verified.verifiedPayload;
  }
  const now = new Date().toISOString();
  const createdAt = now;
  const id = String(report.id || `r_${randomUUID()}`).trim();
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
  if (!allowRequestMethod(request, response)) return;

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
      if (isActiveReportInsertConflict(reportError)) {
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
    let notificationSyncPending = false;
    if (notificationRows.length) {
      const { error: notificationError } = await context.supabase
        .from("notifications")
        .insert(notificationRows);
      if (notificationError) {
        notificationSyncPending = true;
        console.error("Report receipt notification insert failed.", notificationError);
      }
    }

    sendJson(response, 200, {
      ok: true,
      reportId: reportRow.id,
      notificationCount: notificationSyncPending ? 0 : notificationRows.length,
      notificationSyncPending,
    });
  } catch (error) {
    console.error("Report submit failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "report_submit_failed" });
  }
}
