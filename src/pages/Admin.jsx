import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Clock3, MapPin, ShieldCheck, UserRound } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import {
  ADMIN_BACKEND_TODO,
  APPOINTMENT_TERM_OPTIONS,
  ADMIN_REVIEW_ACTIONS,
  REFEREE_GRADE_META,
  SUSPENSION_TIERS,
  buildAdminAppointmentModel,
  buildAdminReviewModel,
  hasAdminAccess,
} from "../lib/admin.js";

const VIEW_OPTIONS = [
  { id: "courts", label: "구장별", icon: MapPin },
  { id: "players", label: "플레이어별", icon: UserRound },
  { id: "matches", label: "경기별", icon: ClipboardList },
];
const ACTION_OPTIONS = Object.entries(ADMIN_REVIEW_ACTIONS).map(([id, meta]) => ({ id, ...meta }));
const APPOINTMENT_ACTION_OPTIONS = [
  { id: "appointReferee", label: "심판 임명" },
  { id: "appointAdmin", label: "관리자 임명" },
  { id: "revokeAppointment", label: "임명 회수" },
];

function statusLabel(status) {
  if (status === "resolved") return "처리됨";
  if (status === "dismissed") return "기각";
  if (status === "reported") return "신고됨";
  if (status === "disputed") return "이의제기";
  if (status === "open") return "대기";
  return status || "대기";
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function appointmentStatusLabel(status) {
  if (status === "active") return "활성";
  if (status === "pending") return "대기";
  if (status === "revoked") return "회수";
  if (status === "expired") return "만료";
  return status || "대기";
}

function DetailList({ title, empty, children }) {
  return (
    <div className="admin-detail-list">
      <strong>{title}</strong>
      <div>{children ?? <span className="admin-empty-line">{empty}</span>}</div>
    </div>
  );
}

export default function Admin({ app }) {
  const [view, setView] = useState("courts");
  const [selectedIdByView, setSelectedIdByView] = useState({});
  const [actionDraft, setActionDraft] = useState({
    actionType: "validReport",
    durationDays: 3,
    targetUserId: "",
    reason: "",
    feedback: "",
  });
  const [appointmentDraft, setAppointmentDraft] = useState({
    actionType: "appointReferee",
    userId: "",
    adminGrade: "support",
    refereeGrade: "candidate",
    termDays: 90,
    appointmentId: "",
    reason: "",
  });
  const canAdmin = hasAdminAccess(app.currentUser, app.state.settings);
  const model = useMemo(() => buildAdminReviewModel(app.state), [app.state]);
  const appointments = useMemo(() => buildAdminAppointmentModel(app.state), [app.state]);
  const appointmentUsers = useMemo(
    () => [...app.state.users].sort((a, b) => a.name.localeCompare(b.name)),
    [app.state.users],
  );
  const activeAppointmentOptions = useMemo(
    () => appointments.rows.filter((row) => row.active && row.source !== "current_profile"),
    [appointments.rows],
  );
  const activeRows = model[view] ?? [];
  const selectedId = selectedIdByView[view];
  const selectedRow = activeRows.find((row) => row.id === selectedId) ?? activeRows[0] ?? null;
  const userMap = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const selectedReport = selectedRow?.reports.find((report) => report.status === "open") ?? selectedRow?.reports[0] ?? null;
  const targetCandidates = useMemo(() => {
    const ids = new Set([
      ...(selectedReport?.reportedUserIds ?? []),
      selectedRow?.player?.id,
      ...(selectedRow?.courtRequests ?? []).map((request) => request.requestedBy),
    ].filter(Boolean));
    return [...ids].map((userId) => userMap[userId]).filter(Boolean);
  }, [selectedReport, selectedRow, userMap]);
  const selectedTargetUserId = targetCandidates.some((user) => user.id === actionDraft.targetUserId)
    ? actionDraft.targetUserId
    : targetCandidates[0]?.id ?? "";

  useEffect(() => {
    setActionDraft((current) => ({
      ...current,
      targetUserId: targetCandidates[0]?.id ?? "",
      reason: "",
      feedback: "",
    }));
  }, [selectedReport?.id, selectedRow?.id]);

  const updateActionDraft = (patch) => setActionDraft((current) => ({ ...current, ...patch }));
  const updateAppointmentDraft = (patch) => setAppointmentDraft((current) => ({ ...current, ...patch }));
  const commitSelectedAction = () => {
    if (!selectedReport) return;
    app.actions.commitAdminReviewAction({
      ...actionDraft,
      targetUserId: selectedTargetUserId,
      reportId: selectedReport.id,
    });
  };
  const commitAppointmentAction = () => {
    app.actions.commitAdminAppointmentAction({
      ...appointmentDraft,
      userId: appointmentDraft.userId || appointmentUsers[0]?.id || "",
      appointmentId: appointmentDraft.appointmentId || activeAppointmentOptions[0]?.id || "",
    });
  };

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
          <small>{ADMIN_BACKEND_TODO}</small>
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
        <Badge tone="orange">mock 권한</Badge>
      </header>

      <div className="admin-summary-grid">
        <Card className="section-card">
          <span>대기 신고</span>
          <strong>{model.summary.openReportCount}</strong>
          <em>처리 필요</em>
        </Card>
        <Card className="section-card">
          <span>전체 신고</span>
          <strong>{model.summary.reportCount}</strong>
          <em>누적</em>
        </Card>
        <Card className="section-card">
          <span>문제 경기</span>
          <strong>{model.summary.matchIssueCount}</strong>
          <em>신고/이의</em>
        </Card>
        <Card className="section-card">
          <span>구장 요청</span>
          <strong>{model.summary.courtRequestCount}</strong>
          <em>등록/허위 검토</em>
        </Card>
        <Card className="section-card">
          <span>임명 대기</span>
          <strong>{appointments.summary.pendingAppointmentCount}</strong>
          <em>심판/관리자</em>
        </Card>
      </div>

      <Card className="section-card admin-backend-note">
        <AlertTriangle size={18} />
        <span>{ADMIN_BACKEND_TODO}</span>
      </Card>

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
                <em>심판 {row.matchCount}경기 · 따봉 {row.thumbsUp} · 신고 {row.reportCount}</em>
              </div>
            ))}
          </div>
        ) : null}
        <div className="admin-appointment-list">
          {appointments.rows.slice(0, 8).map((row) => (
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
        <div className="admin-action-panel admin-appointment-action-panel">
          <div>
            <strong>임명/회수 액션</strong>
            <small>mock 커밋입니다. 배포 전 서버 권한, RLS, auditLog 트랜잭션으로 다시 묶어야 합니다.</small>
          </div>
          <div className="arena-field-grid">
            <label>
              액션
              <select value={appointmentDraft.actionType} onChange={(event) => updateAppointmentDraft({ actionType: event.target.value })}>
                {APPOINTMENT_ACTION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            {appointmentDraft.actionType === "revokeAppointment" ? (
              <label>
                회수 대상
                <select value={appointmentDraft.appointmentId} onChange={(event) => updateAppointmentDraft({ appointmentId: event.target.value })}>
                  {!activeAppointmentOptions.length ? <option value="">활성 임명 없음</option> : null}
                  {activeAppointmentOptions.map((row) => <option key={row.id} value={row.id}>{row.userName} · {row.roleLabel} · {row.gradeLabel}</option>)}
                </select>
              </label>
            ) : (
              <label>
                플레이어
                <select value={appointmentDraft.userId || appointmentUsers[0]?.id || ""} onChange={(event) => updateAppointmentDraft({ userId: event.target.value })}>
                  {appointmentUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · 신뢰도 {user.trustScore ?? "-"}</option>)}
                </select>
              </label>
            )}
          </div>
          {appointmentDraft.actionType !== "revokeAppointment" ? (
            <div className="arena-field-grid">
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
            disabled={appointmentDraft.actionType === "revokeAppointment" && !activeAppointmentOptions.length}
            onClick={commitAppointmentAction}
          >
            임명/회수 커밋
          </Button>
        </div>
      </Card>

      <div className="admin-workbench">
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Sorted Queue</p>
              <h2>검토 큐</h2>
            </div>
            <Badge tone="blue">{activeRows.length}건</Badge>
          </div>

          <div className="segmented-control">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button key={option.id} type="button" className={view === option.id ? "active" : ""} onClick={() => setView(option.id)}>
                  <Icon size={15} /> {option.label}
                </button>
              );
            })}
          </div>

          <div className="admin-sort-list">
            {activeRows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={selectedRow?.id === row.id ? "admin-sort-row active" : "admin-sort-row"}
                onClick={() => setSelectedIdByView((current) => ({ ...current, [view]: row.id }))}
              >
                <span>
                  <strong>{row.title}</strong>
                  <em>{row.subtitle}</em>
                </span>
                <span className="admin-sort-counts">
                  <b>{row.issueCount ?? row.openCount}</b>
                  <small>이슈</small>
                  <b>{row.reportCount}</b>
                  <small>신고</small>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="section-card admin-detail-panel">
          {selectedRow ? (
            <>
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Review Detail</p>
                  <h2>{selectedRow.title}</h2>
                  <span>{selectedRow.subtitle}</span>
                </div>
                <Badge tone={selectedRow.openCount ? "orange" : "green"}>{selectedRow.openCount ? "처리 필요" : "정리됨"}</Badge>
              </div>

              <div className="contract-grid">
                <div>
                  <span>신고</span>
                  <strong>{selectedRow.reportCount}</strong>
                </div>
                <div>
                  <span>이슈</span>
                  <strong>{selectedRow.issueCount ?? selectedRow.openCount}</strong>
                </div>
                <div>
                  <span>경기</span>
                  <strong>{selectedRow.matchCount ?? 0}</strong>
                </div>
                <div>
                  <span>구장요청</span>
                  <strong>{selectedRow.courtRequestCount ?? 0}</strong>
                </div>
              </div>

              <div className="admin-action-panel">
                <div>
                  <strong>처리 액션</strong>
                  <small>선택된 신고 기준으로 신고자 피드백과 제재 로그를 커밋합니다.</small>
                </div>
                <div className="arena-field-grid">
                  <label>
                    액션
                    <select value={actionDraft.actionType} onChange={(event) => updateActionDraft({ actionType: event.target.value })}>
                      {ACTION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    대상
                    <select value={selectedTargetUserId} disabled={!targetCandidates.length} onChange={(event) => updateActionDraft({ targetUserId: event.target.value })}>
                      {!targetCandidates.length ? <option value="">대상 없음</option> : null}
                      {targetCandidates.map((user) => <option key={user.id} value={user.id}>{user.name} · 신뢰도 {user.trustScore ?? "-"}</option>)}
                    </select>
                  </label>
                </div>
                <label>
                  제재 기간
                  <select value={actionDraft.durationDays} onChange={(event) => updateActionDraft({ durationDays: Number(event.target.value) })}>
                    {SUSPENSION_TIERS.map((tier) => <option key={tier.id} value={tier.days}>{tier.label}</option>)}
                  </select>
                </label>
                <label>
                  처리 사유
                  <textarea value={actionDraft.reason} placeholder="관리자 처리 사유" onChange={(event) => updateActionDraft({ reason: event.target.value })} />
                </label>
                <label>
                  신고자 피드백
                  <textarea value={actionDraft.feedback} placeholder={ADMIN_REVIEW_ACTIONS[actionDraft.actionType]?.feedback} onChange={(event) => updateActionDraft({ feedback: event.target.value })} />
                </label>
                <Button type="button" variant="secondary" disabled={!selectedReport || selectedReport.status !== "open"} onClick={commitSelectedAction}>
                  액션 커밋
                </Button>
                <small>mock/localStorage에서는 커밋 직전 상태만 확인합니다. 실시간 중복 방지는 서버 트랜잭션에서 다시 확인해야 합니다.</small>
              </div>

              <DetailList title="쌓인 신고" empty="신고 없음">
                {selectedRow.reports.length ? selectedRow.reports.slice(0, 8).map((report) => (
                  <div key={report.id} className="admin-detail-row">
                    <span>
                      <strong>{report.reason}</strong>
                      <em>{report.type} · {formatDate(report.createdAt)}</em>
                    </span>
                    <Badge tone={report.status === "open" ? "orange" : "neutral"}>{statusLabel(report.status)}</Badge>
                  </div>
                )) : null}
              </DetailList>

              <DetailList title="관련 경기" empty="관련 경기 없음">
                {selectedRow.matches.length ? selectedRow.matches.slice(0, 8).map((match) => (
                  <div key={match.id} className="admin-detail-row">
                    <span>
                      <strong>{match.title ?? `${match.teamA?.name ?? "A"} vs ${match.teamB?.name ?? "B"}`}</strong>
                      <em>{match.court ?? "미정 구장"} · {match.scheduledDate ?? ""} {match.scheduledTime ?? ""}</em>
                    </span>
                    <Badge tone={match.status === "disputed" ? "orange" : "neutral"}>{statusLabel(match.status)}</Badge>
                  </div>
                )) : null}
              </DetailList>

              <DetailList title="구장 등록요청" empty="관련 요청 없음">
                {selectedRow.courtRequests.length ? selectedRow.courtRequests.slice(0, 8).map((request) => (
                  <div key={request.id} className="admin-detail-row">
                    <span>
                      <strong>{request.name}</strong>
                      <em>{request.addressText} · {request.lat ?? "-"}, {request.lng ?? "-"}</em>
                    </span>
                    <span className="admin-row-actions">
                      <Badge tone={request.status === "reported" ? "orange" : request.status === "approved" ? "green" : "neutral"}>{statusLabel(request.status)}</Badge>
                      {request.status !== "approved" ? (
                        <Button type="button" variant="secondary" size="sm" onClick={() => app.actions.approveCourtRequest(request.id)}>
                          승인
                        </Button>
                      ) : null}
                    </span>
                  </div>
                )) : null}
              </DetailList>
            </>
          ) : (
            <div className="empty-state">검토할 큐가 없습니다.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
