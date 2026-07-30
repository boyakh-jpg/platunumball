import { useMemo } from "react";
import { getMatchRoomPost } from "./matchesPageSelectors.js";

export function getSelectedMatchRoom(match, state) {
  if (!match) return { post: null, error: null };
  try {
    return { post: getMatchRoomPost(match, state), error: null };
  } catch (error) {
    return { post: null, error };
  }
}

export function useSelectedMatchRoom(match, state) {
  return useMemo(
    () => getSelectedMatchRoom(match, state),
    [match, state],
  );
}

export function requestMatchDetailOnce({
  matchId,
  requestedMatchDetails,
  loadMatchDetail,
  onUnavailable,
  onSettled,
}) {
  requestedMatchDetails.add(matchId);
  const request = loadMatchDetail?.(matchId);
  if (!request?.then) {
    if (!request) requestedMatchDetails.delete(matchId);
    onSettled?.();
    return;
  }
  return request.then((count) => {
    if (!count) {
      requestedMatchDetails.delete(matchId);
      onUnavailable?.();
    }
  }).catch(() => {
    requestedMatchDetails.delete(matchId);
    onUnavailable?.();
  }).finally(() => onSettled?.());
}
