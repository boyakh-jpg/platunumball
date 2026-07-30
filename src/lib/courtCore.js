import { COURTS, getCanonicalRegion, isSameRegion } from "./constants.js";
import { getCourtHashtag } from "./handles.js";
import { getSafeHttpUrl } from "./inputSecurity.js";
import { isWithinOneEdit as isWithinOneCourtSearchEdit } from "../../shared/lib/fuzzyText.js";
import {
  buildCourtAddressNameUpdates,
  getCourtAddressFacilityName,
  getCourtAddressKey,
  getCourtFacilityBaseName,
  getCourtRequestName,
  getCourtStandardName,
  normalizeCourtFacilityName,
  normalizeCourtNamePart,
  normalizeCourtSigungu,
} from "../../shared/lib/courts.js";
export {
  buildCourtAddressNameUpdates,
  getCourtAddressFacilityName,
  getCourtAddressKey,
  getCourtFacilityBaseName,
  getCourtRequestName,
  getCourtStandardName,
  normalizeCourtFacilityName,
  normalizeCourtNamePart,
  normalizeCourtSigungu,
};
import { normalizeCourtOptionalBoolean } from "../../shared/lib/courtPolicy.js";
export { normalizeCourtOptionalBoolean };
const COURT_REGION_ADDRESS_LABELS = Object.freeze({
  마포: "마포구",
  성수: "성수동",
  광진: "광진구",
  잠실: "잠실동",
  강남: "강남구",
  서초: "서초구",
  동작: "동작구",
  성동: "성동구",
  서대문: "서대문구",
  영등포: "영등포구",
});
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
export const COURT_TYPE_OPTIONS = [
  { id: "확인 필요", label: "확인 필요" },
  { id: "야외", label: "야외" },
  { id: "실내", label: "실내" },
];
export const COURT_KIND_OPTIONS = [
  { id: "unknown", label: "확인 필요" },
  { id: "official", label: "정식구장" },
  { id: "street_hoop", label: "골목/길농" },
];
export const COURT_ACCESS_OPTIONS = [
  { id: "unknown", label: "확인 필요" },
  { id: "walk_in", label: "자유 이용" },
  { id: "reservation", label: "예약 필요" },
  { id: "restricted", label: "출입 제한" },
];
export const COURT_PUBLIC_ACCESS_OPTIONS = [
  { id: "unknown", label: "알 수 없음" },
  { id: "public", label: "공개" },
  { id: "private", label: "비공개" },
];
export const COURT_CORRECTION_FIELD_OPTIONS = [
  { id: "name", label: "시설명" },
  { id: "location", label: "위치·주소" },
  { id: "access", label: "공개·이용 방식" },
  { id: "operation", label: "운영·폐쇄 상태" },
  { id: "court", label: "코트 유형·시설" },
  { id: "contact", label: "연락처·예약 URL" },
  { id: "duplicate", label: "중복 구장" },
  { id: "other", label: "기타" },
];
const COURT_CORRECTION_BOOLEAN_OPTIONS = Object.freeze([
  { id: "true", label: "있음" },
  { id: "false", label: "없음" },
  { id: "null", label: "확인 필요" },
]);
export const COURT_CORRECTION_ATTRIBUTE_OPTIONS = Object.freeze({
  access: [
    { id: "publicAccess", label: "공개 범위", options: COURT_PUBLIC_ACCESS_OPTIONS },
    { id: "accessType", label: "이용 방식", options: COURT_ACCESS_OPTIONS },
    {
      id: "paid",
      label: "이용료",
      options: [
        { id: "true", label: "유료" },
        { id: "false", label: "무료" },
        { id: "null", label: "확인 필요" },
      ],
    },
  ],
  operation: [
    {
      id: "operationalStatus",
      label: "운영 상태",
      options: [
        { id: "active", label: "운영 중" },
        { id: "pending", label: "확인 중" },
        { id: "closed", label: "폐쇄" },
        { id: "unknown", label: "확인 필요" },
      ],
    },
  ],
  court: [
    {
      id: "indoorOutdoor",
      label: "실내외",
      options: [
        { id: "outdoor", label: "야외" },
        { id: "indoor", label: "실내" },
        { id: "mixed", label: "혼합" },
        { id: "unknown", label: "확인 필요" },
      ],
    },
    { id: "courtKind", label: "구장 유형", options: COURT_KIND_OPTIONS },
    { id: "surfaceType", label: "바닥", options: COURT_SURFACE_OPTIONS },
    { id: "courtLayout", label: "코트 형태", options: COURT_LAYOUT_OPTIONS },
    { id: "lighting", label: "조명", options: COURT_CORRECTION_BOOLEAN_OPTIONS },
  ],
});
export function getCourtCorrectionFieldLabel(value = "") {
  return COURT_CORRECTION_FIELD_OPTIONS.find((option) => option.id === value)?.label ?? "기타";
}
export function getCourtCorrectionAttributeOptions(field = "") {
  return COURT_CORRECTION_ATTRIBUTE_OPTIONS[field] ?? [];
}
export function getCourtCorrectionAttribute(correction = {}) {
  return getCourtCorrectionAttributeOptions(correction.field)
    .find((option) => option.id === correction.attribute) ?? null;
}
export function getCourtCorrectionAttributeLabel(correction = {}) {
  return getCourtCorrectionAttribute(correction)?.label ?? "";
}
export function getCourtCorrectionProposedLabel(correction = {}) {
  const attribute = getCourtCorrectionAttribute(correction);
  return attribute?.options.find((option) => option.id === String(correction.proposedValue))?.label
    ?? String(correction.proposedValue ?? "");
}
export function getCourtCorrectionPatch(correction = {}) {
  const attribute = getCourtCorrectionAttribute(correction);
  const option = attribute?.options.find((item) => item.id === String(correction.proposedValue));
  if (!attribute || !option) return null;
  if (["paid", "lighting"].includes(attribute.id)) {
    return { [attribute.id]: option.id === "null" ? null : option.id === "true" };
  }
  return { [attribute.id]: option.id };
}
export const COURT_SOURCE_URL_MAX_LENGTH = 500;
export function normalizeCourtType(value = "") {
  const normalized = String(value ?? "").trim();
  if (["야외", "outdoor"].includes(normalized)) return "야외";
  if (["실내", "indoor"].includes(normalized)) return "실내";
  return "확인 필요";
}
export function normalizeCourtKind(value = "") {
  const normalized = String(value ?? "").trim();
  return COURT_KIND_OPTIONS.some((option) => option.id === normalized) ? normalized : "unknown";
}
export function normalizeCourtAccessType(value = "", reservation = null) {
  const normalized = String(value ?? "").trim();
  if (normalized === "open") return "walk_in";
  if (COURT_ACCESS_OPTIONS.some((option) => option.id === normalized)) return normalized;
  if (reservation === true) return "reservation";
  if (reservation === false) return "walk_in";
  return "unknown";
}
export function normalizeCourtPublicAccess(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["public", "공개"].includes(normalized)) return "public";
  if (["private", "비공개"].includes(normalized)) return "private";
  return "unknown";
}
export function normalizeCourtSourceUrl(value = "") {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > COURT_SOURCE_URL_MAX_LENGTH) return "";
  return getSafeHttpUrl(normalized);
}
export function getCourtKindLabel(court = {}) {
  return COURT_KIND_OPTIONS.find((option) => option.id === normalizeCourtKind(court.courtKind))?.label ?? "확인 필요";
}
export function getCourtAccessLabel(court = {}) {
  const accessType = normalizeCourtAccessType(court.accessType, court.reservation);
  return COURT_ACCESS_OPTIONS.find((option) => option.id === accessType)?.label ?? "확인 필요";
}
export function getCourtPublicAccessLabel(court = {}) {
  const publicAccess = normalizeCourtPublicAccess(court.publicAccess);
  return COURT_PUBLIC_ACCESS_OPTIONS.find((option) => option.id === publicAccess)?.label ?? "알 수 없음";
}
export function getCourtPaidLabel(court = {}) {
  const paid = normalizeCourtOptionalBoolean(court.paid);
  if (paid === true) return "유료";
  if (paid === false) return "무료";
  return "비용 확인 필요";
}
const LEGACY_COURT_NOTE_REPLACEMENTS = Object.freeze([
  [". 핀은 시설 주소 기준이다.", ". 핀은 시설 주소를 기준으로 표시됩니다."],
  [". 대관 가능 여부를 확인한다.", ". 대관 가능 여부를 확인해 주세요."],
  [". 대관 일정과 출입구를 확인한다.", ". 대관 일정과 출입구를 확인해 주세요."],
  [". 대관 일정을 확인한다.", ". 대관 일정을 확인해 주세요."],
]);
export function getCourtLocationNote(value = "") {
  const note = String(value ?? "").trim();
  const replacement = LEGACY_COURT_NOTE_REPLACEMENTS.find(([suffix]) => note.endsWith(suffix));
  return replacement ? `${note.slice(0, -replacement[0].length)}${replacement[1]}` : note;
}
export function getCourtLightingLabel(court = {}) {
  const lighting = normalizeCourtOptionalBoolean(court.lighting);
  if (lighting === true) return "야간 조명 있음";
  if (lighting === false) return "야간 조명 없음";
  return "조명 확인 필요";
}
export function getCourtReservationValue(court = {}) {
  const accessType = normalizeCourtAccessType(court.accessType, court.reservation);
  if (accessType === "reservation") return true;
  if (accessType === "walk_in") return false;
  return null;
}
export function getCourtHoopCount(court = {}) {
  const explicitValue = court.hoopCount;
  const explicitCount = Number(explicitValue);
  if (explicitValue !== null && explicitValue !== undefined && explicitValue !== "" && Number.isInteger(explicitCount) && explicitCount >= 0) return explicitCount;
  const courtLayout = normalizeCourtLayout(court.courtLayout);
  if (["half", "single_hoop"].includes(courtLayout)) return 1;
  if (courtLayout === "full") return 2;
  return null;
}
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
export function getCourtCoordinate(court) {
  if (!court || typeof court !== "object") return null;
  const lat = getOptionalCourtCoordinate(court.lat, -90, 90)
    ?? getOptionalCourtCoordinate(court.latitude, -90, 90);
  const lng = getOptionalCourtCoordinate(court.lng, -180, 180)
    ?? getOptionalCourtCoordinate(court.longitude, -180, 180);
  return lat !== null && lng !== null ? { lat, lng } : null;
}
export function getCourtMapUrl(court = {}) {
  const coordinate = getCourtCoordinate(court);
  const address = String(court.roadAddress || court.road_address || court.addressText || court.address_text || court.jibunAddress || court.jibun_address || "").trim();
  const title = String(court.name || "").trim() || address || "농구장";
  const query = address || title;
  if (coordinate) {
    return `https://map.naver.com/?lng=${coordinate.lng}&lat=${coordinate.lat}&title=${encodeURIComponent(title)}`;
  }
  return `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
}
export function getCourtNaverMapAppUrl(court = {}, platform = "ios") {
  const coordinate = getCourtCoordinate(court);
  const address = String(court.roadAddress || court.road_address || court.addressText || court.address_text || court.jibunAddress || court.jibun_address || "").trim();
  const title = String(court.name || "").trim() || address || "농구장";
  const appName = "https://boxtier.kr";
  const action = coordinate
    ? `place?lat=${coordinate.lat}&lng=${coordinate.lng}&name=${encodeURIComponent(title)}&appname=${encodeURIComponent(appName)}`
    : `search?query=${encodeURIComponent(address || title)}&appname=${encodeURIComponent(appName)}`;
  if (platform === "android") {
    return `intent://${action}#Intent;scheme=nmap;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.nhn.android.nmap;end`;
  }
  return `nmap://${action}`;
}
export function getAdminCourtStreetViewUrl(court = {}) {
  const coordinate = getCourtCoordinate(court);
  const address = String(court.roadAddress || court.road_address || court.addressText || court.address_text || court.jibunAddress || court.jibun_address || "").trim();
  const params = new URLSearchParams({
    view: "panorama",
    name: String(court.name || "").trim() || address || "농구장",
    address,
  });
  if (coordinate) {
    params.set("lat", String(coordinate.lat));
    params.set("lng", String(coordinate.lng));
  }
  return `/app/admin/court-map?${params.toString()}`;
}
function getFallbackSurfaceType(court = {}) {
  if (court.surfaceType) return court.surfaceType;
  if (String(court.type ?? "").includes("실내")) return "indoor_synthetic";
  return "unknown";
}
export function getFallbackLayout(court = {}) {
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
export function getCourtSearchText(court = {}) {
  return [
    court.name,
    getCourtHashtag(court),
    court.region,
    court.type,
    getCourtAddress(court),
    court.roadAddress,
    court.jibunAddress,
    getCourtSurfaceLabel(court),
    getCourtLayoutLabel(court),
  ].filter(Boolean).join(" ");
}
export function isCourtInRegion(court = {}, region = "") {
  const targetRegion = String(region ?? "").trim();
  if (!targetRegion || targetRegion === "전체") return true;
  const targetRegionParts = targetRegion.split(/\s+/).filter(Boolean);
  const targetSido = targetRegionParts.length > 1 && /(?:특별자치시|특별시|광역시|도)$/u.test(targetRegionParts[0])
    ? targetRegionParts[0]
    : "";
  const courtAddressSido = [court.addressText, court.roadAddress, court.jibunAddress]
    .map((value) => String(value ?? "").trim().split(/\s+/)[0])
    .find((value) => /(?:특별자치시|특별시|광역시|도)$/u.test(value)) ?? "";
  const courtSido = String(court.sido ?? "").trim() || courtAddressSido;
  if (targetSido && courtSido && !isSameRegion(courtSido, targetSido)) return false;
  const mappedRegion = String(court.region ?? "").replace(/\s+/g, "").toLowerCase();
  const mappedSido = String(court.sido ?? "").replace(/\s+/g, "").toLowerCase();
  if ([
    mappedRegion && mappedRegion !== mappedSido ? court.region : "",
    court.sigungu,
    court.regionKey,
    court.emd,
  ].some((value) => isSameRegion(value, targetRegion))) return true;
  const canonicalRegion = getCanonicalRegion(targetRegion);
  const addressRegion = COURT_REGION_ADDRESS_LABELS[canonicalRegion]
    ?? targetRegion.split(/\s+/).filter(Boolean).reverse().find((value) => /[시군구]$/u.test(value))
    ?? canonicalRegion;
  const normalizedAddressRegion = String(addressRegion).replace(/\s+/g, "").toLowerCase();
  return [court.addressText, court.roadAddress, court.jibunAddress]
    .some((value) => String(value ?? "").replace(/\s+/g, "").toLowerCase().includes(normalizedAddressRegion));
}
export function mergeCourtSearchCourts(directoryCourts = [], discoveredCourts = []) {
  const byId = new Map(directoryCourts.filter((court) => court?.id).map((court) => [court.id, court]));
  discoveredCourts.forEach((court) => {
    if (court?.id && !byId.has(court.id)) byId.set(court.id, court);
  });
  return [...byId.values()];
}
export function getCourtRecommendationScore(court = {}) {
  const rating = Number(court.adjustedRating ?? court.reviewSummary?.adjustedRating ?? court.rating ?? 3.5);
  const completedMatchCount = Math.max(0, Number(court.completedMatchCount ?? 0));
  if (court.recommendationScore !== null && court.recommendationScore !== undefined && Number.isFinite(Number(court.recommendationScore))) {
    return Number(court.recommendationScore);
  }
  return rating + Math.min(0.8, Math.log1p(completedMatchCount) * 0.2);
}
export function getCourtPickerResults(courts = [], options = {}) {
  const query = String(options.query ?? "").trim();
  const region = String(options.region ?? "").trim();
  const currentRegion = String(options.currentRegion ?? "").trim();
  const favoriteCourtIds = new Set(options.favoriteCourtIds ?? []);
  const normalizedQuery = query.toLowerCase();
  const hasQuery = Boolean(normalizedQuery);
  const regionCandidates = courts.filter((court) => (
    hasQuery || isCourtInRegion(court, region)
  ));
  const exactMatches = regionCandidates.filter((court) => getCourtSearchText(court).toLowerCase().includes(normalizedQuery));
  const matches = exactMatches.length || !hasQuery
    ? exactMatches
    : regionCandidates.filter((court) => isCourtFuzzySearchMatch(court, query));
  return [...matches].sort((a, b) => (
    Number(favoriteCourtIds.has(b.id)) - Number(favoriteCourtIds.has(a.id))
    || Number(isCourtInRegion(b, currentRegion)) - Number(isCourtInRegion(a, currentRegion))
    || getCourtRecommendationScore(b) - getCourtRecommendationScore(a)
    || String(a.name ?? "").localeCompare(String(b.name ?? ""))
  ));
}
function normalizeCourtSearchValue(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
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
