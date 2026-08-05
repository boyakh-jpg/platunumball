import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { FAVORITE_LIMIT, REFEREE_ACTIVE_TRUST_MIN, isRefereeGrade } from "../../../shared/lib/constants.js";

const TARGET_TYPES = new Set(["player", "team", "court", "referee"]);

function isActiveAppointment(appointment = {}, nowMs = Date.now()) {
  if (appointment.status && appointment.status !== "active") return false;
  const startsAt = appointment.starts_at ? new Date(appointment.starts_at).getTime() : 0;
  const endsAt = appointment.ends_at ? new Date(appointment.ends_at).getTime() : 0;
  return (!startsAt || startsAt <= nowMs) && (!endsAt || endsAt >= nowMs);
}

async function assertTargetExists(context, targetType, targetId) {
  if (targetType === "court") {
    const { data: approvedCourt, error: approvedCourtError } = await context.supabase
      .from("approved_courts")
      .select("id")
      .eq("id", targetId)
      .or("status.is.null,status.eq.active")
      .maybeSingle();
    if (approvedCourtError) throw approvedCourtError;
    if (approvedCourt?.id) return;

    const targetError = new Error("favorite_target_not_found");
    targetError.statusCode = 404;
    throw targetError;
  }

  const table = targetType === "player" || targetType === "referee" ? "profiles" : "teams";
  let query = context.supabase.from(table).select("id").eq("id", targetId);
  if (targetType === "referee") query = context.supabase.from(table).select("id, trust_score").eq("id", targetId);
  if (targetType === "team") query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    const targetError = new Error("favorite_target_not_found");
    targetError.statusCode = 404;
    throw targetError;
  }
  if (targetType === "referee") {
    if (Number(data.trust_score ?? 0) < REFEREE_ACTIVE_TRUST_MIN) {
      const targetError = new Error("favorite_target_not_found");
      targetError.statusCode = 404;
      throw targetError;
    }
    const { data: appointments, error: appointmentError } = await context.supabase
      .from("referee_appointments")
      .select("grade, status, starts_at, ends_at")
      .eq("user_id", targetId)
      .eq("role", "referee");
    if (appointmentError) throw appointmentError;
    const qualified = (appointments ?? []).some((appointment) => isRefereeGrade(appointment.grade) && isActiveAppointment(appointment));
    if (!qualified) {
      const targetError = new Error("favorite_target_not_found");
      targetError.statusCode = 404;
      throw targetError;
    }
  }
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const targetType = String(body.targetType || "").trim();
    const targetId = String(body.targetId || "").trim();
    const active = Boolean(body.active);
    if (!TARGET_TYPES.has(targetType) || !targetId) {
      sendJson(response, 400, { error: "invalid_favorite_target" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    if (active) {
      await assertTargetExists(context, targetType, targetId);
      const { count, error: countError } = await context.supabase
        .from("favorites")
        .select("target_id", { count: "exact", head: true })
        .eq("user_id", context.profileId)
        .eq("target_type", targetType)
        .neq("target_id", targetId);
      if (countError) throw countError;
      if ((count ?? 0) >= FAVORITE_LIMIT) {
        sendJson(response, 400, { error: "favorite_limit_exceeded", limit: FAVORITE_LIMIT, targetType });
        return;
      }
      const { error } = await context.supabase
        .from("favorites")
        .upsert({
          user_id: context.profileId,
          target_type: targetType,
          target_id: targetId,
        }, { onConflict: "user_id,target_type,target_id" });
      if (error) throw error;
    } else {
      const { error } = await context.supabase
        .from("favorites")
        .delete()
        .eq("user_id", context.profileId)
        .eq("target_type", targetType)
        .eq("target_id", targetId);
      if (error) throw error;
    }

    sendJson(response, 200, { ok: true, targetType, targetId, active });
  } catch (error) {
    console.error("Favorite sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "favorite_sync_failed" });
  }
}
