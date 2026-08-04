import {
  COURT_REQUEST_AI_CONFIDENCE_MIN,
  COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS,
  COURT_REQUEST_FIELD_ACCURACY_MAX_METERS,
  COURT_REQUEST_FIELD_DISTANCE_MAX_METERS,
  COURT_REQUEST_PHOTO_MAX,
  COURT_REQUEST_PHOTO_MIN,
} from "../../shared/lib/courtRequestImagePolicy.js";

export const COURT_REQUEST_AI_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
export const COURT_REQUEST_AI_PROMPT_VERSION = "court-photo-v1";

function parseJsonAnswer(value = "") {
  const text = String(value || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("court_ai_invalid_response");
  return JSON.parse(text.slice(start, end + 1));
}

export function normalizeCourtPhotoAiAnswer(value = "") {
  const parsed = typeof value === "string" ? parseJsonAnswer(value) : value;
  const layout = ["full", "half", "single_hoop", "unknown"].includes(parsed?.courtLayout)
    ? parsed.courtLayout
    : "unknown";
  const confidence = Number(parsed?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("court_ai_invalid_confidence");
  return {
    basketballCourt: parsed?.basketballCourt === true,
    hoopVisible: parsed?.hoopVisible === true,
    overviewVisible: parsed?.overviewVisible === true,
    screenshotOrSynthetic: parsed?.screenshotOrSynthetic === true,
    courtLayout: layout,
    confidence,
  };
}

export function getCourtVerificationDecision({
  assessments = [],
  photoCount = 0,
  expectedLayout = "unknown",
  fieldAccuracyMeters,
  fieldDistanceMeters,
  fieldCapturedAt,
  trustScore = 0,
  priorApprovedCount = 0,
  nearbyDuplicateCount = 0,
  type = "",
  publicAccess = "unknown",
} = {}) {
  const isFiniteAtMost = (value, maximum) => value !== null
    && value !== ""
    && Number.isFinite(Number(value))
    && Number(value) <= maximum;
  const courtPhotos = assessments.filter((item) => item.basketballCourt);
  const fieldCapturedMs = Date.parse(String(fieldCapturedAt || ""));
  const fieldAgeMs = Date.now() - fieldCapturedMs;
  const confidence = courtPhotos.length ? Math.min(...courtPhotos.map((item) => item.confidence)) : 0;
  const layoutMatches = expectedLayout === "unknown"
    || courtPhotos.some((item) => item.courtLayout === expectedLayout);
  const checks = {
    trustedRequester: Number(trustScore) >= 90 || Number(priorApprovedCount) >= 2,
    fieldAccuracy: isFiniteAtMost(fieldAccuracyMeters, COURT_REQUEST_FIELD_ACCURACY_MAX_METERS),
    fieldDistance: isFiniteAtMost(fieldDistanceMeters, COURT_REQUEST_FIELD_DISTANCE_MAX_METERS),
    fieldFresh: Number.isFinite(fieldCapturedMs) && fieldAgeMs >= -60_000 && fieldAgeMs <= COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS,
    noNearbyDuplicate: Number(nearbyDuplicateCount) === 0,
    outdoorPublic: type === "야외" && publicAccess === "public",
    photoCount: photoCount >= 2 && photoCount <= COURT_REQUEST_PHOTO_MAX,
    courtVisible: courtPhotos.length >= 2,
    hoopVisible: courtPhotos.some((item) => item.hoopVisible),
    overviewVisible: courtPhotos.some((item) => item.overviewVisible),
    layoutMatches,
    authenticImages: assessments.length === photoCount && assessments.every((item) => !item.screenshotOrSynthetic),
    aiConfidence: confidence >= COURT_REQUEST_AI_CONFIDENCE_MIN,
  };
  return {
    decision: Object.values(checks).every(Boolean) ? "auto_approve" : "manual_review",
    confidence,
    checks,
  };
}

function getAiConfig() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(process.env.CLOUDFLARE_AI_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "").trim();
  return accountId && apiToken ? { accountId, apiToken } : null;
}

async function inspectPhoto(config, photo, expectedLayout) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run/${COURT_REQUEST_AI_MODEL}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "query",
        image: `data:image/webp;base64,${photo.imageBase64}`,
        question: `Inspect this evidence photo for a basketball court application. Expected layout: ${expectedLayout}. Return only JSON with exactly these fields: {"basketballCourt":boolean,"hoopVisible":boolean,"overviewVisible":boolean,"screenshotOrSynthetic":boolean,"courtLayout":"full|half|single_hoop|unknown","confidence":number}. confidence is 0 to 1 for your visual findings.`,
        reasoning: false,
        stream: false,
        temperature: 0,
        max_tokens: 220,
      }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const message = [401, 403].includes(response.status)
      ? "court_ai_access_denied"
      : response.status === 404
        ? "court_ai_model_not_found"
        : response.status === 429 ? "court_ai_rate_limited" : "court_ai_request_failed";
    throw new Error(message);
  }
  return normalizeCourtPhotoAiAnswer(payload?.result?.answer ?? payload?.result?.response ?? payload?.result ?? "");
}

export async function inspectCourtRequestPhotos(photos = [], expectedLayout = "unknown") {
  if (photos.length < COURT_REQUEST_PHOTO_MIN || photos.length > COURT_REQUEST_PHOTO_MAX) {
    throw new Error("court_photo_count_invalid");
  }
  const config = getAiConfig();
  if (!config) return { status: "unavailable", assessments: [], failureReason: "court_ai_not_configured", model: COURT_REQUEST_AI_MODEL, promptVersion: COURT_REQUEST_AI_PROMPT_VERSION };
  const assessments = [];
  try {
    for (const photo of photos) {
      let assessment;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          assessment = await inspectPhoto(config, photo, expectedLayout);
          break;
        } catch (error) {
          if (attempt === 1) throw error;
        }
      }
      assessments.push(assessment);
    }
    return { status: "complete", assessments, failureReason: null, model: COURT_REQUEST_AI_MODEL, promptVersion: COURT_REQUEST_AI_PROMPT_VERSION };
  } catch (error) {
    console.error("Court request AI verification failed.", error.message);
    return { status: "failed", assessments: [], failureReason: error.message, model: COURT_REQUEST_AI_MODEL, promptVersion: COURT_REQUEST_AI_PROMPT_VERSION };
  }
}
