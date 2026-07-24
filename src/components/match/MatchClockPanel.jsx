import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
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
import "../../styles/match-clock.css";

const ERROR_LABELS = Object.freeze({
  match_clock_forbidden: "이 경기의 시계를 볼 권한이 없습니다.",
  match_clock_controller_must_be_active: "현재 출전 선수만 시계를 받을 수 있습니다.",
  match_clock_start_forbidden: "지정된 시계 담당 선수만 시작할 수 있습니다.",
  match_clock_transfer_forbidden: "시계 담당자 또는 경기 관리자만 넘길 수 있습니다.",
  match_clock_overtime_requires_tie: "동점일 때만 연장을 시작할 수 있습니다.",
  server_actions_disabled: "서버 기능이 꺼져 있어 경기시계를 사용할 수 없습니다.",
});

function getErrorLabel(error) {
  const code = String(error?.code || error?.message || "");
  return ERROR_LABELS[code] || "경기시계 처리에 실패했습니다.";
}

function beep(volume = 0.7) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass || volume <= 0) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "square";
  oscillator.frequency.setValueAtTime(880, context.currentTime);
  gain.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.55);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.55);
  oscillator.addEventListener("ended", () => context.close());
}

export default function MatchClockPanel({ match }) {
  const [snapshot, setSnapshot] = useState(null);
  const [score, setScore] = useState({ a: 0, b: 0, updatedAt: null });
  const [activePlayers, setActivePlayers] = useState([]);
  const [selectedControllerId, setSelectedControllerId] = useState("");
  const [shotClockSeconds, setShotClockSeconds] = useState(0);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);
  const [volume, setVolume] = useState(70);
  const wakeLockRef = useRef(null);
  const soundedRef = useRef({ period: false, shot: false });

  const applyResponse = useCallback((response) => {
    if (!response?.clock) return;
    const nextClock = { ...response.clock, clientReceivedAtMs: Date.now() };
    setSnapshot(nextClock);
    setScore(response.score || { a: 0, b: 0, updatedAt: null });
    setActivePlayers(response.activePlayers || []);
    setSelectedControllerId(nextClock.controllerId || "");
    setShotClockSeconds(Number(nextClock.shotClockSeconds || 0));
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
  const regulationEnded = isBreak && liveClock.currentPeriod >= liveClock.expectedPeriodCount;
  const tied = score.a === score.b;
  const deadlineRemainingMs = Math.max(0, Date.parse(liveClock?.startDeadlineAt || "") - nowMs);
  const fallbackFactor = MATCH_CLOCK_FALLBACK_FACTORS[match.mode] ?? 0.8;

  useEffect(() => {
    if (!liveClock || liveClock.status !== "running") {
      soundedRef.current = { period: false, shot: false };
      return;
    }
    if (liveClock.periodRemainingMs <= 0 && !soundedRef.current.period) {
      soundedRef.current.period = true;
      beep(volume / 100);
    }
    if (liveClock.shotClockSeconds > 0 && liveClock.shotRemainingMs <= 0 && !soundedRef.current.shot) {
      soundedRef.current.shot = true;
      beep(volume / 100);
    }
    if (liveClock.shotRemainingMs > 0) soundedRef.current.shot = false;
  }, [liveClock, volume]);

  const requestWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) {
      setError("이 브라우저는 화면 유지를 지원하지 않습니다.");
      setWakeLockEnabled(false);
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeLockEnabled(true);
      wakeLockRef.current.addEventListener("release", () => setWakeLockEnabled(false), { once: true });
    } catch {
      setWakeLockEnabled(false);
      setError("화면 유지 권한을 허용하지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && wakeLockEnabled && !wakeLockRef.current) {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [requestWakeLock, wakeLockEnabled]);

  const toggleWakeLock = async () => {
    if (wakeLockEnabled) {
      await wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockEnabled(false);
      return;
    }
    await requestWakeLock();
  };

  const confirmAction = (message, action, payload = {}) => {
    if (window.confirm(message)) void runAction(action, payload);
  };

  if (!liveClock) {
    return (
      <section className="ui-match-clock-panel ui-panel" aria-label="경기시계">
        <strong>경기시계 불러오는 중</strong>
        {error ? <p className="ui-match-clock-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="ui-match-clock-panel ui-panel" aria-label="경기시계">
      <header className="ui-match-clock-header">
        <div>
          <span className="ui-match-clock-eyebrow">GAME CLOCK</span>
          <h3>경기시계</h3>
        </div>
        <div className="ui-match-clock-badges">
          <Badge tone={isRunning ? "green" : isEnded ? "neutral" : "gold"}>
            {isRunning ? "진행 중" : isEnded ? "시계 종료" : isPending ? "시작 대기" : isBreak ? "휴식" : "일시정지"}
          </Badge>
          <Badge tone={recognition.recognized ? "green" : "neutral"}>
            인정 시간 {Math.round(recognition.ratio * 100)}%
          </Badge>
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
                  onChange={(event) => setSelectedControllerId(event.target.value)}
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
                      onClick={() => setShotClockSeconds(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <Button
                type="button"
                variant="secondary"
                disabled={pendingAction === "configure" || !selectedControllerId}
                onClick={() => void runAction("configure", { controllerId: selectedControllerId, shotClockSeconds })}
              >
                담당·샷클락 저장
              </Button>
            </>
          ) : null}
          <div className="ui-match-clock-controller-status">
            <span>시계 담당</span>
            <strong>{controller?.name || "출전 선수 지정 대기"}</strong>
          </div>
          {liveClock.canControl ? (
            <Button
              type="button"
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
        <>
          <div className="ui-match-clock-scoreboard" aria-label="기록 점수판">
            <div>
              <span className="ui-match-clock-team-label">A</span>
              <strong className="ui-match-clock-team-score">{score.a}</strong>
            </div>
            <div className="ui-match-clock-main-time">
              <Badge tone="orange">{getMatchClockPeriodLabel(liveClock)}</Badge>
              <time>{formatClockTime(liveClock.periodRemainingMs, { tenths: true })}</time>
              <small>서버시간 기준</small>
            </div>
            <div>
              <span className="ui-match-clock-team-label">B</span>
              <strong className="ui-match-clock-team-score">{score.b}</strong>
            </div>
          </div>

          {liveClock.shotClockSeconds > 0 ? (
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

          {!isEnded && liveClock.canControl ? (
            <div className="ui-match-clock-actions ui-action-row">
              {isRunning ? (
                <Button type="button" variant="secondary" onClick={() => void runAction("pause")}>
                  <Pause size={18} /> 일시정지
                </Button>
              ) : !isBreak ? (
                <Button type="button" onClick={() => void runAction("resume")}>
                  <Play size={18} /> 계속
                </Button>
              ) : null}
              {!isBreak ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => confirmAction(`${getMatchClockPeriodLabel(liveClock)}를 종료할까요?`, "endPeriod")}
                >
                  쿼터 종료
                </Button>
              ) : null}
              {isBreak && !regulationEnded && liveClock.overtimeCount === 0 ? (
                <Button
                  type="button"
                  onClick={() => confirmAction(`${liveClock.currentPeriod + 1}쿼터를 시작할까요?`, "startPeriod")}
                >
                  다음 쿼터 시작
                </Button>
              ) : null}
              {isBreak && regulationEnded && tied ? (
                <Button
                  type="button"
                  onClick={() => confirmAction(`연장 ${liveClock.overtimeCount + 1}을 시작할까요?`, "startOvertime")}
                >
                  연장 {liveClock.overtimeCount + 1} 시작
                </Button>
              ) : null}
              {(isBreak && regulationEnded && !tied) || (isBreak && liveClock.overtimeCount > 0 && !tied) ? (
                <Button
                  type="button"
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
        </>
      )}

      <div className="ui-match-clock-device-tools">
        <Button type="button" size="sm" variant="secondary" onClick={() => void toggleWakeLock()}>
          <Maximize2 size={16} /> 화면 유지 {wakeLockEnabled ? "켜짐" : "꺼짐"}
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
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
        <Button type="button" size="sm" variant="secondary" onClick={() => beep(volume / 100)}>
          <BellRing size={16} /> 부저 시험
        </Button>
      </div>

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
}
