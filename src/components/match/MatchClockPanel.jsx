import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  deriveMatchClock,
  getMatchClockRecognition,
  requestMatchClock,
} from "../../lib/matchClock.js";
import { MATCH_SIDES } from "../../lib/constants.js";
import { normalizeMatchRules } from "../../lib/matchRules.js";
import {
  activateMatchClockMediaSession,
  deactivateMatchClockMediaSession,
  getBuzzerMediaElement,
  getMatchClockErrorLabel,
  playMatchClockBuzzer,
} from "../../lib/matchClockAudio.js";
import { hasMatchScoreboardOperators } from "../../lib/matchUtils.js";
import "../../styles/match-clock.css";
import MatchClockPanelView from "./MatchClockPanelView.jsx";
import useMatchClockRequests from "./useMatchClockRequests.js";

export { default as MatchScoreControls } from "./MatchScoreControls.jsx";

export default function MatchClockPanel({
  match,
  onMatchEnded,
  canEndMatch = false,
  onEndMatch = null,
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
  const lastMediaResetAtRef = useRef(0);

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
  const clockRequests = useMatchClockRequests({ applyResponse, clockClient, matchId: match.id, setError });

  useEffect(() => {
    const nextScoreA = Number(match?.result?.scoreA ?? match?.teamA?.score);
    const nextScoreB = Number(match?.result?.scoreB ?? match?.teamB?.score);
    if (!Number.isFinite(nextScoreA) || !Number.isFinite(nextScoreB)) return;
    setScore((current) => {
      if (current.a === nextScoreA && current.b === nextScoreB) return current;
      return { ...current, a: nextScoreA, b: nextScoreB };
    });
  }, [match?.result?.scoreA, match?.result?.scoreB, match?.teamA?.score, match?.teamB?.score]);

  const runAction = useCallback(async (action, payload = {}) => {
    if (!match?.id || pendingAction) return false;
    const requestMatchId = match.id;
    const requestId = clockRequests.startMutation();
    if (!requestId) return false;
    setPendingAction(action);
    setError("");
    try {
      const response = await clockClient(match.id, action, payload);
      if (!clockRequests.isCurrent(requestId, requestMatchId)) return false;
      applyResponse(response);
      return true;
    } catch (actionError) {
      if (clockRequests.isCurrent(requestId, requestMatchId)) setError(getMatchClockErrorLabel(actionError));
      return false;
    } finally {
      if (clockRequests.finishMutation(requestId)) setPendingAction("");
    }
  }, [applyResponse, clockClient, match?.id, pendingAction]);

  const controllerCanEditScores = Boolean(snapshot?.canControl && !match.refereeId);
  const incrementScore = useCallback(async (sideName, delta) => {
    if (!onIncrementScore || scorePendingSide || (!controllerCanEditScores && !editableScoreSides.includes(sideName))) return;
    const requestMatchId = match.id;
    const requestId = clockRequests.startMutation();
    if (!requestId) return;
    setScorePendingSide(sideName);
    setScoreError("");
    try {
      const response = await onIncrementScore(sideName, delta, {
        expectedRevisionA: score.revisionA,
        expectedRevisionB: score.revisionB,
        clockController: controllerCanEditScores,
      });
      if (!clockRequests.isCurrent(requestId, requestMatchId)) return;
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
        if (refreshed && clockRequests.isCurrent(requestId, requestMatchId)) applyResponse(refreshed);
      }
    } catch (actionError) {
      const refreshed = await clockClient(match.id, "read").catch(() => null);
      if (refreshed && clockRequests.isCurrent(requestId, requestMatchId)) applyResponse(refreshed);
      if (clockRequests.isCurrent(requestId, requestMatchId)) {
        setScoreError(String(actionError?.message || actionError?.code || "점수를 갱신하지 못했습니다."));
      }
    } finally {
      if (clockRequests.finishMutation(requestId)) setScorePendingSide("");
    }
  }, [applyResponse, clockClient, controllerCanEditScores, editableScoreSides, match.id, onIncrementScore, score.revisionA, score.revisionB, scorePendingSide]);

  useEffect(() => {
    configurationDirtyRef.current = false;
    matchEndedNotifiedRef.current = false;
    rosterRevisionRef.current = "";
    setPendingAction("");
    setScorePendingSide("");
  }, [match.id]);

  useEffect(() => {
    getBuzzerMediaElement();
  }, []);

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
  const periodDisplayLabel = Number(liveClock?.overtimeCount || 0) > 0
    ? `OT${liveClock.overtimeCount}`
    : `${liveClock?.currentPeriod || 1}Q`;
  const isRunning = liveClock?.status === "running";
  const hasRemainingPeriodTime = Number(liveClock?.periodRemainingMs || 0) > 0;
  const regulationEnded = isBreak && liveClock.currentPeriod >= liveClock.expectedPeriodCount;
  const tied = score.a === score.b;
  const deadlineRemainingMs = Math.max(0, Date.parse(liveClock?.startDeadlineAt || "") - nowMs);
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
  const shotClockEnabled = Number(liveClock?.shotClockSeconds || 0) > 0;
  const showAttendanceQr = Boolean(attendanceQr?.value && liveClock?.canControl);
  const liveControllerCanEditScores = Boolean(liveClock?.canControl && !match.refereeId);
  const clockEditableScoreSides = liveControllerCanEditScores ? MATCH_SIDES : editableScoreSides;
  const canResetShotClock = Boolean(liveClock?.canControl && !isEnded && !isBreak);
  const mediaControlEligible = Boolean(
    shotClockEnabled
    && liveClock?.canControl
    && !isEnded,
  );
  const mediaResetEnabled = Boolean(
    mediaControlEligible
    && !isPending
    && !isBreak,
  );
  const requestMatchEnd = async () => {
    if (!canEndMatch || !onEndMatch || pendingAction) return;
    const message = "경기와 경기시계를 함께 종료하고 사후 기록 단계로 이동할까요?";
    if (!window.confirm(message)) return;
    const requestMatchId = match.id;
    const requestId = clockRequests.startMutation();
    if (!requestId) return;
    setPendingAction("endMatch");
    setError("");
    try {
      const response = await onEndMatch();
      if (response?.ok === false || response === false) throw new Error("match_end_failed");
      if (clockRequests.isCurrent(requestId, requestMatchId)) onMatchEnded?.();
    } catch {
      if (clockRequests.isCurrent(requestId, requestMatchId)) setError("경기 종료 처리에 실패했습니다.");
    } finally {
      if (clockRequests.finishMutation(requestId)) setPendingAction("");
    }
  };

  const enableMediaControl = useCallback(() => {
    if (!mediaControlEligible) return;
    void activateMatchClockMediaSession();
  }, [mediaControlEligible]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !mediaControlEligible) return undefined;

    const resetFromMediaControl = () => {
      void activateMatchClockMediaSession();
      if (!mediaResetEnabled || pendingAction) return;
      const resetRequestedAt = Date.now();
      if (resetRequestedAt - lastMediaResetAtRef.current < 300) return;
      lastMediaResetAtRef.current = resetRequestedAt;
      void runAction("resetShot");
    };

    try {
      navigator.mediaSession.setActionHandler("play", resetFromMediaControl);
      navigator.mediaSession.setActionHandler("pause", resetFromMediaControl);
    } catch {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
      } catch {
        // Unsupported media controls remain untouched.
      }
      return undefined;
    }

    return () => {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
      } catch {
        // Unsupported media controls keep their native behavior.
      }
    };
  }, [mediaControlEligible, mediaResetEnabled, pendingAction, runAction]);

  useEffect(() => {
    if (mediaControlEligible) {
      void activateMatchClockMediaSession();
      return undefined;
    }
    deactivateMatchClockMediaSession();
    return undefined;
  }, [mediaControlEligible]);

  useEffect(() => () => {
    deactivateMatchClockMediaSession();
  }, []);

  useEffect(() => {
    if (!liveClock) {
      soundedRef.current = { period: false, shot: false, break: false };
      return;
    }
    if (liveClock.status === "running") {
      soundedRef.current.break = false;
      if (liveClock.periodRemainingMs <= 0 && !soundedRef.current.period) {
        soundedRef.current.period = true;
        void playMatchClockBuzzer("period", volume / 100);
      } else if (liveClock.shotClockSeconds > 0 && liveClock.shotRemainingMs <= 0 && !soundedRef.current.shot) {
        soundedRef.current.shot = true;
        void playMatchClockBuzzer("shot", volume / 100);
      }
      if (liveClock.shotRemainingMs > 0) soundedRef.current.shot = false;
      return;
    }
    soundedRef.current.period = false;
    soundedRef.current.shot = false;
    if (isBreak && breakLimitMs > 0 && breakElapsedMs >= breakLimitMs && !soundedRef.current.break) {
      soundedRef.current.break = true;
      void playMatchClockBuzzer("warning", volume / 100);
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
    const played = await playMatchClockBuzzer("period", volume / 100);
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
      await clockRequests.readLatest({ quiet: true });
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
        void playMatchClockBuzzer("period", volume / 100);
      }
    });
  };

  return <MatchClockPanelView context={{ activePlayers, applyResponse, attendanceQr, breakElapsedMs, breakLimitMinutes, breakLimitMs, breakOvertimeMs, breakRemainingMs, canEndMatch, canResetShotClock, clockClient, clockEditableScoreSides, closeFocusMode, configurationDirtyRef, confirmAction, controller, controllerCanEditScores, deadlineRemainingMs, deviceNotice, directScoreControlsEnabled, editableScoreSides, enableMediaControl, error, focusMode, halftimeAfterPeriod, hasRemainingPeriodTime, incrementScore, isBreak, isEnded, isHalftimeBreak, isPending, isRunning, lastMediaResetAtRef, liveClock, liveControllerCanEditScores, match, matchEndedNotifiedRef, matchRules, mediaControlEligible, mediaResetEnabled, nowMs, onEndMatch, onIncrementScore, onMatchEnded, onRosterChanged, openFocusMode, pendingAction, periodDisplayLabel, recognition, regulationEnded, requestMatchEnd, requestWakeLock, rosterRevisionRef, runAction, saveConfiguration, score, scoreError, scorePendingSide, scoreboardEnabled, selectController, selectShotClock, selectedControllerId, setActivePlayers, setAttendanceQr, setDeviceNotice, setError, setFocusMode, setNowMs, setPendingAction, setScore, setScoreError, setScorePendingSide, setSelectedControllerId, setShotClockSeconds, setSnapshot, setVolume, setWakeLockActive, setWakeLockRequested, shotClockEnabled, shotClockSeconds, showAttendanceQr, snapshot, soundedRef, testBuzzer, tied, toggleWakeLock, volume, wakeLockActive, wakeLockRef, wakeLockRequested, wakeLockRequestedRef }} />;
}
