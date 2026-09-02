import { ExternalLink, History, UserCheck } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { getAdminReportTypeLabel } from "../lib/admin.js";
import { ADMIN_DEFAULT_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { ADMIN_QUEUE_FOCUS_LABELS, formatDate } from "./adminPageModel.js";

const REPORT_SECTION_BY_TYPE = {
  court: "courts",
  court_review: "courts",
  court_request: "courts",
  match: "matches",
  player: "players",
  team: "teams",
  team_name: "teams",
  team_emblem: "teams",
  affiliation_name: "teams",
};

const OPERATION_LABELS = {
  assignSelf: "담당자 지정",
  unassign: "담당자 해제",
  markUrgent: "긴급 지정",
  clearUrgent: "긴급 해제",
};

function getDisplayName(user) {
  return user?.name || user?.nickname || user?.handle || user?.id || "-";
}

function getReportTarget(report, state, userMap, matchMap) {
  const id = report?.targetId;
  if (!id) return "-";
  if (["player", "user"].includes(report.type)) return getDisplayName(userMap[id]);
  if (report.type === "match") return matchMap[id]?.title || matchMap[id]?.name || id;
  if (["team", "team_name", "team_emblem", "affiliation_name"].includes(report.type)) {
    if (report.type === "affiliation_name") {
      const affiliation = (state.affiliations ?? []).find((item) => item.id === id);
      return affiliation?.name || affiliation?.title || id;
    }
    const team = (state.teams ?? []).find((item) => item.id === id);
    return team?.name || team?.title || id;
  }
  if (["court", "court_review", "court_request"].includes(report.type)) {
    const court = (state.courts ?? []).find((item) => item.id === id)
      ?? (state.settings?.approvedCourts ?? []).find((item) => item.id === id)
      ?? (state.settings?.courtRequests ?? []).find((item) => item.id === id)
      ?? (state.settings?.courtReviews ?? []).find((item) => item.id === id);
    return court?.name || court?.courtName || court?.facilityName || id;
  }
  return id;
}

function getEvidenceItems(report = {}) {
  const values = [
    report.evidence,
    report.evidenceUrl,
    report.evidenceObjectKey,
    report.courtCorrection?.evidenceUrl,
    report.courtCorrection?.evidenceObjectKey,
    ...(Array.isArray(report.evidenceUrls) ? report.evidenceUrls : []),
    ...(Array.isArray(report.attachments) ? report.attachments : []),
  ].flatMap((value) => Array.isArray(value) ? value : [value]);
  return values.filter(Boolean).map((value) => typeof value === "string" ? value : value.url || value.objectKey || value.name).filter(Boolean);
}

function ReportFacts({ report, state, userMap, matchMap }) {
  const evidence = getEvidenceItems(report);
  const description = report.description || report.details || report.content || report.message || "-";
  return (
    <dl className="admin-report-facts">
      <div><dt>대상</dt><dd>{getReportTarget(report, state, userMap, matchMap)}</dd></div>
      <div><dt>사유</dt><dd>{report.reason || "-"}</dd></div>
      <div className="wide"><dt>설명</dt><dd>{description}</dd></div>
      <div className="wide"><dt>증거</dt><dd>{evidence.length ? evidence.map((item) => /^https?:\/\//i.test(item) ? <a key={item} href={item} target="_blank" rel="noreferrer">증거 열기 <ExternalLink size={14} /></a> : <span key={item}>{item}</span>) : "없음"}</dd></div>
      <div><dt>신고자</dt><dd>{getDisplayName(userMap[report.by])}</dd></div>
      <div><dt>접수 시각</dt><dd>{formatDate(report.createdAt)}</dd></div>
      <div><dt>담당자</dt><dd>{report.assignedTo ? getDisplayName(userMap[report.assignedTo]) : "미배정"}</dd></div>
      <div><dt>상태</dt><dd>{report.status === "open" ? "미처리" : "처리 완료"}</dd></div>
    </dl>
  );
}

export default function AdminReportsPanel({ controller }) {
  const {
    app, section, queueMode, queueFocus, setQueueMode, queueFilter, appliedQueueFilter,
    updateQueueFilter, applyQueueFilter, clearQueueFilter, refreshQueue, loadAdminSection,
    reportQueueReports, selectedQueueReport, reportAuditHistory, selectQueueReport,
    userMap, matchMap, adminViewState, activeAdminPage, reportOperationPending,
    reportOperationStatus, commitReportOperation, changeSection,
  } = controller;
  const loading = app.adminStatus?.loading && app.adminStatus?.section === "reports";
  const error = app.adminStatus?.error && app.adminStatus?.section === "reports";
  const report = selectedQueueReport;
  const reviewSection = REPORT_SECTION_BY_TYPE[report?.type];

  return (
    <div className="admin-report-workbench">
      <Card className="section-card admin-report-queue">
        <div className="section-title-row">
          <div><p className="eyebrow">Report queue</p><h2>신고·검토 대기열</h2></div>
          <Badge tone="blue">{activeAdminPage?.total ?? reportQueueReports.length}건</Badge>
        </div>
        {queueFocus ? <div className="admin-report-focus"><strong>{ADMIN_QUEUE_FOCUS_LABELS[queueFocus]}</strong><Button type="button" variant="secondary" onClick={() => controller.navigateToReportQueue("", queueMode)}>전체 큐</Button></div> : null}
        <div className="arena-field-grid">
          <label>큐 필터<input value={queueFilter} placeholder="신고 사유" disabled={reportOperationPending} onChange={(event) => updateQueueFilter(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyQueueFilter(); } }} /></label>
          <div className="ui-action-row admin-row-actions">
            <Button type="button" variant="secondary" disabled={reportOperationPending} onClick={applyQueueFilter}>적용</Button>
            {appliedQueueFilter ? <Button type="button" variant="secondary" disabled={reportOperationPending} onClick={clearQueueFilter}>초기화</Button> : null}
            <Button type="button" variant="secondary" disabled={reportOperationPending || loading} onClick={refreshQueue}>{loading ? "갱신 중" : "새로고침"}</Button>
          </div>
        </div>
        <div className="ui-segmented-control segmented-control compact-segments admin-queue-filter">
          <button type="button" className={queueMode === "pending" ? "active" : ""} disabled={reportOperationPending} onClick={() => setQueueMode("pending")}>처리 대기</button>
          <button type="button" className={queueMode === "history" ? "active" : ""} disabled={reportOperationPending} onClick={() => setQueueMode("history")}>전체 이력</button>
        </div>
        {error ? <div className="admin-queue-state error" role="alert"><span>신고 목록을 불러오지 못했습니다.</span><Button type="button" variant="secondary" onClick={() => loadAdminSection?.({ section, queueMode, focus: queueFocus, filter: appliedQueueFilter, limit: ADMIN_DEFAULT_PAGE_LIMIT, offset: 0, force: true })}>다시 시도</Button></div> : null}
        <div className="admin-report-list">
          {reportQueueReports.map((item) => (
            <button key={item.id} type="button" className={report?.id === item.id ? "active" : ""} disabled={reportOperationPending} onClick={() => selectQueueReport(item.id)}>
              <span><strong>{getAdminReportTypeLabel(item.type)}</strong><em>{item.reason || "사유 없음"}</em><small>{formatDate(item.createdAt)} · {item.assignedTo ? "배정됨" : "미배정"}</small></span>
              <Badge tone={item.priority === "urgent" ? "warning" : item.status === "open" ? "blue" : "neutral"}>{item.priority === "urgent" ? "긴급" : item.status === "open" ? "미처리" : "완료"}</Badge>
            </button>
          ))}
          {!loading && !error && !reportQueueReports.length ? <div className="ui-empty-state-compact">조건에 맞는 신고가 없습니다.</div> : null}
        </div>
        {activeAdminPage?.hasMore ? <Button type="button" variant="secondary" disabled={loading || reportOperationPending} onClick={() => app.actions.loadMoreAdminSection?.()}>더 보기 ({reportQueueReports.length}/{activeAdminPage.total})</Button> : null}
      </Card>

      <Card className="section-card admin-report-detail">
        {!report ? <div className="ui-empty-state-compact">신고를 선택하세요.</div> : (
          <>
            <div className="section-title-row">
              <div><p className="eyebrow">Human review</p><h2>{getAdminReportTypeLabel(report.type)} 상세</h2></div>
              <Badge tone={report.priority === "urgent" ? "warning" : "neutral"}>{report.priority === "urgent" ? "긴급" : "일반"}</Badge>
            </div>
            <ReportFacts report={report} state={adminViewState} userMap={userMap} matchMap={matchMap} />
            {report.status === "open" ? (
              <div className="admin-report-operation">
                <div><UserCheck size={18} /><strong>사람 검토 준비</strong><span>배정·긴급도만 변경합니다. 제재는 유형별 검토에서 확인 후 처리합니다.</span></div>
                <div className="ui-action-row">
                  <Button type="button" variant="secondary" disabled={reportOperationPending} onClick={() => commitReportOperation(report.assignedTo ? "unassign" : "assignSelf")}>{report.assignedTo ? "배정 해제" : "내게 배정"}</Button>
                  <Button type="button" variant="secondary" disabled={reportOperationPending} onClick={() => commitReportOperation(report.priority === "urgent" ? "clearUrgent" : "markUrgent")}>{report.priority === "urgent" ? "긴급 해제" : "긴급 지정"}</Button>
                  {reviewSection ? <Button type="button" disabled={reportOperationPending} onClick={() => changeSection(reviewSection)}>유형별 검토 열기</Button> : null}
                </div>
                {reportOperationStatus ? <small role="status">{reportOperationStatus}</small> : null}
              </div>
            ) : null}
            <section className="admin-report-history">
              <div className="section-title-row"><h3>처리 이력</h3><History size={18} /></div>
              <ol>
                {report.resolvedAt ? <li><strong>처리 완료</strong><span>{getDisplayName(userMap[report.resolvedBy])} · {formatDate(report.resolvedAt)}</span><small>{report.resolution || "처리 결과 기록됨"}</small></li> : null}
                {reportAuditHistory.map((entry) => <li key={entry.id}><strong>{OPERATION_LABELS[entry.operation] || entry.actionType || entry.type || "관리자 변경"}</strong><span>{getDisplayName(userMap[entry.createdBy])} · {formatDate(entry.createdAt)}</span></li>)}
                {report.assignedAt ? <li><strong>최초 담당 배정</strong><span>{formatDate(report.assignedAt)}</span></li> : null}
                <li><strong>신고 접수</strong><span>{getDisplayName(userMap[report.by])} · {formatDate(report.createdAt)}</span></li>
              </ol>
            </section>
          </>
        )}
      </Card>
    </div>
  );
}
