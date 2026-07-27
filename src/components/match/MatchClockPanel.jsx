import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  BellRing,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Power,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import QrCode from "../common/QrCode.jsx";
import {
  MATCH_CLOCK_FALLBACK_FACTORS,
  SHOT_CLOCK_OPTIONS,
  deriveMatchClock,
  formatClockTime,
  getMatchClockPeriodLabel,
  getMatchClockRecognition,
  requestMatchClock,
} from "../../lib/matchClock.js";
import { normalizeMatchRules } from "../../lib/matchRules.js";
import { hasMatchScoreboardOperators } from "../../lib/matchUtils.js";
import "../../styles/match-clock.css";

const ERROR_LABELS = Object.freeze({
  match_clock_forbidden: "이 경기의 시계를 볼 권한이 없습니다.",
  match_clock_controller_must_be_active: "현재 출전 선수만 시계를 받을 수 있습니다.",
  match_clock_start_forbidden: "지정된 시계 담당 선수만 시작할 수 있습니다.",
  match_clock_resume_forbidden: "남은 경기시간이 없습니다. 쿼터 종료를 눌러주세요.",
  match_clock_transfer_forbidden: "시계 담당자 또는 경기 관리자만 넘길 수 있습니다.",
  match_clock_overtime_requires_tie: "동점일 때만 연장을 시작할 수 있습니다.",
  match_clock_disabled: "이 경기는 BOXTIER 경기시계를 사용하지 않습니다.",
  server_actions_disabled: "서버 기능이 꺼져 있어 경기시계를 사용할 수 없습니다.",
});

let buzzerMediaElement = null;
const buzzerMediaUrls = new Map();

const BUZZER_PATTERNS = Object.freeze({
  shot: Object.freeze([
    { durationMs: 260, frequency: 980 },
  ]),
  period: Object.freeze([
    { durationMs: 1500, frequency: 780 },
  ]),
  warning: Object.freeze([
    { durationMs: 170, frequency: 900 },
    { durationMs: 130, frequency: 0 },
    { durationMs: 170, frequency: 900 },
  ]),
});

function getErrorLabel(error) {
  const code = String(error?.code || error?.message || "");
  return ERROR_LABELS[code] || "경기시계 처리에 실패했습니다.";
}

function writeWavText(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function getBuzzerMediaUrl(patternName) {
  if (buzzerMediaUrls.has(patternName)) return buzzerMediaUrls.get(patternName);
  const pattern = BUZZER_PATTERNS[patternName] || BUZZER_PATTERNS.period;
  const sampleRate = 22050;
  const totalSamples = pattern.reduce(
    (total, segment) => total + Math.round((segment.durationMs / 1000) * sampleRate),
    0,
  );
  const buffer = new ArrayBuffer(44 + totalSamples * 2);
  const view = new DataView(buffer);
  writeWavText(view, 0, "RIFF");
  view.setUint32(4, 36 + totalSamples * 2, true);
  writeWavText(view, 8, "WAVE");
  writeWavText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWavText(view, 36, "data");
  view.setUint32(40, totalSamples * 2, true);

  let sampleOffset = 0;
  pattern.forEach((segment) => {
    const segmentSamples = Math.round((segment.durationMs / 1000) * sampleRate);
    for (let index = 0; index < segmentSamples; index += 1) {
      const edgeFade = Math.min(1, index / 80, (segmentSamples - index - 1) / 160);
      const wave = segment.frequency > 0
        ? Math.sign(Math.sin((2 * Math.PI * segment.frequency * index) / sampleRate))
        : 0;
      view.setInt16(44 + sampleOffset * 2, Math.round(wave * edgeFade * 30000), true);
      sampleOffset += 1;
    }
  });

  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  buzzerMediaUrls.set(patternName, url);
  return url;
}

function getBuzzerMediaElement() {
  if (buzzerMediaElement) return buzzerMediaElement;
  buzzerMediaElement = new Audio();
  buzzerMediaElement.preload = "auto";
  buzzerMediaElement.setAttribute("playsinline", "");
  buzzerMediaElement.setAttribute("webkit-playsinline", "");
  buzzerMediaElement.setAttribute("aria-hidden", "true");
  buzzerMediaElement.hidden = true;
  buzzerMediaElement.src = getBuzzerMediaUrl("period");
  document.body.appendChild(buzzerMediaElement);
  buzzerMediaElement.load();
  return buzzerMediaElement;
}

async function playBuzzer(patternName = "period", volume = 1) {
  if (volume <= 0) return false;
  try {
    const mediaElement = getBuzzerMediaElement();
    const nextSource = getBuzzerMediaUrl(patternName);
    mediaElement.pause();
    if (mediaElement.src !== nextSource) {
      mediaElement.src = nextSource;
      mediaElement.load();
    }
    mediaElement.currentTime = 0;
    mediaElement.muted = false;
    mediaElement.volume = Math.min(1, Math.max(0, volume));
    await mediaElement.play();
    return true;
  } catch {
    return false;
  }
}

function getMatchScoreState(match = {}) {
  return {
    scoreA: Number(match.result?.scoreA ?? match.teamA?.score ?? 0),
    scoreB: Number(match.result?.scoreB ?? match.teamB?.score ?? 0),
    revisionA: Number(match.result?.scoreRevisionA ?? 0),
    revisionB: Number(match.result?.scoreRevisionB ?? 0),
  };
}

export function MatchScoreControls({
  match,
  editableScoreSides = [],
  onIncrementScore = null,
  label = "실시간 팀 점수",
}) {
  const [score, setScore] = useState(() => getMatchScoreState(match));
  const [pendingSide, setPendingSide] = useState("");
  const [scoreError, setScoreError] = useState("");

  useEffect(() => {
    setScore(getMatchScoreState(match));
  }, [
    match.id,
    match.result?.scoreA,
    match.result?.scoreB,
    match.result?.scoreRevisionA,
    match.result?.scoreRevisionB,
    match.teamA?.score,
    match.teamB?.score,
  ]);

  const incrementScore = async (sideName, delta) => {
    if (!onIncrementScore || pendingSide || !editableScoreSides.includes(sideName)) return;
    setPendingSide(sideName);
    setScoreError("");
    try {
      const response = await onIncrementScore(sideName, delta, {
        expectedRevisionA: score.revisionA,
        expectedRevisionB: score.revisionB,
      });
      if (response?.ok === false) throw new Error(response.error || response.message || "score_update_failed");
      const responseScore = response?.match ? getMatchScoreState(response.match) : null;
      setScore((current) => ({
        scoreA: Number(response?.scoreA ?? responseScore?.scoreA ?? current.scoreA + (sideName === "teamA" ? delta : 0)),
        scoreB: Number(response?.scoreB ?? responseScore?.scoreB ?? current.scoreB + (sideName === "teamB" ? delta : 0)),
        revisionA: Number(response?.scoreRevisionA ?? responseScore?.revisionA ?? current.revisionA + (sideName === "teamA" ? 1 : 0)),
        revisionB: Number(response?.scoreRevisionB ?? responseScore?.revisionB ?? current.revisionB + (sideName === "teamB" ? 1 : 0)),
      }));
    } catch (error) {
      setScoreError(String(error?.message || error?.code || "점수를 갱신하지 못했습니다."));
    } finally {
      setPendingSide("");
    }
  };

  return (
    <section className="ui-match-score-control-panel" aria-label={label}>
      <header>
        <div>
          <strong>{label}</strong>
          <span>팀 점수만 저장합니다.</span>
        </div>
        <Badge tone="neutral">개인 스탯 미기록</Badge>
      </header>
      <div className="ui-match-score-control-grid">
        {[
          { sideName: "teamA", name: match.teamA?.name ?? "A", value: score.scoreA },
          { sideName: "teamB", name: match.teamB?.name ?? "B", value: score.scoreB },
        ].map((side) => (
          <div key={side.sideName} className="ui-match-score-control-side">
            <span>{side.name}</span>
            <strong>{side.value}</strong>
            {editableScoreSides.includes(side.sideName) ? (
              <div className="ui-match-clock-score-actions" aria-label={`${side.name} 점수 조정`}>
                {[-1, 1, 2, 3].map((delta) => (
                  <Button
                    key={delta}
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(pendingSide)}
                    onClick={() => void incrementScore(side.sideName, delta)}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </Button>
                ))}
              </div>
            ) : <small>읽기 전용</small>}
          </div>
        ))}
      </div>
      {scoreError ? <p className="ui-match-score-control-error">{scoreError}</p> : null}
    </section>
  );
}

export default function MatchClockPanel({
  match,
  onMatchEnded,
  clockClient = requestMatchClock,
  editableScoreSides = [],
  onIncrementScore = null,
  onRosterChanged = null,
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [score, setScore] = useState({ a: 0, b: 0, revisionA: 0, revisionB: 0, updatedAt: null });
  const [scorePendingSide, setScorePendingSide] = useState("");
  const [scoreError, setScoreError] = useState("");
  const [activePlayers, setActivePlayers] = useState([]);
  const [attendanceQr, setAttendanceQr] = useState(null);
  const [selectedControllerId, setSelectedControllerId] = useState("");
  const [shotClockSeconds, setShotClockSeconds] = useState(0);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [deviceNotice, setDeviceNotice] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [focusMode, setFocusMode] = useState(false);
  const [wakeLockRequested, setWakeLockRequested] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [volume, setVolume] = useState(100);
  const wakeLockRef = useRef(null);
  const wakeLockRequestedRef = useRef(false);
  const configurationDirtyRef = useRef(false);
  const matchEndedNotifiedRef = useRef(false);
  const soundedRef = useRef({ period: false, shot: false, break: false });
  const rosterRevisionRef = useRef("");

  const applyResponse = useCallback((response) => {
    if (!response?.clock) return;
    const nextClock = { ...response.clock, clientReceivedAtMs: Date.now() };
    setSnapshot((current) => {
      const sameBreak = current?.status === "break"
        && nextClock.status === "break"
        && current.currentPeriod === nextClock.currentPeriod
        && current.overtimeCount === nextClock.overtimeCount;
      return {
        ...nextClock,
        breakStartedAtMs: sameBreak
          ? current.breakStartedAtMs
          : nextClock.status === "break"
            ? Date.parse(nextClock.breakStartedAt || nextClock.serverNow || "") || Date.now()
            : null,
      };
    });
    setScore(response.score || { a: 0, b: 0, revisionA: 0, revisionB: 0, updatedAt: null });
    setActivePlayers(response.activePlayers || []);
    setAttendanceQr(response.attendanceQr || null);
    if (response.rosterRevision) {
      if (rosterRevisionRef.current && rosterRevisionRef.current !== response.rosterRevision) {
        onRosterChanged?.();
      }
      rosterRevisionRef.current = response.rosterRevision;
    }
    if (!configurationDirtyRef.current) {
      setSelectedControllerId(nextClock.controllerId || "");
      setShotClockSeconds(Number(nextClock.shotClockSeconds || 0));
    }
  }, [onRosterChanged]);

  const runAction = useCallback(async (action, payload = {}) => {
    if (!match?.id || pendingAction) return false;
    setPendingAction(action);
    setError("");
    try {
      const response = await clockClient(match.id, action, payload);
      applyResponse(response);
      return true;
    } catch (actionError) {
      setError(getErrorLabel(actionError));
      return false;
    } finally {
      setPendingAction("");
    }
  }, [applyResponse, clockClient, match?.id, pendingAction]);

  const incrementScore = useCallback(async (sideName, delta) => {
    if (!onIncrementScore || scorePendingSide || !editableScoreSides.includes(sideName)) return;
    setScorePendingSide(sideName);
    setScoreError("");
    try {
      const response = await onIncrementScore(sideName, delta, {
        expectedRevisionA: score.revisionA,
        expectedRevisionB: score.revisionB,
      });
      if (response?.scoreA != null && response?.scoreB != null) {
        setScore((current) => ({
          ...current,
          a: Number(response.scoreA),
          b: Number(response.scoreB),
          revisionA: Number(response.scoreRevisionA ?? current.revisionA),
          revisionB: Number(response.scoreRevisionB ?? current.revisionB),
        }));
      } else {
        const refreshed = await clockClient(match.id, "read").catch(() => null);
        if (refreshed) applyResponse(refreshed);
      }
    } catch (actionError) {
      const refreshed = await clockClient(match.id, "read").catch(() => null);
      if (refreshed) applyResponse(refreshed);
      setScoreError(String(actionError?.message || actionError?.code || "점수를 갱신하지 못했습니다."));
    } finally {
      setScorePendingSide("");
    }
  }, [applyResponse, clockClient, editableScoreSides, match.id, onIncrementScore, score.revisionA, score.revisionB, scorePendingSide]);

  useEffect(() => {
    configurationDirtyRef.current = false;
    matchEndedNotifiedRef.current = false;
    rosterRevisionRef.current = "";
  }, [match.id]);

  useEffect(() => {
    getBuzzerMediaElement();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await clockClient(match.id, "read");
        if (!cancelled) {
          setError("");
          applyResponse(response);
        }
      } catch (loadError) {
        if (!cancelled) setError(getErrorLabel(loadError));
      }
    };
    void load();
    const pollId = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [applyResponse, clockClient, match.id]);

  useEffect(() => {
    const tickId = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(tickId);
  }, []);

  const liveClock = useMemo(() => deriveMatchClock(snapshot, nowMs), [nowMs, snapshot]);
  const recognition = useMemo(() => getMatchClockRecognition(liveClock), [liveClock]);
  const controller = activePlayers.find((player) => player.id === liveClock?.controllerId);
  const isPending = liveClock?.status === "pending";
  const isEnded = liveClock?.status === "ended";
  const isBreak = liveClock?.status === "break";
  const isRunning = liveClock?.status === "running";
  const hasRemainingPeriodTime = Number(liveClock?.periodRemainingMs || 0) > 0;
  const regulationEnded = isBreak && liveClock.currentPeriod >= liveClock.expectedPeriodCount;
  const tied = score.a === score.b;
  const deadlineRemainingMs = Math.max(0, Date.parse(liveClock?.startDeadlineAt || "") - nowMs);
  const fallbackFactor = MATCH_CLOCK_FALLBACK_FACTORS[match.mode] ?? 0.8;
  const scoreboardEnabled = hasMatchScoreboardOperators(match);
  const matchRules = useMemo(
    () => normalizeMatchRules(match.rules, { mode: match.mode }),
    [match.mode, match.rules],
  );
  const directScoreControlsEnabled = scoreboardEnabled;
  const halftimeAfterPeriod = matchRules.periodCount > 1
    ? matchRules.periodCount / 2
    : 0;
  const isHalftimeBreak = isBreak
    && liveClock.overtimeCount === 0
    && halftimeAfterPeriod > 0
    && liveClock.currentPeriod === halftimeAfterPeriod;
  const breakLimitMinutes = isHalftimeBreak
    ? matchRules.halftimeMinutes
    : matchRules.periodBreakMinutes;
  const breakLimitMs = breakLimitMinutes * 60 * 1000;
  const breakElapsedMs = isBreak && liveClock.breakStartedAtMs
    ? Math.max(0, nowMs - liveClock.breakStartedAtMs)
    : 0;
  const breakRemainingMs = Math.max(0, breakLimitMs - breakElapsedMs);
  const breakOvertimeMs = Math.max(0, breakElapsedMs - breakLimitMs);

  useEffect(() => {
    if (!liveClock) {
      soundedRef.current = { period: false, shot: false, break: false };
      return;
    }
    if (liveClock.status === "running") {
      soundedRef.current.break = false;
      if (liveClock.periodRemainingMs <= 0 && !soundedRef.current.period) {
        soundedRef.current.period = true;
        void playBuzzer("period", volume / 100);
      } else if (liveClock.shotClockSeconds > 0 && liveClock.shotRemainingMs <= 0 && !soundedRef.current.shot) {
        soundedRef.current.shot = true;
        void playBuzzer("shot", volume / 100);
      }
      if (liveClock.shotRemainingMs > 0) soundedRef.current.shot = false;
      return;
    }
    soundedRef.current.period = false;
    soundedRef.current.shot = false;
    if (isBreak && breakLimitMs > 0 && breakElapsedMs >= breakLimitMs && !soundedRef.current.break) {
      soundedRef.current.break = true;
      void playBuzzer("warning", volume / 100);
    } else if (!isBreak) {
      soundedRef.current.break = false;
    }
  }, [breakElapsedMs, breakLimitMs, isBreak, liveClock, volume]);

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) {
      wakeLockRequestedRef.current = false;
      setWakeLockRequested(false);
      setWakeLockActive(false);
      setDeviceNotice("이 브라우저는 화면 유지를 지원하지 않습니다.");
      return false;
    }
    try {
      const lock = await navigator.wakeLock.request("screen");
      wakeLockRef.current = lock;
      setWakeLockActive(true);
      setDeviceNotice("");
      lock.addEventListener("release", () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
        setWakeLockActive(false);
      }, { once: true });
      return true;
    } catch {
      setWakeLockActive(false);
      setDeviceNotice("화면 유지 권한을 허용하지 못했습니다.");
      return false;
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && wakeLockRequestedRef.current && !wakeLockRef.current) {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [requestWakeLock]);

  const toggleWakeLock = async () => {
    if (wakeLockRequestedRef.current) {
      wakeLockRequestedRef.current = false;
      setWakeLockRequested(false);
      await wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockActive(false);
      setDeviceNotice("");
      return;
    }
    wakeLockRequestedRef.current = true;
    setWakeLockRequested(true);
    await requestWakeLock();
  };

  const openFocusMode = async () => {
    flushSync(() => setFocusMode(true));
    setDeviceNotice("");
    const fullscreenTarget = document.querySelector(".ui-match-clock-focus-backdrop");
    const requestFullscreen = fullscreenTarget?.requestFullscreen
      || fullscreenTarget?.webkitRequestFullscreen;
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (!fullscreenElement && requestFullscreen) {
        await Promise.resolve(requestFullscreen.call(fullscreenTarget));
      } else if (!requestFullscreen) {
        setDeviceNotice("브라우저 전체화면 대신 화면 덮기 팝업으로 열었습니다.");
      }
    } catch {
      setDeviceNotice("브라우저 전체화면을 허용하지 않아 시계 팝업으로 열었습니다.");
    }
  };

  const closeFocusMode = useCallback(async () => {
    setFocusMode(false);
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
    if (fullscreenElement && exitFullscreen) {
      await Promise.resolve(exitFullscreen.call(document)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!isEnded) return;
    if (focusMode) void closeFocusMode();
    if (liveClock?.matchEndedAt && !matchEndedNotifiedRef.current) {
      matchEndedNotifiedRef.current = true;
      onMatchEnded?.();
    }
  }, [closeFocusMode, focusMode, isEnded, liveClock?.matchEndedAt, onMatchEnded]);

  useEffect(() => {
    if (!focusMode) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") void closeFocusMode();
    };
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeFocusMode, focusMode]);

  const testBuzzer = async () => {
    setDeviceNotice("");
    const played = await playBuzzer("period", volume / 100);
    if (!played) {
      setDeviceNotice(volume <= 0
        ? "부저 음량이 0%입니다."
        : "미디어 부저 재생이 차단됐습니다. 부저 시험을 다시 눌러주세요.");
    } else {
      setDeviceNotice("미디어 부저가 재생됐습니다.");
    }
  };

  const saveConfiguration = async (controllerId, nextShotClockSeconds) => {
    if (!controllerId || pendingAction) return;
    configurationDirtyRef.current = true;
    const succeeded = await runAction("configure", {
      controllerId,
      shotClockSeconds: nextShotClockSeconds,
    });
    configurationDirtyRef.current = false;
    if (!succeeded) {
      const response = await clockClient(match.id, "read").catch(() => null);
      if (response) applyResponse(response);
    }
  };

  const selectController = (controllerId) => {
    setSelectedControllerId(controllerId);
    void saveConfiguration(controllerId, shotClockSeconds);
  };

  const selectShotClock = (nextShotClockSeconds) => {
    setShotClockSeconds(nextShotClockSeconds);
    void saveConfiguration(selectedControllerId, nextShotClockSeconds);
  };

  const confirmAction = (message, action, payload = {}) => {
    if (!window.confirm(message)) return;
    void runAction(action, payload).then((succeeded) => {
      if (
        succeeded
        && (action === "endPeriod" || action === "endClock")
        && !soundedRef.current.period
      ) {
        soundedRef.current.period = true;
        void playBuzzer("period", volume / 100);
      }
    });
  };

  if (!liveClock) {
    return (
      <section className="ui-match-clock-panel ui-panel" aria-label="경기시계">
        <strong>경기시계 불러오는 중</strong>
        {error ? <p className="ui-match-clock-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  const shotClockEnabled = Number(liveClock.shotClockSeconds || 0) > 0;
  const canResetShotClock = liveClock.canControl && !isEnded && !isBreak;

  const clockPanel = (
    <section
      className={`ui-match-clock-panel ui-panel${focusMode ? " ui-match-clock-panel-focus" : ""}${isPending ? " ui-match-clock-panel-pending" : ""}`}
      aria-label="경기시계"
    >
      <header className="ui-match-clock-header">
        <div>
          <span className="ui-match-clock-eyebrow">GAME CLOCK</span>
          <h3>경기시계</h3>
        </div>
        <div className="ui-match-clock-header-tools">
          <div className="ui-match-clock-badges">
            <Badge tone={isRunning ? "green" : isEnded ? "neutral" : "gold"}>
              {isRunning ? "진행 중" : isEnded ? "시계 종료" : isPending ? "시작 대기" : isBreak ? "휴식" : "일시정지"}
            </Badge>
            <Badge tone={recognition.recognized ? "green" : "neutral"}>
              인정 시간 {Math.round(recognition.ratio * 100)}%
            </Badge>
          </div>
          {focusMode ? (
            <Button type="button" size="sm" variant="primary" onClick={() => void closeFocusMode()}>
              <Minimize2 size={16} /> 닫기
            </Button>
          ) : null}
        </div>
      </header>

      {isPending ? (
        <div className="ui-match-clock-setup">
          <div className="ui-match-clock-deadline">
            <strong>{deadlineRemainingMs > 0 ? `${formatClockTime(deadlineRemainingMs)} 안에 시계 시작` : "시계 시작 인정 시간 경과"}</strong>
            <span>경기는 계속 진행됩니다. 시계 미사용 시 MMR은 {Math.round(fallbackFactor * 100)}% 반영됩니다.</span>
          </div>
          {liveClock.canManage ? (
            <>
              <label className="ui-match-clock-field">
                <span>최초 시계 담당</span>
                <select
                  className="ui-control"
                  value={selectedControllerId}
                  disabled={pendingAction === "configure"}
                  onChange={(event) => selectController(event.target.value)}
                >
                  {activePlayers.map((player) => (
                    <option key={player.id} value={player.id}>{player.name}</option>
                  ))}
                </select>
              </label>
              <fieldset className="ui-match-clock-fieldset">
                <legend>샷클락</legend>
                <div className="ui-match-clock-option-grid">
                  {SHOT_CLOCK_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={shotClockSeconds === option.value ? "primary" : "secondary"}
                      aria-pressed={shotClockSeconds === option.value}
                      disabled={pendingAction === "configure" || !selectedControllerId}
                      onClick={() => selectShotClock(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
          <div className="ui-match-clock-controller-status">
            <span>시계 담당</span>
            <strong>{controller?.name || "출전 선수 지정 대기"}</strong>
          </div>
          {liveClock.canControl ? (
            <Button
              type="button"
              size="sm"
              disabled={Boolean(pendingAction)}
              onClick={() => confirmAction("실제 경기시계를 시작할까요?", "start")}
            >
              <Play size={18} /> 경기시계 시작
            </Button>
          ) : (
            <p className="ui-match-clock-readonly">담당 선수의 휴대폰에서 경기시계를 시작합니다.</p>
          )}
        </div>
      ) : (
        <div className={`ui-match-clock-live${shotClockEnabled ? " ui-match-clock-live-with-shot" : ""}`}>
          <div className={`ui-match-clock-display-grid${shotClockEnabled ? "" : " ui-match-clock-display-grid-single"}`}>
            <div
              className={`ui-match-clock-scoreboard${scoreboardEnabled ? "" : " ui-match-clock-scoreboard-time-only"}${attendanceQr?.value ? " ui-match-clock-scoreboard-with-attendance" : ""}`}
              aria-label={scoreboardEnabled ? "기록 점수판" : "경기시간"}
            >
              {scoreboardEnabled ? (
                <span className="ui-match-clock-scoreboard-label">점수판</span>
              ) : null}
              {scoreboardEnabled ? (
                <div className="ui-match-clock-team ui-match-clock-team-a">
                  <span className="ui-match-clock-team-label">A 점수</span>
                  <strong className="ui-match-clock-team-score">{score.a}</strong>
                  {directScoreControlsEnabled && editableScoreSides.includes("teamA") && !isEnded ? (
                    <div className="ui-match-clock-score-actions" aria-label="A 점수 조정">
                      {[-1, 1, 2, 3].map((delta) => (
                        <Button key={delta} type="button" size="sm" variant="secondary" disabled={Boolean(scorePendingSide)} onClick={() => void incrementScore("teamA", delta)}>
                          {delta > 0 ? `+${delta}` : delta}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="ui-match-clock-main-time">
                <span className="ui-match-clock-main-time-label">경기시계</span>
                <Badge tone="orange">{getMatchClockPeriodLabel(liveClock)}</Badge>
                <time>{formatClockTime(liveClock.periodRemainingMs, { tenths: true })}</time>
                <small>{scoreboardEnabled ? "서버시간 · 점수 3초 자동 갱신" : "서버시간 기준"}</small>
              </div>
              {scoreboardEnabled ? (
                <div className="ui-match-clock-team ui-match-clock-team-b">
                  <span className="ui-match-clock-team-label">B 점수</span>
                  <strong className="ui-match-clock-team-score">{score.b}</strong>
                  {directScoreControlsEnabled && editableScoreSides.includes("teamB") && !isEnded ? (
                    <div className="ui-match-clock-score-actions" aria-label="B 점수 조정">
                      {[-1, 1, 2, 3].map((delta) => (
                        <Button key={delta} type="button" size="sm" variant="secondary" disabled={Boolean(scorePendingSide)} onClick={() => void incrementScore("teamB", delta)}>
                          {delta > 0 ? `+${delta}` : delta}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {attendanceQr?.value && (liveClock.canControl || liveClock.canManage) ? (
                <div className="ui-match-clock-attendance-qr">
                  <QrCode value={attendanceQr.value} label="지각 출석 QR 코드" expandable />
                  <span>지각 출석</span>
                </div>
              ) : null}
            </div>

            {shotClockEnabled ? (
              <button
                type="button"
                className="ui-match-shot-clock"
                disabled={!canResetShotClock}
                onClick={() => void runAction("resetShot")}
                aria-label={`샷클락 ${formatClockTime(liveClock.shotRemainingMs)}. 눌러서 ${liveClock.shotClockSeconds}초로 초기화`}
              >
                <span className="ui-match-shot-clock-label">샷클락</span>
                <strong className="ui-match-shot-clock-value">{Math.ceil(liveClock.shotRemainingMs / 1000)}</strong>
                <span className="ui-match-shot-clock-action">
                  <RotateCcw size={15} aria-hidden="true" />
                  {canResetShotClock
                    ? `${liveClock.shotClockSeconds}초로 초기화`
                    : liveClock.canControl
                      ? isBreak ? "휴식 중" : "사용 종료"
                      : "읽기 전용"}
                </span>
              </button>
            ) : null}
          </div>

          {isBreak ? (
            <div className={`ui-match-clock-break${breakOvertimeMs > 0 ? " ui-match-clock-break-over" : ""}`} role="timer">
              <span>{isHalftimeBreak ? "하프타임" : "쿼터 휴식"}</span>
              <strong>
                {breakOvertimeMs > 0
                  ? `${formatClockTime(breakOvertimeMs)} 초과`
                  : `${formatClockTime(breakRemainingMs)} 남음`}
              </strong>
              <small>권장 휴식 {breakLimitMinutes}분 · 다음 구간 시작은 언제든 가능</small>
            </div>
          ) : null}

          {!isEnded && liveClock.canControl ? (
            <div className="ui-match-clock-actions ui-action-row">
              {isRunning && hasRemainingPeriodTime ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => void runAction("pause")}>
                  <Pause size={18} /> 일시정지
                </Button>
              ) : !isBreak && hasRemainingPeriodTime ? (
                <Button type="button" size="sm" onClick={() => void runAction("resume")}>
                  <Play size={18} /> 계속
                </Button>
              ) : null}
              {!isBreak ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => confirmAction(`${getMatchClockPeriodLabel(liveClock)}를 종료할까요?`, "endPeriod")}
                >
                  쿼터 종료
                </Button>
              ) : null}
              {isBreak && !regulationEnded && liveClock.overtimeCount === 0 ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => confirmAction(`${liveClock.currentPeriod + 1}쿼터를 시작할까요?`, "startPeriod")}
                >
                  다음 쿼터 시작
                </Button>
              ) : null}
              {isBreak && regulationEnded && (!scoreboardEnabled || tied) ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => confirmAction(`연장 ${liveClock.overtimeCount + 1}을 시작할까요?`, "startOvertime")}
                >
                  연장 {liveClock.overtimeCount + 1} 시작
                </Button>
              ) : null}
              {isBreak && regulationEnded && (!scoreboardEnabled || !tied) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => confirmAction("경기시계 운용을 종료할까요?", "endClock")}
                >
                  경기시계 종료
                </Button>
              ) : null}
            </div>
          ) : null}

          {!liveClock.canControl && !isEnded ? (
            <p className="ui-match-clock-readonly">{controller?.name || "지정 선수"}님이 시계를 조작 중입니다.</p>
          ) : null}

          {!isEnded && (liveClock.canControl || liveClock.canManage) ? (
            <details className="ui-match-clock-transfer">
              <summary>시계 담당 선수 변경</summary>
              <div className="ui-match-clock-player-grid">
                {activePlayers.filter((player) => player.id !== liveClock.controllerId).map((player) => (
                  <Button
                    key={player.id}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => confirmAction(`${player.name} 선수에게 시계를 넘길까요? 넘긴 뒤 현재 기기에서는 조작할 수 없습니다.`, "transfer", { controllerId: player.id })}
                  >
                    {player.name}
                  </Button>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}

      <div className="ui-match-clock-device-tools">
        <Button
          type="button"
          size="sm"
          variant="primary"
          aria-pressed={focusMode}
          onClick={() => void (focusMode ? closeFocusMode() : openFocusMode())}
        >
          {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          {focusMode ? "전체화면 닫기" : "시계 전체화면"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="primary"
          aria-pressed={wakeLockRequested}
          onClick={() => void toggleWakeLock()}
        >
          <Power size={16} />
          {wakeLockActive ? "화면 유지 켜짐" : wakeLockRequested ? "화면 유지 재연결" : "화면 유지 켜기"}
        </Button>
        <Button type="button" size="sm" variant="primary" onClick={() => void testBuzzer()}>
          <BellRing size={16} /> 부저 시험
        </Button>
        <label className="ui-match-clock-volume">
          {volume > 0 ? <Volume2 size={17} /> : <VolumeX size={17} />}
          <span className="ui-match-clock-volume-label">부저 {volume}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="10"
            value={volume}
            style={{ "--match-clock-volume-progress": `${volume}%` }}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      </div>
      {deviceNotice ? <p className="ui-match-clock-device-notice" role="status">{deviceNotice}</p> : null}
      {scoreError ? <p className="ui-match-clock-error" role="alert">{scoreError}</p> : null}

      {isEnded ? (
        <div className="ui-match-clock-result ui-status-strip">
          <strong>{recognition.recognized ? "경기시계 정상 사용" : "경기시계 미사용 처리"}</strong>
          <span>
            실제 운용 {formatClockTime(liveClock.activeElapsedMs)} · 기준 {formatClockTime(liveClock.minimumActiveMs)}
          </span>
        </div>
      ) : null}
      {error ? <p className="ui-match-clock-error" role="alert">{error}</p> : null}
    </section>
  );

  if (focusMode) {
    return createPortal(
      <div className="ui-match-clock-focus-backdrop" role="dialog" aria-modal="true" aria-label="전체화면 경기시계">
        {clockPanel}
      </div>,
      document.body,
    );
  }

  return clockPanel;
}
