import { COURTS, getCanonicalRegion, isSameRegion } from "./constants.js";
import { getCourtHashtag } from "./handles.js";
import { getSafeHttpUrl } from "./inputSecurity.js";

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

export function normalizeCourtOptionalBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
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

export function normalizeCourtNamePart(value = "") {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/제\s+(\d+)\s*코트/gi, "제$1코트")
    .replace(/([A-Z0-9]+)\s+코트/gi, "$1코트");
}

export function normalizeCourtFacilityName(value = "") {
  const normalized = normalizeCourtNamePart(value)
    .replace(/^\[\s*\d+\s*\]\s*/, "")
    .replace(/^농구장\s*\(\s*([^()]+?)\s*\)$/i, "$1 농구장")
    .replace(/\s*\(\s*((?:실내|실외|야외)\s*)?농구장\s*\)\s*$/i, " $1농구장")
    .replace(/농구\s*코트/gi, "농구장")
    .replace(/([0-9A-Za-z가-힣])농구장/g, "$1 농구장")
    .replace(/농구장\s*(\d+)\s*면/g, "농구장 $1면")
    .replace(/농구장\s*(\d+)(?!\s*면)/g, "농구장 $1")
    .replace(/농구장\s*([A-Z])$/i, (_, unit) => `농구장 ${unit.toUpperCase()}`)
    .replace(/제\s+(\d+)\s*농구장/gi, "제$1 농구장")
    .replace(/농구장\s*및\s*/g, "농구장 및 ");
  return normalizeCourtNamePart(normalized);
}

function stripCourtAddressPrefix(name = "", addressDong = "") {
  const normalizedName = normalizeCourtFacilityName(name);
  const normalizedDong = normalizeCourtNamePart(addressDong);
  if (!normalizedDong || !normalizedName.startsWith(`${normalizedDong} `)) return normalizedName;
  return normalizedName.slice(normalizedDong.length).trim();
}

function normalizeCourtRegionText(value = "") {
  return normalizeCourtNamePart(value).replace(/^세종특별자치시$/, "세종시");
}

function isCourtCityToken(value = "") {
  return /(?:시|군)$/.test(value);
}

function isCourtDistrictToken(value = "") {
  return /구$/.test(value);
}

export function normalizeCourtSigungu(value = "", addressText = "", sido = "", region = "") {
  const safeSido = normalizeCourtRegionText(sido);
  const addressTokens = normalizeCourtNamePart(addressText).split(" ").filter(Boolean);
  let direct = normalizeCourtRegionText(value);
  if (direct === "세종시" || safeSido === "세종시" || addressTokens[0] === "세종특별자치시") return "세종시";

  if (safeSido && direct.startsWith(`${safeSido} `)) direct = direct.slice(safeSido.length).trim();
  const directParts = direct.split(" ").filter(Boolean);
  if (directParts.length > 1 && /(?:특별자치시|특별시|광역시|도)$/.test(directParts[0])) {
    direct = directParts.slice(1).join(" ");
  }

  if (direct) {
    const directTokens = direct.split(" ").filter(Boolean);
    const addressCityIndex = addressTokens.findIndex((token) => token === directTokens[0]);
    if (
      directTokens.length === 1
      && isCourtCityToken(directTokens[0])
      && addressCityIndex >= 0
      && isCourtDistrictToken(addressTokens[addressCityIndex + 1])
    ) {
      return `${directTokens[0]} ${addressTokens[addressCityIndex + 1]}`;
    }
    return direct;
  }

  const localityTokens = addressTokens[0] === safeSido || /(?:특별자치시|특별시|광역시|도)$/.test(addressTokens[0] ?? "")
    ? addressTokens.slice(1)
    : addressTokens;
  if (isCourtCityToken(localityTokens[0]) && isCourtDistrictToken(localityTokens[1])) {
    return `${localityTokens[0]} ${localityTokens[1]}`;
  }
  if (/(?:시|군|구)$/.test(localityTokens[0] ?? "")) return localityTokens[0];

  const safeRegion = normalizeCourtRegionText(region);
  return /(?:시|군|구)$/.test(safeRegion) ? safeRegion : "";
}

export function getCourtFacilityBaseName(rawName = "", sigungu = "", courtUnit = "") {
  let facilityName = normalizeCourtFacilityName(rawName);
  const safeSigungu = normalizeCourtSigungu(sigungu);
  const safeCourtUnit = normalizeCourtNamePart(courtUnit);
  if (safeSigungu && facilityName.startsWith(`${safeSigungu} `)) {
    facilityName = facilityName.slice(safeSigungu.length).trim();
  }
  if (safeCourtUnit && normalizeCourtIdentityText(facilityName).endsWith(normalizeCourtIdentityText(safeCourtUnit))) {
    facilityName = facilityName.slice(0, Math.max(0, facilityName.length - safeCourtUnit.length)).trim();
  }
  facilityName = facilityName
    .replace(/\s*(?:(?:실내|실외|야외)\s*)?농구장\s*$/i, "")
    .replace(/\s*농구\s*코트\s*$/i, "")
    .replace(/[\s·,\-]+$/g, "");
  return normalizeCourtNamePart(facilityName);
}

export function getCourtStandardName(court = {}) {
  const addressText = court.addressText || court.roadAddress || court.jibunAddress;
  const sigungu = normalizeCourtSigungu(court.sigungu, addressText, court.sido, court.region);
  const courtUnit = normalizeCourtNamePart(court.courtUnit ?? court.court_unit);
  const rawFacilityName = court.buildingName || court.facilityName || court.facility_name || court.baseName || court.name;
  const facilityName = getCourtFacilityBaseName(rawFacilityName, sigungu, courtUnit);
  if (!sigungu || !facilityName) return "";
  return normalizeCourtNamePart(`${sigungu} ${facilityName} 농구장${courtUnit ? ` ${courtUnit}` : ""}`);
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
  const standardName = getCourtStandardName(court);
  if (standardName) return standardName;
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
  return "반코트 또는 골대 1개 구장은 5v5 경기를 진행하기에 좁을 수 있습니다. 방을 만들기 전에 참가자와 먼저 합의해 주세요.";
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
