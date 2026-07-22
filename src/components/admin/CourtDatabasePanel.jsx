import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Database, ExternalLink, RotateCcw, Save, X } from "lucide-react";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import { getCourtFacilityBaseName, getCourtMapUrl, getCourtStandardName } from "../../lib/courts.js";

const ACTION_COLUMN_WIDTH = 220;
const MAP_WINDOW_NAME = "rankball-court-map";

const DEFAULT_COURT_FILTERS = {
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
  nameEvidenceSnapshotDate: "",
};

const EMPTY_HISTORY_FILTERS = {
  createdAt: "", courtId: "", sigungu: "", changedByName: "", changedFields: "",
  changesText: "", changeSource: "", reason: "",
};

const COURT_COLUMNS = [
  { key: "name", rowKey: "name", label: "표준 구장명", width: "250px", readOnly: true },
  { key: "facilityName", rowKey: "facility_name", patchKey: "facilityName", label: "시설명", width: "210px", editor: "text", required: true },
  { key: "nameEvidenceDecision", rowKey: "name_evidence_decision", patchKey: "nameEvidenceDecision", label: "명칭판정", width: "125px", editor: "select", type: "nameEvidenceDecision", nullable: false, requiresNameEvidence: true },
  { key: "nameEvidenceApplicationStatus", rowKey: "name_evidence_application_status", patchKey: "nameEvidenceApplicationStatus", label: "반영상태", width: "125px", editor: "select", type: "nameEvidenceApplicationStatus", nullable: false, requiresNameEvidence: true },
  { key: "nameEvidenceReference", rowKey: "name_evidence_reference", label: "근거시설", width: "220px", readOnly: true },
  { key: "nameEvidenceKind", rowKey: "name_evidence_kind", label: "근거유형", width: "125px", type: "nameEvidenceKind", readOnly: true },
  { key: "nameEvidenceRelation", rowKey: "name_evidence_relation", label: "공간관계", width: "105px", type: "nameEvidenceRelation", readOnly: true },
  { key: "nameEvidenceDistanceM", rowKey: "name_evidence_distance_m", label: "거리(m)", width: "90px", readOnly: true },
  { key: "nameEvidenceProposedFacility", rowKey: "name_evidence_proposed_facility", patchKey: "nameEvidenceProposedFacility", label: "검수후보", width: "220px", editor: "text", requiresNameEvidence: true },
  { key: "nameEvidenceAppliedFacility", rowKey: "name_evidence_applied_facility", patchKey: "nameEvidenceAppliedFacility", label: "반영시설명", width: "220px", editor: "text", requiresNameEvidence: true },
  { key: "nameEvidenceUrl", rowKey: "name_evidence_url", label: "OSM 근거", width: "105px", type: "osmEvidenceUrl", readOnly: true },
  { key: "nameEvidenceSnapshotDate", rowKey: "name_evidence_snapshot_date", label: "OSM 기준일", width: "120px", type: "date", readOnly: true },
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

const HISTORY_COLUMNS = [
  { key: "createdAt", rowKey: "created_at", label: "시각", width: "155px", type: "date" },
  { key: "courtId", rowKey: "court_id", label: "구장 ID", width: "190px" },
  { key: "sigungu", rowKey: "sigungu", label: "시군구", width: "135px" },
  { key: "changedByName", rowKey: "changed_by_name", label: "처리자", width: "130px" },
  { key: "changedFields", rowKey: "changed_fields", label: "수정 필드", width: "240px" },
  { key: "changesText", rowKey: "changes", label: "변경 내용", width: "720px" },
  { key: "changeSource", rowKey: "change_source", label: "유형", width: "95px", type: "source" },
  { key: "reason", rowKey: "reason", label: "사유", width: "260px" },
];

const SELECT_OPTIONS = {
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
  origin: [["", "전체"], ["public_import", "공공데이터"], ["user_request", "사용자 신청"], ["system", "시스템"]],
  source: [["", "전체"], ["admin", "관리자"], ["system", "시스템"]],
};

const LABELS = Object.fromEntries(
  Object.values(SELECT_OPTIONS).flat().filter(([id]) => id && id !== "__null__"),
);
const FIELD_LABELS = Object.fromEntries(COURT_COLUMNS.filter((column) => column.patchKey || column.key === "name").map((column) => [column.patchKey || column.key, column.label]));
const EDITABLE_COLUMNS = COURT_COLUMNS.filter((column) => column.patchKey);

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function formatValue(column, value) {
  if (column.type === "date") return formatDateTime(value);
  if (column.type === "booleanNullable") return value === true ? "예" : value === false ? "아니오" : "미입력";
  if (column.type === "modificationCount") return `${Number(value ?? 0).toLocaleString()}회`;
  if (column.coordinate) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(6) : "-";
  }
  if (value === null || value === undefined || value === "") return "-";
  const typedLabel = SELECT_OPTIONS[column.type]?.find(([id]) => id === String(value))?.[1];
  return typedLabel ?? LABELS[value] ?? String(value);
}

function normalizeEditValue(column, value) {
  if (column.editor === "number") {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (column.editor === "select") return value ?? null;
  const text = String(value ?? "").trim();
  return text || null;
}

function buildRowDraft(row) {
  return Object.fromEntries(EDITABLE_COLUMNS.map((column) => {
    let value = row[column.rowKey] ?? null;
    if (column.patchKey === "facilityName" && !value) {
      value = getCourtFacilityBaseName(row.name, row.sigungu, row.court_unit);
    }
    return [column.patchKey, value];
  }));
}

function buildPatch(draft) {
  if (!draft) return {};
  return Object.fromEntries(EDITABLE_COLUMNS.flatMap((column) => {
    const before = normalizeEditValue(column, draft.original[column.patchKey]);
    const after = normalizeEditValue(column, draft.values[column.patchKey]);
    return Object.is(before, after) ? [] : [[column.patchKey, after]];
  }));
}

function isColumnEditable(row, column) {
  if (!column.patchKey) return false;
  return !column.requiresNameEvidence || Boolean(row.name_evidence_decision);
}

function getDraftCourtName(row, values) {
  return getCourtStandardName({
    ...row,
    facilityName: values.facilityName,
    courtUnit: values.courtUnit,
    sido: values.sido,
    sigungu: values.sigungu,
    addressText: values.addressText,
  });
}

function validatePatch(values, patch) {
  if (!Object.keys(patch).length) return "수정된 셀이 없습니다.";
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

function getSaveErrorMessage(errorCode = "") {
  const code = String(errorCode);
  if (code.includes("court_name_evidence_not_found")) return "OSM 명칭 근거가 없는 구장은 판정 정보를 수정할 수 없습니다.";
  if (code.includes("url_invalid")) return "URL은 https:// 주소만 저장할 수 있습니다.";
  if (code.includes("coordinates_invalid")) return "위도·경도 값을 확인해 주세요.";
  if (code.includes("duplicate") || code === "23505") return "같은 구장으로 판정되는 데이터가 이미 있습니다.";
  if (code.includes("permission")) return "구장 DB 수정 권한이 없습니다.";
  if (code.includes("unchanged")) return "실제로 변경된 값이 없습니다.";
  return "구장 정보를 저장하지 못했습니다.";
}

function SortIcon({ active, direction }) {
  if (!active) return <ArrowUpDown size={12} />;
  return direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
}

function FilterControl({ column, value, onChange, onEnter }) {
  if (SELECT_OPTIONS[column.type]) {
    return (
      <select aria-label={`${column.label} 필터`} value={value} onChange={(event) => onChange(event.target.value)}>
        {SELECT_OPTIONS[column.type].map(([id, label]) => <option key={id || "all"} value={id}>{label}</option>)}
      </select>
    );
  }
  return (
    <input
      aria-label={`${column.label} 필터`}
      type={column.type === "date" ? "date" : "search"}
      value={value}
      placeholder={column.type === "date" ? "" : "필터"}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

function CellEditor({ column, value, disabled, onChange, onEscape }) {
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onEscape();
  };
  if (column.editor === "select") {
    const options = (SELECT_OPTIONS[column.type] ?? [])
      .filter(([id]) => id !== "" && (column.nullable !== false || id !== "__null__"));
    const selected = value === null || value === undefined ? "__null__" : String(value);
    return (
      <select
        aria-label={`${column.label} 수정`}
        value={selected}
        autoFocus
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "__null__" ? null : column.type === "booleanNullable" ? next === "true" : next);
        }}
      >
        {options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    );
  }
  return (
    <input
      aria-label={`${column.label} 수정`}
      type={column.editor === "number" ? "number" : column.editor === "url" ? "url" : column.editor === "tel" ? "tel" : "text"}
      value={value ?? ""}
      min={column.min}
      max={column.max}
      step={column.step ?? (column.editor === "number" ? 1 : undefined)}
      autoFocus
      disabled={disabled}
      onKeyDown={onKeyDown}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Pagination({ page, onChange, loading }) {
  const current = Number(page?.page ?? 1);
  const pageCount = Number(page?.pageCount ?? 1);
  return (
    <div className="court-db-pagination">
      <span>전체 {Number(page?.total ?? 0).toLocaleString()}개 · {current}/{pageCount}페이지 · 100행</span>
      <div>
        <Button type="button" size="sm" variant="secondary" disabled={loading || current <= 1} onClick={() => onChange(current - 1)}>이전</Button>
        <Button type="button" size="sm" variant="secondary" disabled={loading || current >= pageCount} onClick={() => onChange(current + 1)}>다음</Button>
      </div>
    </div>
  );
}

function ChangeSummary({ changes }) {
  const entries = changes && typeof changes === "object" && !Array.isArray(changes) ? Object.entries(changes) : [];
  if (!entries.length) return <span>-</span>;
  return (
    <div className="court-db-history-changes">
      {entries.map(([key, change]) => (
        <span key={key}>
          <b>{FIELD_LABELS[key] ?? key}</b>{" "}
          {formatValue(COURT_COLUMNS.find((column) => (column.patchKey || column.key) === key) ?? {}, change?.before)} → {formatValue(COURT_COLUMNS.find((column) => (column.patchKey || column.key) === key) ?? {}, change?.after)}
        </span>
      ))}
    </div>
  );
}

export default function CourtDatabasePanel({ app }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("courts");
  const [courtRows, setCourtRows] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [courtPage, setCourtPage] = useState({ page: 1, pageSize: 100, total: 0, pageCount: 1 });
  const [historyPage, setHistoryPage] = useState({ page: 1, pageSize: 100, total: 0, pageCount: 1 });
  const [courtFilterDraft, setCourtFilterDraft] = useState(DEFAULT_COURT_FILTERS);
  const [historyFilterDraft, setHistoryFilterDraft] = useState(EMPTY_HISTORY_FILTERS);
  const [courtQuery, setCourtQuery] = useState({ page: 1, sortKey: "modificationCount", sortDirection: "asc", filters: DEFAULT_COURT_FILTERS });
  const [historyQuery, setHistoryQuery] = useState({ page: 1, sortKey: "createdAt", sortDirection: "desc", filters: EMPTY_HISTORY_FILTERS });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [draftRows, setDraftRows] = useState({});
  const [activeCell, setActiveCell] = useState(null);
  const [reason, setReason] = useState("");
  const [reasonOptional, setReasonOptional] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);

  const activeColumns = tab === "courts" ? COURT_COLUMNS : HISTORY_COLUMNS;
  const activeQuery = tab === "courts" ? courtQuery : historyQuery;
  const activeDraft = tab === "courts" ? courtFilterDraft : historyFilterDraft;
  const activePage = tab === "courts" ? courtPage : historyPage;
  const tableWidth = activeColumns.reduce((total, column) => total + Number.parseInt(column.width, 10), 0) + (tab === "courts" ? ACTION_COLUMN_WIDTH : 0);
  const dirtyUpdates = useMemo(() => Object.entries(draftRows).flatMap(([courtId, draft]) => {
    const patch = buildPatch(draft);
    return Object.keys(patch).length ? [{ courtId, patch, ...draft }] : [];
  }), [draftRows]);
  const editDirty = dirtyUpdates.length > 0;
  const dirtyFieldCount = useMemo(() => dirtyUpdates.reduce((total, update) => total + Object.keys(update.patch).length, 0), [dirtyUpdates]);
  const editValidation = useMemo(() => {
    for (const update of dirtyUpdates) {
      const row = courtRows.find((candidate) => candidate.id === update.courtId);
      const message = validatePatch(update.values, update.patch);
      if (message) return `${row?.name ?? update.courtId}: ${message}`;
    }
    return "";
  }, [courtRows, dirtyUpdates]);
  const activeRow = useMemo(() => courtRows.find((row) => row.id === activeCell?.courtId) ?? null, [courtRows, activeCell?.courtId]);
  const activeRowDraft = activeRow ? draftRows[activeRow.id] : null;
  const activeEditedName = activeRow && activeRowDraft ? getDraftCourtName(activeRow, activeRowDraft.values) : "";
  const activeNameDirty = Boolean(activeRow && activeEditedName && activeEditedName !== activeRow.name);
  const reasonValid = reasonOptional || reason.trim().length >= 4;

  const loadRows = async (preserveStatus = false) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    if (!preserveStatus) setStatus("");
    const result = tab === "courts"
      ? await app.actions.loadAdminCourtDatabase?.(courtQuery)
      : await app.actions.loadAdminCourtNameHistory?.(historyQuery);
    if (requestRef.current !== requestId) return;
    setLoading(false);
    if (!result || result.ok === false) {
      setStatus("목록을 불러오지 못했습니다.");
      return;
    }
    if (tab === "courts") {
      setCourtRows(result.rows ?? []);
      setCourtPage(result.page ?? { page: 1, pageSize: 100, total: 0, pageCount: 1 });
      setReasonOptional(result.capabilities?.reasonOptional === true);
    } else {
      setHistoryRows(result.rows ?? []);
      setHistoryPage(result.page ?? { page: 1, pageSize: 100, total: 0, pageCount: 1 });
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadRows();
    // Query objects only change on explicit filter, sort, or page actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, courtQuery, historyQuery]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const resetEdits = () => {
    setDraftRows({});
    setActiveCell(null);
    setReason("");
  };
  const canDiscard = () => !saving && (!editDirty || window.confirm("저장하지 않은 수정값을 버릴까요?"));
  const closeModal = () => {
    if (!canDiscard()) return;
    resetEdits();
    setOpen(false);
  };
  const changeTab = (nextTab) => {
    if (nextTab === tab || !canDiscard()) return;
    resetEdits();
    setStatus("");
    setTab(nextTab);
  };
  const changeFilter = (key, value) => {
    if (tab === "courts") setCourtFilterDraft((current) => ({ ...current, [key]: value }));
    else setHistoryFilterDraft((current) => ({ ...current, [key]: value }));
  };
  const applyFilters = () => {
    if (!canDiscard()) return;
    resetEdits();
    if (tab === "courts") setCourtQuery((current) => ({ ...current, page: 1, filters: { ...courtFilterDraft } }));
    else setHistoryQuery((current) => ({ ...current, page: 1, filters: { ...historyFilterDraft } }));
  };
  const resetFilters = () => {
    if (!canDiscard()) return;
    resetEdits();
    if (tab === "courts") {
      setCourtFilterDraft({ ...DEFAULT_COURT_FILTERS });
      setCourtQuery((current) => ({ ...current, page: 1, sortKey: "modificationCount", sortDirection: "asc", filters: { ...DEFAULT_COURT_FILTERS } }));
    } else {
      setHistoryFilterDraft({ ...EMPTY_HISTORY_FILTERS });
      setHistoryQuery((current) => ({ ...current, page: 1, sortKey: "createdAt", sortDirection: "desc", filters: { ...EMPTY_HISTORY_FILTERS } }));
    }
  };
  const changeSort = (key) => {
    if (!canDiscard()) return;
    resetEdits();
    const update = (current) => ({
      ...current,
      page: 1,
      sortKey: key,
      sortDirection: current.sortKey === key && current.sortDirection === "asc" ? "desc" : "asc",
    });
    if (tab === "courts") setCourtQuery(update);
    else setHistoryQuery(update);
  };
  const changePage = (page) => {
    if (!canDiscard()) return;
    resetEdits();
    if (tab === "courts") setCourtQuery((current) => ({ ...current, page }));
    else setHistoryQuery((current) => ({ ...current, page }));
  };
  const updateDraftValues = (row, valuePatch) => setDraftRows((current) => {
    const existing = current[row.id];
    const original = existing?.original ?? buildRowDraft(row);
    const values = { ...(existing?.values ?? original), ...valuePatch };
    const nextDraft = { original, values };
    if (Object.keys(buildPatch(nextDraft)).length) return { ...current, [row.id]: nextDraft };
    const next = { ...current };
    delete next[row.id];
    return next;
  });
  const activateCell = (row, column) => {
    if (!isColumnEditable(row, column) || saving) return;
    setActiveCell({ courtId: row.id, patchKey: column.patchKey });
    setStatus("");
  };
  const updateEditValue = (row, patchKey, value) => updateDraftValues(row, { [patchKey]: value });
  const restoreCell = (row, patchKey) => {
    const original = draftRows[row.id]?.original ?? buildRowDraft(row);
    updateDraftValues(row, { [patchKey]: original[patchKey] });
  };
  const applyQuickStatus = (kind) => {
    if (!activeRow || saving) return;
    if (kind === "review") updateDraftValues(activeRow, { verificationStatus: "review_required", operationalStatus: "pending", status: "hidden" });
    else if (kind === "disabled") updateDraftValues(activeRow, { status: "disabled" });
    else updateDraftValues(activeRow, { status: "active" });
  };
  const saveUpdates = async () => {
    if (!editDirty || saving) return;
    if (editValidation) {
      setStatus(editValidation);
      return;
    }
    if (!reasonValid) {
      setStatus("변경 사유를 4자 이상 입력해 주세요.");
      return;
    }
    setSaving(true);
    const result = await app.actions.saveAdminCourtBatch?.({
      updates: dirtyUpdates.map(({ courtId, patch }) => ({ courtId, patch })),
      reason: reason.trim(),
    });
    if (!result || result.ok === false) {
      setSaving(false);
      setStatus(getSaveErrorMessage(result?.error));
      return;
    }
    const savedRows = Number(result.updatedCount ?? dirtyUpdates.length);
    const savedFields = dirtyFieldCount;
    resetEdits();
    setSaving(false);
    await loadRows(true);
    setStatus(`${savedRows}개 구장 · ${savedFields}개 셀을 일괄 저장했습니다.`);
  };

  const modal = open ? (
    <div className="court-db-modal-backdrop" role="presentation">
      <section className="court-db-modal" role="dialog" aria-modal="true" aria-labelledby="court-db-modal-title">
        <header className="court-db-modal-header">
          <div>
            <p className="eyebrow">Court Database</p>
            <h2 id="court-db-modal-title">구장 DB</h2>
            <small>전체 DB 필터·정렬 · 페이지당 100행 · 수정은 관리자 감사 로그에 기록</small>
          </div>
          <div>
            <strong className="court-db-count">{Number(activePage.total ?? 0).toLocaleString()}개</strong>
            <Button type="button" size="sm" variant="secondary" onClick={closeModal}><X size={15} /> 창 닫기</Button>
          </div>
        </header>

        <div className="court-db-modal-body">
          <div className="segmented-control compact-segments court-db-tabs">
            <button type="button" className={tab === "courts" ? "active" : ""} onClick={() => changeTab("courts")}>구장 검색</button>
            <button type="button" className={tab === "history" ? "active" : ""} onClick={() => changeTab("history")}>수정 이력</button>
          </div>

          <div className="court-db-toolbar">
            <small>가로 스크롤은 표 하단에 고정됩니다. 수정 가능한 셀을 누르면 바로 입력할 수 있습니다.</small>
            <div>
              <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={resetFilters}><RotateCcw size={14} /> 초기화</Button>
              <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={applyFilters}>{loading ? "조회 중" : "필터 적용"}</Button>
            </div>
          </div>

          {tab === "courts" ? (
            <div className="court-db-edit-toolbar">
              <div>
                <strong>{editDirty ? `${dirtyUpdates.length}개 구장 · ${dirtyFieldCount}개 셀 수정` : activeRow?.name ?? "수정할 셀을 선택하세요"}</strong>
                <span>{editValidation || (activeNameDirty ? `표준명 변경: ${activeEditedName}` : "ESC: 현재 셀만 원래 값으로 복구")}</span>
              </div>
              <label>
                변경 사유
                <input
                  value={reason}
                  placeholder={reasonOptional ? "boyakh 한시적 입력 잠금" : "4자 이상"}
                  maxLength={160}
                  disabled={saving || reasonOptional}
                  onChange={(event) => setReason(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveUpdates();
                    }
                  }}
                />
              </label>
              <div className="court-db-quick-status">
                <button type="button" disabled={!activeRow || saving} onClick={() => applyQuickStatus("review")}>확인불가 숨김</button>
                <button type="button" disabled={!activeRow || saving} onClick={() => applyQuickStatus("disabled")}>비활성화</button>
                <button type="button" disabled={!activeRow || saving} onClick={() => applyQuickStatus("active")}>활성 복구</button>
              </div>
              <div className="court-db-batch-actions">
                <Button type="button" size="sm" disabled={!editDirty || Boolean(editValidation) || !reasonValid || saving} onClick={saveUpdates}>
                  <Save size={13} /> {saving ? "저장 중" : "일괄 저장"}
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={!editDirty || saving} onClick={resetEdits}><X size={13} /> 전체 취소</Button>
              </div>
            </div>
          ) : null}

          {status ? <p className="court-db-status">{status}</p> : null}

          <div className="court-db-table-wrap">
            <table className={`court-db-table ${tab === "history" ? "court-db-table-history" : ""}`} style={{ width: `${tableWidth}px` }}>
              <colgroup>
                {tab === "courts" ? <col style={{ width: `${ACTION_COLUMN_WIDTH}px` }} /> : null}
                {activeColumns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  {tab === "courts" ? <th className="court-db-sticky-actions">작업</th> : null}
                  {activeColumns.map((column) => (
                    <th key={column.key}>
                      <button type="button" className="court-db-sort" onClick={() => changeSort(column.key)}>
                        <span title={column.label}>{column.label}</span><SortIcon active={activeQuery.sortKey === column.key} direction={activeQuery.sortDirection} />
                      </button>
                    </th>
                  ))}
                </tr>
                <tr className="court-db-filter-row">
                  {tab === "courts" ? <th className="court-db-sticky-actions"><span>좌측 고정</span></th> : null}
                  {activeColumns.map((column) => (
                    <th key={column.key}>
                      <FilterControl
                        column={column}
                        value={activeDraft[column.key] ?? ""}
                        onChange={(value) => changeFilter(column.key, value)}
                        onEnter={applyFilters}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tab === "courts" ? courtRows.map((row) => {
                  const rowDraft = draftRows[row.id];
                  const rowValues = rowDraft?.values ?? buildRowDraft(row);
                  const rowPatch = buildPatch(rowDraft);
                  const rowDirty = Object.keys(rowPatch).length > 0;
                  const editedName = rowDirty ? getDraftCourtName(row, rowValues) : row.name;
                  const nameDirty = Boolean(editedName && editedName !== row.name);
                  const rowActive = activeCell?.courtId === row.id;
                  return (
                    <tr key={row.id} className={[rowDirty ? "court-db-row-editing" : "", rowActive ? "court-db-row-active" : ""].filter(Boolean).join(" ")}>
                      <td className="court-db-actions court-db-sticky-actions">
                        <a href={getCourtMapUrl(row, { zoom: 18 })} target={MAP_WINDOW_NAME}><ExternalLink size={13} /> 네이버지도</a>
                        {rowDirty ? <span className="court-db-row-dirty-count">{Object.keys(rowPatch).length}셀</span> : null}
                      </td>
                      {COURT_COLUMNS.map((column) => {
                        const columnEditable = isColumnEditable(row, column);
                        const columnDirty = rowDirty && (column.key === "name"
                          ? nameDirty
                          : column.patchKey && Object.prototype.hasOwnProperty.call(rowPatch, column.patchKey));
                        const cellActive = columnEditable && activeCell?.courtId === row.id && activeCell.patchKey === column.patchKey;
                        const displayValue = column.key === "name" ? editedName : column.patchKey ? rowValues[column.patchKey] : row[column.rowKey];
                        return (
                          <td
                            key={column.key}
                            className={[columnDirty ? "court-db-cell-dirty" : "", columnEditable ? "court-db-editable-cell" : "", cellActive ? "court-db-cell-active" : ""].filter(Boolean).join(" ")}
                            title={formatValue(column, displayValue)}
                            tabIndex={columnEditable ? 0 : undefined}
                            onClick={() => activateCell(row, column)}
                            onKeyDown={(event) => {
                              if (columnEditable && (event.key === "Enter" || event.key === "F2")) {
                                event.preventDefault();
                                activateCell(row, column);
                              }
                            }}
                          >
                            {cellActive ? (
                              <CellEditor
                                column={column}
                                value={rowValues[column.patchKey]}
                                disabled={saving}
                                onChange={(value) => updateEditValue(row, column.patchKey, value)}
                                onEscape={() => restoreCell(row, column.patchKey)}
                              />
                            ) : column.type === "osmEvidenceUrl" && displayValue ? (
                              <a href={String(displayValue)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>OSM 열기</a>
                            ) : formatValue(column, displayValue)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }) : historyRows.map((row) => (
                  <tr key={row.id}>
                    {HISTORY_COLUMNS.map((column) => (
                      <td key={column.key} className={column.key === "changesText" ? "court-db-history-cell" : ""} title={column.key === "changesText" ? undefined : formatValue(column, row[column.rowKey])}>
                        {column.key === "changesText" ? <ChangeSummary changes={row.changes} /> : column.key === "changedFields"
                          ? Object.keys(row.changes ?? {}).map((key) => FIELD_LABELS[key] ?? key).join(", ") || "-"
                          : formatValue(column, row[column.rowKey])}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && !(tab === "courts" ? courtRows : historyRows).length ? (
                  <tr><td colSpan={activeColumns.length + (tab === "courts" ? 1 : 0)} className="court-db-empty">조건에 맞는 데이터가 없습니다.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <Pagination page={activePage} onChange={changePage} loading={loading} />
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <Card className="section-card court-db-launcher">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Court Database</p>
            <h2>구장 DB</h2>
            <small>대형 편집 창에서 전체 구장과 수정 이력을 관리합니다.</small>
          </div>
          <Button type="button" onClick={() => setOpen(true)}><Database size={16} /> 구장 DB 열기</Button>
        </div>
      </Card>
      {modal ? createPortal(modal, document.body) : null}
    </>
  );
}
