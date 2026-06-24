import { COURTS } from "./constants.js";

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

export function getRegisteredCourts(stateOrSettings = {}) {
  const settings = stateOrSettings.settings ? stateOrSettings.settings : stateOrSettings;
  const approvedCourts = settings.approvedCourts ?? [];
  const byId = new Map(COURTS.map((court) => [court.id, court]));
  approvedCourts.forEach((court) => {
    if (!court?.id) return;
    byId.set(court.id, court);
  });
  return [...byId.values()];
}
