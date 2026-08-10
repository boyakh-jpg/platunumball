import { useCallback, useEffect, useRef, useState } from "react";
import { getMatchClockErrorLabel } from "../../lib/matchClockAudio.js";

export default function useMatchClockRequests({ applyResponse, clockClient, matchId, setError }) {
  const requestRef = useRef({ matchId, sequence: 0, mutating: false });
  if (requestRef.current.matchId !== matchId) {
    requestRef.current = { matchId, sequence: requestRef.current.sequence + 1, mutating: false };
  }

  const isCurrent = useCallback(
    (requestId, requestMatchId = matchId) => (
      requestRef.current.sequence === requestId && requestRef.current.matchId === requestMatchId
    ),
    [matchId],
  );
  const startMutation = useCallback(() => {
    if (requestRef.current.mutating) return 0;
    requestRef.current.mutating = true;
    return ++requestRef.current.sequence;
  }, []);
  const finishMutation = useCallback((requestId) => {
    if (requestRef.current.sequence !== requestId) return false;
    requestRef.current.mutating = false;
    return true;
  }, []);
  const readLatest = useCallback(async ({ quiet = false } = {}) => {
    if (requestRef.current.mutating) return false;
    const requestId = ++requestRef.current.sequence;
    try {
      const response = await clockClient(matchId, "read");
      if (!isCurrent(requestId) || requestRef.current.mutating) return false;
      if (!quiet) setError("");
      applyResponse(response);
      return true;
    } catch (error) {
      if (!quiet && isCurrent(requestId) && !requestRef.current.mutating) {
        setError(getMatchClockErrorLabel(error));
      }
      return false;
    }
  }, [applyResponse, clockClient, isCurrent, matchId, setError]);

  useEffect(() => {
    void readLatest();
    const pollId = window.setInterval(readLatest, 3000);
    return () => window.clearInterval(pollId);
  }, [readLatest]);

  return { finishMutation, isCurrent, readLatest, startMutation };
}

export function useScreenWakeLock(setDeviceNotice) {
  const [wakeLockRequested, setWakeLockRequested] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const lockRef = useRef(null);
  const requestedRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef(null);
  const mountedRef = useRef(true);

  const requestWakeLock = useCallback(() => {
    const generation = generationRef.current;
    const pendingRequest = requestRef.current;
    if (pendingRequest?.generation === generation) return pendingRequest.promise;
    if (!("wakeLock" in navigator)) {
      requestedRef.current = false;
      setWakeLockRequested(false);
      setWakeLockActive(false);
      setDeviceNotice("이 브라우저는 화면 유지를 지원하지 않습니다.");
      return Promise.resolve(false);
    }
    const request = { generation, promise: null };
    request.promise = Promise.resolve().then(() => navigator.wakeLock.request("screen")).then(async (lock) => {
      if (!mountedRef.current || generationRef.current !== generation || !requestedRef.current) {
        await lock.release().catch(() => {});
        return false;
      }
      lockRef.current = lock;
      setWakeLockActive(true);
      setDeviceNotice("");
      lock.addEventListener("release", () => {
        if (lockRef.current !== lock) return;
        lockRef.current = null;
        setWakeLockActive(false);
      }, { once: true });
      return true;
    }).catch(() => {
      if (mountedRef.current && generationRef.current === generation && requestedRef.current) {
        setWakeLockActive(false);
        setDeviceNotice("화면 유지 권한을 허용하지 못했습니다.");
      }
      return false;
    }).finally(() => {
      if (requestRef.current === request) requestRef.current = null;
    });
    requestRef.current = request;
    return request.promise;
  }, [setDeviceNotice]);

  useEffect(() => {
    mountedRef.current = true;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && requestedRef.current && !lockRef.current) {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      mountedRef.current = false;
      requestedRef.current = false;
      generationRef.current += 1;
      const lock = lockRef.current;
      lockRef.current = null;
      lock?.release().catch(() => {});
    };
  }, [requestWakeLock]);

  const toggleWakeLock = useCallback(async () => {
    if (requestedRef.current) {
      requestedRef.current = false;
      generationRef.current += 1;
      setWakeLockRequested(false);
      const lock = lockRef.current;
      lockRef.current = null;
      setWakeLockActive(false);
      setDeviceNotice("");
      await lock?.release().catch(() => {});
      return;
    }
    generationRef.current += 1;
    requestedRef.current = true;
    setWakeLockRequested(true);
    await requestWakeLock();
  }, [requestWakeLock, setDeviceNotice]);

  return { toggleWakeLock, wakeLockActive, wakeLockRequested };
}
