const MATCH_SIDES = Object.freeze(["teamA", "teamB"]);

export function uniquePlayerIds(playerIds = []) {
  return [...new Set(playerIds.filter(Boolean))];
}

export function flattenPlayerIdValues(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenPlayerIdValues);
  if (typeof value === "object") return Object.values(value).flatMap(flattenPlayerIdValues);
  return value ? [String(value)] : [];
}

export function flattenMatchReservePlayerIds(match = {}) {
  return Object.values(match.reservePlayers ?? match.rules?.reservePlayers ?? {})
    .flatMap((value) => (Array.isArray(value) ? value.filter(Boolean) : []));
}

// Shape validation needs duplicates intact so it can reject the original payload.
export function collectMatchActivePlayerIds(match = {}) {
  return MATCH_SIDES.flatMap((sideName) => match?.[sideName]?.players ?? []).filter(Boolean);
}

export function projectMatchActivePlayerIds(match = {}) {
  return uniquePlayerIds(collectMatchActivePlayerIds(match));
}

export function projectMatchSideParticipationIds(match = {}, sideName = "") {
  if (!MATCH_SIDES.includes(sideName)) return [];
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  return uniquePlayerIds([
    ...(match?.[sideName]?.players ?? []),
    ...(playedPlayerIds?.[sideName] ?? []),
  ]);
}

export function projectMatchParticipationIds(match = {}) {
  return uniquePlayerIds(
    MATCH_SIDES.flatMap((sideName) => projectMatchSideParticipationIds(match, sideName)),
  );
}

export function projectPersistedMatchReportParticipantIds(match = {}, playerRows = []) {
  return uniquePlayerIds([
    ...playerRows.map((player) => player?.user_id),
    ...flattenPlayerIdValues(match.reserve_players),
    ...flattenPlayerIdValues(match.played_player_ids),
    ...flattenPlayerIdValues(match.rules?.reservePlayers),
    ...flattenPlayerIdValues(match.rules?.playedPlayerIds),
  ].map((value) => String(value ?? "").trim()).filter(Boolean));
}
