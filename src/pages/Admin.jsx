import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Clock3, ExternalLink, MapPin, RotateCcw, Save, ShieldAlert, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
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
import { getCourtLayoutLabel, getCourtLocationMatches, getCourtMapUrl, getCourtSurfaceLabel } from "../lib/courts.js";
import { getMatchHashtag } from "../lib/handles.js";
import { ADMIN_DEFAULT_PAGE_LIMIT, DEFAULT_ADMIN_QUEUE_MODE, DEFAULT_ADMIN_SECTION } from "../lib/queryPolicy.js";
import { getTeamEmblemErrorMessage } from "../lib/teamEmblem.js";
import {
  cloneRatingPolicy,
  DEFAULT_RATING_POLICY,
  getRatingPolicyValue,
  normalizeRatingPolicy,
  RATING_POLICY_GROUPS,
  setRatingPolicyValue,
} from "../lib/ratingPolicy.js";
import "../styles/recruiting-arena.css";

const ADMIN_SECTION_OPTIONS = [
  { id: "courts", label: "구장 신청", caption: "등록 신청과 구장 신고", icon: MapPin },
  { id: "players", label: "플레이어 신고", caption: "신고와 징계", icon: UserRound },
  { id: "matches", label: "경기 심사", caption: "기록 오류와 이의", icon: ClipboardList },
  { id: "teams", label: "팀 엠블럼", caption: "이미지 신고와 제한", icon: ShieldAlert },
  { id: "appointments", label: "권한 관리", caption: "심판과 관리자 임명", icon: ShieldCheck },
  { id: "ratingPolicy", label: "MMR·신뢰도", caption: "이벤트 반영 정책", icon: SlidersHorizontal, ownerOnly: true },
];
const ACTION_OPTIONS = Object.entries(ADMIN_REVIEW_ACTIONS).map(([id, meta]) => ({ id, ...meta }));
const APPOINTMENT_ACTION_OPTIONS = [
  { id: "appointReferee", label: "심판 임명" },
  { id: "appointAdmin", label: "관리자 임명" },
  { id: "extendAppointment", label: "임명 연장" },
  { id: "revokeAppointment", label: "임명 회수" },
];
const REVIEW_WORKFLOW_COPY = {
  courts: {
    title: "구장 신청·신고",
    queueTitle: "구장 처리 대기열",
    actionTitle: "구장 신고 처리",
    description: "신청 정보와 위치를 먼저 확인하고, 신고가 있는 경우에만 신고 조치를 처리합니다.",
  },
  players: {
    title: "플레이어 신고",
    queueTitle: "플레이어 신고 대기열",
    actionTitle: "플레이어 최종판단",
    description: "선수를 누르면 해당 플레이어에게 쌓인 신고와 제재 이력을 보고 최종판단합니다.",
  },
  matches: {
    title: "경기 심사",
    queueTitle: "경기 심사 대기열",
    actionTitle: "경기 최종판단",
    description: "경기 신고, 기록 오류, 이의 상태를 경기 단위로 확인합니다.",
  },
  teams: {
    title: "팀 엠블럼 신고",
    queueTitle: "엠블럼 신고 대기열",
    actionTitle: "엠블럼 최종판단",
    description: "현재 이미지를 확인하고 신고 인정 시 즉시 기본값으로 전환합니다. 누적 위반 횟수에 따라 업로드가 제한됩니다.",
  },
};

function statusLabel(status) {
  if (status === "resolved") return "처리됨";
  if (status === "dismissed") return "기각";
  if (status === "reported") return "신고됨";
  if (status === "disputed") return "이의제기";
  if (status === "pending") return "대기";
  if (status === "approved") return "승인됨";
  if (status === "rejected") return "반려됨";
  if (status === "open") return "대기";
  if (status === "active") return "활성";
  if (status === "hidden") return "숨김";
  if (status === "disabled") return "비활성";
  return status || "대기";
}

function isPendingCourtRequest(request = {}) {
  return ["pending", "reported"].includes(request.status ?? "pending");
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

function RatingPolicyPanel({ app }) {
  const loadRatingPolicy = app.actions.loadRatingPolicy;
  const [draft, setDraft] = useState(() => cloneRatingPolicy(DEFAULT_RATING_POLICY));
  const [savedPolicy, setSavedPolicy] = useState(() => cloneRatingPolicy(DEFAULT_RATING_POLICY));
  const [defaultPolicy, setDefaultPolicy] = useState(() => cloneRatingPolicy(DEFAULT_RATING_POLICY));
  const [version, setVersion] = useState(1);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");

  const applyResult = (result = {}) => {
    const policy = normalizeRatingPolicy(result.policy ?? DEFAULT_RATING_POLICY);
    const defaults = normalizeRatingPolicy(result.defaults ?? DEFAULT_RATING_POLICY);
    setDraft(policy);
    setSavedPolicy(policy);
    setDefaultPolicy(defaults);
    setVersion(Number(result.version ?? 1));
    setHistory(result.history ?? []);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRatingPolicy?.()
      .then((result) => {
        if (!active) return;
        if (!result || result.ok === false) {
          setStatus("정책을 불러오지 못했습니다.");
          return;
        }
        applyResult(result);
      })
      .catch(() => {
        if (active) setStatus("정책을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadRatingPolicy]);

  const changed = JSON.stringify(draft) !== JSON.stringify(savedPolicy);
  const updateField = (field, rawValue) => {
    const value = Math.max(field.min, Math.min(field.max, Number(rawValue)));
    setDraft((current) => setRatingPolicyValue(current, field.path, Number.isFinite(value) ? value : field.min));
    setStatus("");
  };
  const requestSave = () => {
    if (reason.trim().length < 4) {
      setStatus("변경 사유를 4자 이상 입력하세요.");
      return;
    }
    setConfirming(true);
  };
  const savePolicy = async () => {
    setConfirming(false);
    setSaving(true);
    setStatus("저장 중");
    try {
      const result = await app.actions.updateRatingPolicy?.({
        expectedVersion: version,
        policy: normalizeRatingPolicy(draft),
        reason: reason.trim(),
      });
      if (!result || result.ok === false) {
        setStatus(result?.error?.includes?.("stale") ? "다른 관리자가 먼저 저장했습니다. 새로 불러오세요." : "정책 저장에 실패했습니다.");
        return;
      }
      applyResult(result);
      setReason("");
      setStatus("저장 완료");
    } catch {
      setStatus("정책 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card className="section-card admin-rating-policy">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Rating Policy</p>
          <h2>MMR·신뢰도 이벤트 정책</h2>
          <span>현재 버전 {version} · 변경은 저장 이후 확정되는 경기와 새 이벤트부터 적용됩니다.</span>
        </div>
        <Badge tone="orange">최고관리자</Badge>
      </div>

      {loading ? <div className="empty-state">정책 불러오는 중</div> : (
        <>
          <div className="admin-rating-groups">
            {RATING_POLICY_GROUPS.map((group) => (
              <section key={group.id} className="admin-rating-group">
                <div>
                  <h3>{group.label}</h3>
                  <p>{group.description}</p>
                </div>
                <div className="admin-rating-field-grid">
                  {group.fields.map((field) => {
                    const id = `rating-${field.path.join("-")}`;
                    return (
                      <label key={id} htmlFor={id}>
                        <span>{field.label}</span>
                        <span className="admin-rating-input">
                          <input
                            id={id}
                            type="number"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            value={getRatingPolicyValue(draft, field.path)}
                            onChange={(event) => updateField(field, event.target.value)}
                          />
                          <em>{field.unit}</em>
                        </span>
                        <small>{field.min}~{field.max}{field.unit}</small>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="admin-rating-save">
            <label>
              변경 사유
              <input value={reason} maxLength={160} placeholder="예: 시즌 초 1v1 변동폭 완화" onChange={(event) => setReason(event.target.value)} />
            </label>
            <div>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => {
                setDraft(cloneRatingPolicy(defaultPolicy));
                setStatus("기본값을 초안에 적용했습니다.");
              }}>
                <RotateCcw size={16} /> 기본값
              </Button>
              <Button type="button" disabled={!changed || saving} onClick={requestSave}>
                <Save size={16} /> 저장
              </Button>
            </div>
            {status ? <strong className="admin-rating-status" aria-live="polite">{status}</strong> : null}
          </div>

          <div className="admin-rating-history">
            <strong>최근 변경</strong>
            {history.length ? history.map((entry) => (
              <div key={entry.id}>
                <span><b>v{entry.version}</b>{entry.reason || "사유 없음"}</span>
                <small>{entry.createdBy || "-"} · {formatDate(entry.createdAt)}</small>
              </div>
            )) : <span className="admin-empty-line">변경 이력 없음</span>}
          </div>
        </>
      )}
      </Card>
      {confirming ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => setConfirming(false)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="MMR·신뢰도 정책 저장" onMouseDown={(event) => event.stopPropagation()}>
            <strong>정책 버전 {version + 1}로 저장할까요?</strong>
            <p>저장 이후 확정되는 경기와 새 신뢰도 이벤트부터 적용됩니다. 이전 결과는 재계산하지 않습니다.</p>
            <div className="app-confirm-actions">
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>취소</Button>
              <Button type="button" onClick={savePolicy}>저장</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function Admin({ app }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const adminLevel = Number(app.adminContext?.level ?? 0);
  const canOwner = adminLevel >= 100;
  const sectionOptions = ADMIN_SECTION_OPTIONS.filter((option) => !option.ownerOnly || canOwner);
  const requestedSection = searchParams.get("section");
  const section = sectionOptions.some((option) => option.id === requestedSection) ? requestedSection : DEFAULT_ADMIN_SECTION;
  const view = ["appointments", "ratingPolicy"].includes(section) ? "courts" : section;
  const [queueModeState, setQueueModeState] = useState({ section: DEFAULT_ADMIN_SECTION, value: DEFAULT_ADMIN_QUEUE_MODE });
  const queueMode = queueModeState.section === section ? queueModeState.value : DEFAULT_ADMIN_QUEUE_MODE;
  const setQueueMode = (value) => setQueueModeState({ section, value });
  const [queueFilterByView, setQueueFilterByView] = useState({});
  const [appliedQueueFilterByView, setAppliedQueueFilterByView] = useState({});
  const queueFilter = queueFilterByView[section] ?? "";
  const appliedQueueFilter = appliedQueueFilterByView[section] ?? "";
  const loadAdminSection = app.actions.loadAdminSection;
  useEffect(() => {
    if (section === "ratingPolicy") return;
    loadAdminSection?.({ section, queueMode, filter: appliedQueueFilter, limit: ADMIN_DEFAULT_PAGE_LIMIT, offset: 0 });
  }, [appliedQueueFilter, loadAdminSection, queueMode, section]);
  const [selectedIdByView, setSelectedIdByView] = useState({});
  const [selectedReportIdByScope, setSelectedReportIdByScope] = useState({});
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
  const [appointmentUserQuery, setAppointmentUserQuery] = useState("");
  const [appointmentUserSnapshot, setAppointmentUserSnapshot] = useState(null);
  const [courtApprovalDraft, setCourtApprovalDraft] = useState({
    approvedName: "",
    addressVerified: false,
    multipleCourtsVerified: false,
  });
  const [courtApprovalStatus, setCourtApprovalStatus] = useState("");
  const [reviewActionStatus, setReviewActionStatus] = useState("");
  const [reviewActionPending, setReviewActionPending] = useState(false);
  const canAdmin = adminLevel >= 30 || hasAdminAccess(app.currentUser, app.state.settings);
  const adminViewState = app.adminState ?? app.state;
  const model = useMemo(() => buildAdminReviewModel(adminViewState), [adminViewState]);
  const appointments = useMemo(() => buildAdminAppointmentModel(adminViewState), [adminViewState]);
  const appointmentUsers = useMemo(
    () => {
      const usersById = new Map((adminViewState.users ?? []).map((user) => [user.id, user]));
      if (appointmentUserSnapshot?.id) usersById.set(appointmentUserSnapshot.id, appointmentUserSnapshot);
      return [...usersById.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    [adminViewState.users, appointmentUserSnapshot],
  );
  const activeAppointmentOptions = useMemo(
    () => appointments.rows.filter((row) => row.active && row.source !== "current_profile" && row.source !== "server_context"),
    [appointments.rows],
  );
  const reviewRows = useMemo(() => {
    const rows = model[view] ?? [];
    if (view === "courts") {
      return rows.filter((row) => row.courtRequestCount > 0 || row.reportCount > 0 || row.courtReviewCount > 0);
    }
    if (view === "matches") {
      return rows.filter((row) => row.reportCount > 0 || row.issueCount > 0);
    }
    return rows;
  }, [model, view]);
  const pendingRows = useMemo(() => reviewRows.filter((row) => {
    if (view === "courts") return row.openCount > 0 || row.courtRequests.some(isPendingCourtRequest);
    if (view === "matches") return row.issueCount > 0;
    return row.openCount > 0;
  }), [reviewRows, view]);
  const activeRows = queueMode === "history" ? reviewRows : pendingRows;
  const selectedId = selectedIdByView[view];
  const selectedRow = activeRows.find((row) => row.id === selectedId) ?? activeRows[0] ?? null;
  const reportOptions = selectedRow?.reports ?? [];
  const selectedReportScope = `${view}:${selectedRow?.id ?? ""}`;
  const selectedReportId = selectedReportIdByScope[selectedReportScope] ?? "";
  const userMap = useMemo(() => Object.fromEntries((adminViewState.users ?? []).map((user) => [user.id, user])), [adminViewState.users]);
  const matchMap = useMemo(() => Object.fromEntries((adminViewState.matches ?? []).map((match) => [match.id, match])), [adminViewState.matches]);
  const selectedReport = reportOptions.find((report) => report.id === selectedReportId) ?? reportOptions.find((report) => report.status === "open") ?? reportOptions[0] ?? null;
  const selectedCourtRequest = selectedRow?.courtRequests?.find(isPendingCourtRequest)
    ?? selectedRow?.courtRequests?.[0]
    ?? null;
  const selectedCourtRequester = selectedCourtRequest ? userMap[selectedCourtRequest.requestedBy] : null;
  const courtLocationMatches = useMemo(
    () => selectedCourtRequest
      ? getCourtLocationMatches(selectedCourtRequest, adminViewState, { excludeRequestId: selectedCourtRequest.id })
      : [],
    [adminViewState, selectedCourtRequest],
  );
  const approvedLocationMatches = courtLocationMatches.filter((candidate) => candidate.type === "approved");
  const courtMapHref = selectedCourtRequest ? getCourtMapUrl(selectedCourtRequest) : "";
  const workflow = REVIEW_WORKFLOW_COPY[view] ?? REVIEW_WORKFLOW_COPY.players;
  const sectionCounts = useMemo(() => {
    const courtReports = (adminViewState.reports ?? []).filter((report) => (
      report.status === "open" && ["court", "court_review"].includes(report.type)
    )).length;
    const localCounts = {
      courts: (adminViewState.settings?.courtRequests ?? []).filter(isPendingCourtRequest).length + courtReports,
      players: model.players.filter((row) => row.openCount > 0).length,
      matches: model.matches.filter((row) => row.issueCount > 0).length,
      teams: model.teams.filter((row) => row.openCount > 0).length,
      appointments: appointments.summary.pendingAppointmentCount,
      ratingPolicy: "",
    };
    return Object.fromEntries(Object.entries(localCounts).map(([key, value]) => [
      key,
      key === "ratingPolicy" ? "" : app.adminStatus?.counts?.[key] ?? (key === section ? value : ""),
    ]));
  }, [adminViewState.reports, adminViewState.settings?.courtRequests, app.adminStatus?.counts, appointments.summary.pendingAppointmentCount, model.matches, model.players, model.teams, section]);
  const activeAdminPage = app.adminStatus?.section === section && app.adminStatus?.queueMode === queueMode
    ? app.adminStatus.page
    : null;
  const changeSection = (nextSection) => {
    const next = new URLSearchParams(searchParams);
    next.set("section", nextSection);
    setSearchParams(next);
  };
  const applyQueueFilter = () => {
    setAppliedQueueFilterByView((current) => ({ ...current, [section]: queueFilter.trim() }));
  };
  const updateQueueFilter = (value) => {
    setQueueFilterByView((current) => ({ ...current, [section]: value }));
  };
  const clearQueueFilter = () => {
    setQueueFilterByView((current) => ({ ...current, [section]: "" }));
    setAppliedQueueFilterByView((current) => ({ ...current, [section]: "" }));
  };
  const visibleActionOptions = useMemo(() => {
    if (selectedReport?.type === "team_emblem") {
      return ACTION_OPTIONS.filter((option) => ["resetTeamEmblem", "dismissReport", "maliciousReporter"].includes(option.id));
    }
    const ids = ["validReport", "dismissReport", "maliciousReporter"];
    if (selectedReport?.type === "court") ids.push("hideCourt");
    if (selectedReport?.type === "court_review") ids.push("hideCourtReview", "suspendTarget");
    if (selectedReport?.type === "match" || selectedReport?.type === "player") ids.push("suspendTarget", "refereeDiscipline");
    if (selectedReport?.type === "court_request") ids.push("suspendTarget");
    return ACTION_OPTIONS.filter((option) => ids.includes(option.id));
  }, [selectedReport?.type]);
  const targetCandidates = useMemo(() => {
    const ids = new Set([
      ...(selectedReport?.reportedUserIds ?? []),
      selectedReport?.by,
      selectedRow?.player?.id,
      ...(selectedRow?.courtRequests ?? []).map((request) => request.requestedBy),
    ].filter(Boolean));
    return [...ids].map((userId) => userMap[userId]).filter(Boolean);
  }, [selectedReport, selectedRow, userMap]);
  const selectedTargetUserId = targetCandidates.some((user) => user.id === actionDraft.targetUserId)
    ? actionDraft.targetUserId
    : targetCandidates[0]?.id ?? "";
  const actionNeedsTarget = ["maliciousReporter", "suspendTarget", "refereeDiscipline"].includes(actionDraft.actionType);
  const selectedNeedsAction = Boolean(
    selectedRow && (
      selectedRow.openCount > 0 ||
      (view === "courts" && selectedRow.courtRequests.some(isPendingCourtRequest)) ||
      (view === "matches" && selectedRow.issueCount > 0)
    )
  );

  useEffect(() => {
    setReviewActionStatus("");
    setActionDraft((current) => ({
      ...current,
      actionType: visibleActionOptions.some((option) => option.id === current.actionType) ? current.actionType : visibleActionOptions[0]?.id ?? "validReport",
      targetUserId: targetCandidates[0]?.id ?? "",
      reason: "",
      feedback: "",
    }));
  }, [selectedReport?.id, selectedRow?.id, targetCandidates, visibleActionOptions]);

  useEffect(() => {
    setCourtApprovalDraft({
      approvedName: selectedCourtRequest?.name ?? "",
      addressVerified: false,
      multipleCourtsVerified: false,
    });
    setCourtApprovalStatus("");
  }, [selectedCourtRequest?.id, selectedCourtRequest?.name]);

  const updateActionDraft = (patch) => setActionDraft((current) => ({ ...current, ...patch }));
  const updateAppointmentDraft = (patch) => setAppointmentDraft((current) => ({ ...current, ...patch }));
  const selectAppointmentUser = (user) => {
    if (!user?.id) return;
    setAppointmentUserSnapshot(user);
    setAppointmentUserQuery(user.name ?? user.handle ?? user.hashtag ?? user.id);
    updateAppointmentDraft({ userId: user.id });
  };
  const updateCourtApprovalDraft = (patch) => setCourtApprovalDraft((current) => ({ ...current, ...patch }));
  const approveSelectedCourt = async () => {
    if (!selectedCourtRequest) return;
    setCourtApprovalStatus("승인 중");
    const result = await app.actions.approveCourtRequest(selectedCourtRequest.id, courtApprovalDraft);
    setCourtApprovalStatus(result && result.ok !== false ? "승인 완료" : "승인 실패");
  };
  const commitSelectedAction = async () => {
    if (!selectedReport || reviewActionPending) return;
    setReviewActionPending(true);
    setReviewActionStatus("처리 중");
    try {
      const result = await app.actions.commitAdminReviewAction({
        ...actionDraft,
        targetUserId: selectedTargetUserId,
        reportId: selectedReport.id,
      });
      if (!result || result.ok === false) {
        setReviewActionStatus(selectedReport.type === "team_emblem"
          ? getTeamEmblemErrorMessage(result?.error || "admin_review_action_failed")
          : "관리자 처리를 완료하지 못했습니다.");
      } else if (result.storageCleanupPending) {
        setReviewActionStatus("기본값 전환은 완료됐습니다. 저장 파일 정리는 재확인이 필요합니다.");
      } else {
        setReviewActionStatus("처리 완료");
      }
    } catch (error) {
      setReviewActionStatus(selectedReport.type === "team_emblem"
        ? getTeamEmblemErrorMessage(error?.code || error?.message)
        : "관리자 처리를 완료하지 못했습니다.");
    } finally {
      setReviewActionPending(false);
    }
  };
  const commitAppointmentAction = () => {
    const appointmentId = ["revokeAppointment", "extendAppointment"].includes(appointmentDraft.actionType)
      ? appointmentDraft.appointmentId || activeAppointmentOptions[0]?.id || ""
      : "";
    app.actions.commitAdminAppointmentAction({
      ...appointmentDraft,
      userId: appointmentDraft.userId,
      appointmentId,
    });
  };

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
      ) : section === "appointments" ? (
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
          <div className="admin-row-actions">
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
            <strong>임명/연장/회수 액션</strong>
            <small>처리는 server action/RPC로 커밋됩니다. 화면 state는 커밋 후 서버 재조회 기준으로 맞춰야 합니다.</small>
          </div>
          <div className="arena-field-grid">
            <label>
              액션
              <select value={appointmentDraft.actionType} onChange={(event) => updateAppointmentDraft({ actionType: event.target.value })}>
                {APPOINTMENT_ACTION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
            {["revokeAppointment", "extendAppointment"].includes(appointmentDraft.actionType) ? (
              <label>
                {appointmentDraft.actionType === "extendAppointment" ? "연장 대상" : "회수 대상"}
                <select value={appointmentDraft.appointmentId || activeAppointmentOptions[0]?.id || ""} onChange={(event) => updateAppointmentDraft({ appointmentId: event.target.value })}>
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
            disabled={["revokeAppointment", "extendAppointment"].includes(appointmentDraft.actionType)
              ? !activeAppointmentOptions.length
              : !appointmentDraft.userId}
            onClick={commitAppointmentAction}
          >
            임명/연장/회수 커밋
          </Button>
        </div>
          <small>{ADMIN_BACKEND_TODO}</small>
        </Card>
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
                placeholder="이름, 구장, 경기, 사유"
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
              <Button type="button" variant="secondary" onClick={applyQueueFilter}>적용</Button>
              {appliedQueueFilter ? <Button type="button" variant="secondary" onClick={clearQueueFilter}>초기화</Button> : null}
            </div>
          </div>
          <div className="segmented-control compact-segments admin-queue-filter">
            <button type="button" className={queueMode === "pending" ? "active" : ""} onClick={() => setQueueMode("pending")}>처리 대기 {pendingRows.length}</button>
            <button type="button" className={queueMode === "history" ? "active" : ""} onClick={() => setQueueMode("history")}>전체 이력 {reviewRows.length}</button>
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
                  <b>{view === "courts" ? row.courtRequests.filter(isPendingCourtRequest).length : row.issueCount ?? row.openCount}</b>
                  <small>{view === "courts" ? "신청" : "이슈"}</small>
                  <b>{row.reportCount}</b>
                  <small>신고</small>
                </span>
              </button>
            ))}
            {!activeRows.length ? <div className="empty-state">{queueMode === "pending" ? "처리할 항목이 없습니다." : "처리 이력이 없습니다."}</div> : null}
          </div>
          {activeAdminPage?.hasMore ? (
            <Button type="button" variant="secondary" disabled={app.adminStatus?.loading} onClick={() => app.actions.loadMoreAdminSection?.()}>
              {app.adminStatus?.loading ? "불러오는 중" : `더 보기 (${activeRows.length}/${activeAdminPage.total})`}
            </Button>
          ) : null}
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
                <Badge tone={selectedNeedsAction ? "orange" : "green"}>{selectedNeedsAction ? "처리 필요" : "정리됨"}</Badge>
              </div>

              <div className="admin-review-context">
                <strong>{workflow.title}</strong>
                <span>{workflow.description}</span>
              </div>

              <div className="contract-grid">
                <div>
                  <span>{view === "courts" ? "신청" : "신고"}</span>
                  <strong>{view === "courts" ? selectedRow.courtRequestCount : selectedRow.reportCount}</strong>
                </div>
                <div>
                  <span>{view === "courts" ? "대기" : "이슈"}</span>
                  <strong>{view === "courts" ? selectedRow.courtRequests.filter(isPendingCourtRequest).length : selectedRow.issueCount ?? selectedRow.openCount}</strong>
                </div>
                <div>
                  <span>신고</span>
                  <strong>{selectedRow.reportCount}</strong>
                </div>
                <div>
                  <span>{view === "teams" ? "위반" : "경기"}</span>
                  <strong>{view === "teams" ? selectedRow.team?.emblemViolationCount ?? 0 : selectedRow.matchCount ?? 0}</strong>
                </div>
              </div>

              {view === "teams" && selectedRow.team ? (
                <section className="admin-team-emblem-detail">
                  <TeamEmblem team={selectedRow.team} size="lg" />
                  <div>
                    <strong>현재 팀 엠블럼</strong>
                    <span>{selectedRow.team.emblemSource === "upload" && selectedRow.team.emblemKey ? "사진 사용 중" : "기본값 사용 중"}</span>
                    <small>누적 위반 {selectedRow.team.emblemViolationCount ?? 0}회 · 제한 종료 {formatDate(selectedRow.team.emblemUploadBlockedUntil)}</small>
                  </div>
                </section>
              ) : null}

              {view === "courts" && selectedCourtRequest ? (
                <section className="admin-court-request-detail">
                  <div className="section-title-row">
                    <div>
                      <p className="eyebrow">Court Request</p>
                      <h3>구장 신청 상세</h3>
                    </div>
                    <Badge tone={selectedCourtRequest.status === "approved" ? "green" : selectedCourtRequest.status === "reported" ? "orange" : "neutral"}>
                      {statusLabel(selectedCourtRequest.status)}
                    </Badge>
                  </div>
                  <div className="admin-court-facts">
                    <div><span>신청자</span><strong>{selectedCourtRequester?.name ?? "확인 필요"}</strong><em>신뢰도 {selectedCourtRequest.requestedByTrustScore ?? selectedCourtRequester?.trustScore ?? "-"}</em></div>
                    <div><span>신청 시설명</span><strong>{selectedCourtRequest.facilityName || selectedCourtRequest.baseName || selectedCourtRequest.name}</strong><em>코트 구분 {selectedCourtRequest.courtUnit || "없음"}</em></div>
                    <div><span>검색 기준 주소</span><strong>{selectedCourtRequest.searchAddressText || "별도 검색 주소 없음"}</strong><em>핀 이동 전 기준</em></div>
                    <div><span>핀 기준 실제 주소</span><strong>{selectedCourtRequest.addressText || "주소 미입력"}</strong><em>{selectedCourtRequest.detailAddress || "상세주소 없음"}</em></div>
                    <div><span>도로명 · 지번</span><strong>{selectedCourtRequest.roadAddress || "도로명 없음"}</strong><em>{selectedCourtRequest.jibunAddress || "지번 없음"}</em></div>
                    <div><span>좌표</span><strong>{selectedCourtRequest.lat != null && selectedCourtRequest.lng != null ? `${Number(selectedCourtRequest.lat).toFixed(5)}, ${Number(selectedCourtRequest.lng).toFixed(5)}` : "좌표 확인 필요"}</strong><em>핀 기준 실제 위치</em></div>
                    <div><span>구장 속성</span><strong>{getCourtSurfaceLabel(selectedCourtRequest)} · {getCourtLayoutLabel(selectedCourtRequest)}</strong><em>{selectedCourtRequest.type ?? "유형 미정"} · {selectedCourtRequest.paid ? "유료" : "무료"}</em></div>
                  </div>
                  {selectedCourtRequest.locationNote ? <p className="admin-court-note">{selectedCourtRequest.locationNote}</p> : null}
                  {selectedCourtRequest.status !== "approved" ? (
                    <div className="admin-court-verification">
                      <div className="admin-court-verification-head">
                        <div>
                          <strong>실재 여부 확인</strong>
                          <small>주소와 핀 위치를 확인하고 승인 구장명을 최종 확정합니다.</small>
                        </div>
                        {courtMapHref ? (
                          <a href={courtMapHref} target="_blank" rel="noreferrer" className="admin-court-map-link">
                            <ExternalLink size={16} /> 네이버 지도
                          </a>
                        ) : null}
                      </div>
                      <label>
                        승인 구장명
                        <input value={courtApprovalDraft.approvedName} onChange={(event) => updateCourtApprovalDraft({ approvedName: event.target.value })} />
                      </label>
                      {courtLocationMatches.length ? (
                        <div className="admin-court-location-matches">
                          <strong>같은 장소 신청·등록 {courtLocationMatches.length}개</strong>
                          {courtLocationMatches.map((candidate) => (
                            <span key={`${candidate.type}-${candidate.court.id}`}>
                              <b>{candidate.court.name}</b>
                              <em>{candidate.type === "approved" ? "등록됨" : "승인 대기"} · {candidate.court.courtUnit || "코트 구분 없음"}</em>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <label className="admin-court-check">
                        <input type="checkbox" checked={courtApprovalDraft.addressVerified} onChange={(event) => updateCourtApprovalDraft({ addressVerified: event.target.checked })} />
                        주소·핀·지도에서 실제 구장임을 확인함
                      </label>
                      {approvedLocationMatches.length ? (
                        <label className="admin-court-check">
                          <input type="checkbox" checked={courtApprovalDraft.multipleCourtsVerified} onChange={(event) => updateCourtApprovalDraft({ multipleCourtsVerified: event.target.checked })} />
                          같은 장소지만 물리적으로 다른 코트임을 확인함
                        </label>
                      ) : null}
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={
                          !courtApprovalDraft.approvedName.trim()
                          || !courtApprovalDraft.addressVerified
                          || (approvedLocationMatches.length > 0 && !courtApprovalDraft.multipleCourtsVerified)
                          || courtApprovalStatus === "승인 중"
                        }
                        onClick={approveSelectedCourt}
                      >
                        {courtApprovalStatus === "승인 중" ? "승인 중" : "확인 후 구장 승인"}
                      </Button>
                      {courtApprovalStatus ? <small>{courtApprovalStatus}</small> : null}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {selectedReport ? (
              <div className="admin-action-panel">
                <div>
                  <strong>{workflow.actionTitle}</strong>
                  <small>선택된 신고 기준으로 신고자 피드백과 제재 로그를 커밋합니다.</small>
                </div>
                <div className="arena-field-grid">
                  <label>
                    처리할 신고
                    <select
                      value={selectedReport?.id ?? ""}
                      disabled={!reportOptions.length}
                      onChange={(event) => setSelectedReportIdByScope((current) => ({ ...current, [selectedReportScope]: event.target.value }))}
                    >
                      {!reportOptions.length ? <option value="">신고 없음</option> : null}
                      {reportOptions.map((report) => (
                        <option key={report.id} value={report.id}>
                          {statusLabel(report.status)} · {report.reason} · {report.type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    액션
                    <select value={actionDraft.actionType} onChange={(event) => updateActionDraft({ actionType: event.target.value })}>
                      {visibleActionOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  {actionNeedsTarget ? <label>
                    대상
                    <select value={selectedTargetUserId} disabled={!targetCandidates.length} onChange={(event) => updateActionDraft({ targetUserId: event.target.value })}>
                      {!targetCandidates.length ? <option value="">대상 없음</option> : null}
                      {targetCandidates.map((user) => <option key={user.id} value={user.id}>{user.name} · 신뢰도 {user.trustScore ?? "-"}</option>)}
                    </select>
                  </label> : null}
                </div>
                {actionNeedsTarget ? <label>
                  제재 기간
                  <select value={actionDraft.durationDays} onChange={(event) => updateActionDraft({ durationDays: Number(event.target.value) })}>
                    {SUSPENSION_TIERS.map((tier) => <option key={tier.id} value={tier.days}>{tier.label}</option>)}
                  </select>
                </label> : null}
                <label>
                  처리 사유
                  <textarea value={actionDraft.reason} placeholder="관리자 처리 사유" onChange={(event) => updateActionDraft({ reason: event.target.value })} />
                </label>
                <label>
                  신고자 피드백
                  <textarea value={actionDraft.feedback} placeholder={ADMIN_REVIEW_ACTIONS[actionDraft.actionType]?.feedback} onChange={(event) => updateActionDraft({ feedback: event.target.value })} />
                </label>
                <Button type="button" variant="secondary" disabled={reviewActionPending || !selectedReport || selectedReport.status !== "open" || (actionDraft.actionType === "resetTeamEmblem" && adminLevel < 50)} onClick={commitSelectedAction}>
                  {reviewActionPending ? "처리 중" : "액션 커밋"}
                </Button>
                {actionDraft.actionType === "resetTeamEmblem" && adminLevel < 50 ? <small>경기관리자 이상만 엠블럼을 강제 전환할 수 있습니다.</small> : null}
                {reviewActionStatus ? <small role="status">{reviewActionStatus}</small> : null}
                <small>실시간 중복 방지는 서버 트랜잭션에서 최종 확인합니다.</small>
              </div>
              ) : null}

              {selectedRow.reports.length ? <DetailList title={view === "courts" ? "구장 신고" : "쌓인 신고"} empty="신고 없음">
                {selectedRow.reports.length ? selectedRow.reports.slice(0, 8).map((report) => (
                  <div key={report.id} className="admin-detail-row">
                    <span>
                      <strong>{report.reason}</strong>
                      <em>
                        {report.type === "match" && matchMap[report.targetId] ? `${getMatchHashtag(matchMap[report.targetId])} · ` : ""}
                        신고자 {userMap[report.by]?.name ?? report.by ?? "-"} · {report.type} · {formatDate(report.createdAt)}
                      </em>
                    </span>
                    <Badge tone={report.status === "open" ? "orange" : "neutral"}>{statusLabel(report.status)}</Badge>
                  </div>
                )) : null}
              </DetailList> : null}

              {view === "players" ? <DetailList title="최근 제재" empty="제재 없음">
                {selectedRow.disciplinaryActions?.length ? selectedRow.disciplinaryActions.slice(0, 8).map((action) => (
                  <div key={action.id} className="admin-detail-row">
                    <span>
                      <strong>{statusLabel(action.status)} · {action.actionType ?? action.type}</strong>
                      <em>{action.reason || "사유 없음"} · {formatDate(action.startsAt)} ~ {formatDate(action.endsAt)}</em>
                    </span>
                    <Badge tone={action.status === "active" ? "orange" : "neutral"}>{action.durationDays ?? "-"}일</Badge>
                  </div>
                )) : null}
              </DetailList> : null}

              {selectedRow.matches.length ? <DetailList title="관련 경기" empty="관련 경기 없음">
                {selectedRow.matches.length ? selectedRow.matches.slice(0, 8).map((match) => (
                  <div key={match.id} className="admin-detail-row">
                    <span>
                      <strong>{getMatchHashtag(match)} · {match.title ?? `${match.teamA?.name ?? "A"} vs ${match.teamB?.name ?? "B"}`}</strong>
                      <em>{match.court ?? "미정 구장"} · {match.scheduledDate ?? ""} {match.scheduledTime ?? ""}</em>
                    </span>
                    <Badge tone={match.status === "disputed" ? "orange" : "neutral"}>{statusLabel(match.status)}</Badge>
                  </div>
                )) : null}
              </DetailList> : null}

              {view === "players" && selectedRow.courtRequests.length ? <DetailList title="구장 등록요청" empty="관련 요청 없음">
                {selectedRow.courtRequests.length ? selectedRow.courtRequests.slice(0, 8).map((request) => (
                  <div key={request.id} className="admin-detail-row">
                    <span>
                      <strong>{request.name}</strong>
                      <em>{request.addressText} · {request.hashtag ?? "해시태그 자동"}</em>
                    </span>
                    <span className="admin-row-actions">
                      <Badge tone={request.status === "reported" ? "orange" : request.status === "approved" ? "green" : "neutral"}>{statusLabel(request.status)}</Badge>
                      {request.status !== "approved" ? <em>구장 신청 탭에서 확인 후 승인</em> : null}
                    </span>
                  </div>
                )) : null}
              </DetailList> : null}

              {view === "courts" && selectedRow.courtReviews?.length ? <DetailList title="구장 리뷰" empty="관련 리뷰 없음">
                {selectedRow.courtReviews?.length ? selectedRow.courtReviews.slice(0, 8).map((review) => (
                  <div key={review.id} className="admin-detail-row">
                    <span>
                      <strong>{review.courtName ?? "구장 리뷰"}</strong>
                      <em>{review.rating ?? "-"}점 · {review.memo || "메모 없음"}</em>
                    </span>
                    <Badge tone={review.status === "hidden" ? "orange" : "neutral"}>{statusLabel(review.status ?? "active")}</Badge>
                  </div>
                )) : null}
              </DetailList> : null}
            </>
          ) : (
            <div className="empty-state">검토할 큐가 없습니다.</div>
          )}
        </Card>
      </div>
      )}
    </div>
  );
}
