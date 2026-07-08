import { COURTS } from "./constants.js";

export function courtIdByName(courtName) {
  return COURTS.find((court) => court.name === courtName)?.id ?? null;
}

export function getCourtId(court = {}) {
  return court.courtId ?? court.court_id ?? court.approvedCourtId ?? court.registeredCourtId ?? courtIdByName(court.court ?? court.courtName);
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

export function getCourtRequestName(rawName = "", addressDong = "") {
  const name = String(rawName ?? "").trim();
  const dong = String(addressDong ?? "").trim();
  if (!dong || name.startsWith(dong)) return name;
  return `${dong} ${name}`;
}

export function normalizeCourtHashtag(value = "") {
  const raw = String(value ?? "").trim().replace(/^#+/, "");
  return raw ? `#${raw}` : "";
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
  return `#${Date.now().toString(36).slice(-5)}`;
}

export function getOptionalCourtCoordinate(value, min, max) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
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

export function isSmallCourt(court = {}) {
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
  return {
    name: normalizeCourtIdentityText(court.name),
    address: normalizeCourtIdentityText(court.addressText || court.roadAddress || court.jibunAddress),
    roadAddress: normalizeCourtIdentityText(court.roadAddress),
    jibunAddress: normalizeCourtIdentityText(court.jibunAddress),
    zonecode: normalizeCourtIdentityText(court.zonecode),
  };
}

function hasCourtLocationIdentity(identity = {}) {
  return Boolean(identity.address || identity.roadAddress || identity.jibunAddress || identity.zonecode);
}

function isSameCourtIdentity(source = {}, target = {}) {
  if (!hasCourtLocationIdentity(source) || !hasCourtLocationIdentity(target)) return false;
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

export function findCourtDuplicate(draft = {}, stateOrSettings = {}, options = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const includeRequests = options.includeRequests !== false;
  const source = getCourtIdentity(draft);
  if (!hasCourtLocationIdentity(source)) return null;

  const approvedCandidates = [
    ...COURTS.map((court) => ({ type: "approved", court })),
    ...(settings.approvedCourts ?? []).map((court) => ({ type: "approved", court })),
  ];
  const pendingCandidates = includeRequests
    ? (settings.courtRequests ?? [])
      .filter((request) => (
        request.id !== options.excludeRequestId &&
        !["approved", "rejected", "dismissed"].includes(request.status)
      ))
      .map((court) => ({ type: "request", court }))
    : [];

  return [...approvedCandidates, ...pendingCandidates].find((candidate) => (
    (options.excludeRequestId && candidate.court?.sourceRequestId === options.excludeRequestId) ||
    isSameCourtIdentity(source, getCourtIdentity(candidate.court))
  )) ?? null;
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

function isActiveModerationItem(item = {}) {
  return !item.status || item.status === "active";
}

export function getCourtReviewSummary(court = {}, reviews = []) {
  const courtId = String(court.id ?? "");
  const courtName = String(court.name ?? "");
  const relatedReviews = reviews
    .filter(isActiveModerationItem)
    .filter((review) => (
      (courtId && review.courtId === courtId) ||
      (courtName && review.courtName === courtName)
    ));

  return {
    averageRating: getRatingAverage(relatedReviews, "rating"),
    reviewCount: relatedReviews.length,
    surfaceRating: getRatingAverage(relatedReviews, "surfaceRating"),
    rimRating: getRatingAverage(relatedReviews, "rimRating"),
    lightingRating: getRatingAverage(relatedReviews, "lightingRating"),
    crowdRating: getRatingAverage(relatedReviews, "crowdRating"),
    locationAccuracy: getRatingAverage(relatedReviews, "locationAccuracy"),
  };
}

export function getRegisteredCourts(stateOrSettings = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const approvedCourts = (settings.approvedCourts ?? []).filter(isActiveModerationItem);
  const courtReviews = (settings.courtReviews ?? []).filter(isActiveModerationItem);
  const byId = new Map(COURTS.map((court) => [court.id, court]));
  approvedCourts.forEach((court) => {
    if (!court?.id) return;
    byId.set(court.id, court);
  });
  return [...byId.values()].map((court) => {
    const reviewSummary = getCourtReviewSummary(court, courtReviews);
    return {
      ...court,
      reviewSummary,
      rating: reviewSummary.averageRating,
      reviewCount: reviewSummary.reviewCount,
    };
  });
}
