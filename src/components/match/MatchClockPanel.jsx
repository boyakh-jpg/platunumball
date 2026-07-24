import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { BellRing, Maximize2, Minimize2, Pause, Play, Power, Volume2, VolumeX } from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import {
  MATCH_CLOCK_FALLBACK_FACTORS,
  SHOT_CLOCK_OPTIONS,
  deriveMatchClock,
  formatClockTime,
  getMatchClockPeriodLabel,
  getMatchClockRecognition,
  requestMatchClock,
} from "../../lib/matchClock.js";
import { hasMatchScoreboardOperators } from "../../lib/matchUtils.js";
import "../../styles/match-clock.css";

const QUARTER_BREAK_LIMIT_MS = 5 * 60 * 1000;
const HALFTIME_BREAK_LIMIT_MS = 10 * 60 * 1000;

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

export default function MatchClockPanel({ match, onMatchEnded }) {
  const [snapshot, setSnapshot] = useState(null);
  const [score, setScore] = useState({ a: 0, b: 0, updatedAt: null });
  const [activePlayers, setActivePlayers] = useState([]);
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
    setScore(response.score || { a: 0, b: 0, updatedAt: null });
    setActivePlayers(response.activePlayers || []);
    if (!configurationDirtyRef.current) {
      setSelectedControllerId(nextClock.controllerId || "");
      setShotClockSeconds(Number(nextClock.shotClockSeconds || 0));
    }
  }, []);

  const runAction = useCallback(async (action, payload = {}) => {
    if (!match?.id || pendingAction) return false;
    setPendingAction(action);
    setError("");
    try {
      const response = await requestMatchClock(match.id, action, payload);
      applyResponse(response);
      return true;
    } catch (actionError) {
      setError(getErrorLabel(actionError));
      return false;
    } finally {
      setPendingAction("");
    }
  }, [applyResponse, match?.id, pendingAction]);

  useEffect(() => {
    configurationDirtyRef.current = false;
    matchEndedNotifiedRef.current = false;
  }, [match.id]);

  useEffect(() => {
    getBuzzerMediaElement();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await requestMatchClock(match.id, "read");
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
  }, [applyResponse, match.id]);

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
  const isHalftimeBreak = isBreak
    && liveClock.overtimeCount === 0
    && liveClock.currentPeriod === Math.floor(liveClock.expectedPeriodCount / 2);
  const breakLimitMs = isHalftimeBreak ? HALFTIME_BREAK_LIMIT_MS : QUARTER_BREAK_LIMIT_MS;
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
    if (isBreak && breakElapsedMs >= breakLimitMs && !soundedRef.current.break) {
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
      const response = await requestMatchClock(match.id, "read").catch(() => null);
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
              className={`ui-match-clock-scoreboard${scoreboardEnabled ? "" : " ui-match-clock-scoreboard-time-only"}`}
              aria-label={scoreboardEnabled ? "기록 점수판" : "경기시간"}
            >
              {scoreboardEnabled ? (
                <div>
                  <span className="ui-match-clock-team-label">A</span>
                  <strong className="ui-match-clock-team-score">{score.a}</strong>
                </div>
              ) : null}
              <div className="ui-match-clock-main-time">
                <Badge tone="orange">{getMatchClockPeriodLabel(liveClock)}</Badge>
                <time>{formatClockTime(liveClock.periodRemainingMs, { tenths: true })}</time>
                <small>서버시간 기준</small>
              </div>
              {scoreboardEnabled ? (
                <div>
                  <span className="ui-match-clock-team-label">B</span>
                  <strong className="ui-match-clock-team-score">{score.b}</strong>
                </div>
              ) : null}
            </div>

            {shotClockEnabled ? (
              <button
                type="button"
                className="ui-match-shot-clock"
                disabled={!liveClock.canControl || isEnded || isBreak}
                onClick={() => void runAction("resetShot")}
                aria-label={`샷클락 ${formatClockTime(liveClock.shotRemainingMs)}. 눌러서 ${liveClock.shotClockSeconds}초로 초기화`}
              >
                <span className="ui-match-shot-clock-label">SHOT CLOCK</span>
                <strong className="ui-match-shot-clock-value">{Math.ceil(liveClock.shotRemainingMs / 1000)}</strong>
                <small className="ui-match-shot-clock-hint">{liveClock.canControl ? `전체 영역을 눌러 ${liveClock.shotClockSeconds}초 초기화` : "읽기 전용"}</small>
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
              <small>권장 휴식 {isHalftimeBreak ? "10분" : "5분"} · 다음 구간 시작은 언제든 가능</small>
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
              {isBreak && regulationEnded && tied ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => confirmAction(`연장 ${liveClock.overtimeCount + 1}을 시작할까요?`, "startOvertime")}
                >
                  연장 {liveClock.overtimeCount + 1} 시작
                </Button>
              ) : null}
              {(isBreak && regulationEnded && !tied) || (isBreak && liveClock.overtimeCount > 0 && !tied) ? (
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
