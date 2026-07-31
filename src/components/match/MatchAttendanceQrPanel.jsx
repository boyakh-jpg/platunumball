import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, RefreshCw, ScanLine, UsersRound } from "lucide-react";
import QrCode from "../common/QrCode.jsx";
import Button from "../common/Button.jsx";
import { requestMatchAttendanceQr, resizeMatchForAttendance } from "../../lib/matchAttendance.js";
import "../../styles/match-attendance.css";

const ERROR_LABELS = Object.freeze({
  match_attendance_qr_disabled: "이 방은 QR 출석을 사용하지 않습니다.",
  match_attendance_qr_locked: "QR 출석 운영 시간이 끝났습니다.",
  match_attendance_qr_permission_denied: "이 경기의 QR 운영 권한이 없습니다. 대회 경기는 배정 심판만 운영합니다.",
  match_attendance_not_checkin_time: "출석 정리는 경기 20분 전부터 가능합니다.",
  match_attendance_resize_unbalanced: "양쪽 출석 인원 차이가 커서 지원 경기 방식으로 줄일 수 없습니다.",
  match_attendance_resize_locked: "경기 시작 전에만 출석 인원 기준으로 방 크기를 바꿀 수 있습니다.",
  match_attendance_resize_tournament_locked: "대회 경기는 출석 인원에 맞춰 경기 방식이나 확정 명단을 자동 변경하지 않습니다.",
});

function getErrorLabel(error) {
  const code = String(error?.code || error?.message || "");
  return ERROR_LABELS[code] || "QR 출석 정보를 불러오지 못했습니다.";
}

function getSideLabel(side = "teamA") {
  return side === "teamA" ? "A사이드" : "B사이드";
}

export default function MatchAttendanceQrPanel({ match, onChanged, onStatusChange }) {
  const [response, setResponse] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const [lastUpdateKind, setLastUpdateKind] = useState("initial");
  const loadRequestIdRef = useRef(0);
  const attendanceRevision = ["teamA", "teamB"]
    .map((side) => [...(match?.attendance?.[side] ?? [])].sort().join(","))
    .join("|");

  const load = useCallback(async ({ quiet = false, reason = "manual" } = {}) => {
    if (!match?.id) return;
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    if (!quiet) setPending(true);
    try {
      const next = await requestMatchAttendanceQr(match);
      if (loadRequestIdRef.current !== requestId) return;
      setResponse(next);
      setError("");
      setLastUpdatedAt(Date.now());
      setLastUpdateKind(reason);
    } catch (loadError) {
      if (loadRequestIdRef.current === requestId) setError(getErrorLabel(loadError));
    } finally {
      if (loadRequestIdRef.current === requestId) setPending(false);
    }
  }, [match]);

  useEffect(() => {
    void load({ reason: "initial" });
    const pollId = window.setInterval(() => void load({ quiet: true, reason: "auto" }), 15000);
    return () => {
      window.clearInterval(pollId);
      loadRequestIdRef.current += 1;
    };
  }, [attendanceRevision, load]);

  useEffect(() => {
    const tickId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tickId);
  }, []);

  useEffect(() => {
    onStatusChange?.(response?.startStatus
      ? { ...response.startStatus, matchId: response.matchId }
      : null);
  }, [onStatusChange, response?.matchId, response?.startStatus]);

  const resize = async () => {
    if (!response?.canResize || pending) return;
    const nextMode = response.summary?.recommendedMode;
    const actionLabel = nextMode === match?.mode ? "현재 경기 방식은 유지하고 미출석자를 정리" : `${nextMode}로 줄이고 미출석자를 정리`;
    if (!window.confirm(`출석을 기준으로 ${actionLabel}할까요? 이 작업은 방 수정 1회를 사용하지 않습니다.`)) return;
    setPending(true);
    setError("");
    try {
      await resizeMatchForAttendance(match.id);
      await onChanged?.();
      await load({ quiet: true, reason: "manual" });
    } catch (resizeError) {
      setError(getErrorLabel(resizeError));
    } finally {
      setPending(false);
    }
  };

  const expiresAtMs = Date.parse(response?.qr?.expiresAt || "") || 0;
  const remainingSeconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const summary = response?.summary;
  const startStatus = response?.startStatus;
  const attendanceStatusCopy = !startStatus
    ? "서버시간과 출석 상태를 확인하고 있습니다."
    : !startStatus.checkinOpen
      ? "출석 시작 전 · QR 출석은 경기 20분 전부터 시작합니다."
      : startStatus.scheduledStartReached
        ? "예정 시작시간이 되어 경기를 시작할 수 있습니다. 시작하면 남은 미출석 선수는 미출석 처리됩니다."
        : startStatus.allCheckedIn
          ? "전원 출석 완료 · 지금 경기 시작 가능"
          : "전원 출석이 완료되면 예정시간 전에도 경기를 시작할 수 있습니다.";
  const updatedSecondsAgo = lastUpdatedAt ? Math.max(0, Math.floor((nowMs - lastUpdatedAt) / 1000)) : 0;
  const refreshStatus = pending
    ? "출석 현황 갱신 중"
    : lastUpdatedAt
      ? `${lastUpdateKind === "manual" ? "새로고침 완료" : lastUpdateKind === "auto" ? "자동 갱신 완료" : "현황 불러오기 완료"} · ${updatedSecondsAgo ? `${updatedSecondsAgo}초 전` : "방금"}`
      : "";

  return (
    <section className="ui-panel ui-match-attendance-panel" aria-label="QR 출석">
      <header>
        <span>
          <ScanLine size={18} />
          <strong>QR 출석</strong>
        </span>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void load({ reason: "manual" })}>
          <RefreshCw className={pending ? "ui-match-attendance-spin" : ""} size={15} /> {pending ? "갱신 중" : "새로고침"}
        </Button>
      </header>
      {refreshStatus ? <small className="ui-match-attendance-refresh-status" role="status" aria-live="polite">{refreshStatus}</small> : null}
      <div className="ui-status-strip ui-match-attendance-start-status" role="status" aria-live="polite">
        <span>출석 완료 {startStatus?.checkedInCount ?? 0}/{startStatus?.requiredCount ?? 0}</span>
        <strong>{attendanceStatusCopy}</strong>
      </div>
      {response?.qr?.value ? (
        <div className="ui-match-attendance-body">
          <QrCode value={response.qr.value} className="ui-match-attendance-qr" label="경기 출석 QR 코드" expandable />
          <div className="ui-match-attendance-copy">
            <strong>참가자가 카메라로 스캔</strong>
            <span><Clock3 size={15} /> {remainingSeconds}초 뒤 자동 교체</span>
            <small>시작 전 스캔은 정상 출석, 시작 후 스캔은 지각·같은 사이드 후보 등록입니다.</small>
          </div>
        </div>
      ) : pending ? <span>QR 만드는 중</span> : startStatus && !startStatus.checkinOpen ? (
        <small>출석 시작 전에는 QR을 표시하지 않습니다.</small>
      ) : null}
      {summary ? (
        <div className="ui-match-attendance-summary">
          {["teamA", "teamB"].map((side) => {
            const counts = summary.bySide?.[side] ?? {};
            return (
              <span key={side}>
                <strong>{getSideLabel(side)}</strong>
                <b>{Number(counts.onTime || 0) + Number(counts.late || 0)}/{Number(counts.total || 0)}</b>
                <small>정상 {counts.onTime || 0} · 지각 {counts.late || 0} · 대기 {counts.pending || 0}</small>
              </span>
            );
          })}
        </div>
      ) : null}
      {response?.canResize ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => void resize()}>
          <UsersRound size={16} /> {response.summary.recommendedMode === match?.mode
            ? "미출석자 정리"
            : `출석 기준 ${response.summary.recommendedMode}로 변경`}
        </Button>
      ) : null}
      {error ? <p className="ui-match-attendance-error" role="alert">{error}</p> : null}
    </section>
  );
}
