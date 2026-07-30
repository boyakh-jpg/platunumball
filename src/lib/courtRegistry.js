import { getCourtLocationNote, getCourtRecommendationScore, getFallbackLayout, normalizeCourtLayout, getCourtRequestName, getCourtStandardName } from "./courtCore.js";
import { normalizeCourtIdentityText } from "../../shared/lib/courts.js";

function getCourtCanonicalBaseName(court = {}) {
  const standardName = getCourtStandardName(court);
  if (standardName) return standardName;
  const facilityName = court.buildingName || court.facilityName || court.baseName || court.name;
  return getCourtRequestName(facilityName, court.addressDong, court.courtUnit);
}

function isSmallCourt(court = {}) {
  const layout = normalizeCourtLayout(getFallbackLayout(court));
  return layout === "half" || layout === "single_hoop";
}

export function getCourtPlayWarning(court = {}, mode = "") {
  if (String(mode) !== "5v5" || !isSmallCourt(court)) return "";
  return "반코트 또는 골대 1개 구장은 5v5 경기를 진행하기에 좁을 수 있습니다. 방을 만들기 전에 참가자와 먼저 합의해 주세요.";
}

function getCourtIdentity(court = {}) {
  const latitude = Number(court.latitude ?? court.lat);
  const longitude = Number(court.longitude ?? court.lng);
  return {
    name: normalizeCourtIdentityText(court.canonicalBaseName || getCourtCanonicalBaseName(court)),
    address: normalizeCourtIdentityText(court.addressText || court.roadAddress || court.jibunAddress),
    roadAddress: normalizeCourtIdentityText(court.roadAddress),
    jibunAddress: normalizeCourtIdentityText(court.jibunAddress),
    zonecode: normalizeCourtIdentityText(court.zonecode),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

function hasCourtLocationIdentity(identity = {}) {
  return Boolean(
    identity.address ||
    identity.roadAddress ||
    identity.jibunAddress ||
    identity.zonecode ||
    (identity.latitude !== null && identity.longitude !== null),
  );
}

function getCourtDistanceMeters(source = {}, target = {}) {
  if ([source.latitude, source.longitude, target.latitude, target.longitude].some((value) => value === null)) return null;
  const toRadians = (value) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(target.latitude - source.latitude);
  const longitudeDelta = toRadians(target.longitude - source.longitude);
  const sourceLatitude = toRadians(source.latitude);
  const targetLatitude = toRadians(target.latitude);
  const haversine = (Math.sin(latitudeDelta / 2) ** 2)
    + (Math.cos(sourceLatitude) * Math.cos(targetLatitude) * (Math.sin(longitudeDelta / 2) ** 2));
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isSameCourtIdentity(source = {}, target = {}) {
  if (!hasCourtLocationIdentity(source) || !hasCourtLocationIdentity(target)) return false;
  const distanceMeters = getCourtDistanceMeters(source, target);
  if (distanceMeters !== null && distanceMeters <= 35) return true;
  if (source.roadAddress && target.roadAddress && source.roadAddress === target.roadAddress) return true;
  if (source.jibunAddress && target.jibunAddress && source.jibunAddress === target.jibunAddress) return true;
  if (source.address && target.address && source.address === target.address) return true;
  if (source.zonecode && target.zonecode && source.zonecode === target.zonecode) {
    return Boolean(
      (source.name && target.name && source.name === target.name) ||
      (source.address && target.address && source.address === target.address),
    );
  }
  return false;
}

function getCourtCandidates(settings = {}, includeRequests = true) {
  const approvedCandidates = (settings.approvedCourts ?? []).map((court) => ({ type: "approved", court }));
  const pendingCandidates = includeRequests
    ? (settings.courtRequests ?? [])
      .filter((request) => !["approved", "rejected", "dismissed"].includes(request.status))
      .map((court) => ({ type: "request", court }))
    : [];
  return [...approvedCandidates, ...pendingCandidates];
}

export function getCourtLocationMatches(draft = {}, stateOrSettings = {}, options = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const source = getCourtIdentity(draft);
  if (!hasCourtLocationIdentity(source)) return [];
  return getCourtCandidates(settings, options.includeRequests !== false).filter((candidate) => {
    if (options.excludeRequestId && candidate.court?.id === options.excludeRequestId) return false;
    if (options.excludeRequestId && candidate.court?.sourceRequestId === options.excludeRequestId) return false;
    return isSameCourtIdentity(source, getCourtIdentity(candidate.court));
  });
}

export function getNearbyCourtCandidates(draft = {}, stateOrSettings = {}, options = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const source = getCourtIdentity(draft);
  if (source.latitude === null || source.longitude === null) return [];
  const requestedMaxDistance = Number(options.maxDistanceMeters ?? 500);
  const requestedLimit = Number(options.limit ?? 5);
  const maxDistanceMeters = Number.isFinite(requestedMaxDistance) ? Math.max(0, requestedMaxDistance) : 500;
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : 5;
  const seen = new Set();

  return getCourtCandidates(settings, options.includeRequests !== false)
    .map((candidate) => {
      if (options.excludeRequestId && candidate.court?.id === options.excludeRequestId) return null;
      if (options.excludeRequestId && candidate.court?.sourceRequestId === options.excludeRequestId) return null;
      const target = getCourtIdentity(candidate.court);
      const distanceMeters = getCourtDistanceMeters(source, target);
      const sameLocation = isSameCourtIdentity(source, target);
      if (!sameLocation && (distanceMeters === null || distanceMeters > maxDistanceMeters)) return null;
      const identityKey = candidate.court?.id
        ? `${candidate.type}:${candidate.court.id}`
        : `${candidate.type}:${target.name}:${target.address}:${target.latitude}:${target.longitude}`;
      if (seen.has(identityKey)) return null;
      seen.add(identityKey);
      return { ...candidate, distanceMeters, sameLocation };
    })
    .filter(Boolean)
    .sort((a, b) => (
      Number(b.sameLocation) - Number(a.sameLocation)
      || (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER)
      || String(a.court?.name ?? "").localeCompare(String(b.court?.name ?? ""))
    ))
    .slice(0, limit);
}

export function getCourtCanonicalName(draft = {}, stateOrSettings = {}, options = {}) {
  void stateOrSettings;
  void options;
  return getCourtStandardName(draft);
}

export function findCourtDuplicate(draft = {}, stateOrSettings = {}, options = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const source = getCourtIdentity(draft);
  if (!hasCourtLocationIdentity(source)) return null;
  return getCourtCandidates(settings, options.includeRequests !== false).find((candidate) => {
    if (options.excludeRequestId && candidate.court?.id === options.excludeRequestId) return false;
    if (options.excludeRequestId && candidate.court?.sourceRequestId === options.excludeRequestId) return false;
    const target = getCourtIdentity(candidate.court);
    return source.name && source.name === target.name && isSameCourtIdentity(source, target);
  }) ?? null;
}

export function getCourtDuplicateMessage(duplicate) {
  if (!duplicate) return "";
  return duplicate.type === "approved" ? "이미 등록된 구장입니다." : "이미 등록요청된 구장입니다.";
}

function getRatingAverage(reviews = [], field) {
  const values = reviews
    .map((review) => Number(review[field]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

const COURT_RATING_DEFAULT_MEAN = 3.5;
const COURT_RATING_DEFAULT_DEVIATION = 1;
const COURT_RATING_MIN_DEVIATION = 0.65;
const COURT_RATING_PRIOR_COUNT = 5;

function getMean(values = [], fallback = COURT_RATING_DEFAULT_MEAN) {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getDeviation(values = [], mean = getMean(values), fallback = COURT_RATING_DEFAULT_DEVIATION) {
  if (!values.length) return fallback;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function roundCourtRating(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function buildCourtReviewCalibration(reviews = []) {
  const activeReviews = reviews
    .filter(isActiveModerationItem)
    .filter((review) => Number(review.rating) >= 1 && Number(review.rating) <= 5);
  const values = activeReviews.map((review) => Number(review.rating));
  const globalMean = getMean(values);
  const globalDeviation = Math.max(getDeviation(values, globalMean), 0.75);
  const byReviewer = new Map();

  activeReviews.forEach((review) => {
    const reviewerId = String(review.reviewerId ?? "");
    if (!byReviewer.has(reviewerId)) byReviewer.set(reviewerId, []);
    byReviewer.get(reviewerId).push(Number(review.rating));
  });

  const adjustedById = new Map();
  activeReviews.forEach((review) => {
    const reviewerValues = byReviewer.get(String(review.reviewerId ?? "")) ?? [];
    const reviewerMean = getMean(reviewerValues, globalMean);
    const reviewerDeviation = getDeviation(reviewerValues, reviewerMean, 0);
    const sampleCount = reviewerValues.length;
    const shrunkMean = ((sampleCount * reviewerMean) + (COURT_RATING_PRIOR_COUNT * globalMean))
      / (sampleCount + COURT_RATING_PRIOR_COUNT);
    const shrunkDeviation = Math.max(
      Math.sqrt(
        ((sampleCount * (reviewerDeviation ** 2)) + (COURT_RATING_PRIOR_COUNT * (globalDeviation ** 2)))
        / (sampleCount + COURT_RATING_PRIOR_COUNT),
      ),
      COURT_RATING_MIN_DEVIATION,
    );
    const standardized = globalMean + (((Number(review.rating) - shrunkMean) / shrunkDeviation) * globalDeviation);
    adjustedById.set(review.id, Math.max(1, Math.min(5, standardized)));
  });

  return { activeReviews, adjustedById, globalMean };
}

function isActiveModerationItem(item = {}) {
  return !item.status || item.status === "active";
}

function getCourtReviewSummary(court = {}, reviews = [], calibration = buildCourtReviewCalibration(reviews)) {
  const courtId = String(court.id ?? "");
  const courtName = String(court.name ?? "");
  const relatedReviews = reviews
    .filter(isActiveModerationItem)
    .filter((review) => (
      (courtId && review.courtId === courtId) ||
      (courtName && review.courtName === courtName)
    ));

  const adjustedValues = relatedReviews
    .map((review) => calibration.adjustedById.get(review.id))
    .filter(Number.isFinite);
  const adjustedRating = adjustedValues.length
    ? ((adjustedValues.reduce((sum, value) => sum + value, 0) + (COURT_RATING_PRIOR_COUNT * calibration.globalMean))
      / (adjustedValues.length + COURT_RATING_PRIOR_COUNT))
    : calibration.globalMean;
  const recentReviews = [...relatedReviews]
    .filter((review) => String(review.memo ?? "").trim())
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() - new Date(a.updatedAt ?? a.createdAt ?? 0).getTime())
    .slice(0, 3)
    .map((review) => ({
      id: review.id,
      rating: Number(review.rating),
      adjustedRating: roundCourtRating(calibration.adjustedById.get(review.id)),
      memo: String(review.memo).trim(),
      createdAt: review.createdAt,
    }));

  return {
    averageRating: roundCourtRating(adjustedRating),
    adjustedRating: roundCourtRating(adjustedRating),
    rawAverageRating: getRatingAverage(relatedReviews, "rating"),
    reviewCount: relatedReviews.length,
    surfaceRating: getRatingAverage(relatedReviews, "surfaceRating"),
    rimRating: getRatingAverage(relatedReviews, "rimRating"),
    lightingRating: getRatingAverage(relatedReviews, "lightingRating"),
    crowdRating: getRatingAverage(relatedReviews, "crowdRating"),
    locationAccuracy: getRatingAverage(relatedReviews, "locationAccuracy"),
    recentReviews,
  };
}

export function getRegisteredCourts(stateOrSettings = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const approvedCourts = (settings.approvedCourts ?? []).filter(isActiveModerationItem);
  const courtMetricsById = new Map((settings.courtMetrics ?? []).map((court) => [court.id, court]));
  const courtReviews = (settings.courtReviews ?? []).filter(isActiveModerationItem);
  const calibration = buildCourtReviewCalibration(courtReviews);
  const byId = new Map();
  approvedCourts.forEach((court) => {
    if (!court?.id) return;
    byId.set(court.id, { ...(byId.get(court.id) ?? {}), ...court });
  });
  return [...byId.values()].map((court) => {
    const calculatedSummary = getCourtReviewSummary(court, courtReviews, calibration);
    const serverReviewCount = Number(court.reviewCount);
    const hasServerMetrics = Number.isFinite(serverReviewCount) && court.metricsUpdatedAt;
    const reviewSummary = hasServerMetrics ? {
      ...calculatedSummary,
      averageRating: serverReviewCount > 0 ? Number(court.adjustedRating) : calculatedSummary.averageRating,
      adjustedRating: Number(court.adjustedRating) || calculatedSummary.adjustedRating,
      rawAverageRating: Number(court.rawRating) || calculatedSummary.rawAverageRating,
      reviewCount: serverReviewCount,
      recentReviews: Array.isArray(court.recentReviews) ? court.recentReviews : calculatedSummary.recentReviews,
    } : calculatedSummary;
    const completedMatchCount = Math.max(0, Number(court.completedMatchCount ?? 0));
    return {
      ...court,
      locationNote: getCourtLocationNote(court.locationNote),
      reviewSummary,
      rating: reviewSummary.averageRating,
      reviewCount: reviewSummary.reviewCount,
      adjustedRating: reviewSummary.adjustedRating,
      rawRating: reviewSummary.rawAverageRating,
      recentReviews: reviewSummary.recentReviews,
      completedMatchCount,
      recommendationScore: getCourtRecommendationScore({ ...court, ...reviewSummary, completedMatchCount }),
    };
  });
}
