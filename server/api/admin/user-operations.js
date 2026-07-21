import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  normalizeAdminUserOperationAction,
  normalizeAdminUserOperationDuration,
  validateAdminUserOperationDraft,
} from "../../../src/lib/adminUserOperations.js";
import { normalizeDirectoryFilter } from "../../../src/lib/queryPolicy.js";

const ADMIN_USER_PAGE_LIMIT = 30;
const ADMIN_USER_MAX_PAGE_LIMIT = 60;
const ADMIN_USER_MAX_OFFSET = 10_000;

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function getEnvIdSet(name) {
  return new Set(String(process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
}

async function isConfiguredOwner(context, targetUserId) {
  if (getEnvIdSet("RANKBALL_OWNER_PROFILE_IDS").has(targetUserId)) return true;
  const ownerAuthIds = getEnvIdSet("RANKBALL_OWNER_AUTH_USER_IDS");
  if (!ownerAuthIds.size) return false;
  const { data, error } = await context.supabase
    .from("profiles")
    .select("auth_user_id")
    .eq("id", targetUserId)
    .maybeSingle();
  if (error) throw error;
  return ownerAuthIds.has(String(data?.auth_user_id ?? ""));
}

function getErrorStatus(error) {
  const message = String(error?.message ?? "");
  if (/profile_not_found/i.test(message)) return 404;
  if (/admin_permission_required|admin_target_protected|owner_target_protected|self_admin_action_denied/i.test(message)) return 403;
  if (/required|invalid|unsupported/i.test(message)) return 400;
  return error?.statusCode || 500;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request);
    const adminLevel = await getAdminLevel(context);
    if (adminLevel < 50) {
      sendJson(response, 403, { error: "admin_permission_required" });
      return;
    }

    const operation = String(body.operation ?? body.action ?? "load").trim();
    if (operation === "load") {
      const limit = clampInteger(body.limit, ADMIN_USER_PAGE_LIMIT, 1, ADMIN_USER_MAX_PAGE_LIMIT);
      const offset = clampInteger(body.offset, 0, 0, ADMIN_USER_MAX_OFFSET);
      const search = normalizeDirectoryFilter(body.search ?? body.filter ?? "");
      const { data, error } = await context.supabase.rpc("rankball_admin_user_operations", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_limit: limit,
        p_offset: offset,
        p_search: search,
        p_risk_only: body.riskOnly !== false,
      });
      if (error) throw error;
      sendJson(response, 200, data ?? { ok: true, rows: [] });
      return;
    }

    if (operation !== "commit") {
      sendJson(response, 400, { error: "unsupported_admin_user_operation" });
      return;
    }

    const targetUserId = String(body.targetUserId ?? body.userId ?? "").trim();
    const rawActionType = String(body.actionType ?? "").trim();
    const rawDurationDays = Number(body.durationDays);
    const reason = String(body.reason ?? "").trim();
    const message = String(body.message ?? "").trim();
    const validationError = validateAdminUserOperationDraft({
      targetUserId,
      actionType: rawActionType,
      durationDays: rawDurationDays,
      reason,
      message,
    });
    if (validationError) {
      sendJson(response, 400, { error: "invalid_admin_user_operation", message: validationError });
      return;
    }
    const actionType = normalizeAdminUserOperationAction(rawActionType);
    const durationDays = normalizeAdminUserOperationDuration(rawDurationDays);
    if (await isConfiguredOwner(context, targetUserId)) {
      sendJson(response, 403, { error: "owner_target_protected" });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_commit_admin_manual_user_action", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_target_user_id: targetUserId,
      p_action_type: actionType,
      p_duration_days: durationDays,
      p_reason: reason,
      p_message: message,
    });
    if (error) throw error;
    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin user operation failed.", error);
    sendJson(response, getErrorStatus(error), { error: error.message || "admin_user_operation_failed" });
  }
}
