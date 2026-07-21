import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { COURT_REQUEST_TRUST_MIN, MINUTE_MS } from "../../../src/lib/constants.js";

const MAX_CANDIDATE_DISTANCE_METERS = 500;
const MAX_NEARBY_COURTS = 5;
const MAX_NEARBY_QUERY_ROWS = 20;
const RATE_LIMIT_WINDOW_MS = MINUTE_MS;
const RATE_LIMIT_MAX = 8;
const rateLimitBuckets = new Map();
function normalizeText(value = "") {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizeIdentity(value = "") {
  return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function getCoordinate(value, limit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  if (Math.abs(numericValue) <= limit) return numericValue;
  const scaledValue = numericValue / 10_000_000;
  return Math.abs(scaledValue) <= limit ? scaledValue : null;
}

function getDistanceMeters(source = {}, target = {}) {
  const sourceLat = getCoordinate(source.lat, 90);
  const sourceLng = getCoordinate(source.lng, 180);
  const targetLat = getCoordinate(target.lat, 90);
  const targetLng = getCoordinate(target.lng, 180);
  if ([sourceLat, sourceLng, targetLat, targetLng].some((value) => value === null)) return null;
  const toRadians = (value) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(targetLat - sourceLat);
  const longitudeDelta = toRadians(targetLng - sourceLng);
  const sourceLatitude = toRadians(sourceLat);
  const targetLatitude = toRadians(targetLat);
  const haversine = (Math.sin(latitudeDelta / 2) ** 2)
    + (Math.cos(sourceLatitude) * Math.cos(targetLatitude) * (Math.sin(longitudeDelta / 2) ** 2));
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function getNearbyInput(body = {}) {
  const lat = getCoordinate(body.lat, 90);
  const lng = getCoordinate(body.lng, 180);
  const input = {
    addressText: normalizeText(body.addressText).slice(0, 200),
    roadAddress: normalizeText(body.roadAddress).slice(0, 200),
    jibunAddress: normalizeText(body.jibunAddress).slice(0, 200),
    lat,
    lng,
  };
  if (lat === null || lng === null || !(input.addressText || input.roadAddress || input.jibunAddress)) {
    const error = new Error("missing_nearby_context");
    error.statusCode = 400;
    throw error;
  }
  return input;
}

function isSameCourtAddress(court = {}, input = {}) {
  const courtAddresses = [court.addressText, court.roadAddress, court.jibunAddress].map(normalizeIdentity).filter(Boolean);
  const pinAddresses = [input.addressText, input.roadAddress, input.jibunAddress].map(normalizeIdentity).filter(Boolean);
  return courtAddresses.some((address) => pinAddresses.includes(address));
}

export function selectNearbyCourtCandidates(candidates = [], input = {}) {
  const seen = new Set();
  return candidates
    .map((candidate) => {
      const row = candidate.court ?? {};
      const court = {
        id: normalizeText(row.id).slice(0, 160),
        name: normalizeText(row.name).slice(0, 160),
        addressText: normalizeText(row.address_text ?? row.addressText).slice(0, 200),
        roadAddress: normalizeText(row.road_address ?? row.roadAddress).slice(0, 200),
        jibunAddress: normalizeText(row.jibun_address ?? row.jibunAddress).slice(0, 200),
      };
      const distanceMeters = getDistanceMeters(input, { lat: row.lat, lng: row.lng });
      const sameAddress = isSameCourtAddress(court, input);
      if (!sameAddress && (distanceMeters === null || distanceMeters > MAX_CANDIDATE_DISTANCE_METERS)) return null;
      const type = candidate.type === "request" ? "request" : "approved";
      const identityKey = `${type}:${court.id || `${normalizeIdentity(court.name)}:${normalizeIdentity(court.addressText || court.roadAddress || court.jibunAddress)}`}`;
      if (!court.name || seen.has(identityKey)) return null;
      seen.add(identityKey);
      return {
        type,
        court,
        distanceMeters: distanceMeters === null ? null : Math.round(distanceMeters),
        sameLocation: sameAddress || (distanceMeters !== null && distanceMeters <= 35),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (
      Number(b.sameLocation) - Number(a.sameLocation)
      || (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER)
      || String(a.court.name).localeCompare(String(b.court.name))
    ))
    .slice(0, MAX_NEARBY_COURTS);
}

function assertRateLimit(profileId) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(profileId) ?? { startedAt: now, count: 0 };
  const nextBucket = now - bucket.startedAt > RATE_LIMIT_WINDOW_MS ? { startedAt: now, count: 1 } : { ...bucket, count: bucket.count + 1 };
  rateLimitBuckets.set(profileId, nextBucket);
  if (nextBucket.count > RATE_LIMIT_MAX) {
    const error = new Error("nearby_search_rate_limited");
    error.statusCode = 429;
    throw error;
  }
}

async function assertCourtRequestAccess(context) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("trust_score")
    .eq("id", context.profileId)
    .maybeSingle();

  if (error) throw error;
  if (Number(data?.trust_score ?? 0) < COURT_REQUEST_TRUST_MIN) {
    const accessError = new Error("court_request_trust_required");
    accessError.statusCode = 403;
    throw accessError;
  }
}

async function getNearbyCourts(context, input) {
  const latitudeDelta = MAX_CANDIDATE_DISTANCE_METERS / 111_320;
  const longitudeScale = Math.max(0.2, Math.cos((input.lat * Math.PI) / 180));
  const longitudeDelta = MAX_CANDIDATE_DISTANCE_METERS / (111_320 * longitudeScale);
  const courtColumns = "id,name,address_text,road_address,jibun_address,lat,lng";
  const approvedQuery = context.supabase
    .from("approved_courts")
    .select(courtColumns)
    .gte("lat", input.lat - latitudeDelta)
    .lte("lat", input.lat + latitudeDelta)
    .gte("lng", input.lng - longitudeDelta)
    .lte("lng", input.lng + longitudeDelta)
    .or("status.is.null,status.eq.active")
    .limit(MAX_NEARBY_QUERY_ROWS);
  const requestQuery = context.supabase
    .from("court_requests")
    .select(courtColumns)
    .in("status", ["pending", "reported"])
    .gte("lat", input.lat - latitudeDelta)
    .lte("lat", input.lat + latitudeDelta)
    .gte("lng", input.lng - longitudeDelta)
    .lte("lng", input.lng + longitudeDelta)
    .limit(MAX_NEARBY_QUERY_ROWS);
  const [approvedResult, requestResult] = await Promise.all([approvedQuery, requestQuery]);
  if (approvedResult.error) throw approvedResult.error;
  if (requestResult.error) throw requestResult.error;
  return selectNearbyCourtCandidates([
    ...(approvedResult.data ?? []).map((court) => ({ type: "approved", court })),
    ...(requestResult.data ?? []).map((court) => ({ type: "request", court })),
  ], input);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const input = getNearbyInput(await readJsonBody(request));
    const context = await getAuthenticatedContext(request);
    await assertCourtRequestAccess(context);
    assertRateLimit(context.profileId);
    const nearbyCourts = await getNearbyCourts(context, input);
    sendJson(response, 200, {
      ok: true,
      nearbyCourts,
    });
  } catch (error) {
    console.error("Nearby court search failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "nearby_court_search_failed" });
  }
}
