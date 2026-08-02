import { Clock3 } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import { ADMIN_PERMISSION_NOTICE, APPOINTMENT_TERM_OPTIONS, REFEREE_GRADE_META } from "../lib/admin.js";
import {
  APPOINTMENT_ACTION_OPTIONS,
  formatDate,
  appointmentStatusLabel,
} from "./adminPageModel.js";

export function AdminAppointmentSection({ controller }) {
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
    reviewActionConfirming,
    setReviewActionConfirming,
    appointmentActionPending,
    appointmentActionStatus,
    canAdmin,
    adminViewState,
    appointments,
    appointmentUsers,
    activeAppointmentOptions,
    selectedActiveAppointmentId,
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
  return (
        <Card className="section-card admin-appointment-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Appointments</p>
            <h2>임명 관리</h2>
          </div>
          <Clock3 size={22} />
        </div>
        <div className="admin-grade-strip">
          {appointments.grades.map((grade) => (
            <div key={grade.id}>
              <strong>{grade.label}</strong>
              <span>Lv.{grade.level}</span>
              <em>{grade.defaultTermDays}일 · {grade.scope}</em>
            </div>
          ))}
        </div>
        <div className="admin-referee-grade-strip">
          {Object.entries(REFEREE_GRADE_META).map(([id, grade]) => (
            <div key={id}>
              <strong>{grade.label}</strong>
              <span>Lv.{grade.level}</span>
              <em>{grade.requirement}</em>
            </div>
          ))}
        </div>
        {appointments.refereeGrades.length ? (
          <div className="admin-referee-score-list">
            {appointments.refereeGrades.map((row) => (
              <div key={row.userId}>
                <strong>{row.userName}</strong>
                <span>{row.gradeLabel} · 점수 {row.score}</span>
                <em>심판 {row.matchCount}경기 · 추천 {row.thumbsUp} · 신고 {row.reportCount}</em>
              </div>
            ))}
          </div>
        ) : null}
        <div className="segmented-control compact-segments admin-queue-filter">
          <button type="button" className={queueMode === "pending" ? "active" : ""} onClick={() => setQueueMode("pending")}>활성·대기</button>
          <button type="button" className={queueMode === "history" ? "active" : ""} onClick={() => setQueueMode("history")}>전체 이력</button>
        </div>
        <div className="arena-field-grid">
          <label>
            목록 필터
            <input
              value={queueFilter}
              placeholder="등급, 역할, 상태"
              onChange={(event) => updateQueueFilter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyQueueFilter();
                }
              }}
            />
          </label>
          <div className="ui-action-row admin-row-actions">
            <Button type="button" variant="secondary" onClick={applyQueueFilter}>적용</Button>
            {appliedQueueFilter ? <Button type="button" variant="secondary" onClick={clearQueueFilter}>초기화</Button> : null}
          </div>
        </div>
        <div className="admin-appointment-list">
          {appointments.rows.map((row) => (
            <div key={row.id} className="admin-appointment-row">
              <span>
                <strong>{row.userName}</strong>
                <em>{row.roleLabel} · {row.gradeLabel} · {row.reason || row.source}</em>
              </span>
              <span>
                <Badge tone={row.status === "pending" ? "orange" : row.active ? "green" : "neutral"}>{appointmentStatusLabel(row.status)}</Badge>
                <small>{row.endsAt ? `만료 ${formatDate(row.endsAt)}` : "무기한"}</small>
              </span>
            </div>
          ))}
          {!appointments.rows.length ? <span className="admin-empty-line">임명 기록 없음</span> : null}
        </div>
        {activeAdminPage?.hasMore ? (
          <Button type="button" variant="secondary" disabled={app.adminStatus?.loading} onClick={() => app.actions.loadMoreAdminSection?.()}>
            {app.adminStatus?.loading ? "불러오는 중" : `더 보기 (${appointments.rows.length}/${activeAdminPage.total})`}
          </Button>
        ) : null}
        <div className="admin-action-panel admin-appointment-action-panel">
          <div>
            <strong>임명·연장·회수 처리</strong>
            <small>처리 결과는 서버에 저장되며, 저장이 완료되면 최신 정보로 화면이 갱신됩니다.</small>
          </div>
          <div className="arena-field-grid">
            <label>
              처리 유형
              <select value={appointmentDraft.actionType} onChange={(event) => updateAppointmentDraft({ actionType: event.target.value })}>
                {APPOINTMENT_ACTION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            {["revokeAppointment", "extendAppointment"].includes(appointmentDraft.actionType) ? (
              <label>
                {appointmentDraft.actionType === "extendAppointment" ? "연장 대상" : "회수 대상"}
                <select value={selectedActiveAppointmentId} disabled={appointmentActionPending} onChange={(event) => updateAppointmentDraft({ appointmentId: event.target.value })}>
                  {!activeAppointmentOptions.length ? <option value="">활성 임명 없음</option> : null}
                  {activeAppointmentOptions.map((row) => <option key={row.id} value={row.id}>{row.userName} · {row.roleLabel} · {row.gradeLabel}</option>)}
                </select>
              </label>
            ) : (
              <label>
                플레이어
                <SearchPicker
                  value={appointmentUserQuery}
                  onChange={setAppointmentUserQuery}
                  placeholder="이름, #해시태그 검색"
                  items={appointmentUsers}
                  remoteSearchType="player"
                  title="플레이어 검색 결과"
                  emptyText="플레이어 없음"
                  floating
                  closeOnResultClick
                  renderItem={(user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="search-picker-result-row search-picker-result-row-actionable"
                      onClick={() => selectAppointmentUser(user)}
                    >
                      <span className="search-picker-result-main">
                        <strong>{user.name}</strong>
                        <em>{user.hashtag || user.handle || user.id} · 신뢰도 {user.trustScore ?? "-"}</em>
                      </span>
                    </button>
                  )}
                />
                {appointmentDraft.userId ? <small>선택: {appointmentUserSnapshot?.name ?? userMap[appointmentDraft.userId]?.name ?? appointmentDraft.userId}</small> : null}
              </label>
            )}
          </div>
          {appointmentDraft.actionType !== "revokeAppointment" ? (
            <div className="arena-field-grid">
              {appointmentDraft.actionType !== "extendAppointment" ? (
                <label>
                  등급
                  {appointmentDraft.actionType === "appointAdmin" ? (
                    <select value={appointmentDraft.adminGrade} onChange={(event) => updateAppointmentDraft({ adminGrade: event.target.value })}>
                      {appointments.grades.filter((grade) => grade.id !== "owner").map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)}
                    </select>
                  ) : (
                    <select value={appointmentDraft.refereeGrade} onChange={(event) => updateAppointmentDraft({ refereeGrade: event.target.value })}>
                      {Object.entries(REFEREE_GRADE_META).map(([id, grade]) => <option key={id} value={id}>{grade.label}</option>)}
                    </select>
                  )}
                </label>
              ) : null}
              <label>
                기간
                <select value={appointmentDraft.termDays} onChange={(event) => updateAppointmentDraft({ termDays: Number(event.target.value) })}>
                  {APPOINTMENT_TERM_OPTIONS.map((term) => <option key={term.id} value={term.days}>{term.label}</option>)}
                </select>
              </label>
            </div>
          ) : null}
          <label>
            사유
            <textarea value={appointmentDraft.reason} placeholder="임명 또는 회수 사유" onChange={(event) => updateAppointmentDraft({ reason: event.target.value })} />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={appointmentActionPending || (["revokeAppointment", "extendAppointment"].includes(appointmentDraft.actionType)
              ? !activeAppointmentOptions.length
              : !appointmentDraft.userId)}
            onClick={commitAppointmentAction}
          >
            {appointmentActionPending ? "저장 중" : "임명/연장/회수 적용"}
          </Button>
          {appointmentActionStatus ? <small role="status">{appointmentActionStatus}</small> : null}
        </div>
          <small>{ADMIN_PERMISSION_NOTICE}</small>
        </Card>
  );
}
