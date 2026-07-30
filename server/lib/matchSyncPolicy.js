import { MATCH_SYNC_DEPENDENCIES } from "./matchSyncDependencies.js";
import { DEFAULT_TOURNAMENT_MMR_GAP, MATCH_SIDES, PLAYER_STAT_FIELDS, RECORD_TYPES, getMatchPlayedIdMap, getParticipantIds, isRefereeGrade, projectTournamentDbIdentity, sortPlainObject, toArray, toNotificationRows, uniqueIds, toFiniteNumber, toTournamentRow, toTournamentTeamRows, persistTournamentSnapshot, normalizePlayerStats, normalizeStatRows, normalizeResultSnapshot, isActiveReferee } from "./matchSyncPolicyData.js";
export { toFiniteNumber, toTournamentRow, toTournamentTeamRows, persistTournamentSnapshot, normalizePlayerStats, normalizeStatRows, normalizeResultSnapshot, isActiveReferee } from "./matchSyncPolicyData.js";

export const configuredDiscordQueueTimeoutMs = Number(process.env.DISCORD_QUEUE_TIMEOUT_MS || 2500);

export const DISCORD_QUEUE_TIMEOUT_MS = Number.isFinite(configuredDiscordQueueTimeoutMs) && configuredDiscordQueueTimeoutMs > 0
  ? configuredDiscordQueueTimeoutMs
  : 2500;

export function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function getMatchBenchPolicyError(error = {}) {
  const errorText = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  if (errorText.includes("invalid_bench_capacity")) return { statusCode: 400, message: "invalid_bench_capacity" };
  if (errorText.includes("match_side_capacity_below_roster")) return { statusCode: 409, message: "match_side_capacity_below_roster" };
  if (errorText.includes("match_bench_capacity_below_roster")) return { statusCode: 409, message: "match_bench_capacity_below_roster" };
  if (errorText.includes("match_reserve_full")) return { statusCode: 409, message: "match_reserve_full" };
  if (errorText.includes("match_reserve_exceeds_bench_capacity")) {
    return { statusCode: 409, message: "match_reserve_exceeds_bench_capacity" };
  }
  if (errorText.includes("match_record_reserve_capacity_exceeded")) {
    return { statusCode: 400, message: "match_record_reserve_capacity_exceeded" };
  }
  if (errorText.includes("match_record_roster_exact_capacity_required") || errorText.includes("match_side_leader_required")) {
    return { statusCode: 400, message: "match_record_roster_invalid" };
  }
  if (errorText.includes("room_edit_limit_reached")) {
    return { statusCode: 409, message: "room_edit_limit_reached" };
  }
  if (errorText.includes("room_edit_window_closed")) {
    return { statusCode: 409, message: "room_edit_window_closed" };
  }
  if (errorText.includes("room_schedule_target_too_soon")) {
    return { statusCode: 409, message: "room_schedule_target_too_soon" };
  }
  if (errorText.includes("room_cancel_locked")) {
    return { statusCode: 409, message: "room_cancel_locked" };
  }
  if (errorText.includes("match_room_edit_locked")) {
    return { statusCode: 409, message: "match_room_edit_locked" };
  }
  if (errorText.includes("match_player_time_overlap")) {
    return { statusCode: 409, message: errorText.match(/match_player_time_overlap:\{.*\}/)?.[0] ?? "match_player_time_overlap" };
  }
  if (errorText.includes("room_meeting_point_required")) return { statusCode: 400, message: "room_meeting_point_required" };
  if (errorText.includes("match_regulation_duration_exceeded")) return { statusCode: 400, message: "match_regulation_duration_exceeded" };
  if (errorText.includes("court_not_found") || errorText.includes("invalid_room_court")) return { statusCode: 400, message: "invalid_room_court" };
  return null;
}

export function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export function getTimestamp(item = {}) {
  return item.updatedAt ?? item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? new Date().toISOString();
}

export function uniqueItemsById(items = []) {
  return [...new Map((items ?? []).filter((item) => item?.id).map((item) => [item.id, item])).values()];
}

export function existingParticipantIds(existingMatch, existingPlayers = []) {
  return new Set([
    existingMatch?.created_by,
    existingMatch?.referee_id,
    existingMatch?.former_referee_id,
    ...(existingPlayers ?? []).map((player) => player.user_id),
  ].filter(Boolean));
}

export function getExistingSidePlayerIds(existingPlayers = [], side) {
  return toArray(existingPlayers)
    .filter((player) => player.side === side)
    .sort((a, b) => Number(a.slot_order ?? 0) - Number(b.slot_order ?? 0))
    .map((player) => player.user_id)
    .filter(Boolean);
}

export function sameOrderedIds(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

export function getExistingSideReserveIds(existingMatch = {}, sideName = "") {
  return toArray(existingMatch?.reserve_players?.[sideName] ?? existingMatch?.rules?.reservePlayers?.[sideName]);
}

export function getExistingSideRosterIds(existingMatch = {}, existingPlayers = [], sideName = "") {
  return uniqueIds([
    ...getExistingSidePlayerIds(existingPlayers, sideName),
    ...getExistingSideReserveIds(existingMatch, sideName),
  ]);
}

export function getNextSideRosterIds(match = {}, sideName = "") {
  return uniqueIds([
    ...toArray(match?.[sideName]?.players),
    ...toArray(match?.reservePlayers?.[sideName] ?? match?.rules?.reservePlayers?.[sideName]),
  ]);
}

export function sameRosterIds(left = [], right = []) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((id) => rightSet.has(id));
}

export function canSyncMatchRecordTeamRoster(profileId, existingMatch, existingPlayers, nextMatch) {
  if (
    !profileId ||
    existingMatch?.rules?.recordType !== RECORD_TYPES.matchRecord ||
    nextMatch?.rules?.recordType !== RECORD_TYPES.matchRecord ||
    existingMatch?.status === "cancelled" ||
    existingMatch?.status === "void" ||
    existingMatch?.confirmed_at ||
    nextMatch?.result
  ) {
    return false;
  }

  const changedSides = MATCH_SIDES.filter((sideName) => !sameRosterIds(
    getExistingSideRosterIds(existingMatch, existingPlayers, sideName),
    getNextSideRosterIds(nextMatch, sideName),
  ));
  if (changedSides.length !== 1) return false;

  const sideName = changedSides[0];
  const existingLeaderId = getExistingSidePlayerIds(existingPlayers, sideName)[0] ?? "";
  const nextLeaderId = toArray(nextMatch?.[sideName]?.players)[0] ?? "";
  return profileId === existingLeaderId && profileId === nextLeaderId;
}

export function isMatchOperator(profileId, existingMatch, nextMatch) {
  return Boolean(profileId && [
    existingMatch?.created_by,
    existingMatch?.referee_id,
    nextMatch?.createdBy,
    nextMatch?.refereeId,
  ].filter(Boolean).includes(profileId));
}

export const CREATE_MATCH_ACTIONS = new Set([
  "createMatch",
  "confirmRecruitingMatch",
  "createTournamentMatch",
]);

export const OPERATOR_MATCH_ACTIONS = new Set([
  "updateTournamentMatchSchedule",
  "forfeitTournamentMatch",
  "checkInMatchPlayer",
  "confirmPickupSideAssignment",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "cancelMatch",
  "deleteSoloRecord",
  "voidMatch",
  "resolveMatchDispute",
  "startMatch",
  "endMatch",
  "updateMatchRoomRules",
  "setMatchRoomPlayerPlacement",
  "swapPickupMatchPlayers",
  "removeMatchRoomPlayer",
]);

export const MATCH_RECORD_ROSTER_ACTION = "setMatchRecordTeamRoster";

export const PARTICIPANT_MATCH_ACTIONS = new Set([
  "acknowledgeMatchRoomRules",
  "agreeMatch",
  "approveMatch",
  "toggleMatchStar",
  "submitMatchThumbs",
  "disputeMatch",
  "respondMatchScheduleProposal",
]);

export const REFEREE_ELIGIBILITY_ACTIONS = new Set([
  "createMatch",
  "confirmRecruitingMatch",
  "createTournamentMatch",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

export const RESULT_REPLACE_MATCH_ACTIONS = new Set([
  "submitMatchResult",
  "resolveMatchDispute",
]);

export function isSoloRecordMatch(match = {}) {
  return match?.rules?.recordType === RECORD_TYPES.personalRecord;
}

export function isMatchRecordMatch(match = {}) {
  return match?.rules?.recordType === RECORD_TYPES.matchRecord;
}

export function shouldReplaceMatchResult(action, match = {}) {
  return RESULT_REPLACE_MATCH_ACTIONS.has(action) || (action === "createMatch" && isSoloRecordMatch(match) && Boolean(match.result));
}

export function shouldReplayMatchOperation(operation = null, match = null) {
  if (!operation) return false;
  return operation.action === "createMatch" && (!match || !isSoloRecordMatch(match));
}

export const ROSTER_LOCKED_MATCH_ACTIONS = new Set([
  ...PARTICIPANT_MATCH_ACTIONS,
  "checkInMatchPlayer",
  "confirmPickupSideAssignment",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

export const REFEREE_LOCKED_MATCH_ACTIONS = new Set([
  ...PARTICIPANT_MATCH_ACTIONS,
  "checkInMatchPlayer",
  "confirmPickupSideAssignment",
  "requestMatchRefereeAbsence",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

export function canSubmitResult(profileId, existingMatch, nextMatch) {
  const disputeDraftSubmission = existingMatch?.status === "disputed" || nextMatch?.status === "disputed" || nextMatch?.disputeDraftResult;
  const refereeId = nextMatch.refereeId || existingMatch?.referee_id;
  const hostId = nextMatch.createdBy || existingMatch?.created_by;
  const recordType = nextMatch.rules?.recordType || existingMatch?.rules?.recordType || "";
  if (recordType === RECORD_TYPES.personalRecord || recordType === RECORD_TYPES.matchRecord) {
    return profileId === hostId;
  }
  if (disputeDraftSubmission) return Boolean(refereeId && profileId === refereeId);
  const startedAt = nextMatch.startedAt || existingMatch?.started_at;
  const endedAt = nextMatch.endedAt || existingMatch?.ended_at;
  if (!startedAt && !endedAt) return false;
  return Boolean(refereeId && profileId === refereeId);
}

export function canSyncSelfSubstitution(profileId, existingMatch, nextMatch) {
  const refereeId = String(nextMatch.refereeId ?? existingMatch?.referee_id ?? "").trim();
  if (refereeId) return profileId === refereeId;
  return MATCH_SIDES.some((sideName) => {
    const existingReserveIds = toArray(existingMatch?.reserve_players?.[sideName]);
    const nextActiveIds = toArray(nextMatch?.[sideName]?.players);
    return existingReserveIds.includes(profileId) && nextActiveIds.includes(profileId);
  });
}

export function canDeleteSoloRecord(profileId, existingMatch, nextMatch) {
  return Boolean(
    profileId &&
    existingMatch?.created_by === profileId &&
    existingMatch?.rules?.recordType === RECORD_TYPES.personalRecord &&
    nextMatch?.rules?.recordType === RECORD_TYPES.personalRecord &&
    nextMatch?.status === "cancelled"
  );
}

export function canSyncMatchAction(profileId, existingMatch, existingPlayers, nextMatch, action) {
  if (!profileId || !nextMatch?.id) return false;
  const nextParticipants = getParticipantIds(nextMatch);
  if (!existingMatch) return CREATE_MATCH_ACTIONS.has(action) && nextParticipants.has(profileId);
  const existingParticipants = existingParticipantIds(existingMatch, existingPlayers);
  if (action === "deleteSoloRecord") return canDeleteSoloRecord(profileId, existingMatch, nextMatch);
  if (action === "substituteMatchPlayer") return canSyncSelfSubstitution(profileId, existingMatch, nextMatch);
  if (action === "resolveMatchDispute") {
    const refereeId = nextMatch.refereeId || existingMatch?.referee_id;
    const authorityId = refereeId || nextMatch.createdBy || existingMatch?.created_by;
    return profileId === authorityId;
  }
  if (action === MATCH_RECORD_ROSTER_ACTION) return canSyncMatchRecordTeamRoster(profileId, existingMatch, existingPlayers, nextMatch);
  if (action === "generatePickupSideAssignment") {
    return isMatchOperator(profileId, existingMatch, nextMatch)
      || existingParticipants.has(profileId)
      || nextParticipants.has(profileId);
  }
  if (OPERATOR_MATCH_ACTIONS.has(action)) return isMatchOperator(profileId, existingMatch, nextMatch);
  if (action === "submitMatchResult") return canSubmitResult(profileId, existingMatch, nextMatch);
  if (PARTICIPANT_MATCH_ACTIONS.has(action)) return existingParticipants.has(profileId) || nextParticipants.has(profileId);
  return existingParticipants.has(profileId) || nextParticipants.has(profileId);
}

export async function validateRefereeEligibility(supabase, existingMatch, nextMatch, action, actorProfileId = "") {
  const refereeId = String(nextMatch.refereeId ?? existingMatch?.referee_id ?? "").trim();
  if (!refereeId) return;

  const existingRefereeId = String(existingMatch?.referee_id ?? "").trim();
  const refereeChanged = refereeId !== existingRefereeId;
  const actorIsAssignedReferee = refereeId === String(actorProfileId || "").trim();
  if (!refereeChanged && !actorIsAssignedReferee && !REFEREE_ELIGIBILITY_ACTIONS.has(action)) return;

  const minTrust = Number(nextMatch.refereeTrustMin ?? existingMatch?.referee_trust_min ?? 90);
  if (!(await isActiveReferee(supabase, refereeId, minTrust))) reject(403, "referee_not_eligible");
}

export function validateLockedMatchCore(existingMatch, existingPlayers, nextMatch, action) {
  if (!existingMatch) return;
  const existingVisibility = existingMatch.visibility || "public";
  const nextVisibility = nextMatch.visibility ?? nextMatch.rules?.visibility ?? existingVisibility;
  if (existingVisibility !== nextVisibility && action !== "updateMatchRoomRules") {
    reject(403, "match_visibility_locked");
  }

  if (ROSTER_LOCKED_MATCH_ACTIONS.has(action)) {
    const existingTeamA = getExistingSidePlayerIds(existingPlayers, "teamA");
    const existingTeamB = getExistingSidePlayerIds(existingPlayers, "teamB");
    const nextTeamA = toArray(nextMatch.teamA?.players);
    const nextTeamB = toArray(nextMatch.teamB?.players);
    if (!sameOrderedIds(existingTeamA, nextTeamA) || !sameOrderedIds(existingTeamB, nextTeamB)) {
      reject(403, "match_roster_locked");
    }
  }

  if (action === "submitMatchResult") {
    const existingPlayed = getMatchPlayedIdMap(existingMatch);
    const nextPlayed = getMatchPlayedIdMap(nextMatch);
    if (!sameOrderedIds(existingPlayed.teamA, nextPlayed.teamA) || !sameOrderedIds(existingPlayed.teamB, nextPlayed.teamB)) {
      reject(403, "match_played_roster_locked");
    }
  }

  if (REFEREE_LOCKED_MATCH_ACTIONS.has(action)) {
    const existingRefereeId = existingMatch.referee_id || "";
    const nextRefereeId = nextMatch.refereeId || "";
    if (existingRefereeId !== nextRefereeId) reject(403, "match_referee_locked");
  }
}

export function validateParticipantResultUnchanged(action, existingResult, existingStats, nextMatch) {
  if (!PARTICIPANT_MATCH_ACTIONS.has(action)) return;
  const existingSnapshot = normalizeResultSnapshot(existingResult, existingStats);
  const nextSnapshot = normalizeResultSnapshot(nextMatch.result);
  if (!existingSnapshot && !nextSnapshot) return;
  if (JSON.stringify(existingSnapshot) !== JSON.stringify(nextSnapshot)) {
    reject(403, "participant_cannot_change_result");
  }
}

export function validateResultOnlyOnSubmission(action, existingResult, existingStats, nextMatch) {
  if (shouldReplaceMatchResult(action, nextMatch) || !nextMatch.result) return;
  const existingSnapshot = normalizeResultSnapshot(existingResult, existingStats);
  const nextSnapshot = normalizeResultSnapshot(nextMatch.result);
  if (!existingSnapshot && !nextSnapshot) return;
  if (JSON.stringify(existingSnapshot) !== JSON.stringify(nextSnapshot)) {
    reject(403, "match_result_submission_required");
  }
}

export function canCommitRatingResult(action, existingResult, nextMatch) {
  return ["approveMatch", "resolveMatchDispute"].includes(action) && Boolean(existingResult) && nextMatch?.status === "confirmed";
}

export const SQL_REDUCER_MATCH_ACTIONS = new Set([
  "finalizeMatch",
  "incrementMatchScore",
  "acknowledgeMatchRoomRules",
  "agreeMatch",
  "approveMatch",
  "cancelMatch",
  "checkInMatchPlayer",
  "confirmPickupSideAssignment",
  "generatePickupSideAssignment",
  "deleteSoloRecord",
  "disputeMatch",
  "resolveMatchDispute",
  "endMatch",
  "forfeitTournamentMatch",
  "removeMatchRoomPlayer",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "setMatchRecordParticipants",
  "setMatchRecordTeamRoster",
  "setMatchRoomPlayerPlacement",
  "swapPickupMatchPlayers",
  "startMatch",
  "submitMatchResult",
  "submitMatchThumbs",
  "substituteMatchPlayer",
  "toggleMatchStar",
  "updateMatchRoomRules",
  "respondMatchScheduleProposal",
  "updateTournamentMatchSchedule",
  "voidMatch",
]);

export function isSupportedMatchAction(action = "") {
  return SQL_REDUCER_MATCH_ACTIONS.has(action);
}

export function isMissingSqlMatchReducer(error = {}) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "PGRST202" ||
    message.includes("rankball_match_agree_action") ||
    message.includes("rankball_match_approval_action") ||
    message.includes("rankball_match_checkin_action") ||
    message.includes("rankball_match_confirm_pickup_assignment") ||
    message.includes("rankball_match_generate_pickup_assignment") ||
    message.includes("rankball_match_finalize_locked") ||
    message.includes("rankball_match_rule_ack_action") ||
    message.includes("rankball_match_schedule_response_action") ||
    message.includes("rankball_match_dispute_action") ||
    message.includes("rankball_match_resolve_dispute_action") ||
    message.includes("rankball_match_end_action") ||
    message.includes("rankball_tournament_match_forfeit_action") ||
    message.includes("rankball_match_referee_absence_action") ||
    message.includes("rankball_match_record_participants_action") ||
    message.includes("rankball_match_result_action") ||
    message.includes("rankball_match_room_update_action") ||
    message.includes("rankball_match_room_action") ||
    message.includes("rankball_match_score_increment_action") ||
    message.includes("rankball_match_substitute_action") ||
    message.includes("rankball_match_roster_transition_action") ||
    message.includes("rankball_match_star_toggle_action") ||
    message.includes("rankball_match_thumbs_action") ||
    message.includes("rankball_match_start_action") ||
    message.includes("rankball_match_start_action_guarded") ||
    message.includes("rankball_match_team_roster_action") ||
    message.includes("rankball_match_terminal_action") ||
    message.includes("rankball_tournament_match_schedule_action") ||
    message.includes("rankball_tournament_match_roster_action")
  );
}

export function rejectSqlMatchFallback(data = {}) {
  if (!data?.fallback) return;
  reject(409, String(data.reason || "match_operation_blocked"));
}

export function shouldUseSqlMatchAction(operation = {}) {
  return SQL_REDUCER_MATCH_ACTIONS.has(String(operation?.action ?? ""));
}

export function canUseSqlMatchActionWithoutSnapshot(operation = {}) {
  return [
    "agreeMatch",
    "approveMatch",
    "cancelMatch",
    "checkInMatchPlayer",
    "confirmPickupSideAssignment",
    "generatePickupSideAssignment",
    "deleteSoloRecord",
    "finalizeMatch",
    "incrementMatchScore",
    "disputeMatch",
    "resolveMatchDispute",
    "endMatch",
    "forfeitTournamentMatch",
    "removeMatchRoomPlayer",
    "requestMatchRefereeAbsence",
    "confirmMatchRefereeAbsence",
    "setMatchRecordParticipants",
    "setMatchRecordTeamRoster",
    "setMatchRoomPlayerPlacement",
    "swapPickupMatchPlayers",
    "startMatch",
    "submitMatchResult",
    "submitMatchThumbs",
    "substituteMatchPlayer",
    "toggleMatchStar",
    "updateMatchRoomRules",
    "acknowledgeMatchRoomRules",
    "respondMatchScheduleProposal",
    "updateTournamentMatchSchedule",
    "voidMatch",
  ].includes(operation?.action) && Boolean(operation?.matchId);
}
