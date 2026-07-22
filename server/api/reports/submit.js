import { randomUUID } from "node:crypto";
import { getAuthenticatedContext, readJsonBody, sendJson, toArray } from "../_supabaseAdmin.js";
import { getMatchScheduledDate } from "../../../src/lib/matchUtils.js";
import { REPORT_MATCH_WINDOW_MS } from "../../../src/lib/constants.js";
import { VOID_MATCH_RESTORE_REPORT_REASON } from "../../../src/lib/reportReasons.js";

const ALLOWED_REPORT_TYPES = new Set(["match", "player", "court", "court_review", "team_emblem", "team_name", "affiliation_name"]);
const COURT_CORRECTION_FIELDS = new Map([
  ["name", "시설명"],
  ["location", "위치·주소"],
  ["access", "공개·이용 방식"],
  ["operation", "운영·폐쇄 상태"],
  ["court", "코트 유형·시설"],
  ["contact", "연락처·예약 URL"],
  ["duplicate", "중복 구장"],
  ["other", "기타"],
]);

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
    uniqueStrings(flattenProfileValues(value)).forEach((profileId) => allowedReportedIds.add(profileId));
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

  const playerIds = getMatchPlayerIds(match, players ?? []);
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

export function normalizeCourtCorrection(value = {}) {
  const field = String(value?.field || "").trim();
  const proposedValue = String(value?.proposedValue || "").trim();
  const evidenceUrl = String(value?.evidenceUrl || "").trim();
  if (!COURT_CORRECTION_FIELDS.has(field) || proposedValue.length < 4 || proposedValue.length > 500) {
    const error = new Error("invalid_court_correction");
    error.statusCode = 400;
    throw error;
  }
  if (evidenceUrl) {
    try {
      const parsed = new URL(evidenceUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || evidenceUrl.length > 1000) throw new Error("invalid");
    } catch {
      const error = new Error("invalid_court_correction_url");
      error.statusCode = 400;
      throw error;
    }
  }
  return { field, proposedValue, evidenceUrl: evidenceUrl || null };
}

async function assertCanSubmitCourtReport(context, targetId, rawCorrection) {
  const correction = normalizeCourtCorrection(rawCorrection);
  const { data: court, error: courtError } = await context.supabase
    .from("approved_courts")
    .select("id, source_request_id, status, name, address_text, road_address, jibun_address, public_access, access_type, operational_status, indoor_outdoor, court_kind, surface_type, court_layout, hoop_count, paid, lighting")
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

  let requestedBy = null;
  if (court.source_request_id) {
    const { data: request, error: requestError } = await context.supabase
      .from("court_requests")
      .select("requested_by")
      .eq("id", court.source_request_id)
      .maybeSingle();
    if (requestError) throw requestError;
    requestedBy = request?.requested_by ?? null;
  }
  return {
    reportedUserIds: requestedBy && requestedBy !== context.profileId ? [requestedBy] : [],
    verifiedReason: `${COURT_CORRECTION_FIELDS.get(correction.field)} 수정 요청: ${correction.proposedValue}`.slice(0, 500),
    verifiedPayload: {
      courtCorrection: {
        ...correction,
        current: {
          name: court.name,
          addressText: court.address_text,
          roadAddress: court.road_address,
          jibunAddress: court.jibun_address,
          publicAccess: court.public_access,
          accessType: court.access_type,
          operationalStatus: court.operational_status,
          indoorOutdoor: court.indoor_outdoor,
          courtKind: court.court_kind,
          surfaceType: court.surface_type,
          courtLayout: court.court_layout,
          hoopCount: court.hoop_count,
          paid: court.paid,
          lighting: court.lighting,
        },
      },
    },
  };
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

async function assertCanSubmitTeamNameReport(context, targetId) {
  const [{ data: team, error: teamError }, { data: captain, error: captainError }] = await Promise.all([
    context.supabase
      .from("teams")
      .select("id,name,deleted_at")
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
  return {
    reportedUserIds: captain?.user_id ? [captain.user_id] : [],
    verifiedPayload: { teamName: team.name, captainId: captain?.user_id ?? null },
  };
}

async function assertCanSubmitAffiliationNameReport(context, targetId) {
  const { data: affiliation, error: affiliationError } = await context.supabase
    .from("affiliations")
    .select("id,name,type,status,created_by,member_count")
    .eq("id", targetId)
    .eq("type", "organization")
    .eq("status", "active")
    .maybeSingle();
  if (affiliationError) throw affiliationError;
  if (!affiliation?.id) {
    const error = new Error("affiliation_not_found");
    error.statusCode = 404;
    throw error;
  }
  return {
    reportedUserIds: affiliation.created_by ? [affiliation.created_by] : [],
    verifiedPayload: {
      affiliationName: affiliation.name,
      affiliationCreatedBy: affiliation.created_by,
      affiliationMemberCount: Number(affiliation.member_count ?? 0),
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
        ["match", "player", "team_emblem", "team_name", "affiliation_name"].includes(reportRow.type)
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
