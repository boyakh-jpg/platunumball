import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, RefreshCw, Search, X } from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import Pagination from "../common/Pagination.jsx";
import AdminMetric from "./AdminMetric.jsx";
import { normalizeAdminDashboardQuery } from "../../../shared/lib/adminDashboardPolicy.js";
import { ADMIN_DEFAULT_PAGE_LIMIT, DIRECTORY_FILTER_MAX_LENGTH, DIRECTORY_MAX_OFFSET } from "../../lib/queryPolicy.js";
import { getMatchRoomPhase } from "../../../shared/lib/matchRoomLifecycle.js";
import { isTerminalMatchStatus } from "../../../shared/lib/notifications.js";
import { getAdminDashboardDetailPath } from "../../lib/appNavigation.js";
import { getAdminStatusLabel } from "../../lib/adminPolicy.js";
import { tournamentStatusLabels } from "../../pages/matchesPageBaseSelectors.js";
import { formatDate } from "../../pages/adminPageModel.js";

const DATASETS = [
  { id: "members", label: "회원", unit: "명", search: "이름·태그·지역 검색" },
  { id: "teams", label: "팀", unit: "팀", search: "팀 이름·지역 검색" },
  { id: "matches", label: "경기", unit: "경기", search: "경기 이름·구장·지역 검색" },
  { id: "tournaments", label: "대회", unit: "개", search: "대회 이름·지역 검색" },
];
const count = (value) => Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";

function summaryDetail(kind, summary) {
  if (!summary) return "전체 목록 보기";
  if (kind === "members") return `오늘 가입 ${count(summary.today)}명`;
  if (kind === "teams") return `오늘 생성 ${count(summary.today)}팀`;
  if (kind === "matches") return `진행 중 ${count(summary.active)} · 결과 확정 ${count(summary.confirmed)}`;
  return `진행 중 ${count(summary.active)} · 종료 ${count(summary.completed)}`;
}

function DashboardRow({ kind, row }) {
  const isTournament = kind === "tournaments";
  const matchPhase = kind === "matches" && !isTerminalMatchStatus(row.status) && (row.startedAt || row.endedAt || row.status === "open") ? getMatchRoomPhase(row) : null;
  const statusLabel = isTournament ? tournamentStatusLabels[row.status] ?? getAdminStatusLabel(row.status) : matchPhase?.listLabel ?? getAdminStatusLabel(row.status);
  const meta = [row.region, kind === "members" ? row.hashtag : null, kind === "matches" ? row.mode : null, row.courtName].filter(Boolean).join(" · ");
  return (
    <li>
      <Link className="admin-dashboard-row" to={getAdminDashboardDetailPath(kind, row.id)}>
        <div className="admin-dashboard-identity"><strong>{row.name || "이름 없음"}</strong><span>{meta || "지역 미등록"}</span></div>
        <div className="admin-dashboard-row-facts">
          {isTournament ? <><span>참가 {count(row.teamCount)}팀 · 승인 {count(row.approvedTeamCount)}팀</span><strong>결과 확정 {count(row.confirmedMatchCount)}경기</strong><span>생성 {count(row.matchCount)}경기{row.cancelledMatchCount > 0 ? ` · 취소·무효 ${count(row.cancelledMatchCount)}경기` : ""}</span></> : null}
          {kind === "members" ? <span>가입 {formatDate(row.createdAt)}</span> : null}
          {kind === "teams" ? <><strong>팀원 {count(row.memberCount)}명</strong><span>생성 {formatDate(row.createdAt)}</span></> : null}
          {kind === "matches" ? <span>{row.scheduledAt ? `일정 ${formatDate(row.scheduledAt)}` : "일정 미정"}</span> : null}
        </div>
        <div className="admin-dashboard-row-state">
          {isTournament || kind === "matches" ? <Badge tone={matchPhase?.tone ?? (row.status === "active" ? "team" : "neutral")}>{statusLabel}</Badge> : null}
          {isTournament ? <small>{row.startDate ? `${row.startDate}${row.endDate && row.endDate !== row.startDate ? ` ~ ${row.endDate}` : ""}` : "일정 미정"}</small> : null}
          <span>상세 보기 <ArrowUpRight size={15} aria-hidden="true" /></span>
        </div>
      </Link>
    </li>
  );
}

export default function AdminDashboardPanel({ loadDashboard }) {
  const [params, setParams] = useSearchParams();
  const query = normalizeAdminDashboardQuery({ kind: params.get("overview"), search: params.get("overviewSearch"), status: params.get("overviewStatus"), offset: params.get("overviewOffset"), limit: ADMIN_DEFAULT_PAGE_LIMIT });
  const { kind, search, status, offset, limit } = query;
  const queryKey = JSON.stringify(query);
  const selected = DATASETS.find((dataset) => dataset.id === kind);
  const [draft, setDraft] = useState(search);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [request, setRequest] = useState({ key: "", loading: true, error: false });
  const loader = useRef(loadDashboard);
  loader.current = loadDashboard;

  useEffect(() => { setDraft(search); }, [kind, search]);
  useEffect(() => {
    let cancelled = false;
    setRequest({ key: queryKey, loading: true, error: false });
    Promise.resolve().then(() => loader.current(JSON.parse(queryKey))).then((data) => {
      if (cancelled) return;
      if (!data?.ok || !data.summary || !Array.isArray(data.rows) || !data.page) throw new Error("dashboard_load_failed");
      setResult({ ...data, key: queryKey });
      setRequest({ key: queryKey, loading: false, error: false });
    }).catch(() => { if (!cancelled) setRequest({ key: queryKey, loading: false, error: true }); });
    return () => { cancelled = true; };
  }, [queryKey, refresh]);

  function changeQuery(patch) {
    const next = normalizeAdminDashboardQuery({ ...query, offset: 0, ...patch });
    setParams((previous) => {
      const updated = new URLSearchParams(previous);
      for (const [key, value] of Object.entries({ overview: next.kind, overviewSearch: next.search, overviewStatus: next.status === "all" ? "" : next.status, overviewOffset: next.offset || "" })) {
        if (value) updated.set(key, String(value)); else updated.delete(key);
      }
      return updated;
    }, { replace: true });
  }

  const loading = request.key !== queryKey || request.loading;
  const error = request.key === queryKey && request.error;
  const current = result?.key === queryKey ? result : null;
  const maxPages = Math.floor(DIRECTORY_MAX_OFFSET / limit) + 1;
  const totalPages = current ? Math.max(1, Math.min(Math.ceil(current.page.total / limit), maxPages)) : 1;
  return (
    <section className="admin-dashboard-overview" aria-labelledby="admin-dashboard-title">
      <div className="section-title-row">
        <div><h2 id="admin-dashboard-title">전체 현황</h2><p className="admin-dashboard-note">{result ? `${formatDate(result.generatedAt)} 기준 · 오늘은 한국 시간 기준` : "회원부터 대회 진행까지 한곳에서 확인하세요."}</p></div>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={15} aria-hidden="true" />새로고침</Button>
      </div>
      <div className="admin-operation-metrics admin-operation-metrics--overview" aria-label="전체 통계와 목록 선택">
        {DATASETS.map((dataset) => <AdminMetric key={dataset.id} label={dataset.label} value={`${count(result?.summary[dataset.id]?.total)}${result ? dataset.unit : ""}`} detail={summaryDetail(dataset.id, result?.summary[dataset.id])} selected={kind === dataset.id} onClick={() => changeQuery({ kind: dataset.id, search: "", status: "all" })} />)}
      </div>
      <Card className="section-card admin-dashboard-directory" aria-labelledby="admin-directory-title">
        <div className="section-title-row"><h3 id="admin-directory-title">{selected.label} 목록{current ? ` · ${count(current.page.total)}${selected.unit}` : ""}</h3>{kind === "tournaments" ? <span className="admin-dashboard-note">확정 경기 수는 최종 결과 기준입니다.</span> : null}</div>
        <form className="admin-dashboard-toolbar" role="search" onSubmit={(event) => { event.preventDefault(); changeQuery({ search: draft }); }}>
          <label className="admin-dashboard-search"><span>{selected.label} 검색</span><input type="search" maxLength={DIRECTORY_FILTER_MAX_LENGTH} value={draft} placeholder={selected.search} onChange={(event) => setDraft(event.target.value)} /></label>
          {["matches", "tournaments"].includes(kind) ? <label className="admin-dashboard-filter"><span>상태</span><select value={status} onChange={(event) => changeQuery({ status: event.target.value })}><option value="all">전체 상태</option><option value="active">진행 중</option><option value="completed">{kind === "matches" ? "결과 확정" : "종료"}</option></select></label> : null}
          <Button type="submit" variant="secondary"><Search size={16} aria-hidden="true" />검색</Button>
          {search || status !== "all" ? <Button variant="ghost" onClick={() => { setDraft(""); changeQuery({ search: "", status: "all" }); }}><X size={16} aria-hidden="true" />초기화</Button> : null}
        </form>
        {error ? <div className="admin-dashboard-feedback" role="alert"><span>현황을 불러오지 못했습니다.{current ? " 이전 조회 결과입니다." : " 잠시 후 다시 시도하세요."}</span><Button size="sm" variant="secondary" onClick={() => setRefresh((value) => value + 1)}>다시 시도</Button></div> : null}
        <div aria-busy={loading}>
          {loading ? <div className="ui-empty-state-compact" role="status">{selected.label} 현황을 불러오는 중입니다.</div> : null}
          {!loading && current?.rows.length ? <ul className="admin-dashboard-list">{current.rows.map((row) => <DashboardRow key={row.id} kind={kind} row={row} />)}</ul> : null}
          {!loading && current && !current.rows.length ? <div className="ui-empty-state-compact">{search || status !== "all" ? "조건에 맞는 항목이 없습니다. 검색 조건을 바꿔보세요." : `등록된 ${selected.label} 없음`}{offset > 0 ? <Button variant="secondary" size="sm" onClick={() => changeQuery({ offset: 0 })}>첫 페이지로</Button> : null}</div> : null}
        </div>
        {current && (current.page.total > limit || offset > 0) ? <Pagination page={Math.floor(offset / limit)} totalPages={totalPages} disabled={loading} onChange={(page) => changeQuery({ offset: page * limit })} /> : null}
        {current?.page.total > maxPages * limit ? <p className="admin-dashboard-note">더 오래된 항목은 검색으로 범위를 좁혀 확인하세요.</p> : null}
      </Card>
    </section>
  );
}
