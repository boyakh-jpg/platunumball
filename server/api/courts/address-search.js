import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { COURT_REQUEST_TRUST_MIN, MINUTE_MS } from "../../../src/lib/constants.js";

const NAVER_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
const MAX_RESULTS = 10;
const RATE_LIMIT_WINDOW_MS = MINUTE_MS;
const RATE_LIMIT_MAX = 12;
const rateLimitBuckets = new Map();

function getNaverClientId() {
  return (
    process.env.NAVER_MAP_CLIENT_ID ||
    process.env.NAVER_MAP_NCP_KEY_ID ||
    process.env.VITE_NAVER_MAP_CLIENT_ID ||
    process.env.VITE_NAVER_MAP_NCP_KEY_ID ||
    ""
  );
}

function getNaverClientSecret() {
  return (
    process.env.NAVER_MAP_CLIENT_SECRET ||
    process.env.NAVER_MAP_NCP_KEY ||
    process.env.NAVER_MAP_NCP_CLIENT_SECRET ||
    ""
  );
}

function getQuery(request, body = {}) {
  const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  return String(url.searchParams.get("q") || body.q || body.query || "").trim();
}

function assertRateLimit(profileId) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(profileId) ?? { startedAt: now, count: 0 };
  const nextBucket = now - bucket.startedAt > RATE_LIMIT_WINDOW_MS ? { startedAt: now, count: 1 } : { ...bucket, count: bucket.count + 1 };
  rateLimitBuckets.set(profileId, nextBucket);
  if (nextBucket.count > RATE_LIMIT_MAX) {
    const error = new Error("address_search_rate_limited");
    error.statusCode = 429;
    throw error;
  }
}

function normalizeNaverAddress(address = {}, index = 0) {
  const elements = address.addressElements ?? [];
  const getElement = (type) => elements.find((element) => element.types?.includes(type))?.longName ?? "";
  const lat = Number(address.y);
  const lng = Number(address.x);
  const roadAddress = String(address.roadAddress ?? "").trim();
  const jibunAddress = String(address.jibunAddress ?? "").trim();
  const addressText = roadAddress || jibunAddress || String(address.englishAddress ?? "").trim();

  return {
    id: `naver:${address.x ?? ""}:${address.y ?? ""}:${index}`,
    addressText,
    roadAddress,
    jibunAddress,
    buildingName: getElement("BUILDING_NAME"),
    bname: getElement("DONGMYUN") || getElement("RI"),
    hname: getElement("DONGMYUN"),
    sido: getElement("SIDO"),
    sigungu: getElement("SIGUGUN"),
    zonecode: address.postalCode ?? getElement("POSTAL_CODE"),
    lat: Number.isFinite(lat) ? lat : "",
    lng: Number.isFinite(lng) ? lng : "",
  };
}

async function assertCourtRequestAccess(context) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("trust_score")
    .eq("id", context.profileId)
    .maybeSingle();

  if (error) throw error;
  const trustScore = Number(data?.trust_score ?? 0);
  if (trustScore < COURT_REQUEST_TRUST_MIN) {
    const accessError = new Error("court_request_trust_required");
    accessError.statusCode = 403;
    throw accessError;
  }
}

async function searchNaver(query) {
  const clientId = getNaverClientId();
  const clientSecret = getNaverClientSecret();
  if (!clientId) {
    const error = new Error("naver_client_id_missing");
    error.statusCode = 500;
    throw error;
  }
  if (!clientSecret) {
    const error = new Error("naver_client_secret_missing");
    error.statusCode = 500;
    throw error;
  }

  const url = new URL(NAVER_GEOCODE_URL);
  url.searchParams.set("query", query);
  const naverResponse = await fetch(url, {
    headers: {
      "x-ncp-apigw-api-key-id": clientId,
      "x-ncp-apigw-api-key": clientSecret,
      Accept: "application/json",
    },
  });
  const payload = await naverResponse.json().catch(() => ({}));
  if (!naverResponse.ok) {
    const error = new Error(payload.errorMessage || payload.message || `naver_geocode_failed:${naverResponse.status}`);
    error.statusCode = 502;
    throw error;
  }

  return (payload.addresses ?? [])
    .map(normalizeNaverAddress)
    .filter((address) => address.addressText)
    .slice(0, MAX_RESULTS);
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const query = getQuery(request, body);
    if (!query) {
      sendJson(response, 400, { error: "missing_query" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    await assertCourtRequestAccess(context);
    assertRateLimit(context.profileId);

    const results = await searchNaver(query);
    sendJson(response, 200, { ok: true, results });
  } catch (error) {
    console.error("Naver address search failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "address_search_failed" });
  }
}
