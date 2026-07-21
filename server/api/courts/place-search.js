import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { COURT_REQUEST_TRUST_MIN, MINUTE_MS } from "../../../src/lib/constants.js";

const NAVER_LOCAL_SEARCH_URL = "https://openapi.naver.com/v1/search/local.json";
const MAX_QUERY_COUNT = 2;
const MAX_RESULTS_PER_QUERY = 5;
const MAX_CANDIDATES = 3;
const MAX_CANDIDATE_DISTANCE_METERS = 500;
const MAX_NEARBY_COURTS = 5;
const MAX_NEARBY_QUERY_ROWS = 20;
const RATE_LIMIT_WINDOW_MS = MINUTE_MS;
const RATE_LIMIT_MAX = 8;
const rateLimitBuckets = new Map();
const PARENT_PLACE_PATTERN = /(공원|체육|운동장|농구장|스포츠|학교|대학교|대학|아파트|복지관|문화회관|청소년|주민센터|행정복지센터|수련관|광장|유원지|휴양림|공공시설|여행,명소)/;

function getNaverSearchClientId() {
  return String(process.env.NAVER_SEARCH_CLIENT_ID || "").trim();
}

function getNaverSearchClientSecret() {
  return String(process.env.NAVER_SEARCH_CLIENT_SECRET || "").trim();
}

function normalizeText(value = "") {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizeIdentity(value = "") {
  return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function decodeNaverText(value = "") {
  return normalizeText(value)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(?:39|x27);/gi, "'");
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

function getPlaceInput(body = {}) {
  const lat = getCoordinate(body.lat, 90);
  const lng = getCoordinate(body.lng, 180);
  const input = {
    buildingName: normalizeText(body.buildingName).slice(0, 120),
    addressText: normalizeText(body.addressText).slice(0, 200),
    roadAddress: normalizeText(body.roadAddress).slice(0, 200),
    jibunAddress: normalizeText(body.jibunAddress).slice(0, 200),
    lat,
    lng,
  };
  if (lat === null || lng === null || !(input.addressText || input.roadAddress || input.jibunAddress)) {
    const error = new Error("missing_place_context");
    error.statusCode = 400;
    throw error;
  }
  return input;
}

function getPlaceQueries(input = {}) {
  const seen = new Set();
  return [input.buildingName, input.roadAddress, input.jibunAddress, input.addressText]
    .map(normalizeText)
    .filter((query) => {
      const key = normalizeIdentity(query);
      if (key.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_QUERY_COUNT);
}

function isSameAddress(place = {}, input = {}) {
  const placeAddresses = [place.roadAddress, place.address].map(normalizeIdentity).filter(Boolean);
  const pinAddresses = [input.roadAddress, input.jibunAddress, input.addressText].map(normalizeIdentity).filter(Boolean);
  return placeAddresses.some((address) => pinAddresses.includes(address));
}

export function selectNaverPlaceCandidates(items = [], input = {}) {
  const buildingNameKey = normalizeIdentity(input.buildingName);
  const seen = new Set();
  return items
    .map((item, index) => {
      const name = decodeNaverText(item.title).slice(0, 120);
      const category = decodeNaverText(item.category).slice(0, 160);
      const address = decodeNaverText(item.address).slice(0, 200);
      const roadAddress = decodeNaverText(item.roadAddress).slice(0, 200);
      const lat = getCoordinate(item.mapy, 90);
      const lng = getCoordinate(item.mapx, 180);
      const place = { name, category, address, roadAddress, lat, lng };
      const distanceMeters = getDistanceMeters(input, place);
      const sameAddress = isSameAddress(place, input);
      const exactBuilding = Boolean(buildingNameKey && normalizeIdentity(name) === buildingNameKey);
      const parentPlace = exactBuilding || PARENT_PLACE_PATTERN.test(`${name} ${category}`);
      return {
        ...place,
        sourceIndex: index,
        queryRank: Number(item.queryRank ?? 0),
        distanceMeters: distanceMeters === null ? null : Math.round(distanceMeters),
        sameAddress,
        exactBuilding,
        parentPlace,
      };
    })
    .filter((place) => {
      if (!place.name || !place.parentPlace) return false;
      if (!(place.sameAddress || place.exactBuilding || (place.distanceMeters !== null && place.distanceMeters <= MAX_CANDIDATE_DISTANCE_METERS))) return false;
      const key = `${normalizeIdentity(place.name)}:${normalizeIdentity(place.roadAddress || place.address)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (
      Number(b.exactBuilding) - Number(a.exactBuilding)
      || Number(b.sameAddress) - Number(a.sameAddress)
      || (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER)
      || a.queryRank - b.queryRank
      || a.sourceIndex - b.sourceIndex
    ))
    .slice(0, MAX_CANDIDATES)
    .map((place, index) => ({
      id: `naver-place:${index}:${normalizeIdentity(place.name).slice(0, 40)}`,
      name: place.name,
      category: place.category,
      address: place.address,
      roadAddress: place.roadAddress,
      lat: place.lat,
      lng: place.lng,
      distanceMeters: place.distanceMeters,
      sameAddress: place.sameAddress,
    }));
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
    const error = new Error("place_search_rate_limited");
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

async function searchNaverLocal(query, queryRank) {
  const clientId = getNaverSearchClientId();
  const clientSecret = getNaverSearchClientSecret();
  if (!clientId || !clientSecret) {
    const error = new Error("place_search_not_configured");
    error.statusCode = 503;
    throw error;
  }

  const url = new URL(NAVER_LOCAL_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(MAX_RESULTS_PER_QUERY));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "random");
  const naverResponse = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
      Accept: "application/json",
    },
  });
  const payload = await naverResponse.json().catch(() => ({}));
  if (!naverResponse.ok) {
    const errorCode = normalizeText(payload.errorCode || payload.errorMessage || naverResponse.status);
    const error = new Error(`naver_place_search_failed:${errorCode}`);
    error.statusCode = 502;
    throw error;
  }
  return (Array.isArray(payload.items) ? payload.items : []).map((item) => ({ ...item, queryRank }));
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const input = getPlaceInput(await readJsonBody(request));
    const context = await getAuthenticatedContext(request);
    await assertCourtRequestAccess(context);
    assertRateLimit(context.profileId);
    const queries = getPlaceQueries(input);
    const [nearbyCourts, placeSearchOutcome] = await Promise.all([
      getNearbyCourts(context, input),
      Promise.all(queries.map((query, queryRank) => searchNaverLocal(query, queryRank)))
        .then((resultGroups) => ({ results: selectNaverPlaceCandidates(resultGroups.flat(), input), error: "" }))
        .catch((error) => {
          if (error.message === "place_search_not_configured" || String(error.message).startsWith("naver_place_search_failed")) {
            return { results: [], error: error.message };
          }
          throw error;
        }),
    ]);
    sendJson(response, 200, {
      ok: true,
      results: placeSearchOutcome.results,
      nearbyCourts,
      placeSearchError: placeSearchOutcome.error || undefined,
    });
  } catch (error) {
    console.error("Naver place search failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "place_search_failed" });
  }
}
