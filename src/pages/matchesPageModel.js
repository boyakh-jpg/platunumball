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
  let request;
  try {
    request = loadMatchDetail?.(matchId);
  } catch {
    requestedMatchDetails.delete(matchId);
    onUnavailable?.();
    onSettled?.();
    return;
  }
  if (!request?.then) {
    if (!request) requestedMatchDetails.delete(matchId);
    onSettled?.();
    return;
  }
  return request.then(
    (count) => {
      if (count) return;
      requestedMatchDetails.delete(matchId);
      onUnavailable?.();
    },
    () => {
      requestedMatchDetails.delete(matchId);
      onUnavailable?.();
    },
  ).finally(() => onSettled?.());
}
