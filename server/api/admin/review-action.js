import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { deleteObject, getR2Config } from "../teams/emblem.js";

const HIGH_IMPACT_ACTIONS = new Set([
  "maliciousReporter",
  "suspendTarget",
  "refereeDiscipline",
  "hideCourt",
  "hideCourtReview",
  "resetTeamEmblem",
  "renameTeam",
  "renameAffiliation",
  "mergeAffiliation",
  "keepMatchVoid",
  "restoreMatchHalf",
  "restoreMatchFull",
]);

function makeHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const reportId = String(body.reportId ?? "").trim();
    if (!reportId) {
      sendJson(response, 400, { error: "missing_report_id" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const adminLevel = await getAdminLevel(context);
    const actionType = String(body.actionType ?? "validReport");
    const reason = String(body.reason ?? "").trim();
    const feedback = String(body.feedback ?? "").trim();
    if (reason.length < 4 || feedback.length < 4) throw makeHttpError("admin_review_detail_required", 400);
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
        const mapped = new Error(error.message || "void_match_review_failed");
        mapped.statusCode = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "23505" ? 409 : 400;
        throw mapped;
      }
      sendJson(response, 200, data ?? { ok: true });
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
        const mapped = new Error(error.message || "team_emblem_moderation_failed");
        mapped.statusCode = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "23505" || error.message === "team_emblem_report_stale" ? 409 : 400;
        throw mapped;
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
        const mapped = new Error(error.message || "name_moderation_failed");
        mapped.statusCode = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "23505" ? 409 : 400;
        throw mapped;
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

    if (error) throw error;

    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin review action failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "admin_review_action_failed" });
  }
}
