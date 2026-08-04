import { createHash } from "node:crypto";
import {
  COURT_REQUEST_PHOTO_MAX_BYTES,
  COURT_REQUEST_PHOTO_MAX_DIMENSION,
  COURT_REQUEST_PHOTO_MAX,
  COURT_REQUEST_PHOTO_MIN_BYTES,
  COURT_REQUEST_PHOTO_MIN_DIMENSION,
  COURT_REQUEST_PHOTO_MIN_PIXELS,
  COURT_REQUEST_PHOTO_MIN,
  COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS,
  getCoordinateDistanceMeters,
  getCourtPhotoLocationEvidence,
} from "../../../shared/lib/courtRequestImagePolicy.js";
import {
  getCourtAiDailyQuota,
  getCourtAiQuotaState,
  getCourtRequestLimitState,
  getCourtVerificationDecision,
  inspectCourtRequestPhotos,
  recordCourtAiUsage,
} from "../../lib/courtRequestVerification.js";
import {
  decodeBase64Image,
  deleteR2Object,
  getPrivateR2Config,
  uploadPrivateR2Webp,
  validateWebpImage,
} from "../_r2ImageStorage.js";
import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const COURT_REQUEST_BODY_MAX_BYTES = 1_900_000;

function requestError(statusCode, message, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

async function getMechanicalEvidence(context, requestPayload, fieldLocation) {
  const lat = Number(requestPayload.lat);
  const lng = Number(requestPayload.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw requestError(400, "court_pin_invalid");
  }
  const fieldLat = Number(fieldLocation?.lat);
  const fieldLng = Number(fieldLocation?.lng);
  const fieldAccuracyMeters = Number(fieldLocation?.accuracy);
  const fieldCapturedMs = Date.parse(String(fieldLocation?.capturedAt || ""));
  const fieldAgeMs = Date.now() - fieldCapturedMs;
  if (
    [fieldLocation?.lat, fieldLocation?.lng, fieldLocation?.accuracy].some((value) => value === null || value === undefined || String(value).trim() === "")
    || !Number.isFinite(fieldLat)
    || !Number.isFinite(fieldLng)
    || Math.abs(fieldLat) > 90
    || Math.abs(fieldLng) > 180
    || !Number.isFinite(fieldAccuracyMeters)
    || fieldAccuracyMeters < 0
    || !Number.isFinite(fieldCapturedMs)
    || fieldAgeMs < -60_000
    || fieldAgeMs > COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS
  ) throw requestError(400, "court_field_location_required");
  const latDelta = 50 / 111_320;
  const lngDelta = 50 / (111_320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  const [priorResult, approvedResult, pendingResult] = await Promise.all([
    context.supabase
      .from("court_requests")
      .select("id", { count: "exact", head: true })
      .eq("requested_by", context.profileId)
      .eq("status", "approved"),
    context.supabase
      .from("approved_courts")
      .select("id,lat,lng")
      .gte("lat", lat - latDelta)
      .lte("lat", lat + latDelta)
      .gte("lng", lng - lngDelta)
      .lte("lng", lng + lngDelta)
      .eq("status", "active")
      .limit(20),
    context.supabase
      .from("court_requests")
      .select("id,lat,lng")
      .neq("id", requestPayload.id)
      .in("status", ["pending", "reported"])
      .gte("lat", lat - latDelta)
      .lte("lat", lat + latDelta)
      .gte("lng", lng - lngDelta)
      .lte("lng", lng + lngDelta)
      .limit(20),
  ]);
  if (priorResult.error) throw priorResult.error;
  if (approvedResult.error) throw approvedResult.error;
  if (pendingResult.error) throw pendingResult.error;
  const nearbyDuplicateCount = [...(approvedResult.data ?? []), ...(pendingResult.data ?? [])]
    .filter((court) => {
      const distance = getCoordinateDistanceMeters(lat, lng, court.lat, court.lng);
      return Number.isFinite(distance) && distance <= 30;
    })
    .length;
  return {
    priorApprovedCount: Number(priorResult.count ?? 0),
    nearbyDuplicateCount,
    fieldAccuracyMeters,
    fieldDistanceMeters: getCoordinateDistanceMeters(lat, lng, fieldLat, fieldLng),
    fieldCapturedAt: new Date(fieldCapturedMs).toISOString(),
  };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  const uploadedKeys = [];
  let storageConfig;
  try {
    const body = await readJsonBody(request, { maxBytes: COURT_REQUEST_BODY_MAX_BYTES, maxStringLength: 450_000 });
    const requestPayload = body.request && typeof body.request === "object" ? { ...body.request } : {};
    const photoInputs = Array.isArray(body.photos) ? body.photos : [];
    if (photoInputs.length < COURT_REQUEST_PHOTO_MIN || photoInputs.length > COURT_REQUEST_PHOTO_MAX) {
      throw requestError(400, "court_photo_count_invalid");
    }
    const requestId = String(requestPayload.id || "").trim();
    if (!/^cr_[A-Za-z0-9_-]{6,80}$/.test(requestId)) throw requestError(400, "court_request_id_invalid");
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > COURT_REQUEST_BODY_MAX_BYTES) throw requestError(413, "request_body_too_large");

    const context = await getAuthenticatedContext(request, { profileSelect: "id, auth_user_id, trust_score" });
    const [quota, requestLimit] = await Promise.all([
      getCourtAiDailyQuota(context.supabase),
      getCourtRequestLimitState(context.supabase, context.profileId),
    ]);
    if (requestLimit.abuseBlocked) throw requestError(429, "court_request_abuse_blocked", { requestLimit });
    if (requestLimit.dailyBlocked) throw requestError(429, "court_request_daily_limit_reached", { requestLimit });
    if (quota.blocked) throw requestError(429, "court_ai_daily_quota_reached");
    const fieldLocation = requestPayload.fieldLocation && typeof requestPayload.fieldLocation === "object"
      ? requestPayload.fieldLocation
      : {};
    delete requestPayload.fieldLocation;
    const photos = photoInputs.map((photo, index) => {
      const bytes = decodeBase64Image(photo?.imageBase64, {
        maxBytes: COURT_REQUEST_PHOTO_MAX_BYTES,
        errorPrefix: `court_photo_${index + 1}`,
      });
      const dimensions = validateWebpImage(bytes, {
        maxDimension: COURT_REQUEST_PHOTO_MAX_DIMENSION,
        errorPrefix: `court_photo_${index + 1}`,
        safeContainer: true,
      });
      if (
        bytes.length < COURT_REQUEST_PHOTO_MIN_BYTES
        || Math.min(dimensions.width, dimensions.height) < COURT_REQUEST_PHOTO_MIN_DIMENSION
        || dimensions.width * dimensions.height < COURT_REQUEST_PHOTO_MIN_PIXELS
      ) throw requestError(400, "court_photo_quality_too_low");
      const hash = createHash("sha256").update(bytes).digest("hex");
      return { bytes, hash, imageBase64: String(photo.imageBase64), metadata: photo?.metadata };
    });
    if (new Set(photos.map((photo) => photo.hash)).size !== photos.length) {
      throw requestError(400, "court_photo_duplicate");
    }

    storageConfig = getPrivateR2Config();
    const mechanical = await getMechanicalEvidence(context, requestPayload, fieldLocation);
    const photoLocation = getCourtPhotoLocationEvidence(
      photos.map((photo) => photo.metadata),
      {
        fieldLat: Number(fieldLocation.lat),
        fieldLng: Number(fieldLocation.lng),
        pinLat: Number(requestPayload.lat),
        pinLng: Number(requestPayload.lng),
      },
    );
    const ai = await inspectCourtRequestPhotos(photos, requestPayload.courtLayout);
    await recordCourtAiUsage(context.supabase, requestId, ai.usage);
    const quotaAfter = getCourtAiQuotaState(quota.usedNeurons + ai.usage.neurons);
    const policy = getCourtVerificationDecision({
      assessments: ai.assessments,
      photoCount: photos.length,
      expectedLayout: requestPayload.courtLayout,
      fieldAccuracyMeters: mechanical.fieldAccuracyMeters,
      fieldDistanceMeters: mechanical.fieldDistanceMeters,
      fieldCapturedAt: mechanical.fieldCapturedAt,
      trustScore: Number(context.profile?.trust_score ?? requestPayload.requestedByTrustScore ?? 0),
      priorApprovedCount: mechanical.priorApprovedCount,
      nearbyDuplicateCount: mechanical.nearbyDuplicateCount,
      type: requestPayload.type,
      publicAccess: requestPayload.publicAccess,
      photoLocation,
    });
    if (ai.status !== "complete") policy.decision = "manual_review";

    for (const photo of photos) {
      const objectKey = `court-requests/${requestId}/${photo.hash}.webp`;
      await uploadPrivateR2Webp(storageConfig, objectKey, photo.bytes, "court request evidence");
      uploadedKeys.push(objectKey);
    }

    const verification = {
      status: ai.status,
      decision: policy.decision,
      confidence: policy.confidence,
      checks: policy.checks,
      photoCount: photos.length,
      model: ai.model,
      promptVersion: ai.promptVersion,
      failureReason: ai.failureReason ?? null,
      photoLocation: {
        status: photoLocation.status,
        confidence: photoLocation.confidence,
        gpsPhotoCount: photoLocation.gpsPhotoCount,
        photoCount: photoLocation.photoCount,
        maxDistanceMeters: photoLocation.maxDistanceMeters,
      },
      analyzedAt: new Date().toISOString(),
    };
    const { data, error } = await context.supabase.rpc("rankball_submit_court_request_with_evidence", {
      actor_profile_id: context.profileId,
      request_payload: { ...requestPayload, verification },
      evidence_payload: {
        photoKeys: uploadedKeys,
        imageHashes: photos.map((photo) => photo.hash),
        fieldLat: Number(fieldLocation.lat),
        fieldLng: Number(fieldLocation.lng),
        fieldAccuracyMeters: mechanical.fieldAccuracyMeters,
        fieldDistanceMeters: mechanical.fieldDistanceMeters,
        fieldCapturedAt: mechanical.fieldCapturedAt,
        aiModel: ai.model,
        promptVersion: ai.promptVersion,
        aiStatus: ai.status,
        aiConfidence: policy.confidence,
        aiResult: {
          assessments: ai.assessments,
          checks: policy.checks,
          usage: ai.usage,
          failureReason: ai.failureReason ?? null,
          photoLocation: verification.photoLocation,
          photoMetadata: photoLocation.photos,
        },
        decision: policy.decision,
      },
    });
    if (error) throw error;

    let approval = null;
    if (policy.decision === "auto_approve") {
      const approvalResult = await context.supabase.rpc("rankball_auto_approve_court_request", { request_id: requestId });
      if (approvalResult.error) {
        console.error("Court request automatic approval deferred.", approvalResult.error.message);
        policy.decision = "manual_review";
        verification.decision = "manual_review";
        await context.supabase.from("court_request_evidence").update({ decision: "manual_review" }).eq("request_id", requestId);
      } else approval = approvalResult.data;
    }

    sendJson(response, 200, {
      ...(data ?? { ok: true, requestId }),
      status: approval?.ok ? "approved" : "pending",
      autoApproved: approval?.ok === true,
      approvedCourtId: approval?.approvedCourtId ?? null,
      verification,
      quota: quotaAfter,
      requestLimit: {
        ...requestLimit,
        dailyCount: requestLimit.dailyCount + 1,
        remaining: Math.max(0, requestLimit.dailyLimit - requestLimit.dailyCount - 1),
        dailyBlocked: requestLimit.dailyCount + 1 >= requestLimit.dailyLimit,
        blocked: requestLimit.dailyCount + 1 >= requestLimit.dailyLimit,
        blockedReason: requestLimit.dailyCount + 1 >= requestLimit.dailyLimit ? "daily" : null,
      },
    });
  } catch (error) {
    if (storageConfig && uploadedKeys.length) {
      for (const objectKey of uploadedKeys) await deleteR2Object(storageConfig, objectKey, "court request evidence rollback").catch(() => null);
    }
    console.error("Court request submit failed.", error.message);
    const knownLimitError = ["court_request_abuse_blocked", "court_request_daily_limit_reached"].includes(error.message);
    let errorDetails = error.details;
    if (knownLimitError && typeof errorDetails === "string") {
      try {
        errorDetails = { requestLimit: JSON.parse(errorDetails) };
      } catch {
        errorDetails = null;
      }
    }
    sendJson(response, error.statusCode || (knownLimitError ? 429 : 500), {
      error: error.message || "court_request_submit_failed",
      ...(errorDetails ? { details: errorDetails } : {}),
    });
  }
}
