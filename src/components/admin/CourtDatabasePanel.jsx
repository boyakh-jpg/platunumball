import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, RotateCcw, Save } from "lucide-react";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import { getCourtFacilityBaseName, getCourtMapUrl, getCourtStandardName } from "../../lib/courts.js";

const DEFAULT_COURT_FILTERS = {
  name: "",
  facilityName: "",
  courtUnit: "",
  indoorOutdoor: "",
  venueType: "",
  courtKind: "",
  surfaceType: "",
  courtLayout: "",
  hoopCount: "",
  accessType: "",
  reservationRequired: "",
  paid: "",
  lighting: "",
  publicAccess: "",
  operationalStatus: "",
  verificationStatus: "",
  sigungu: "",
  modificationCount: "zero",
  registrationOrigin: "",
  status: "",
  updatedAt: "",
  id: "",
  hashtag: "",
  address: "",
  lat: "",
  lng: "",
};

const EMPTY_HISTORY_FILTERS = {
  createdAt: "",
  courtId: "",
  sigungu: "",
  previousName: "",
  newName: "",
  changedByName: "",
  changeSource: "",
  reason: "",
};

const COURT_COLUMNS = [
  { key: "name", label: "구장명", width: "240px" },
  { key: "facilityName", label: "시설명", width: "210px" },
  { key: "courtUnit", label: "코트", width: "90px" },
  { key: "indoorOutdoor", label: "실내외", width: "90px", type: "indoorOutdoor" },
  { key: "venueType", label: "시설유형", width: "110px", type: "venueType" },
  { key: "courtKind", label: "구장분류", width: "110px", type: "courtKind" },
  { key: "surfaceType", label: "바닥", width: "110px", type: "surfaceType" },
  { key: "courtLayout", label: "코트형태", width: "110px", type: "courtLayout" },
  { key: "hoopCount", label: "골대", width: "80px", type: "number" },
  { key: "accessType", label: "이용방식", width: "105px", type: "accessType" },
  { key: "reservationRequired", label: "예약", width: "90px", type: "booleanNullable" },
  { key: "paid", label: "유료", width: "80px", type: "booleanNullable" },
  { key: "lighting", label: "조명", width: "80px", type: "booleanNullable" },
  { key: "publicAccess", label: "공개", width: "90px", type: "publicAccess" },
  { key: "operationalStatus", label: "운영상태", width: "105px", type: "operationalStatus" },
  { key: "verificationStatus", label: "검증상태", width: "115px", type: "verificationStatus" },
  { key: "sigungu", label: "시군구", width: "130px" },
  { key: "modificationCount", label: "수정횟수", width: "90px", type: "modificationCount" },
  { key: "registrationOrigin", label: "출처", width: "105px", type: "origin" },
  { key: "status", label: "상태", width: "90px", type: "status" },
  { key: "updatedAt", label: "수정일", width: "125px", type: "date" },
  { key: "id", label: "ID", width: "170px" },
  { key: "hashtag", label: "해시태그", width: "100px" },
  { key: "address", label: "주소", width: "280px" },
  { key: "lat", label: "위도", width: "120px", type: "number" },
  { key: "lng", label: "경도", width: "120px", type: "number" },
];

const HISTORY_COLUMNS = [
  { key: "createdAt", label: "시각", width: "150px", type: "date" },
  { key: "courtId", label: "구장 ID", width: "170px" },
  { key: "sigungu", label: "시군구", width: "130px" },
  { key: "previousName", label: "변경 전", width: "250px" },
  { key: "newName", label: "변경 후", width: "250px" },
  { key: "changedByName", label: "처리자", width: "120px" },
  { key: "changeSource", label: "유형", width: "90px", type: "source" },
  { key: "reason", label: "사유", width: "230px" },
];

const SELECT_OPTIONS = {
  indoorOutdoor: [
    ["", "전체"], ["__null__", "미입력"], ["outdoor", "야외"], ["indoor", "실내"], ["mixed", "혼합"], ["unknown", "알 수 없음"],
  ],
  venueType: [["", "전체"], ["__null__", "미입력"], ["park", "공원"], ["sports_facility", "체육시설"], ["public_facility", "공공시설"], ["school", "학교"], ["apartment", "아파트"], ["unknown", "알 수 없음"]],
  courtKind: [["", "전체"], ["__null__", "미입력"], ["official", "정규"], ["street_hoop", "길거리"], ["unknown", "알 수 없음"]],
  surfaceType: [["", "전체"], ["__null__", "미입력"], ["asphalt", "아스팔트"], ["urethane", "우레탄"], ["dirt", "흙"], ["indoor_wood", "실내목재"], ["indoor_synthetic", "실내합성"], ["unknown", "알 수 없음"]],
  courtLayout: [["", "전체"], ["__null__", "미입력"], ["full", "풀코트"], ["half", "하프코트"], ["single_hoop", "단일골대"], ["unknown", "알 수 없음"]],
  accessType: [["", "전체"], ["__null__", "미입력"], ["walk_in", "자유이용"], ["reservation", "예약"], ["restricted", "제한"], ["unknown", "알 수 없음"]],
  booleanNullable: [["", "전체"], ["__null__", "미입력"], ["true", "예"], ["false", "아니오"]],
  publicAccess: [["", "전체"], ["__null__", "미입력"], ["public", "공개"], ["private", "비공개"], ["unknown", "알 수 없음"]],
  operationalStatus: [["", "전체"], ["__null__", "미입력"], ["active", "운영"], ["pending", "확인 중"], ["closed", "폐쇄"], ["unknown", "알 수 없음"]],
  verificationStatus: [["", "전체"], ["__null__", "미입력"], ["pending", "미검증"], ["source_verified", "출처검증"], ["verified", "검증완료"], ["review_required", "검토필요"]],
  modificationCount: [["zero", "0회"], ["positive", "1회 이상"], ["", "전체"]],
  origin: [["", "전체"], ["public_import", "공공데이터"], ["user_request", "사용자 신청"], ["system", "시스템"]],
  status: [["", "전체"], ["active", "활성"], ["hidden", "숨김"]],
  source: [["", "전체"], ["admin", "관리자"], ["system", "시스템"]],
};

const LABELS = {
  outdoor: "야외",
  indoor: "실내",
  mixed: "혼합",
  unknown: "알 수 없음",
  park: "공원",
  sports_facility: "체육시설",
  public_facility: "공공시설",
  school: "학교",
  apartment: "아파트",
  official: "정규",
  street_hoop: "길거리",
  asphalt: "아스팔트",
  urethane: "우레탄",
  dirt: "흙",
  indoor_wood: "실내목재",
  indoor_synthetic: "실내합성",
  full: "풀코트",
  half: "하프코트",
  single_hoop: "단일골대",
  walk_in: "자유이용",
  reservation: "예약",
  restricted: "제한",
  public: "공개",
  private: "비공개",
  pending: "확인 중",
  closed: "폐쇄",
  source_verified: "출처검증",
  verified: "검증완료",
  review_required: "검토필요",
  public_import: "공공데이터",
  user_request: "사용자 신청",
  system: "시스템",
  active: "활성",
  hidden: "숨김",
  admin: "관리자",
};

const OPERATIONAL_LABELS = { active: "운영", pending: "확인 중", closed: "폐쇄", unknown: "알 수 없음" };
const VERIFICATION_LABELS = { pending: "미검증", source_verified: "출처검증", verified: "검증완료", review_required: "검토필요" };

function formatBoolean(value, trueLabel, falseLabel) {
  if (value === true) return trueLabel;
  if (value === false) return falseLabel;
  return "미입력";
}

function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : "-";
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
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

export default function CourtDatabasePanel({ app }) {
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
  const [editing, setEditing] = useState(null);
  const requestRef = useRef(0);

  const activeColumns = tab === "courts" ? COURT_COLUMNS : HISTORY_COLUMNS;
  const activeQuery = tab === "courts" ? courtQuery : historyQuery;
  const activeDraft = tab === "courts" ? courtFilterDraft : historyFilterDraft;

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
      setCourtPage(result.page ?? courtPage);
    } else {
      setHistoryRows(result.rows ?? []);
      setHistoryPage(result.page ?? historyPage);
    }
  };

  useEffect(() => {
    void loadRows();
    // Query objects only change on explicit filter, sort, or page actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, courtQuery, historyQuery]);

  const editRow = useMemo(
    () => courtRows.find((row) => row.id === editing?.courtId) ?? null,
    [courtRows, editing?.courtId],
  );
  const editedName = editRow && editing
    ? getCourtStandardName({
      ...editRow,
      facilityName: editing.facilityName,
      courtUnit: editRow.court_unit,
      addressText: editRow.address_text,
    })
    : "";
  const editDirty = Boolean(editRow && editedName && editedName !== editRow.name);

  const changeFilter = (key, value) => {
    if (tab === "courts") setCourtFilterDraft((current) => ({ ...current, [key]: value }));
    else setHistoryFilterDraft((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    setEditing(null);
    if (tab === "courts") setCourtQuery((current) => ({ ...current, page: 1, filters: { ...courtFilterDraft } }));
    else setHistoryQuery((current) => ({ ...current, page: 1, filters: { ...historyFilterDraft } }));
  };

  const resetFilters = () => {
    setEditing(null);
    if (tab === "courts") {
      setCourtFilterDraft(DEFAULT_COURT_FILTERS);
      setCourtQuery((current) => ({ ...current, page: 1, sortKey: "modificationCount", sortDirection: "asc", filters: DEFAULT_COURT_FILTERS }));
    } else {
      setHistoryFilterDraft(EMPTY_HISTORY_FILTERS);
      setHistoryQuery((current) => ({ ...current, page: 1, filters: EMPTY_HISTORY_FILTERS }));
    }
  };

  const changeSort = (key) => {
    setEditing(null);
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
    setEditing(null);
    if (tab === "courts") setCourtQuery((current) => ({ ...current, page }));
    else setHistoryQuery((current) => ({ ...current, page }));
  };

  const beginRename = (row) => {
    setStatus("");
    setEditing({
      courtId: row.id,
      facilityName: row.facility_name || getCourtFacilityBaseName(row.name, row.sigungu, row.court_unit),
      reason: "",
      saving: false,
    });
  };

  const saveRename = async () => {
    if (!editing || !editDirty || editing.reason.trim().length < 4) return;
    setEditing((current) => ({ ...current, saving: true }));
    const result = await app.actions.renameAdminCourt?.({
      courtId: editing.courtId,
      facilityName: editing.facilityName,
      reason: editing.reason.trim(),
    });
    if (!result || result.ok === false) {
      setEditing((current) => ({ ...current, saving: false }));
      setStatus("이름을 저장하지 못했습니다.");
      return;
    }
    setEditing(null);
    await loadRows(true);
    setStatus("이름을 저장했습니다.");
  };

  return (
    <Card className="section-card court-db-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Court Database</p>
          <h2>구장 DB</h2>
        </div>
        <strong className="court-db-count">{Number((tab === "courts" ? courtPage : historyPage).total ?? 0).toLocaleString()}개</strong>
      </div>

      <div className="segmented-control compact-segments court-db-tabs">
        <button type="button" className={tab === "courts" ? "active" : ""} onClick={() => { setTab("courts"); setEditing(null); }}>구장 검색</button>
        <button type="button" className={tab === "history" ? "active" : ""} onClick={() => { setTab("history"); setEditing(null); }}>수정 이력</button>
      </div>

      <div className="court-db-toolbar">
        <small>전체 DB에서 필터·정렬한 뒤 100행만 불러옵니다.</small>
        <div>
          <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={resetFilters}><RotateCcw size={14} /> 초기화</Button>
          <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={applyFilters}>{loading ? "조회 중" : "필터 적용"}</Button>
        </div>
      </div>

      {status ? <p className="court-db-status">{status}</p> : null}

      <div className="court-db-table-wrap">
        <table className={`court-db-table ${tab === "history" ? "court-db-table-history" : ""}`}>
          <colgroup>
            {activeColumns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
            {tab === "courts" ? <col style={{ width: "145px" }} /> : null}
          </colgroup>
          <thead>
            <tr>
              {activeColumns.map((column) => (
                <th key={column.key}>
                  <button type="button" className="court-db-sort" onClick={() => changeSort(column.key)}>
                    {column.label}<SortIcon active={activeQuery.sortKey === column.key} direction={activeQuery.sortDirection} />
                  </button>
                </th>
              ))}
              {tab === "courts" ? <th>작업</th> : null}
            </tr>
            <tr className="court-db-filter-row">
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
              {tab === "courts" ? <th><span>—</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {tab === "courts" ? courtRows.map((row) => {
              const rowEditing = editing?.courtId === row.id;
              const rowDirty = rowEditing && editDirty;
              return (
                <Fragment key={row.id}>
                  <tr>
                    <td className={rowDirty ? "court-db-cell-dirty" : ""} title={rowEditing ? editedName : row.name}>{rowEditing ? editedName : row.name}</td>
                    <td className={rowDirty ? "court-db-cell-dirty court-db-edit-cell" : ""} title={row.facility_name ?? ""}>
                      {rowEditing ? (
                        <input
                          value={editing.facilityName}
                          aria-label={`${row.name} 시설명 수정`}
                          onChange={(event) => setEditing((current) => ({ ...current, facilityName: event.target.value }))}
                        />
                      ) : row.facility_name || "-"}
                    </td>
                    <td title={row.court_unit ?? ""}>{row.court_unit || "-"}</td>
                    <td>{LABELS[row.indoor_outdoor] ?? row.indoor_outdoor ?? "-"}</td>
                    <td>{LABELS[row.venue_type] ?? row.venue_type ?? "-"}</td>
                    <td>{LABELS[row.court_kind] ?? row.court_kind ?? "-"}</td>
                    <td>{LABELS[row.surface_type] ?? row.surface_type ?? "-"}</td>
                    <td>{LABELS[row.court_layout] ?? row.court_layout ?? "-"}</td>
                    <td>{row.hoop_count ?? "-"}</td>
                    <td>{LABELS[row.access_type] ?? row.access_type ?? "-"}</td>
                    <td>{formatBoolean(row.reservation_required, "필요", "불필요")}</td>
                    <td>{formatBoolean(row.paid, "유료", "무료")}</td>
                    <td>{formatBoolean(row.lighting, "있음", "없음")}</td>
                    <td>{LABELS[row.public_access] ?? row.public_access ?? "-"}</td>
                    <td>{OPERATIONAL_LABELS[row.operational_status] ?? row.operational_status ?? "-"}</td>
                    <td>{VERIFICATION_LABELS[row.verification_status] ?? row.verification_status ?? "-"}</td>
                    <td title={row.sigungu ?? ""}>{row.sigungu || "-"}</td>
                    <td>{Number(row.name_modification_count ?? 0).toLocaleString()}회</td>
                    <td>{LABELS[row.registration_origin] ?? row.registration_origin ?? "-"}</td>
                    <td>{LABELS[row.status] ?? row.status ?? "-"}</td>
                    <td title={row.updated_at ?? ""}>{formatDateTime(row.updated_at)}</td>
                    <td title={row.id}>{row.id}</td>
                    <td title={row.hashtag ?? ""}>{row.hashtag || "-"}</td>
                    <td title={row.address_text ?? ""}>{row.address_text || "-"}</td>
                    <td title={row.lat ?? ""}>{formatCoordinate(row.lat)}</td>
                    <td title={row.lng ?? ""}>{formatCoordinate(row.lng)}</td>
                    <td className="court-db-actions">
                      <a href={getCourtMapUrl(row)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> 지도</a>
                      <button type="button" onClick={() => (rowEditing ? setEditing(null) : beginRename(row))}>{rowEditing ? "취소" : "이름 변경"}</button>
                    </td>
                  </tr>
                  {rowEditing ? (
                    <tr className="court-db-edit-row">
                      <td colSpan={COURT_COLUMNS.length + 1}>
                        <label>
                          변경 사유
                          <input
                            value={editing.reason}
                            placeholder="4자 이상"
                            onChange={(event) => setEditing((current) => ({ ...current, reason: event.target.value }))}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void saveRename();
                              }
                            }}
                          />
                        </label>
                        <Button type="button" size="sm" disabled={!rowDirty || editing.reason.trim().length < 4 || editing.saving} onClick={saveRename}>
                          <Save size={14} /> {editing.saving ? "저장 중" : "저장"}
                        </Button>
                        <small>붉은 셀은 아직 저장되지 않은 값입니다.</small>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            }) : historyRows.map((row) => (
              <tr key={row.id}>
                <td title={row.created_at ?? ""}>{formatDateTime(row.created_at)}</td>
                <td title={row.court_id ?? ""}>{row.court_id}</td>
                <td title={row.sigungu ?? ""}>{row.sigungu || "-"}</td>
                <td title={row.previous_name ?? ""}>{row.previous_name || "-"}</td>
                <td title={row.new_name ?? ""}>{row.new_name || "-"}</td>
                <td title={row.changed_by_name ?? row.changed_by ?? ""}>{row.changed_by_name || row.changed_by || "-"}</td>
                <td>{LABELS[row.change_source] ?? row.change_source ?? "-"}</td>
                <td title={row.reason ?? ""}>{row.reason || "-"}</td>
              </tr>
            ))}
            {!loading && !(tab === "courts" ? courtRows : historyRows).length ? (
              <tr><td colSpan={activeColumns.length + (tab === "courts" ? 1 : 0)} className="court-db-empty">조건에 맞는 데이터가 없습니다.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pagination page={tab === "courts" ? courtPage : historyPage} onChange={changePage} loading={loading} />
    </Card>
  );
}
