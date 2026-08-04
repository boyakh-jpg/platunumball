import {
  COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS,
  COURT_REQUEST_FIELD_ACCURACY_MAX_METERS,
  COURT_REQUEST_FIELD_DISTANCE_MAX_METERS,
  COURT_REQUEST_PHOTO_MAX,
  COURT_REQUEST_PHOTO_MIN,
} from "../../shared/lib/courtRequestImagePolicy.js";

export const COURT_REQUEST_AI_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
export const COURT_REQUEST_AI_PROMPT_VERSION = "court-photo-v2";
export const COURT_REQUEST_AI_PROXY_URL = "https://boxtier-court-ai.rankball.workers.dev";
export const COURT_REQUEST_AI_DAILY_NEURONS = 10_000;
export const COURT_REQUEST_AI_BLOCK_RATIO = 0.7;

const COURT_REQUEST_AI_BLOCK_NEURONS = COURT_REQUEST_AI_DAILY_NEURONS * COURT_REQUEST_AI_BLOCK_RATIO;
const COURT_REQUEST_AI_INPUT_NEURONS_PER_MILLION = 27_273;
const COURT_REQUEST_AI_OUTPUT_NEURONS_PER_MILLION = 90_909;
const COURT_REQUEST_AI_FALLBACK_NEURONS_PER_CALL = 40;

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
  const layoutAliases = {
    standard: "full",
    "full court": "full",
    full_court: "full",
    "half court": "half",
    half_court: "half",
    "single hoop": "single_hoop",
  };
  if (!Object.prototype.hasOwnProperty.call(parsed, "courtLayout")) throw new Error("court_ai_invalid_response");
  const layoutValue = layoutAliases[textValue(parsed?.courtLayout)] ?? textValue(parsed?.courtLayout);
  const layout = ["full", "half", "single_hoop", "unknown"].includes(layoutValue)
    ? layoutValue
    : "unknown";
  return {
    basketballCourt: booleanValue(parsed?.basketballCourt),
    hoopVisible: booleanValue(parsed?.hoopVisible),
    overviewVisible: booleanValue(parsed?.overviewVisible),
    screenshotOrSynthetic: booleanValue(parsed?.screenshotOrSynthetic),
    courtLayout: layout,
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
  const emptyQuota = getCourtAiQuotaState(0, now);
  // ponytail: the 30% reserve absorbs in-flight requests; add atomic reservations only if court traffic grows materially.
  const { data, error } = await supabase
    .from("court_ai_usage_events")
    .select("neurons")
    .gte("created_at", emptyQuota.dayStartsAt);
  if (error) throw error;
  const usedNeurons = (data ?? []).reduce((total, row) => total + (Number(row.neurons) || 0), 0);
  return getCourtAiQuotaState(usedNeurons, now);
}

export async function recordCourtAiUsage(supabase, requestId, usage = {}) {
  if (!(Number(usage.calls) > 0)) return;
  const { error } = await supabase.from("court_ai_usage_events").insert({
    request_id: requestId,
    model: COURT_REQUEST_AI_MODEL,
    calls: Math.max(1, Math.trunc(Number(usage.calls) || 1)),
    input_tokens: Math.max(0, Math.trunc(Number(usage.inputTokens) || 0)),
    output_tokens: Math.max(0, Math.trunc(Number(usage.outputTokens) || 0)),
    neurons: Math.max(0, Number(usage.neurons) || 0),
    estimated: usage.estimated === true,
  });
  if (error) throw error;
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
  const layoutMatches = expectedLayout === "unknown"
    || courtPhotos.some((item) => item.courtLayout === expectedLayout);
  const visualChecks = {
    courtVisible: courtPhotos.length >= 2,
    hoopVisible: courtPhotos.some((item) => item.hoopVisible),
    overviewVisible: courtPhotos.some((item) => item.overviewVisible),
    layoutMatches,
    authenticImages: assessments.length === photoCount && assessments.every((item) => !item.screenshotOrSynthetic),
  };
  const confidence = Object.values(visualChecks).filter(Boolean).length / Object.keys(visualChecks).length;
  const checks = {
    trustedRequester: Number(trustScore) >= 90 || Number(priorApprovedCount) >= 2,
    fieldAccuracy: isFiniteAtMost(fieldAccuracyMeters, COURT_REQUEST_FIELD_ACCURACY_MAX_METERS),
    fieldDistance: isFiniteAtMost(fieldDistanceMeters, COURT_REQUEST_FIELD_DISTANCE_MAX_METERS),
    fieldFresh: Number.isFinite(fieldCapturedMs) && fieldAgeMs >= -60_000 && fieldAgeMs <= COURT_REQUEST_FIELD_CAPTURE_MAX_AGE_MS,
    noNearbyDuplicate: Number(nearbyDuplicateCount) === 0,
    outdoorPublic: type === "야외" && publicAccess === "public",
    photoCount: photoCount >= 2 && photoCount <= COURT_REQUEST_PHOTO_MAX,
    ...visualChecks,
  };
  return {
    decision: Object.values(checks).every(Boolean) ? "auto_approve" : "manual_review",
    confidence,
    checks,
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

async function inspectPhoto(config, photo, expectedLayout) {
  const response = await fetch(
    config.url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "query",
        image: `data:image/webp;base64,${photo.imageBase64}`,
        question: `Inspect this evidence photo for a basketball court application. Expected layout: ${expectedLayout}. Return only JSON with exactly these fields: {"basketballCourt":boolean,"hoopVisible":boolean,"overviewVisible":boolean,"screenshotOrSynthetic":boolean,"courtLayout":"full|half|single_hoop|unknown"}.`,
        reasoning: false,
        stream: false,
        temperature: 0,
        max_tokens: 128,
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

export async function inspectCourtRequestPhotos(photos = [], expectedLayout = "unknown") {
  if (photos.length < COURT_REQUEST_PHOTO_MIN || photos.length > COURT_REQUEST_PHOTO_MAX) {
    throw new Error("court_photo_count_invalid");
  }
  const config = getAiConfig();
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, neurons: 0, estimated: false };
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
          const inspected = await inspectPhoto(config, photo, expectedLayout);
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
