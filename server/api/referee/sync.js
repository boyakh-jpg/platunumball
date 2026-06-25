import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const REFEREE_TRUST_MIN = 90;
const REFEREE_EXAM_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toPayloadRow(item = {}) {
  return {
    id: item.id,
    status: item.status || null,
    payload: item,
    created_at: item.createdAt || item.startedAt || new Date().toISOString(),
    updated_at: item.updatedAt || item.finishedAt || item.createdAt || item.startedAt || new Date().toISOString(),
  };
}

function toNotificationRows(notifications = [], profileId = "") {
  return toArray(notifications).map((notification) => {
    const targetUserId = notification.targetUserId || profileId;
    if (targetUserId !== profileId) return null;
    return {
      id: notification.id,
      user_id: profileId,
      target_user_id: targetUserId,
      title: notification.title || "심판 요청",
      body: notification.body || "",
      tone: notification.tone || "team",
      type: notification.type || "referee",
      match_id: notification.matchId || null,
      recruiting_post_id: notification.recruitingPostId || null,
      invitation_id: notification.invitationId || null,
      discord_event: notification.discordEvent || notification.eventType || null,
      read_at: notification.readAt || null,
      payload: notification,
      created_at: notification.createdAt || new Date().toISOString(),
      updated_at: notification.updatedAt || notification.createdAt || new Date().toISOString(),
    };
  }).filter((row) => row?.id);
}

async function getActorTrustScore(context) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("trust_score")
    .eq("id", context.profileId)
    .maybeSingle();
  if (error) throw error;
  return Number(data?.trust_score ?? 0);
}

function assertTrustScore(trustScore) {
  if (trustScore < REFEREE_TRUST_MIN) {
    const error = new Error("referee_trust_too_low");
    error.statusCode = 403;
    throw error;
  }
}

async function assertExamCooldownOpen(context) {
  const { data, error } = await context.supabase
    .from("referee_exam_attempts")
    .select("available_after")
    .eq("user_id", context.profileId)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const availableAfter = data?.[0]?.available_after ? new Date(data[0].available_after).getTime() : 0;
  if (Number.isFinite(availableAfter) && availableAfter > Date.now()) {
    const lockError = new Error("referee_exam_cooldown_active");
    lockError.statusCode = 400;
    throw lockError;
  }
}

function toExamAttemptRow(attempt = {}, profileId = "") {
  const id = String(attempt.id || "").trim();
  if (!id) {
    const error = new Error("missing_attempt_id");
    error.statusCode = 400;
    throw error;
  }
  const payload = {
    ...attempt,
    id,
    userId: profileId,
  };
  return {
    ...toPayloadRow(payload),
    id,
    user_id: profileId,
    status: ["started", "passed", "failed"].includes(payload.status) ? payload.status : "started",
    exam_version: payload.examVersion || null,
    started_at: payload.startedAt || payload.createdAt || new Date().toISOString(),
    finished_at: payload.finishedAt || null,
    available_after: payload.availableAfter || new Date(Date.now() + REFEREE_EXAM_COOLDOWN_MS).toISOString(),
  };
}

async function syncExamAttempt(context, action, attempt = {}) {
  const trustScore = await getActorTrustScore(context);
  assertTrustScore(trustScore);
  const row = toExamAttemptRow(attempt, context.profileId);
  const { data: existingAttempt, error: existingError } = await context.supabase
    .from("referee_exam_attempts")
    .select("id, user_id")
    .eq("id", row.id)
    .maybeSingle();
  if (existingError) throw existingError;

  if (action === "startExam") {
    if (existingAttempt?.user_id === context.profileId) return { ok: true, attemptId: row.id, duplicate: true };
    if (existingAttempt) {
      const error = new Error("exam_attempt_id_conflict");
      error.statusCode = 409;
      throw error;
    }
    await assertExamCooldownOpen(context);
  } else if (action === "finishExam") {
    if (existingAttempt?.user_id !== context.profileId) {
      const error = new Error("exam_attempt_permission_denied");
      error.statusCode = 403;
      throw error;
    }
    if (!["passed", "failed"].includes(row.status)) {
      const error = new Error("invalid_exam_finish_status");
      error.statusCode = 400;
      throw error;
    }
  }

  const { error } = await context.supabase
    .from("referee_exam_attempts")
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
  return { ok: true, attemptId: row.id };
}

async function assertPassedAttempt(context, request = {}) {
  if (request.qualification !== "community_exam") return;
  const attemptId = String(request.examAttemptId || "").trim();
  const examVersion = String(request.examVersion || "").trim();
  const { data, error } = await context.supabase
    .from("referee_exam_attempts")
    .select("id, payload")
    .eq("id", attemptId)
    .eq("user_id", context.profileId)
    .eq("status", "passed")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || (examVersion && data.payload?.examVersion !== examVersion)) {
    const requestError = new Error("passed_exam_attempt_required");
    requestError.statusCode = 400;
    throw requestError;
  }
}

function toRefereeRequestRow(request = {}, profileId = "", trustScore = 0) {
  const id = String(request.id || "").trim();
  if (!id) {
    const error = new Error("missing_referee_request_id");
    error.statusCode = 400;
    throw error;
  }
  const qualification = request.qualification === "official_license" ? "official_license" : "community_exam";
  const payload = {
    ...request,
    id,
    requestedBy: profileId,
    qualification,
    trustScore,
    status: "pending",
  };
  return {
    ...toPayloadRow(payload),
    id,
    requested_by: profileId,
    status: "pending",
    qualification,
    trust_score: trustScore,
  };
}

async function syncRefereeRequest(context, request = {}, notifications = []) {
  const trustScore = await getActorTrustScore(context);
  assertTrustScore(trustScore);
  const row = toRefereeRequestRow(request, context.profileId, trustScore);
  await assertPassedAttempt(context, row.payload);

  const { error: requestError } = await context.supabase
    .from("referee_requests")
    .upsert(row, { onConflict: "id" });
  if (requestError) throw requestError;

  const notificationRows = toNotificationRows(notifications, context.profileId);
  if (notificationRows.length) {
    const { error: notificationError } = await context.supabase
      .from("notifications")
      .upsert(notificationRows, { onConflict: "id" });
    if (notificationError) throw notificationError;
  }

  return { ok: true, requestId: row.id, notificationCount: notificationRows.length };
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
    const action = String(body.action || "").trim();
    const result = action === "startExam" || action === "finishExam"
      ? await syncExamAttempt(context, action, body.attempt)
      : action === "submitRequest"
        ? await syncRefereeRequest(context, body.request, body.notifications)
        : null;
    if (!result) {
      sendJson(response, 400, { error: "unsupported_referee_action" });
      return;
    }
    sendJson(response, 200, result);
  } catch (error) {
    console.error("Referee sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "referee_sync_failed" });
  }
}
