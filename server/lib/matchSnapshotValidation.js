import { compactArray } from "../../shared/lib/arrayValues.js";
import {
  getModeSize,
  isSupportedMatchMode,
} from "../../shared/lib/matchConstants.js";
import {
  MATCH_SIDES,
  PLAYER_STAT_FIELD_IDS as PLAYER_STAT_FIELDS,
  RECORD_TYPES,
  isSupportedSoloRecordMode,
  isValidBenchCapacity,
} from "../../shared/lib/constants.js";
import {
  collectMatchActivePlayerIds,
  uniquePlayerIds,
} from "../../shared/lib/playerIds.js";
import { nullableText } from "../../shared/lib/rowUtils.js";
import {
  addTeamRoster,
  assertProfilesExist,
  assertTeamRosterMembers,
} from "../api/_rosterEligibility.js";
import {
  getMatchBenchCapacity,
  getMatchPlayedIds,
  getMatchReserveIds,
} from "./matchSnapshotRows.js";

const RESULT_REPLACE_MATCH_ACTIONS = new Set([
  "submitMatchResult",
  "resolveMatchDispute",
]);

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function isSoloRecordMatch(match = {}) {
  return match?.rules?.recordType === RECORD_TYPES.personalRecord;
}

function isMatchRecordMatch(match = {}) {
  return match?.rules?.recordType === RECORD_TYPES.matchRecord;
}

function shouldReplaceMatchResult(action, match = {}) {
  return RESULT_REPLACE_MATCH_ACTIONS.has(action)
    || (action === "createMatch" && isSoloRecordMatch(match) && Boolean(match.result));
}

function getAnonymousPlayerIds(match = {}) {
  return new Set(Object.keys(match.anonymousPlayers ?? {}).filter(Boolean));
}

export function validateMatchShape(match = {}) {
  const mode = match.mode ?? "5v5";
  const supported = isSoloRecordMatch(match)
    ? isSupportedSoloRecordMode(mode)
    : isSupportedMatchMode(mode);
  if (!supported) reject(400, "unsupported_match_mode");
  const capacity = getModeSize(match.mode);
  const explicitBenchCapacity = match.benchCapacity ?? match.rules?.benchCapacity;
  if (
    explicitBenchCapacity !== undefined
    && !isValidBenchCapacity(explicitBenchCapacity)
  ) {
    reject(400, "invalid_bench_capacity");
  }
  const benchCapacity = getMatchBenchCapacity(match);
  if ((match.teamA?.players ?? []).filter(Boolean).length > capacity) {
    reject(400, "team_a_exceeds_mode_capacity");
  }
  if ((match.teamB?.players ?? []).filter(Boolean).length > capacity) {
    reject(400, "team_b_exceeds_mode_capacity");
  }
  if (compactArray((match.reservePlayers ?? match.rules?.reservePlayers ?? {}).teamA).length > benchCapacity) {
    reject(400, "team_a_exceeds_bench_capacity");
  }
  if (compactArray((match.reservePlayers ?? match.rules?.reservePlayers ?? {}).teamB).length > benchCapacity) {
    reject(400, "team_b_exceeds_bench_capacity");
  }

  const allPlayerIds = [
    ...collectMatchActivePlayerIds(match),
    ...getMatchReserveIds(match),
  ];
  const duplicate = allPlayerIds.find(
    (playerId, index) => allPlayerIds.indexOf(playerId) !== index,
  );
  if (duplicate) reject(400, "duplicate_match_player");
  if (match.refereeId && allPlayerIds.includes(match.refereeId)) {
    reject(400, "referee_cannot_be_player");
  }
}

export function validateMatchCreateCourt(match = {}) {
  if (isSoloRecordMatch(match) || isMatchRecordMatch(match)) return;
  const courtId = nullableText(
    match.courtId
    ?? match.court_id
    ?? match.approvedCourtId
    ?? match.registeredCourtId,
  );
  if (!courtId) reject(400, "missing_match_court");
}

function getSideScopedIds(match = {}, sideName) {
  return [
    ...compactArray(match[sideName]?.players),
    ...compactArray((match.reservePlayers ?? match.rules?.reservePlayers ?? {})[sideName]),
    ...compactArray((match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {})[sideName]),
  ];
}

export async function validateMatchRosterEligibility(supabase, match = {}) {
  const anonymousPlayerIds = getAnonymousPlayerIds(match);
  const realProfileIds = (ids = []) => (
    ids.filter((userId) => !anonymousPlayerIds.has(userId))
  );
  const linkedProfileIds = Object.values(match.anonymousPlayers ?? {})
    .map((player) => nullableText(player?.linkedProfileId))
    .filter(Boolean);
  const rosterIds = [
    ...collectMatchActivePlayerIds(match),
    ...getMatchReserveIds(match),
    ...getMatchPlayedIds(match),
  ];
  await assertProfilesExist(
    supabase,
    uniquePlayerIds([...realProfileIds(rosterIds), ...linkedProfileIds]),
    "match_player_not_found",
  );

  const rostersByTeam = new Map();
  MATCH_SIDES.forEach((sideName) => {
    const teamId = match[sideName]?.teamId;
    if (!teamId) return;
    addTeamRoster(
      rostersByTeam,
      teamId,
      realProfileIds(getSideScopedIds(match, sideName)),
    );
  });
  await assertTeamRosterMembers(
    supabase,
    rostersByTeam,
    "match_team_roster_not_member",
  );
}

export function validateResultShape(match = {}, action = "sync") {
  if (!shouldReplaceMatchResult(action, match) || !match.result) return;

  const scoreA = toFiniteNumber(match.result.scoreA, -1);
  const scoreB = toFiniteNumber(match.result.scoreB, -1);
  if (scoreA < 0 || scoreA > 999 || scoreB < 0 || scoreB > 999) {
    reject(400, "invalid_match_score");
  }

  const recordableIds = new Set([
    ...collectMatchActivePlayerIds(match),
    ...getMatchPlayedIds(match),
  ].filter(Boolean));
  const invalidPlayerId = Object.keys(match.result.playerStats ?? {})
    .find((userId) => !recordableIds.has(userId));
  if (invalidPlayerId) reject(400, "stat_player_not_in_match");

  const invalidStat = Object.values(match.result.playerStats ?? {}).some((stat) => (
    PLAYER_STAT_FIELDS.some((field) => {
      const value = toFiniteNumber(stat?.[field], -1);
      return value < 0 || value > 999;
    })
  ));
  if (invalidStat) reject(400, "invalid_player_stat");
}

export function validateSoloRecordSnapshot(match = {}, actorProfileId = "") {
  if (!isSoloRecordMatch(match)) return;
  const teamAPlayers = compactArray(match.teamA?.players);
  const teamBPlayers = compactArray(match.teamB?.players);
  const anonymousPlayers = Object.values(match.anonymousPlayers ?? {});
  const linkedProfileIds = anonymousPlayers
    .map((player) => nullableText(player?.linkedProfileId))
    .filter(Boolean);
  if (match.createdBy && match.createdBy !== actorProfileId) {
    reject(403, "solo_record_owner_mismatch");
  }
  if (!["public", "private"].includes(match.visibility)) {
    reject(400, "solo_record_visibility_invalid");
  }
  if (match.status !== "confirmed" && match.status !== "cancelled") {
    reject(400, "solo_record_status_invalid");
  }
  if (match.ranked !== false) reject(400, "solo_record_ranked_invalid");
  if (
    teamAPlayers.length !== 1
    || teamAPlayers[0] !== actorProfileId
    || teamBPlayers.length
  ) {
    reject(400, "solo_record_roster_invalid");
  }
  if (
    linkedProfileIds.includes(actorProfileId)
    || new Set(linkedProfileIds).size !== linkedProfileIds.length
  ) {
    reject(400, "solo_record_linked_roster_invalid");
  }
  if (anonymousPlayers.some((player) => String(player?.name ?? "").includes("#"))) {
    reject(400, "solo_record_hashtag_not_allowed");
  }
  if (match.refereeId) reject(400, "solo_record_referee_invalid");
}
