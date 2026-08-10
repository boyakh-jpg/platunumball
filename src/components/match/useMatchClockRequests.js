import { useCallback, useEffect, useRef } from "react";
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
