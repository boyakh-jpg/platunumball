import { ShieldCheck } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import UserOperationsPanel from "../components/admin/UserOperationsPanel.jsx";
import CourtDatabasePanel from "../components/admin/CourtDatabasePanel.jsx";
import { ADMIN_PERMISSION_NOTICE, getAdminReportTypeLabel } from "../lib/admin.js";
import { ADMIN_DEFAULT_PAGE_LIMIT } from "../lib/queryPolicy.js";
import {
  REVIEW_QUEUE_FILTER_PLACEHOLDERS,
  isPendingCourtRequest,
  formatDate,
} from "./adminPageModel.js";
import {
  RatingPolicyPanel,
} from "./AdminPageParts.jsx";

import { AdminAppointmentSection } from "./AdminAppointmentSection.jsx";
import { AdminDetailPanel } from "./AdminDetailPanel.jsx";
export default function AdminPageView({ controller }) {
  const {
    app,
    adminLevel,
    sectionOptions,
    section,
    view,
    queueMode,
    setQueueMode,
    queueFilter,
    appliedQueueFilter,
    loadAdminSection,
    setSelectedIdByView,
    setSelectedReportIdByScope,
    actionDraft,
    mergeAffiliationQuery,
    setMergeAffiliationQuery,
    appointmentDraft,
    appointmentUserQuery,
    setAppointmentUserQuery,
    appointmentUserSnapshot,
    courtApprovalDraft,
    courtApprovalStatus,
    reviewActionStatus,
    reviewActionPending,
    appointmentActionPending,
    reviewActionConfirming,
    setReviewActionConfirming,
    canAdmin,
    adminViewState,
    appointments,
    appointmentUsers,
    activeAppointmentOptions,
    activeRows,
    selectedRow,
    reportOptions,
    selectedReportScope,
    userMap,
    matchMap,
    selectedReport,
    selectedReportIsVoidRestore,
    selectedCourtRequest,
    selectedCourtRequester,
    courtLocationMatches,
    approvedLocationMatches,
    courtMapHref,
    courtSourceHref,
    courtApprovalPreview,
    workflow,
    sectionCounts,
    activeAdminPage,
    activeQueueTotal,
    changeSection,
    applyQueueFilter,
    updateQueueFilter,
    clearQueueFilter,
    refreshQueue,
    visibleActionOptions,
    targetCandidates,
    selectedTargetUserId,
    actionNeedsTarget,
    actionTargetIsReporter,
    actionNeedsReplacementName,
    actionNeedsMergeTarget,
    nameModerationAction,
    reviewReasonMaxLength,
    reviewActionInvalid,
    reviewActionHighImpact,
    reviewMetrics,
    selectedNeedsAction,
    updateActionDraft,
    changeReviewActionType,
    updateAppointmentDraft,
    selectAppointmentUser,
    updateCourtApprovalDraft,
    approveSelectedCourt,
    commitSelectedAction,
    commitAppointmentAction,
  } = controller;
if (!canAdmin && (!app.adminStatus?.loaded || app.adminStatus?.loading)) {
    return (
      <div className="page-stack admin-page">
        <Card className="section-card admin-denied-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Admin</p>
              <h1>관리자 권한 확인 중</h1>
            </div>
            <ShieldCheck size={22} />
          </div>
        </Card>
      </div>
    );
  }

  if (!canAdmin) {
    return (
      <div className="page-stack admin-page">
        <Card className="section-card admin-denied-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Admin</p>
              <h1>관리자 권한 없음</h1>
            </div>
            <ShieldCheck size={22} />
          </div>
          <p>관리자 메뉴는 권한자에게만 표시됩니다.</p>
          <small>{ADMIN_PERMISSION_NOTICE}</small>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack admin-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Admin Console</p>
          <h1>관리자 메뉴</h1>
        </div>
        <Badge tone="team">서버 권한</Badge>
      </header>

      <nav className="admin-section-tabs" aria-label="관리자 업무">
        {sectionOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              className={section === option.id ? "active" : ""}
              aria-current={section === option.id ? "page" : undefined}
              disabled={reviewActionPending || appointmentActionPending}
              onClick={() => changeSection(option.id)}
            >
              <span className="admin-section-tab-icon"><Icon size={19} /></span>
              <span>
                <strong>{option.label}</strong>
                <em>{option.caption}</em>
              </span>
              {sectionCounts[option.id] === "" ? null : <b>{sectionCounts[option.id] ?? 0}</b>}
            </button>
          );
        })}
      </nav>

      {section === "ratingPolicy" ? (
        <RatingPolicyPanel app={app} />
      ) : section === "userOps" ? (
        <UserOperationsPanel app={app} />
      ) : section === "courtDb" ? (
        <CourtDatabasePanel app={app} />
      ) : section === "appointments" ? (
<AdminAppointmentSection controller={controller} />
      ) : (
      <div className="admin-workbench">
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Pending Queue</p>
              <h2>{workflow.queueTitle}</h2>
            </div>
            <Badge tone="blue">{activeRows.length}건</Badge>
          </div>
          <div className="arena-field-grid">
            <label>
              큐 필터
              <input
                value={queueFilter}
                placeholder={REVIEW_QUEUE_FILTER_PLACEHOLDERS[view] ?? "신고 사유"}
                disabled={reviewActionPending}
                onChange={(event) => updateQueueFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyQueueFilter();
                  }
                }}
              />
            </label>
            <div className="admin-row-actions">
              <Button type="button" variant="secondary" disabled={reviewActionPending} onClick={applyQueueFilter}>적용</Button>
              {appliedQueueFilter ? <Button type="button" variant="secondary" disabled={reviewActionPending} onClick={clearQueueFilter}>초기화</Button> : null}
              <Button type="button" variant="secondary" disabled={reviewActionPending || app.adminStatus?.loading} onClick={refreshQueue}>
                {app.adminStatus?.loading ? "갱신 중" : "새로고침"}
              </Button>
            </div>
          </div>
          <div className="segmented-control compact-segments admin-queue-filter">
            <button type="button" className={queueMode === "pending" ? "active" : ""} disabled={reviewActionPending} onClick={() => setQueueMode("pending")}>
              처리 대기{queueMode === "pending" ? ` ${activeQueueTotal}` : ""}
            </button>
            <button type="button" className={queueMode === "history" ? "active" : ""} disabled={reviewActionPending} onClick={() => setQueueMode("history")}>
              전체 이력{queueMode === "history" ? ` ${activeQueueTotal}` : ""}
            </button>
          </div>

          <div className="admin-sort-list">
            {app.adminStatus?.loading && app.adminStatus?.section === section ? <div className="admin-queue-state" role="status">검토 목록을 불러오는 중입니다.</div> : null}
            {app.adminStatus?.error && app.adminStatus?.section === section ? (
              <div className="admin-queue-state error" role="alert">
                <span>검토 목록을 불러오지 못했습니다.</span>
                <Button type="button" variant="secondary" onClick={() => loadAdminSection?.({ section, queueMode, filter: appliedQueueFilter, limit: ADMIN_DEFAULT_PAGE_LIMIT, offset: 0, force: true })}>다시 시도</Button>
              </div>
            ) : null}
            {!app.adminStatus?.loading && !app.adminStatus?.error ? activeRows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={selectedRow?.id === row.id ? "admin-sort-row active" : "admin-sort-row"}
                disabled={reviewActionPending}
                onClick={() => setSelectedIdByView((current) => ({ ...current, [view]: row.id }))}
              >
                <span>
                  <strong>{row.title}</strong>
                  <em>{row.subtitle}</em>
                  {row.latestReport ? <small className="admin-sort-latest">{getAdminReportTypeLabel(row.latestReport.type)} · {row.latestReport.reason} · {formatDate(row.latestReport.createdAt)}</small> : null}
                </span>
                <span className="admin-sort-counts">
                  <b>{view === "courts" ? row.courtRequests.filter(isPendingCourtRequest).length : row.issueCount ?? row.openCount}</b>
                  <small>{view === "courts" ? "신청" : "이슈"}</small>
                  <b>{row.reportCount}</b>
                  <small>신고</small>
                </span>
              </button>
            )) : null}
            {!app.adminStatus?.loading && !app.adminStatus?.error && !activeRows.length ? <div className="ui-empty-state-compact">{queueMode === "pending" ? "처리할 항목이 없습니다." : "처리 이력이 없습니다."}</div> : null}
          </div>
          {activeAdminPage?.hasMore ? (
            <Button type="button" variant="secondary" disabled={reviewActionPending || app.adminStatus?.loading} onClick={() => app.actions.loadMoreAdminSection?.()}>
              {app.adminStatus?.loading ? "불러오는 중" : `더 보기 (${activeRows.length}/${activeAdminPage.total})`}
            </Button>
          ) : null}
        </Card>

<AdminDetailPanel controller={controller} />
      </div>
      )}
    </div>
  );
}
