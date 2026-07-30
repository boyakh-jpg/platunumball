import { getCourtFacilityBaseName, getCourtStandardName } from "../../lib/courts.js";

export const ACTION_COLUMN_WIDTH = 250;

export const MAP_WINDOW_NAME = "rankball-court-map";

export const STREET_VIEW_WINDOW_NAME = "rankball-court-street-view";

export const DEFAULT_COURT_FILTERS = {
  name: "", facilityName: "", courtUnit: "", indoorOutdoor: "", venueType: "", courtKind: "",
  surfaceType: "", courtLayout: "", hoopCount: "", accessType: "", reservationRequired: "",
  paid: "", lighting: "", publicAccess: "", operatorName: "", contactPhone: "", officialUrl: "",
  reservationUrl: "", openingHoursText: "", applicationMethod: "", operationalStatus: "",
  verificationStatus: "", status: "", sido: "", sigungu: "", emd: "", detailAddress: "",
  locationNote: "", accessNote: "", facilityAreaSqm: "", facilityAreaScope: "",
  modificationCount: "zero", registrationOrigin: "", updatedAt: "", id: "", hashtag: "",
  address: "", roadAddress: "", jibunAddress: "", zonecode: "", lat: "", lng: "",
  nameEvidenceDecision: "", nameEvidenceApplicationStatus: "", nameEvidenceReference: "",
  nameEvidenceKind: "", nameEvidenceRelation: "", nameEvidenceDistanceM: "",
  nameEvidenceProposedFacility: "", nameEvidenceAppliedFacility: "", nameEvidenceUrl: "",
  nameEvidenceSnapshotDate: "", regionalAliasNo: "", reviewCount: "zero", reviewedAt: "",
  reviewedBy: "", reviewScenario: "",
};

export const EMPTY_HISTORY_FILTERS = {
  createdAt: "", courtId: "", sigungu: "", changedByName: "", changedFields: "",
  changesText: "", changeSource: "", reason: "",
};

export const COURT_COLUMNS = [
  { key: "facilityName", rowKey: "facility_name", patchKey: "facilityName", label: "시설명", width: "210px", editor: "text", required: true },
  { key: "nameEvidenceDecision", rowKey: "name_evidence_decision", patchKey: "nameEvidenceDecision", label: "명칭판정", width: "125px", editor: "select", type: "nameEvidenceDecision", nullable: false, requiresNameEvidence: true },
  { key: "nameEvidenceDistanceM", rowKey: "name_evidence_distance_m", label: "거리(m)", width: "90px", readOnly: true },
  { key: "courtUnit", rowKey: "court_unit", patchKey: "courtUnit", label: "코트", width: "100px", editor: "text" },
  { key: "indoorOutdoor", rowKey: "indoor_outdoor", patchKey: "indoorOutdoor", label: "실내외", width: "100px", editor: "select", type: "indoorOutdoor" },
  { key: "venueType", rowKey: "venue_type", patchKey: "venueType", label: "시설유형", width: "115px", editor: "select", type: "venueType" },
  { key: "courtKind", rowKey: "court_kind", patchKey: "courtKind", label: "구장분류", width: "110px", editor: "select", type: "courtKind" },
  { key: "surfaceType", rowKey: "surface_type", patchKey: "surfaceType", label: "바닥", width: "115px", editor: "select", type: "surfaceType" },
  { key: "courtLayout", rowKey: "court_layout", patchKey: "courtLayout", label: "코트형태", width: "115px", editor: "select", type: "courtLayout" },
  { key: "hoopCount", rowKey: "hoop_count", patchKey: "hoopCount", label: "골대", width: "80px", editor: "number", min: 1, max: 100 },
  { key: "accessType", rowKey: "access_type", patchKey: "accessType", label: "이용방식", width: "110px", editor: "select", type: "accessType" },
  { key: "reservationRequired", rowKey: "reservation_required", patchKey: "reservationRequired", label: "예약", width: "90px", editor: "select", type: "booleanNullable" },
  { key: "paid", rowKey: "paid", patchKey: "paid", label: "유료", width: "82px", editor: "select", type: "booleanNullable" },
  { key: "lighting", rowKey: "lighting", patchKey: "lighting", label: "조명", width: "82px", editor: "select", type: "booleanNullable" },
  { key: "publicAccess", rowKey: "public_access", patchKey: "publicAccess", label: "공개", width: "95px", editor: "select", type: "publicAccess", nullable: false },
  { key: "name", rowKey: "name", label: "표준 구장명", width: "250px", readOnly: true },
  { key: "regionalAliasNo", rowKey: "regional_alias_no", label: "지역순번", width: "95px", type: "number", readOnly: true },
  { key: "reviewCount", rowKey: "admin_review_count", label: "검수횟수", width: "95px", type: "reviewCount", readOnly: true },
  { key: "reviewScenario", rowKey: "admin_review_scenario", label: "최근판정", width: "125px", type: "reviewScenario", readOnly: true },
  { key: "reviewedAt", rowKey: "admin_reviewed_at", label: "검수일", width: "135px", type: "date", readOnly: true },
  { key: "reviewedBy", rowKey: "admin_reviewed_by", label: "검수자", width: "150px", readOnly: true },
  { key: "nameEvidenceApplicationStatus", rowKey: "name_evidence_application_status", patchKey: "nameEvidenceApplicationStatus", label: "반영상태", width: "125px", editor: "select", type: "nameEvidenceApplicationStatus", nullable: false, requiresNameEvidence: true },
  { key: "nameEvidenceReference", rowKey: "name_evidence_reference", label: "근거시설", width: "220px", readOnly: true },
  { key: "nameEvidenceKind", rowKey: "name_evidence_kind", label: "근거유형", width: "125px", type: "nameEvidenceKind", readOnly: true },
  { key: "nameEvidenceRelation", rowKey: "name_evidence_relation", label: "공간관계", width: "105px", type: "nameEvidenceRelation", readOnly: true },
  { key: "nameEvidenceProposedFacility", rowKey: "name_evidence_proposed_facility", patchKey: "nameEvidenceProposedFacility", label: "검수후보", width: "220px", editor: "text", requiresNameEvidence: true },
  { key: "nameEvidenceAppliedFacility", rowKey: "name_evidence_applied_facility", patchKey: "nameEvidenceAppliedFacility", label: "반영시설명", width: "220px", editor: "text", requiresNameEvidence: true },
  { key: "nameEvidenceUrl", rowKey: "name_evidence_url", label: "OSM 근거", width: "105px", type: "osmEvidenceUrl", readOnly: true },
  { key: "nameEvidenceSnapshotDate", rowKey: "name_evidence_snapshot_date", label: "OSM 기준일", width: "120px", type: "date", readOnly: true },
  { key: "operatorName", rowKey: "operator_name", patchKey: "operatorName", label: "관리기관", width: "170px", editor: "text" },
  { key: "contactPhone", rowKey: "contact_phone", patchKey: "contactPhone", label: "연락처", width: "150px", editor: "tel" },
  { key: "officialUrl", rowKey: "official_url", patchKey: "officialUrl", label: "공식 URL", width: "240px", editor: "url" },
  { key: "reservationUrl", rowKey: "reservation_url", patchKey: "reservationUrl", label: "예약 URL", width: "240px", editor: "url" },
  { key: "openingHoursText", rowKey: "opening_hours_text", patchKey: "openingHoursText", label: "운영시간", width: "210px", editor: "text" },
  { key: "applicationMethod", rowKey: "application_method", patchKey: "applicationMethod", label: "신청방법", width: "210px", editor: "text" },
  { key: "operationalStatus", rowKey: "operational_status", patchKey: "operationalStatus", label: "운영상태", width: "110px", editor: "select", type: "operationalStatus", nullable: false },
  { key: "verificationStatus", rowKey: "verification_status", patchKey: "verificationStatus", label: "검증상태", width: "120px", editor: "select", type: "verificationStatus", nullable: false },
  { key: "status", rowKey: "status", patchKey: "status", label: "노출상태", width: "105px", editor: "select", type: "status", nullable: false },
  { key: "sido", rowKey: "sido", patchKey: "sido", label: "시도", width: "125px", editor: "text" },
  { key: "sigungu", rowKey: "sigungu", patchKey: "sigungu", label: "시군구", width: "135px", editor: "text" },
  { key: "emd", rowKey: "emd", patchKey: "emd", label: "읍면동", width: "120px", editor: "text" },
  { key: "detailAddress", rowKey: "detail_address", patchKey: "detailAddress", label: "상세주소", width: "210px", editor: "text" },
  { key: "locationNote", rowKey: "location_note", patchKey: "locationNote", label: "위치메모", width: "240px", editor: "text" },
  { key: "accessNote", rowKey: "access_note", patchKey: "accessNote", label: "접근메모", width: "240px", editor: "text" },
  { key: "facilityAreaSqm", rowKey: "facility_area_sqm", patchKey: "facilityAreaSqm", label: "면적(㎡)", width: "105px", editor: "number", min: 0.01 },
  { key: "facilityAreaScope", rowKey: "facility_area_scope", patchKey: "facilityAreaScope", label: "면적범위", width: "110px", editor: "select", type: "facilityAreaScope" },
  { key: "modificationCount", rowKey: "name_modification_count", label: "이름수정", width: "95px", type: "modificationCount", readOnly: true },
  { key: "registrationOrigin", rowKey: "registration_origin", label: "등록출처", width: "110px", type: "origin", readOnly: true },
  { key: "updatedAt", rowKey: "updated_at", label: "수정일", width: "135px", type: "date", readOnly: true },
  { key: "id", rowKey: "id", label: "ID", width: "190px", readOnly: true },
  { key: "hashtag", rowKey: "hashtag", patchKey: "hashtag", label: "해시태그", width: "110px", editor: "text" },
  { key: "address", rowKey: "address_text", patchKey: "addressText", label: "대표주소", width: "290px", editor: "text", required: true },
  { key: "roadAddress", rowKey: "road_address", patchKey: "roadAddress", label: "도로명주소", width: "290px", editor: "text" },
  { key: "jibunAddress", rowKey: "jibun_address", patchKey: "jibunAddress", label: "지번주소", width: "290px", editor: "text" },
  { key: "zonecode", rowKey: "zonecode", patchKey: "zonecode", label: "우편번호", width: "95px", editor: "text" },
  { key: "lat", rowKey: "lat", patchKey: "lat", label: "위도", width: "130px", editor: "number", min: -90, max: 90, step: "any", coordinate: true },
  { key: "lng", rowKey: "lng", patchKey: "lng", label: "경도", width: "130px", editor: "number", min: -180, max: 180, step: "any", coordinate: true },
];

export const HISTORY_COLUMNS = [
  { key: "createdAt", rowKey: "created_at", label: "시각", width: "155px", type: "date" },
  { key: "courtId", rowKey: "court_id", label: "구장 ID", width: "190px" },
  { key: "sigungu", rowKey: "sigungu", label: "시군구", width: "135px" },
  { key: "changedByName", rowKey: "changed_by_name", label: "처리자", width: "130px" },
  { key: "changedFields", rowKey: "changed_fields", label: "수정 필드", width: "240px" },
  { key: "changesText", rowKey: "changes", label: "변경 내용", width: "720px" },
  { key: "changeSource", rowKey: "change_source", label: "유형", width: "95px", type: "source" },
  { key: "reason", rowKey: "reason", label: "사유", width: "260px" },
];

export const SELECT_OPTIONS = {
  indoorOutdoor: [["", "전체"], ["__null__", "미입력"], ["outdoor", "야외"], ["indoor", "실내"], ["mixed", "혼합"], ["unknown", "알 수 없음"]],
  venueType: [["", "전체"], ["__null__", "미입력"], ["park", "공원"], ["sports_facility", "체육시설"], ["public_facility", "공공시설"], ["school", "학교"], ["apartment", "아파트"], ["unknown", "알 수 없음"]],
  courtKind: [["", "전체"], ["__null__", "미입력"], ["official", "정규"], ["street_hoop", "길거리"], ["unknown", "알 수 없음"]],
  surfaceType: [["", "전체"], ["__null__", "미입력"], ["asphalt", "아스팔트"], ["urethane", "우레탄"], ["dirt", "흙"], ["indoor_wood", "실내목재"], ["indoor_synthetic", "실내합성"], ["unknown", "알 수 없음"]],
  courtLayout: [["", "전체"], ["__null__", "미입력"], ["full", "풀코트"], ["half", "하프코트"], ["single_hoop", "단일골대"], ["unknown", "알 수 없음"]],
  accessType: [["", "전체"], ["__null__", "미입력"], ["walk_in", "자유이용"], ["reservation", "예약"], ["restricted", "제한"], ["unknown", "알 수 없음"]],
  booleanNullable: [["", "전체"], ["__null__", "미입력"], ["true", "예"], ["false", "아니오"]],
  publicAccess: [["", "전체"], ["__null__", "미입력"], ["public", "공개"], ["private", "비공개"], ["unknown", "알 수 없음"]],
  operationalStatus: [["", "전체"], ["__null__", "미입력"], ["active", "운영"], ["pending", "확인 중"], ["closed", "폐쇄"], ["unknown", "알 수 없음"]],
  verificationStatus: [["", "전체"], ["__null__", "미입력"], ["pending", "미검증"], ["source_verified", "출처검증"], ["verified", "검증완료"], ["review_required", "검토필요"]],
  status: [["", "전체"], ["active", "활성"], ["hidden", "임시 숨김"], ["disabled", "비활성"]],
  facilityAreaScope: [["", "전체"], ["__null__", "미입력"], ["court", "코트"], ["facility", "시설전체"], ["unknown", "알 수 없음"]],
  nameEvidenceDecision: [["", "전체"], ["__null__", "근거 없음"], ["auto_apply", "자동 확정"], ["review_required", "30~80m 검수"], ["administrative_fallback", "행정동 fallback"], ["unresolved", "미해결"]],
  nameEvidenceApplicationStatus: [["", "전체"], ["__null__", "근거 없음"], ["applied", "반영"], ["unchanged", "변경 없음"], ["skipped_duplicate", "중복 건너뜀"], ["skipped_manual", "수동 보호"], ["pending", "대기"], ["not_applicable", "미적용"]],
  nameEvidenceKind: [["", "전체"], ["__null__", "근거 없음"], ["exact_court", "코트 자체"], ["sports_centre", "체육시설"], ["school", "학교"], ["building", "건물"], ["park_ground", "공원·운동장"], ["community_centre", "공공시설"], ["landmark", "주변시설"], ["administrative", "OSM 행정구역"], ["stored_administrative", "저장 읍면동"]],
  nameEvidenceRelation: [["", "전체"], ["__null__", "근거 없음"], ["self", "코트 자체"], ["inside", "polygon 내부"], ["site_member", "같은 부지"], ["nearby", "인접"], ["administrative", "행정구역"], ["none", "미해결"]],
  modificationCount: [["zero", "0회"], ["positive", "1회 이상"], ["", "전체"]],
  reviewCount: [["zero", "0회"], ["positive", "1회 이상"], ["", "전체"]],
  reviewScenario: [["", "전체"], ["__null__", "미검수"], ["manual", "수동 저장"], ["public", "공개"], ["private", "비공개"], ["regional_alias", "읍면동 순번명"], ["review_required", "추가 확인"], ["closed", "폐쇄"], ["duplicate", "중복"]],
  origin: [["", "전체"], ["public_import", "공공데이터"], ["user_request", "사용자 신청"], ["system", "시스템"]],
  source: [["", "전체"], ["admin", "관리자"], ["system", "시스템"]],
};

export const REVIEW_SCENARIOS = [
  { id: "public", label: "공개", description: "검증 완료 + 공개", tone: "success" },
  { id: "private", label: "비공개", description: "검증 완료 + 비공개", tone: "neutral" },
  { id: "regional_alias", label: "읍면동 순번명", description: "같은 장소 번호 재사용", tone: "accent" },
  { id: "review_required", label: "추가 확인", description: "숨김 + 검토 대기", tone: "warning" },
  { id: "closed", label: "폐쇄", description: "운영 종료 + 비활성", tone: "danger" },
  { id: "duplicate", label: "중복", description: "중복 행 비활성", tone: "danger" },
];

export const REVIEW_CHIP_GROUPS = [
  { key: "indoorOutdoor", label: "실내외", options: [["outdoor", "야외"], ["indoor", "실내"], ["mixed", "혼합"], ["unknown", "모름"]] },
  { key: "venueType", label: "시설유형", options: [["park", "공원"], ["sports_facility", "체육시설"], ["public_facility", "공공시설"], ["school", "학교"], ["apartment", "아파트"], ["unknown", "모름"]] },
  { key: "courtKind", label: "구장분류", options: [["official", "정규"], ["street_hoop", "길거리"], ["unknown", "모름"]] },
  { key: "surfaceType", label: "바닥", options: [["asphalt", "아스팔트"], ["urethane", "우레탄"], ["dirt", "흙"], ["indoor_wood", "실내목재"], ["indoor_synthetic", "실내합성"], ["unknown", "모름"]] },
  { key: "courtLayout", label: "코트형태", options: [["full", "풀코트"], ["half", "하프코트"], ["single_hoop", "단일골대"], ["unknown", "모름"]] },
  { key: "hoopCount", label: "골대", options: [[1, "1개"], [2, "2개"], [3, "3개"], [4, "4개"], [null, "미입력"]] },
  { key: "accessType", label: "이용방식", options: [["walk_in", "자유이용"], ["reservation", "예약"], ["restricted", "제한"], ["unknown", "모름"]] },
  { key: "paid", label: "유료", options: [[false, "무료"], [true, "유료"], [null, "미입력"]] },
  { key: "lighting", label: "조명", options: [[true, "있음"], [false, "없음"], [null, "미입력"]] },
];

export const COURT_UNIT_CHIPS = [[null, "미구분"], ["1코트", "1코트"], ["2코트", "2코트"], ["3코트", "3코트"], ["A코트", "A코트"], ["B코트", "B코트"]];

export const REVIEW_PRIORITY_LABELS = ["검토 필요", "검증 대기", "정보 보완", "검증 완료"];

export const LABELS = Object.fromEntries(
  Object.values(SELECT_OPTIONS).flat().filter(([id]) => id && id !== "__null__"),
);

export const FIELD_LABELS = {
  ...Object.fromEntries(COURT_COLUMNS.filter((column) => column.patchKey || column.key === "name").map((column) => [column.patchKey || column.key, column.label])),
  adminReviewCount: "검수횟수",
  adminReviewScenario: "최근판정",
  adminReviewedAt: "검수일",
  regionalAliasNo: "지역순번",
  regionalAliasRegionKey: "지역순번 범위",
};

export const EDITABLE_COLUMNS = COURT_COLUMNS.filter((column) => column.patchKey);

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export function formatValue(column, value) {
  if (column.type === "date") return formatDateTime(value);
  if (column.type === "booleanNullable") return value === true ? "예" : value === false ? "아니오" : "미입력";
  if (column.type === "modificationCount" || column.type === "reviewCount") return `${Number(value ?? 0).toLocaleString()}회`;
  if (column.coordinate) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(6) : "-";
  }
  if (value === null || value === undefined || value === "") return "-";
  const typedLabel = SELECT_OPTIONS[column.type]?.find(([id]) => id === String(value))?.[1];
  return typedLabel ?? LABELS[value] ?? String(value);
}

export function normalizeEditValue(column, value) {
  if (column.editor === "number") {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (column.editor === "select") return value ?? null;
  const text = String(value ?? "").trim();
  return text || null;
}

export function buildRowDraft(row) {
  return Object.fromEntries(EDITABLE_COLUMNS.map((column) => {
    let value = row[column.rowKey] ?? null;
    if (column.patchKey === "facilityName" && !value) {
      value = getCourtFacilityBaseName(row.name, row.sigungu, row.court_unit);
    }
    return [column.patchKey, value];
  }));
}

export function buildPatch(draft) {
  if (!draft) return {};
  return Object.fromEntries(EDITABLE_COLUMNS.flatMap((column) => {
    const before = normalizeEditValue(column, draft.original[column.patchKey]);
    const after = normalizeEditValue(column, draft.values[column.patchKey]);
    return Object.is(before, after) ? [] : [[column.patchKey, after]];
  }));
}

export function isColumnEditable(row, column) {
  if (!column.patchKey) return false;
  return !column.requiresNameEvidence || Boolean(row.name_evidence_decision);
}

export function getDraftCourtName(row, values) {
  return getCourtStandardName({
    ...row,
    facilityName: values.facilityName,
    courtUnit: values.courtUnit,
    sido: values.sido,
    sigungu: values.sigungu,
    addressText: values.addressText,
  });
}

export function validatePatch(values, patch, allowEmpty = false) {
  if (!allowEmpty && !Object.keys(patch).length) return "수정된 셀이 없습니다.";
  if (!String(values.facilityName ?? "").trim()) return "시설명은 비울 수 없습니다.";
  if (!String(values.addressText ?? "").trim()) return "대표주소는 비울 수 없습니다.";
  const lat = normalizeEditValue(COURT_COLUMNS.find((column) => column.patchKey === "lat"), values.lat);
  const lng = normalizeEditValue(COURT_COLUMNS.find((column) => column.patchKey === "lng"), values.lng);
  if ((lat === null) !== (lng === null)) return "위도와 경도는 함께 입력하거나 함께 비워야 합니다.";
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return "위도 범위를 확인해 주세요.";
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return "경도 범위를 확인해 주세요.";
  const hoopCount = normalizeEditValue(COURT_COLUMNS.find((column) => column.patchKey === "hoopCount"), values.hoopCount);
  if (hoopCount !== null && (!Number.isInteger(hoopCount) || hoopCount < 1 || hoopCount > 100)) return "골대 수는 1~100 정수로 입력해 주세요.";
  const facilityArea = normalizeEditValue(COURT_COLUMNS.find((column) => column.patchKey === "facilityAreaSqm"), values.facilityAreaSqm);
  if (facilityArea !== null && (!Number.isFinite(facilityArea) || facilityArea <= 0)) return "면적은 0보다 커야 합니다.";
  for (const key of ["officialUrl", "reservationUrl"]) {
    const url = String(values[key] ?? "").trim();
    if (url && !url.startsWith("https://")) return `${FIELD_LABELS[key]}은 https:// 주소만 사용할 수 있습니다.`;
  }
  return "";
}

export function getSaveErrorMessage(errorCode = "") {
  const code = String(errorCode);
  if (code.includes("court_name_evidence_not_found")) return "OSM 명칭 근거가 없는 구장은 판정 정보를 수정할 수 없습니다.";
  if (code.includes("court_regional_alias_emd_required")) return "읍면동을 먼저 확인해야 지역 순번명을 만들 수 있습니다.";
  if (code.includes("court_regional_alias_location_patch_invalid")) return "지역 순번명 처리와 주소·좌표 수정은 따로 저장해 주세요.";
  if (code.includes("court_unit_required_for_shared_location")) return "같은 장소에 여러 구장이 있습니다. 1코트·2코트처럼 코트 구분을 먼저 선택해 주세요.";
  if (code.includes("court_review_scenario_invalid")) return "지원하지 않는 검수 시나리오입니다.";
  if (code.includes("url_invalid")) return "URL은 https:// 주소만 저장할 수 있습니다.";
  if (code.includes("coordinates_invalid")) return "위도·경도 값을 확인해 주세요.";
  if (code.includes("duplicate") || code === "23505") return "같은 구장으로 판정되는 데이터가 이미 있습니다.";
  if (code.includes("permission")) return "구장 DB 수정 권한이 없습니다.";
  if (code.includes("unchanged")) return "실제로 변경된 값이 없습니다.";
  return "구장 정보를 저장하지 못했습니다.";
}

export function getMobileMapPlatform() {
  if (typeof navigator === "undefined") return "";
  const userAgent = String(navigator.userAgent || "");
  if (/Android/i.test(userAgent)) return "android";
  if (navigator.userAgentData?.mobile || /iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  return "";
}
