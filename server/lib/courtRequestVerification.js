import {
  COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS,
  COURT_REQUEST_FIELD_ACCURACY_MAX_METERS,
  COURT_REQUEST_FIELD_DISTANCE_MAX_METERS,
  COURT_REQUEST_PHOTO_MAX,
  COURT_REQUEST_PHOTO_MIN,
} from "../../shared/lib/courtRequestImagePolicy.js";

export const COURT_REQUEST_AI_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
export const COURT_REQUEST_AI_PROMPT_VERSION = "court-photo-v4";
export const COURT_REQUEST_AI_PROXY_URL = "https://boxtier-court-ai.rankball.workers.dev";
export const COURT_REQUEST_AI_DAILY_NEURONS = 10_000;
export const COURT_REQUEST_AI_BLOCK_RATIO = 0.8;
export const COURT_REQUEST_DAILY_LIMIT = 3;

const COURT_REQUEST_AI_BLOCK_NEURONS = COURT_REQUEST_AI_DAILY_NEURONS * COURT_REQUEST_AI_BLOCK_RATIO;
const COURT_REQUEST_AI_INPUT_NEURONS_PER_MILLION = 4_410;
const COURT_REQUEST_AI_OUTPUT_NEURONS_PER_MILLION = 61_493;
const COURT_REQUEST_AI_FALLBACK_NEURONS_PER_CALL = 12;
export const COURT_REQUEST_AI_RESERVATION_NEURONS = COURT_REQUEST_PHOTO_MAX * 2 * COURT_REQUEST_AI_FALLBACK_NEURONS_PER_CALL;

function parseJsonAnswer(value = "") {
  const text = String(value || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("court_ai_invalid_response");
  return JSON.parse(text.slice(start, end + 1));
}

export function normalizeCourtPhotoAiAnswer(value = "") {
  const parsed = typeof value === "string" ? parseJsonAnswer(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("court_ai_invalid_response");
  const textValue = (input) => String(input ?? "").trim().toLowerCase();
  const booleanValue = (input) => {
    if (typeof input === "boolean") return input;
    const text = textValue(input);
    if (["true", "yes"].includes(text)) return true;
    if (["false", "no"].includes(text)) return false;
    throw new Error("court_ai_invalid_response");
  };
  return {
    court: booleanValue(parsed?.court),
    hoop: booleanValue(parsed?.hoop),
    lines: booleanValue(parsed?.lines),
    venue: booleanValue(parsed?.venue),
    synthetic: booleanValue(parsed?.synthetic),
  };
}

export function getCourtAiUsage(metrics = {}) {
  const inputTokens = Math.max(0, Number(metrics?.input_tokens ?? metrics?.inputTokens ?? metrics?.prompt_tokens) || 0);
  const outputTokens = Math.max(0, Number(metrics?.output_tokens ?? metrics?.outputTokens ?? metrics?.completion_tokens) || 0);
  const measured = inputTokens > 0 || outputTokens > 0;
  const neurons = measured
    ? inputTokens * COURT_REQUEST_AI_INPUT_NEURONS_PER_MILLION / 1_000_000
      + outputTokens * COURT_REQUEST_AI_OUTPUT_NEURONS_PER_MILLION / 1_000_000
    : COURT_REQUEST_AI_FALLBACK_NEURONS_PER_CALL;
  return { calls: 1, inputTokens, outputTokens, neurons, estimated: !measured };
}

export function getCourtAiQuotaState(usedNeurons = 0, now = new Date()) {
  const safeUsedNeurons = Math.max(0, Number(usedNeurons) || 0);
  const current = new Date(now);
  const dayStartsAt = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
  const resetsAt = new Date(dayStartsAt.getTime() + 24 * 60 * 60 * 1000);
  return {
    usedNeurons: safeUsedNeurons,
    dailyAllocationNeurons: COURT_REQUEST_AI_DAILY_NEURONS,
    blockAtNeurons: COURT_REQUEST_AI_BLOCK_NEURONS,
    usedRatio: safeUsedNeurons / COURT_REQUEST_AI_DAILY_NEURONS,
    blocked: safeUsedNeurons >= COURT_REQUEST_AI_BLOCK_NEURONS,
    dayStartsAt: dayStartsAt.toISOString(),
    resetsAt: resetsAt.toISOString(),
  };
}

export async function getCourtAiDailyQuota(supabase, now = new Date()) {
  const { data, error } = await supabase.rpc("rankball_get_court_ai_budget_state");
  if (error) throw error;
  return {
    ...getCourtAiQuotaState(data?.usedNeurons, now),
    committedNeurons: Math.max(0, Number(data?.committedNeurons) || 0),
    reservedNeurons: Math.max(0, Number(data?.reservedNeurons) || 0),
  };
}

export async function getCourtRequestLimitState(supabase, profileId) {
  const { data, error } = await supabase.rpc("rankball_get_court_request_limit_state", {
    actor_profile_id: profileId,
  });
  if (error) throw error;
  const dailyLimit = Math.max(1, Number(data?.dailyLimit) || COURT_REQUEST_DAILY_LIMIT);
  const dailyCount = Math.max(0, Number(data?.dailyCount) || 0);
  return {
    ...data,
    dailyCount,
    dailyLimit,
    remaining: Math.max(0, dailyLimit - dailyCount),
    dailyBlocked: data?.dailyBlocked === true || dailyCount >= dailyLimit,
    abuseBlocked: data?.abuseBlocked === true,
    blocked: data?.abuseBlocked === true || data?.dailyBlocked === true || dailyCount >= dailyLimit,
  };
}

export async function reserveCourtAiBudget(supabase, requestId) {
  const { data, error } = await supabase.rpc("rankball_reserve_court_ai_budget", {
    p_request_id: requestId,
    p_reserved_neurons: COURT_REQUEST_AI_RESERVATION_NEURONS,
    p_limit_neurons: COURT_REQUEST_AI_BLOCK_NEURONS,
  });
  if (error) throw error;
  if (!data?.allowed) {
    const quotaError = new Error(data?.reason === "duplicate_request" ? "court_request_id_duplicate" : "court_ai_daily_quota_reached");
    quotaError.statusCode = data?.reason === "duplicate_request" ? 409 : 429;
    throw quotaError;
  }
  return data;
}

export async function settleCourtAiBudget(supabase, requestId, usage = {}, now = new Date()) {
  const { data, error } = await supabase.rpc("rankball_settle_court_ai_budget", {
    p_request_id: requestId,
    p_model: COURT_REQUEST_AI_MODEL,
    p_calls: Math.max(0, Math.trunc(Number(usage.calls) || 0)),
    p_input_tokens: Math.max(0, Math.trunc(Number(usage.inputTokens) || 0)),
    p_output_tokens: Math.max(0, Math.trunc(Number(usage.outputTokens) || 0)),
    p_neurons: Math.max(0, Number(usage.neurons) || 0),
    p_estimated: usage.estimated === true,
  });
  if (error) throw error;
  return {
    ...getCourtAiQuotaState(data?.usedNeurons, now),
    committedNeurons: Math.max(0, Number(data?.committedNeurons) || 0),
    reservedNeurons: Math.max(0, Number(data?.reservedNeurons) || 0),
  };
}

export function getCourtVerificationDecision({
  assessments = [],
  photoCount = 0,
  fieldAccuracyMeters,
  fieldDistanceMeters,
  fieldCapturedAt,
  trustScore = 0,
  priorApprovedCount = 0,
  nearbyDuplicateCount = 0,
  type = "",
  publicAccess = "unknown",
  photoLocation = {},
} = {}) {
  const isFiniteAtMost = (value, maximum) => value !== null
    && value !== ""
    && Number.isFinite(Number(value))
    && Number(value) <= maximum;
  const fieldCapturedMs = Date.parse(String(fieldCapturedAt || ""));
  const fieldAgeMs = Date.now() - fieldCapturedMs;
  const visualChecks = {
    courtEvidence: assessments.some((item) => item.court && (item.hoop || item.lines)),
    evidenceCoverage: assessments.length === photoCount && assessments.every((item) => item.court || item.venue),
    authenticImages: assessments.length === photoCount && assessments.every((item) => !item.synthetic),
  };
  const liveLocationVerified = isFiniteAtMost(fieldAccuracyMeters, COURT_REQUEST_FIELD_ACCURACY_MAX_METERS)
    && isFiniteAtMost(fieldDistanceMeters, COURT_REQUEST_FIELD_DISTANCE_MAX_METERS)
    && Number.isFinite(fieldCapturedMs)
    && fieldAgeMs >= -60_000
    && fieldAgeMs <= COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS;
  const photoLocationMatched = photoLocation?.status === "matched";
  const photoLocationContradicts = photoLocation?.status === "mismatch";
  const locationVerified = (liveLocationVerified || photoLocationMatched) && !photoLocationContradicts;
  const locationSource = liveLocationVerified
    ? (photoLocationMatched || photoLocation?.status === "partial" ? "live_and_photo_gps" : "live_gps")
    : photoLocationMatched ? "photo_gps" : "address_pin";
  const visualConfidence = Object.values(visualChecks).filter(Boolean).length / Object.keys(visualChecks).length;
  const photoLocationConfidence = Number.isFinite(Number(photoLocation?.confidence))
    ? Math.max(0, Math.min(1, Number(photoLocation.confidence)))
    : 0.75;
  const confidence = Math.min(visualConfidence, liveLocationVerified && !photoLocationContradicts ? 1 : photoLocationConfidence);
  const checks = {
    trustedRequester: Number(trustScore) >= 90 || Number(priorApprovedCount) >= 2,
    locationVerified,
    photoLocationConsistent: !photoLocationContradicts,
    noNearbyDuplicate: Number(nearbyDuplicateCount) === 0,
    publicCourt: ["실내", "야외"].includes(type) && publicAccess === "public",
    photoCount: photoCount === COURT_REQUEST_PHOTO_MAX,
    ...visualChecks,
  };
  return {
    decision: Object.values(checks).every(Boolean) ? "auto_approve" : "manual_review",
    confidence,
    checks,
    locationSource,
  };
}

function getAiConfig() {
  const proxyUrl = String(process.env.CLOUDFLARE_AI_PROXY_URL || COURT_REQUEST_AI_PROXY_URL).trim();
  const proxySecret = String(process.env.CLOUDFLARE_AI_PROXY_SECRET || process.env.CRON_SECRET || "").trim();
  if (proxyUrl && proxySecret) return { url: proxyUrl, apiToken: proxySecret };
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(process.env.CLOUDFLARE_AI_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "").trim();
  return accountId && apiToken
    ? { url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${COURT_REQUEST_AI_MODEL}`, apiToken }
    : null;
}

async function inspectPhoto(config, photo) {
  const response = await fetch(
    config.url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: `data:image/webp;base64,${photo.imageBase64}`,
        prompt: "Output exactly one JSON object and no prose: {\"court\":boolean,\"hoop\":boolean,\"lines\":boolean,\"venue\":boolean,\"synthetic\":boolean}. venue requires an identifiable gym/sports-center exterior, entrance, or sign, not merely a court or building. synthetic means the entire submitted image is a phone/browser/app screenshot, illustration, CGI, or generated image; normal old, blurry, or low-resolution photos are not synthetic.",
        stream: false,
        temperature: 0,
        max_tokens: 48,
      }),
    },
  );
  const payload = await response.json().catch(() => null);
  const result = payload?.result ?? payload;
  const usage = getCourtAiUsage(result?.metrics ?? result?.usage ?? payload?.usage);
  if (!response.ok || payload?.success === false) {
    const message = [401, 403].includes(response.status)
      ? "court_ai_access_denied"
      : response.status === 404
        ? "court_ai_model_not_found"
        : response.status === 429 ? "court_ai_rate_limited" : "court_ai_request_failed";
    const error = new Error(message);
    error.aiUsage = usage;
    throw error;
  }
  try {
    return {
      assessment: normalizeCourtPhotoAiAnswer(result?.answer ?? result?.response ?? result ?? ""),
      usage,
    };
  } catch (error) {
    error.aiUsage = usage;
    throw error;
  }
}

export async function inspectCourtRequestPhotos(photos = []) {
  if (photos.length < COURT_REQUEST_PHOTO_MIN || photos.length > COURT_REQUEST_PHOTO_MAX) {
    throw new Error("court_photo_count_invalid");
  }
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, neurons: 0, estimated: false };
  const config = getAiConfig();
  const addUsage = (next = {}) => {
    usage.calls += Number(next.calls) || 0;
    usage.inputTokens += Number(next.inputTokens) || 0;
    usage.outputTokens += Number(next.outputTokens) || 0;
    usage.neurons += Number(next.neurons) || 0;
    usage.estimated ||= next.estimated === true;
  };
  if (!config) return { status: "unavailable", assessments: [], usage, failureReason: "court_ai_not_configured", model: COURT_REQUEST_AI_MODEL, promptVersion: COURT_REQUEST_AI_PROMPT_VERSION };
  const assessments = [];
  try {
    for (const photo of photos) {
      let assessment;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const inspected = await inspectPhoto(config, photo);
          assessment = inspected.assessment;
          addUsage(inspected.usage);
          break;
        } catch (error) {
          addUsage(error.aiUsage);
          if (attempt === 1) throw error;
        }
      }
      assessments.push(assessment);
    }
    return { status: "complete", assessments, usage, failureReason: null, model: COURT_REQUEST_AI_MODEL, promptVersion: COURT_REQUEST_AI_PROMPT_VERSION };
  } catch (error) {
    console.error("Court request AI verification failed.", error.message);
    return { status: "failed", assessments: [], usage, failureReason: error.message, model: COURT_REQUEST_AI_MODEL, promptVersion: COURT_REQUEST_AI_PROMPT_VERSION };
  }
}
