import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { MINUTE_MS } from "../../../shared/lib/matchConstants.js";
import { normalizeNaverAddress } from "../../../shared/lib/naverAddress.js";
import { assertCourtRequestAccess } from "../../lib/courtRequestAccess.js";
import { createFixedWindowRateLimiter } from "../../lib/fixedWindowRateLimit.js";

const NAVER_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
const MAX_RESULTS = 10;
const assertRateLimit = createFixedWindowRateLimiter({
  windowMs: MINUTE_MS,
  max: 12,
  errorCode: "address_search_rate_limited",
});

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

function getQuery(body = {}) {
  return String(body.q || body.query || "").trim();
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
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const query = getQuery(body);
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
