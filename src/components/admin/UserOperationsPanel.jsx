import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Search, ShieldAlert, UserRoundCheck } from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import { SUSPENSION_TIERS } from "../../lib/admin.js";
import {
  ADMIN_USER_OPERATION_ACTIONS,
  getAdminUserRiskMeta,
  getAdminUserRiskSignals,
  validateAdminUserOperationDraft,
} from "../../lib/adminUserOperations.js";

const EMPTY_RESULT = Object.freeze({
  summary: {
    totalUsers: 0,
    activeUsers30d: 0,
    signalUsers: 0,
    reviewUsers: 0,
    activeSanctionUsers: 0,
    newUsers30d: 0,
    warningCount30d: 0,
    roomRemakeCount30d: 0,
    roomRemakeReviewUsers: 0,
  },
  rows: [],
  page: { limit: 30, offset: 0, total: 0, nextOffset: null, hasMore: false },
});

const ACTION_OPTIONS = Object.entries(ADMIN_USER_OPERATION_ACTIONS).map(([id, value]) => ({ id, ...value }));

function mergeRows(currentRows = [], nextRows = []) {
  const rows = new Map(currentRows.map((row) => [row.id, row]));
  nextRows.forEach((row) => {
    if (row?.id) rows.set(row.id, row);
  });
  return [...rows.values()];
}

function formatDateTime(value) {
  if (!value) return "없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "없음";
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getOperationErrorMessage(error) {
  const code = String(error?.code ?? error?.message ?? error ?? "");
  if (code.includes("owner_target_protected")) return "최고관리자 계정은 이 화면에서 조치할 수 없습니다.";
  if (code.includes("admin_target_protected")) return "같거나 높은 등급의 관리자는 조치할 수 없습니다.";
  if (code.includes("self_admin_action_denied")) return "자기 계정에는 조치할 수 없습니다.";
  if (code.includes("profile_not_found")) return "대상 사용자를 찾을 수 없습니다.";
  if (code.includes("admin_permission_required")) return "경기관리자 이상 권한이 필요합니다.";
  return "운영 조치를 완료하지 못했습니다.";
}

export default function UserOperationsPanel({ app }) {
  const loadUsers = app.actions.loadAdminUserOperations;
  const commitOperation = app.actions.commitAdminUserOperation;
  const requestVersionRef = useRef(0);
  const [riskOnly, setRiskOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [result, setResult] = useState(EMPTY_RESULT);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState({
    actionType: "warning",
    durationDays: 3,
    reason: "",
    message: "",
  });
  const [actionStatus, setActionStatus] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const loadPage = useCallback(async ({ offset = 0, append = false } = {}) => {
    const requestVersion = ++requestVersionRef.current;
    setLoading(true);
    setLoadError("");
    try {
      const response = await loadUsers?.({
        search: appliedSearch,
        riskOnly,
        limit: 30,
        offset,
      });
      if (requestVersionRef.current !== requestVersion) return false;
      if (!response || response.ok === false) {
        setLoadError("사용자 운영 통계를 불러오지 못했습니다.");
        return false;
      }
      setResult((current) => ({
        summary: response.summary ?? current.summary ?? EMPTY_RESULT.summary,
        rows: append ? mergeRows(current.rows, response.rows ?? []) : response.rows ?? [],
        page: response.page ?? EMPTY_RESULT.page,
      }));
      return true;
    } catch {
      if (requestVersionRef.current === requestVersion) setLoadError("사용자 운영 통계를 불러오지 못했습니다.");
      return false;
    } finally {
      if (requestVersionRef.current === requestVersion) setLoading(false);
    }
  }, [appliedSearch, loadUsers, riskOnly]);

  useEffect(() => {
    loadPage({ offset: 0 });
  }, [loadPage]);

  const selected = result.rows.find((row) => row.id === selectedId) ?? result.rows[0] ?? null;
  const selectedSignals = useMemo(() => getAdminUserRiskSignals(selected?.riskSignals), [selected?.riskSignals]);
  const selectedRisk = getAdminUserRiskMeta(selected?.riskScore);
  const selectedAction = ADMIN_USER_OPERATION_ACTIONS[draft.actionType] ?? ADMIN_USER_OPERATION_ACTIONS.warning;

  useEffect(() => {
    setConfirming(false);
    setActionStatus("");
    setDraft((current) => ({ ...current, reason: "", message: "" }));
  }, [selected?.id]);

  const applySearch = () => {
    const nextSearch = search.trim();
    if (nextSearch === appliedSearch) loadPage({ offset: 0 });
    else setAppliedSearch(nextSearch);
  };

  const updateDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch }));
    setConfirming(false);
    setActionStatus("");
  };

  const fillRoomRemakeWarning = () => {
    if (!selected) return;
    const sequence = Math.max(1, Number(selected.maxRoomRemakeSequence ?? 1));
    updateDraft({
      actionType: "warning",
      reason: `같은 설정으로 방 다시 만들기 반복 확인 · 최대 연속 ${sequence}회`,
      message: "같은 설정으로 방을 반복해서 다시 만들면 참가자 일정에 혼선이 생길 수 있습니다. 이후에도 반복되면 운영 검토 후 신뢰도가 조정될 수 있습니다.",
    });
  };

  const commit = async () => {
    if (!selected || actionPending) return;
    const operationDraft = { ...draft, targetUserId: selected.id };
    const validationError = validateAdminUserOperationDraft(operationDraft);
    if (validationError) {
      setActionStatus(validationError);
      return;
    }
    if (draft.actionType !== "warning" && !confirming) {
      setConfirming(true);
      setActionStatus("제재 범위와 기간을 다시 확인해 주세요.");
      return;
    }

    setActionPending(true);
    setActionStatus("처리 중");
    try {
      const response = await commitOperation?.(operationDraft);
      if (!response || response.ok === false) {
        setActionStatus(getOperationErrorMessage(response?.error));
        return;
      }
      setDraft((current) => ({ ...current, reason: "", message: "" }));
      setConfirming(false);
      setActionStatus(draft.actionType === "warning" ? "경고 알림을 보냈습니다." : "제재와 사용자 알림을 저장했습니다.");
      await loadPage({ offset: 0 });
    } catch (error) {
      setActionStatus(getOperationErrorMessage(error));
    } finally {
      setActionPending(false);
    }
  };

  return (
    <div className="admin-user-operations">
      <div className="admin-summary-grid">
        <Card className="section-card"><span>전체 사용자</span><strong>{result.summary.totalUsers ?? 0}</strong><em>등록 프로필</em></Card>
        <Card className="section-card"><span>30일 활동</span><strong>{result.summary.activeUsers30d ?? 0}</strong><em>경기·방·채팅·프로필</em></Card>
        <Card className="section-card"><span>검토 필요</span><strong>{result.summary.reviewUsers ?? 0}</strong><em>우선도 30 이상</em></Card>
        <Card className="section-card"><span>활성 제재</span><strong>{result.summary.activeSanctionUsers ?? 0}</strong><em>현재 제한 사용자</em></Card>
        <Card className="section-card"><span>30일 경고</span><strong>{result.summary.warningCount30d ?? 0}</strong><em>수동 경고 발송</em></Card>
        <Card className="section-card"><span>30일 다시 만들기</span><strong>{result.summary.roomRemakeCount30d ?? 0}</strong><em>검토 {result.summary.roomRemakeReviewUsers ?? 0}명</em></Card>
      </div>

      <Card className="section-card admin-user-ops-toolbar">
        <div>
          <p className="eyebrow">User Operations</p>
          <h2>사용자 통계·수동 조치</h2>
          <span>신호는 검토 순서용입니다. 자동 제재 근거로 사용하지 않습니다.</span>
        </div>
        <div className="admin-user-ops-search">
          <label>
            사용자 검색
            <span>
              <Search size={16} />
              <input
                value={search}
                placeholder="이름, #해시태그, ID, 지역"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applySearch();
                  }
                }}
              />
            </span>
          </label>
          <Button type="button" variant="secondary" onClick={applySearch}>검색</Button>
          <Button type="button" variant="secondary" disabled={loading} onClick={() => loadPage({ offset: 0 })}><RefreshCw size={16} /> 새로고침</Button>
        </div>
        <div className="segmented-control compact-segments admin-user-ops-mode">
          <button type="button" className={riskOnly ? "active" : ""} onClick={() => setRiskOnly(true)}>주의 신호 {result.summary.signalUsers ?? 0}</button>
          <button type="button" className={!riskOnly ? "active" : ""} onClick={() => setRiskOnly(false)}>전체 사용자</button>
        </div>
      </Card>

      <div className="admin-user-ops-workbench">
        <Card className="section-card admin-user-ops-list-card">
          <div className="section-title-row">
            <div><p className="eyebrow">Review Queue</p><h2>{riskOnly ? "주의 신호 사용자" : "전체 사용자"}</h2></div>
            <Badge tone="blue">{result.page.total ?? result.rows.length}명</Badge>
          </div>
          {loadError ? <div className="ui-empty-state-compact">{loadError}</div> : null}
          <div className="admin-user-risk-list">
            {result.rows.map((user) => {
              const risk = getAdminUserRiskMeta(user.riskScore);
              return (
                <button
                  key={user.id}
                  type="button"
                  className={selected?.id === user.id ? "admin-user-risk-row active" : "admin-user-risk-row"}
                  onClick={() => setSelectedId(user.id)}
                >
                  <span>
                    <strong>{user.name || "이름 없음"}</strong>
                    <em>{user.hashtag || user.id} · {user.region || "지역 미정"}</em>
                    <small>최근 활동 {formatDateTime(user.lastActivityAt)}</small>
                  </span>
                  <span>
                    <Badge tone={risk.tone}>{risk.label}</Badge>
                    <b>{Number(user.riskScore ?? 0)}</b>
                  </span>
                </button>
              );
            })}
            {!loading && !result.rows.length ? <div className="ui-empty-state-compact">조건에 맞는 사용자가 없습니다.</div> : null}
            {loading && !result.rows.length ? <div className="ui-empty-state-compact">불러오는 중</div> : null}
          </div>
          {result.page.hasMore ? (
            <Button type="button" variant="secondary" disabled={loading} onClick={() => loadPage({ offset: result.page.nextOffset, append: true })}>
              {loading ? "불러오는 중" : `더 보기 (${result.rows.length}/${result.page.total})`}
            </Button>
          ) : null}
        </Card>

        <Card className="section-card admin-user-ops-detail">
          {selected ? (
            <>
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">User Detail</p>
                  <h2>{selected.name || "이름 없음"}</h2>
                  <span>{selected.hashtag || selected.id} · {selected.position || "포지션 미정"} · 신뢰도 {selected.trustScore ?? 80}</span>
                </div>
                <Badge tone={selectedRisk.tone}>{selectedRisk.label} {Number(selected.riskScore ?? 0)}</Badge>
              </div>

              <section className="admin-user-signal-panel">
                <div><AlertTriangle size={18} /><strong>검토 신호</strong><small>수치만으로 경고·제재하지 않습니다.</small></div>
                <div className="admin-user-signal-list">
                  {selectedSignals.map((signal) => <span key={signal.id} title={signal.description}>{signal.label}</span>)}
                  {!selectedSignals.length ? <em>특이 신호 없음</em> : null}
                </div>
              </section>

              <div className="admin-user-stat-grid">
                <div><span>30일 경기</span><strong>{selected.matchCount30d ?? 0}</strong><em>누적 {selected.totalMatchCount ?? 0}</em></div>
                <div><span>30일 방 생성</span><strong>{selected.roomCount30d ?? 0}</strong><em>종료 {selected.closedRoomCount30d ?? 0}</em></div>
                <div><span>방 다시 만들기</span><strong>{selected.roomRemakeCount ?? 0}</strong><em>30일 {selected.roomRemakeCount30d ?? 0}회</em></div>
                <div><span>최대 연속 다시 만들기</span><strong>{selected.maxRoomRemakeSequence ?? 0}</strong><em>최근 {formatDateTime(selected.lastRoomRemakeAt)}</em></div>
                <div><span>30일 채팅</span><strong>{selected.messageCount30d ?? 0}</strong><em>메시지</em></div>
                <div><span>30일 경기 취소</span><strong>{selected.cancelledMatchCount30d ?? 0}</strong><em>참가 경기 기준</em></div>
                <div><span>30일 피신고</span><strong>{selected.receivedReportCount30d ?? 0}</strong><em>미처리 {selected.openReportCount ?? 0}</em></div>
                <div><span>30일 신고 제출</span><strong>{selected.filedReportCount30d ?? 0}</strong><em>신고자 기준</em></div>
                <div><span>활성 제재</span><strong>{selected.activeSanctionCount ?? 0}</strong><em>전체 {formatDateTime(selected.fullSuspensionUntil)}</em></div>
                <div><span>공개방 제한</span><strong>{selected.publicRoomSuspensionUntil ? "적용" : "없음"}</strong><em>{formatDateTime(selected.publicRoomSuspensionUntil)}</em></div>
              </div>

              <section className="admin-user-action-panel">
                <div className="admin-user-action-head">
                  <div><ShieldAlert size={19} /><strong>신고 없는 수동 조치</strong></div>
                  <small>사유는 감사 로그, 안내 문구는 사용자 앱 알림에 저장됩니다.</small>
                </div>
                {Number(selected.roomRemakeCount ?? 0) > 0 ? (
                  <Button type="button" variant="secondary" onClick={fillRoomRemakeWarning}>반복 다시 만들기 경고문 채우기</Button>
                ) : null}
                <div className="arena-field-grid">
                  <label>
                    조치
                    <select value={draft.actionType} onChange={(event) => updateDraft({ actionType: event.target.value })}>
                      {ACTION_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                    <small>{selectedAction.description}</small>
                  </label>
                  {draft.actionType !== "warning" ? (
                    <label>
                      기간
                      <select value={draft.durationDays} onChange={(event) => updateDraft({ durationDays: Number(event.target.value) })}>
                        {SUSPENSION_TIERS.map((tier) => <option key={tier.id} value={tier.days}>{tier.label}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
                <label>
                  관리 사유
                  <textarea value={draft.reason} maxLength={300} placeholder="운영자가 확인한 근거와 판단 사유" onChange={(event) => updateDraft({ reason: event.target.value })} />
                </label>
                <label>
                  사용자 안내
                  <textarea value={draft.message} maxLength={500} placeholder="사용자에게 보낼 정중하고 구체적인 안내" onChange={(event) => updateDraft({ message: event.target.value })} />
                </label>
                {confirming ? (
                  <div className="admin-user-action-confirm">
                    <AlertTriangle size={18} />
                    <span><strong>{selectedAction.label} · {draft.durationDays}일</strong><em>저장 즉시 제한과 알림이 적용됩니다.</em></span>
                    <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>취소</Button>
                  </div>
                ) : null}
                <Button type="button" disabled={actionPending} onClick={commit}>
                  <UserRoundCheck size={17} /> {actionPending ? "처리 중" : confirming ? "제재 확정" : draft.actionType === "warning" ? "경고 발송" : "제재 검토"}
                </Button>
                {actionStatus ? <small className="admin-user-action-status">{actionStatus}</small> : null}
              </section>
            </>
          ) : <div className="ui-empty-state-compact">검토할 사용자를 선택해 주세요.</div>}
        </Card>
      </div>
    </div>
  );
}
