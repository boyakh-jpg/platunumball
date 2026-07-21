import { COURTS } from "./constants.js";

export function courtIdByName(courtName) {
  return COURTS.find((court) => court.name === courtName)?.id ?? null;
}

export function getCourtId(court = {}) {
  return court.courtId ?? court.court_id ?? court.approvedCourtId ?? court.registeredCourtId ?? courtIdByName(court.court ?? court.courtName);
}

export function getCourtAddress(court = {}) {
  return court.roadAddress || court.addressText || court.jibunAddress || "주소 미등록";
}

export const COURT_SURFACE_OPTIONS = [
  { id: "asphalt", label: "아스팔트" },
  { id: "urethane", label: "우레탄" },
  { id: "dirt", label: "흙바닥" },
  { id: "indoor_wood", label: "실내 마루" },
  { id: "indoor_synthetic", label: "실내 합성" },
  { id: "unknown", label: "확인 필요" },
];

export const COURT_LAYOUT_OPTIONS = [
  { id: "full", label: "풀코트" },
  { id: "half", label: "반코트" },
  { id: "single_hoop", label: "골대 1개" },
  { id: "unknown", label: "확인 필요" },
];

export function normalizeCourtSurfaceType(value = "") {
  return COURT_SURFACE_OPTIONS.some((option) => option.id === value) ? value : "unknown";
}

export function normalizeCourtLayout(value = "") {
  return COURT_LAYOUT_OPTIONS.some((option) => option.id === value) ? value : "unknown";
}

export function normalizeCourtReviewRating(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(5, Math.round(number)));
}

export function normalizeCourtNamePart(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/제\s+(\d+)\s*코트/gi, "제$1코트")
    .replace(/([A-Z0-9]+)\s+코트/gi, "$1코트");
}

function stripCourtAddressPrefix(name = "", addressDong = "") {
  const normalizedName = normalizeCourtNamePart(name);
  const normalizedDong = normalizeCourtNamePart(addressDong);
  if (!normalizedDong || !normalizedName.startsWith(`${normalizedDong} `)) return normalizedName;
  return normalizedName.slice(normalizedDong.length).trim();
}

export function getCourtRequestName(rawName = "", addressDong = "", courtUnit = "") {
  const facilityName = stripCourtAddressPrefix(rawName, addressDong);
  const unit = normalizeCourtNamePart(courtUnit);
  if (!facilityName || !unit) return facilityName;
  const facilityKey = normalizeCourtIdentityText(facilityName);
  const unitKey = normalizeCourtIdentityText(unit);
  return facilityKey.endsWith(unitKey) ? facilityName : `${facilityName} ${unit}`;
}

function getCourtCanonicalBaseName(court = {}) {
  const facilityName = court.buildingName || court.facilityName || court.baseName || court.name;
  return getCourtRequestName(facilityName, court.addressDong, court.courtUnit);
}

export function normalizeCourtHashtag(value = "") {
  const raw = String(value ?? "").trim().replace(/^#+/, "");
  if (!raw) return "";
  return /^\d{1,4}$/.test(raw) ? `#${raw.padStart(5, "0")}` : `#${raw}`;
}

export function makeRandomCourtHashtag(state = {}) {
  const used = new Set([
    ...COURTS,
    ...(state.settings?.approvedCourts ?? []),
    ...(state.settings?.courtRequests ?? []),
  ].map((court) => String(court.hashtag ?? "").toLowerCase()).filter(Boolean));

  for (let index = 0; index < 20; index += 1) {
    const candidate = `#${Math.floor(10000 + Math.random() * 90000)}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `#${10000 + (Date.now() % 90000)}`;
}

export function getOptionalCourtCoordinate(value, min, max) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}

export function getCourtMapUrl(court = {}) {
  const latitude = getOptionalCourtCoordinate(court.lat ?? court.latitude, -90, 90);
  const longitude = getOptionalCourtCoordinate(court.lng ?? court.longitude, -180, 180);
  const address = String(court.roadAddress || court.addressText || court.jibunAddress || "").trim();
  const query = address || String(court.name || "").trim() || "농구장";
  if (latitude !== null && longitude !== null) {
    return `https://map.naver.com/?lng=${longitude}&lat=${latitude}&title=${encodeURIComponent(query)}`;
  }

  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}

function getFallbackSurfaceType(court = {}) {
  if (court.surfaceType) return court.surfaceType;
  if (String(court.type ?? "").includes("실내")) return "indoor_synthetic";
  return "unknown";
}

function getFallbackLayout(court = {}) {
  if (court.courtLayout) return court.courtLayout;
  if (court.hoopCount === 1) return "half";
  if (court.courtKind === "official" || court.hoopCount === 2) return "full";
  return "unknown";
}

export function getCourtSurfaceLabel(court = {}) {
  const surfaceType = normalizeCourtSurfaceType(getFallbackSurfaceType(court));
  return COURT_SURFACE_OPTIONS.find((option) => option.id === surfaceType)?.label ?? "확인 필요";
}

export function getCourtLayoutLabel(court = {}) {
  const courtLayout = normalizeCourtLayout(getFallbackLayout(court));
  return COURT_LAYOUT_OPTIONS.find((option) => option.id === courtLayout)?.label ?? "확인 필요";
}

function normalizeCourtSearchValue(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function isWithinOneCourtSearchEdit(source = "", target = "") {
  if (source === target) return true;
  if (!source || !target || Math.abs(source.length - target.length) > 1) return false;

  let sourceIndex = 0;
  let targetIndex = 0;
  let edits = 0;
  while (sourceIndex < source.length && targetIndex < target.length) {
    if (source[sourceIndex] === target[targetIndex]) {
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (source.length > target.length) sourceIndex += 1;
    else if (target.length > source.length) targetIndex += 1;
    else {
      sourceIndex += 1;
      targetIndex += 1;
    }
  }
  return edits + Number(sourceIndex < source.length || targetIndex < target.length) <= 1;
}

export function isCourtFuzzySearchMatch(court = {}, query = "") {
  const normalizedQuery = normalizeCourtSearchValue(query);
  if (normalizedQuery.length < 2) return false;
  const candidates = [
    court.name,
    court.hashtag,
    court.addressText,
    court.roadAddress,
    court.jibunAddress,
    court.region,
    court.type,
  ].map(normalizeCourtSearchValue).filter(Boolean);

  return candidates.some((candidate) => {
    if (candidate.includes(normalizedQuery)) return true;
    if (candidate.length < normalizedQuery.length) return isWithinOneCourtSearchEdit(candidate, normalizedQuery);
    for (let index = 0; index <= candidate.length - normalizedQuery.length; index += 1) {
      if (isWithinOneCourtSearchEdit(candidate.slice(index, index + normalizedQuery.length), normalizedQuery)) return true;
    }
    return false;
  });
}

function isSmallCourt(court = {}) {
  const layout = normalizeCourtLayout(getFallbackLayout(court));
  return layout === "half" || layout === "single_hoop";
}

export function getCourtPlayWarning(court = {}, mode = "") {
  if (String(mode) !== "5v5" || !isSmallCourt(court)) return "";
  return "반코트/골대 1개 구장은 5v5 진행이 좁을 수 있습니다. 생성은 가능하지만 현장 합의를 먼저 확인하세요.";
}

function normalizeCourtIdentityText(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}#]/gu, "");
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
  const approvedCandidates = [
    ...COURTS.map((court) => ({ type: "approved", court })),
    ...(settings.approvedCourts ?? []).map((court) => ({ type: "approved", court })),
  ];
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

export function getCourtCanonicalName(draft = {}, stateOrSettings = {}, options = {}) {
  const baseName = getCourtCanonicalBaseName(draft);
  if (!baseName) return "";
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const sourceIdentity = getCourtIdentity({ ...draft, canonicalBaseName: baseName });
  const baseKey = normalizeCourtIdentityText(baseName);
  const hasDifferentLocationCollision = getCourtCandidates(settings, options.includeRequests !== false).some((candidate) => {
    if (options.excludeRequestId && candidate.court?.id === options.excludeRequestId) return false;
    if (options.excludeRequestId && candidate.court?.sourceRequestId === options.excludeRequestId) return false;
    const candidateBaseKey = normalizeCourtIdentityText(candidate.court?.canonicalBaseName || getCourtCanonicalBaseName(candidate.court));
    return candidateBaseKey === baseKey && !isSameCourtIdentity(sourceIdentity, getCourtIdentity(candidate.court));
  });
  if (!hasDifferentLocationCollision) return baseName;
  const locationLabel = normalizeCourtNamePart(draft.addressDong || draft.region || draft.zonecode);
  return locationLabel ? `${baseName} (${locationLabel})` : baseName;
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

export function getCourtRecommendationScore(court = {}) {
  const rating = Number(court.adjustedRating ?? court.reviewSummary?.adjustedRating ?? court.rating ?? COURT_RATING_DEFAULT_MEAN);
  const completedMatchCount = Math.max(0, Number(court.completedMatchCount ?? 0));
  if (court.recommendationScore !== null && court.recommendationScore !== undefined && Number.isFinite(Number(court.recommendationScore))) {
    return Number(court.recommendationScore);
  }
  return rating + Math.min(0.8, Math.log1p(completedMatchCount) * 0.2);
}

export function getRegisteredCourts(stateOrSettings = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const approvedCourts = (settings.approvedCourts ?? []).filter(isActiveModerationItem);
  const courtMetricsById = new Map((settings.courtMetrics ?? []).map((court) => [court.id, court]));
  const courtReviews = (settings.courtReviews ?? []).filter(isActiveModerationItem);
  const calibration = buildCourtReviewCalibration(courtReviews);
  const byId = new Map(COURTS.map((court) => {
    const metrics = courtMetricsById.get(court.id) ?? {};
    return [court.id, { ...court, ...metrics, name: court.name }];
  }));
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
