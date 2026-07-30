import { allowRequestMethod, readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";
import { deleteObject, getR2Config } from "../teams/emblem.js";
import { HIGH_IMPACT_ADMIN_REVIEW_ACTIONS } from "../../../shared/lib/adminReview.js";

const HIGH_IMPACT_ACTIONS = new Set(HIGH_IMPACT_ADMIN_REVIEW_ACTIONS);
const ALLOWED_ACTIONS = new Set([
  "validReport",
  "dismissReport",
  ...HIGH_IMPACT_ACTIONS,
]);
const ADMIN_REVIEW_TEXT_MAX_LENGTH = 500;

function makeHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function normalizeAdminReviewInput(body = {}) {
  const actionType = String(body.actionType ?? "validReport").trim();
  const reason = String(body.reason ?? "").trim();
  const feedback = String(body.feedback ?? "").trim();
  if (!ALLOWED_ACTIONS.has(actionType)) throw makeHttpError("invalid_admin_review_action", 400);
  if (
    reason.length < 4
    || feedback.length < 4
    || reason.length > ADMIN_REVIEW_TEXT_MAX_LENGTH
    || feedback.length > ADMIN_REVIEW_TEXT_MAX_LENGTH
  ) {
    throw makeHttpError("admin_review_detail_invalid", 400);
  }
  return { actionType, reason, feedback };
}

export function getAdminReviewErrorStatus(error = {}) {
  if (error?.code === "42501") return 403;
  if (error?.code === "P0002") return 404;
  if (error?.code === "23505" || error?.message === "team_emblem_report_stale") return 409;
  if (["22001", "22023", "23502"].includes(error?.code)) return 400;
  return 500;
}

function mapAdminReviewError(error, fallback) {
  const mapped = new Error(error?.message || fallback);
  mapped.statusCode = getAdminReviewErrorStatus(error);
  return mapped;
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const context = await requireAdminContext(request);
    const adminLevel = context.adminLevel;
    const body = await readJsonBody(request);
    const reportId = String(body.reportId ?? "").trim();
    if (!reportId) {
      sendJson(response, 400, { error: "missing_report_id" });
      return;
    }

    const { actionType, reason, feedback } = normalizeAdminReviewInput(body);
    if (HIGH_IMPACT_ACTIONS.has(actionType) && adminLevel < 50) throw makeHttpError("admin_discipline_permission_required", 403);

    if (["suspendTarget", "refereeDiscipline"].includes(actionType)) {
      const targetUserId = String(body.targetUserId ?? "").trim();
      const { data: report, error: reportError } = await context.supabase
        .from("reports")
        .select("type, target_id, reported_user_ids")
        .eq("id", reportId)
        .maybeSingle();
      if (reportError) throw reportError;
      if (!report) throw makeHttpError("report_not_found", 404);
      const verifiedTargetIds = Array.isArray(report.reported_user_ids) ? report.reported_user_ids.map(String) : [];
      if (!targetUserId || !verifiedTargetIds.includes(targetUserId)) throw makeHttpError("report_target_mismatch", 400);
      if (actionType === "refereeDiscipline") {
        if (report.type !== "match") throw makeHttpError("match_report_required", 400);
        const { data: match, error: matchError } = await context.supabase
          .from("matches")
          .select("referee_id, former_referee_id")
          .eq("id", report.target_id)
          .maybeSingle();
        if (matchError) throw matchError;
        if (![match?.referee_id, match?.former_referee_id].filter(Boolean).includes(targetUserId)) {
          throw makeHttpError("referee_target_mismatch", 400);
        }
      }
    }
    if (["keepMatchVoid", "restoreMatchHalf", "restoreMatchFull"].includes(actionType)) {
      const { data, error } = await context.supabase.rpc("rankball_review_void_match_report", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_report_id: reportId,
        p_action_type: actionType,
        p_penalty_type: String(body.penaltyType ?? ""),
        p_target_user_id: String(body.targetUserId ?? ""),
        p_duration_days: Number(body.durationDays ?? 3),
        p_reason: reason,
        p_feedback: feedback,
      });
      if (error) {
        throw mapAdminReviewError(error, "void_match_review_failed");
      }
      sendJson(response, 200, data ?? { ok: true });
      return;
    }
    if (actionType === "markCourtDuplicate") {
      const { data, error } = await context.supabase.rpc("rankball_resolve_duplicate_court_report", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_report_id: reportId,
        p_reason: reason,
        p_feedback: feedback,
      });
      if (error) {
        throw mapAdminReviewError(error, "duplicate_court_report_resolution_failed");
      }
      sendJson(response, 200, data ?? { ok: true, actionType });
      return;
    }
    if (actionType === "applyCourtCorrection") {
      const { data, error } = await context.supabase.rpc("rankball_apply_court_correction_report", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_report_id: reportId,
        p_reason: reason,
        p_feedback: feedback,
      });
      if (error) {
        throw mapAdminReviewError(error, "court_correction_apply_failed");
      }
      sendJson(response, 200, data ?? { ok: true, actionType });
      return;
    }
    if (actionType === "resetTeamEmblem") {
      const { data, error } = await context.supabase.rpc("rankball_moderate_team_emblem_guarded", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_report_id: reportId,
        p_reason: reason,
        p_feedback: feedback,
      });
      if (error) {
        throw mapAdminReviewError(error, "team_emblem_moderation_failed");
      }

      let storageCleanupPending = false;
      if (data?.previousEmblemKey) {
        try {
          await deleteObject(getR2Config(), data.previousEmblemKey);
        } catch {
          storageCleanupPending = true;
        }
      }
      sendJson(response, 200, { ...(data ?? { ok: true }), storageCleanupPending });
      return;
    }
    if (["renameTeam", "renameAffiliation", "mergeAffiliation"].includes(actionType)) {
      const { data, error } = await context.supabase.rpc("rankball_moderate_reported_name", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_report_id: reportId,
        p_action_type: actionType,
        p_replacement_name: String(body.replacementName ?? ""),
        p_merge_target_id: String(body.mergeTargetId ?? ""),
        p_reason: reason,
        p_feedback: feedback,
      });
      if (error) {
        throw mapAdminReviewError(error, "name_moderation_failed");
      }
      sendJson(response, 200, data ?? { ok: true });
      return;
    }
    const { data, error } = await context.supabase.rpc("rankball_commit_admin_review_action", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_report_id: reportId,
      p_action_type: actionType,
      p_target_user_id: String(body.targetUserId ?? ""),
      p_duration_days: Number(body.durationDays ?? 3),
      p_reason: reason,
      p_feedback: feedback,
    });

    if (error) throw mapAdminReviewError(error, "admin_review_action_failed");

    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin review action failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "admin_review_action_failed" });
  }
}
