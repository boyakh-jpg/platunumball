import { getAuthenticatedContext, readJsonBody, sendJson, toNotificationRows } from "../_supabaseAdmin.js";
import { REFEREE_EXAM_COOLDOWN_MS, REFEREE_TRUST_MIN } from "../../../shared/lib/constants.js";
import {
  REFEREE_EXAM_BANK_SIZE,
  REFEREE_EXAM_PASS_SCORE,
  REFEREE_EXAM_SIZE,
  REFEREE_EXAM_VERSION,
  createRefereeExamSet,
  gradeRefereeExamByQuestionIds,
} from "../../../shared/lib/refereeExamBank.js";

function toPayloadRow(item = {}) {
  return {
    id: item.id,
    status: item.status || null,
    payload: item,
    created_at: item.createdAt || item.startedAt || new Date().toISOString(),
    updated_at: item.updatedAt || item.finishedAt || item.createdAt || item.startedAt || new Date().toISOString(),
  };
}

function sanitizeExamAnswers(answers = {}) {
  return Object.fromEntries(
    Object.entries(answers && typeof answers === "object" ? answers : {})
      .map(([questionId, answerIndex]) => [String(questionId), Number(answerIndex)])
      .filter(([questionId, answerIndex]) => questionId && Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex <= 3),
  );
}

function getAttemptId(attempt = {}) {
  const id = String(attempt.id || "").trim();
  if (!id) {
    const error = new Error("missing_attempt_id");
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function toClientAttempt(payload = {}) {
  return payload;
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

function toExamAttemptRow(payload = {}, profileId = "") {
  const id = getAttemptId(payload);
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
  const attemptId = getAttemptId(attempt);
  const { data: existingAttempt, error: existingError } = await context.supabase
    .from("referee_exam_attempts")
    .select("id, user_id, status, payload")
    .eq("id", attemptId)
    .maybeSingle();
  if (existingError) throw existingError;

  if (action === "startExam") {
    if (existingAttempt?.user_id === context.profileId) {
      return { ok: true, attemptId, attempt: toClientAttempt(existingAttempt.payload), duplicate: true };
    }
    if (existingAttempt) {
      const error = new Error("exam_attempt_id_conflict");
      error.statusCode = 409;
      throw error;
    }
    await assertExamCooldownOpen(context);

    const now = new Date();
    const seed = `${now.toISOString()}-${context.profileId}-${attemptId}-${Math.random()}`;
    const examSet = createRefereeExamSet(seed, REFEREE_EXAM_SIZE);
    const payload = {
      id: attemptId,
      userId: context.profileId,
      status: "started",
      examVersion: REFEREE_EXAM_VERSION,
      bankSize: REFEREE_EXAM_BANK_SIZE,
      passScore: REFEREE_EXAM_PASS_SCORE,
      total: REFEREE_EXAM_SIZE,
      questionIds: examSet.questionIds,
      questions: examSet.questions,
      startedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      availableAfter: new Date(now.getTime() + REFEREE_EXAM_COOLDOWN_MS).toISOString(),
    };
    const row = toExamAttemptRow(payload, context.profileId);
    const { error } = await context.supabase
      .from("referee_exam_attempts")
      .upsert(row, { onConflict: "id" });
    if (error) {
      if (String(error.message || "").includes("referee_exam_cooldown_active")) {
        error.statusCode = 400;
      }
      throw error;
    }
    return { ok: true, attemptId, attempt: toClientAttempt(payload) };
  }

  if (existingAttempt?.user_id !== context.profileId) {
    const error = new Error("exam_attempt_permission_denied");
    error.statusCode = 403;
    throw error;
  }
  if (["passed", "failed"].includes(existingAttempt?.status) && existingAttempt?.payload?.result) {
    return { ok: true, attemptId, attempt: toClientAttempt(existingAttempt.payload), result: existingAttempt.payload.result, duplicate: true };
  }

  const questionIds = Array.isArray(existingAttempt?.payload?.questionIds) ? existingAttempt.payload.questionIds : [];
  if (questionIds.length !== REFEREE_EXAM_SIZE) {
    const error = new Error("invalid_exam_question_set");
    error.statusCode = 400;
    throw error;
  }
  const answers = sanitizeExamAnswers(attempt.answers);
  const result = gradeRefereeExamByQuestionIds(questionIds, answers);
  const now = new Date().toISOString();
  const payload = {
    ...existingAttempt.payload,
    id: attemptId,
    userId: context.profileId,
    status: result.passed ? "passed" : "failed",
    answers,
    result,
    score: result.score,
    total: result.total,
    passed: result.passed,
    finishedAt: now,
    updatedAt: now,
  };
  const row = toExamAttemptRow(payload, context.profileId);
  const { error } = await context.supabase
    .from("referee_exam_attempts")
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
  return { ok: true, attemptId, attempt: toClientAttempt(payload), result };
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

  const notificationRows = toNotificationRows(notifications, context.profileId, {
    defaultTitle: "심판 요청",
    defaultTone: "team",
    defaultType: "referee",
    filterToProfile: true,
  });
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
