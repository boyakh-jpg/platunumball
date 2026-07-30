import { uniquePlayerIds } from "./playerIds.js";
import { getMatchReservePlayerIds } from "./matchParticipation.js";
import {
  getMatchPlayerTeamId,
} from "./matchRoster.js";
import { getMatchRecordWindow } from "./matchRoomLifecycle.js";

export function getMatchRosterSwapPatch(
  match,
  sideName,
  activePlayerId,
  reservePlayerId,
) {
  const side = match[sideName] ?? {};
  const sidePlayers = side.players ?? [];
  const reserveIds = getMatchReservePlayerIds(match, sideName);
  const currentIsPlayer = sidePlayers.includes(activePlayerId);
  const currentIsReserve = reserveIds.includes(activePlayerId);
  const nextIsPlayer = sidePlayers.includes(reservePlayerId);
  const nextIsReserve = reserveIds.includes(reservePlayerId);
  if (!nextIsPlayer && !nextIsReserve) return { valid: false, match, swapped: false };

  const recordWindow = getMatchRecordWindow(match);
  const shouldSwap = recordWindow.beforeEnd && (
    (currentIsReserve && nextIsPlayer)
    || (currentIsPlayer && nextIsReserve)
  );
  if (!shouldSwap) return { valid: true, match, swapped: false };

  const activeInId = currentIsReserve ? activePlayerId : reservePlayerId;
  const benchedId = currentIsReserve ? reservePlayerId : activePlayerId;
  const nextPlayers = sidePlayers.map(
    (playerId) => (playerId === benchedId ? activeInId : playerId),
  );
  const currentReservePlayers = match.reservePlayers?.[sideName] ?? [];
  const nextReservePlayers = uniquePlayerIds([
    ...currentReservePlayers.filter((playerId) => playerId !== activeInId),
    benchedId,
  ]);
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const nextPlayedPlayerIds = {
    ...playedPlayerIds,
    [sideName]: uniquePlayerIds([
      ...(playedPlayerIds[sideName] ?? []),
      ...sidePlayers,
      activeInId,
      benchedId,
    ]),
  };
  const playerTeams = { ...(side.playerTeams ?? {}) };
  [activeInId, benchedId].forEach((playerId) => {
    const teamId = getMatchPlayerTeamId(match, sideName, playerId);
    if (teamId) playerTeams[playerId] = teamId;
  });

  return {
    valid: true,
    swapped: true,
    activeInId,
    benchedId,
    match: {
      ...match,
      [sideName]: {
        ...side,
        players: uniquePlayerIds(nextPlayers),
        playerTeams,
      },
      reservePlayers: {
        ...(match.reservePlayers ?? {}),
        [sideName]: nextReservePlayers,
      },
      playedPlayerIds: nextPlayedPlayerIds,
      rules: {
        ...(match.rules ?? {}),
        playedPlayerIds: nextPlayedPlayerIds,
      },
    },
  };
}
