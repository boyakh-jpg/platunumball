import { MATCH_SYNC_DEPENDENCIES } from "./matchSyncDependencies.js";

import * as MATCH_SYNC_POLICY from "./matchSyncPolicy.js";

const MATCH_SQL_ACTION_DEPENDENCIES = { ...MATCH_SYNC_DEPENDENCIES, ...MATCH_SYNC_POLICY };

const {

  DISCORD_QUEUE_TIMEOUT_MS, MATCH_SIDES, RECORD_TYPES, isMatchRecordMatch, isMissingSqlMatchReducer, loadAuthoritativeState, queueMatchDiscordDeliveries,

  reject, rejectSqlMatchFallback, toArray, withTimeout,

} = MATCH_SQL_ACTION_DEPENDENCIES;

export async function loadSyncedMatch(context, matchId = "") {
  if (!matchId) return null;
  const state = await loadAuthoritativeState(context, { operation: { matchId } });
  return (state.matches ?? []).find((item) => item.id === matchId) ?? null;
}

export async function applySqlMatchCoreAction(context, operation = {}, match = {}) {

if (operation.action === "approveMatch" && match?.id && !isMatchRecordMatch(match)) {
    reject(409, "general_match_participant_approval_retired");
  }

if (operation.action === "resolveMatchDispute" && !String(operation.resolutionReason ?? "").trim()) {
    reject(400, "match_dispute_resolution_reason_required");
  }

if (operation.action === "finalizeMatch" && operation.disputesAcknowledged !== true) {
    reject(400, "match_finalize_disputes_acknowledgement_required");
  }

if (operation.action === "incrementMatchScore" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_match_score_increment_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId,
      p_delta_a: Number(operation.deltaA ?? 0),
      p_delta_b: Number(operation.deltaB ?? 0),
      p_expected_revision_a: operation.expectedRevisionA == null ? null : Number(operation.expectedRevisionA),
      p_expected_revision_b: operation.expectedRevisionB == null ? null : Number(operation.expectedRevisionB),
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_score_increment_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

if (operation.action === "finalizeMatch" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_match_finalize_locked", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId,
      p_action: operation.action,
      p_disputes_acknowledged: true,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_finalize_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

if (operation.action === "acknowledgeMatchRoomRules" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_match_rule_ack_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId,
      p_rule_revision: Number(operation.revision ?? 0),
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_rule_ack_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

if (operation.action === "respondMatchScheduleProposal" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_match_schedule_response_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId,
      p_proposal_id: operation.proposalId ?? "",
      p_decision: operation.decision ?? "approve",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_schedule_response_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

if (operation.action === "updateMatchRoomRules" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_match_room_update_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId,
      p_patch: operation.patch ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_room_update_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

if (operation.action === "updateTournamentMatchSchedule" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_tournament_match_schedule_action", {
      p_actor_profile_id: context.profileId,
      p_tournament_id: operation.tournamentId ?? "",
      p_match_id: operation.matchId,
      p_schedule: operation.schedule ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

if (operation.action === "forfeitTournamentMatch" && operation.matchId) {
    const { data, error } = await context.supabase.rpc("rankball_tournament_match_forfeit_action", {
      p_actor_profile_id: context.profileId,
      p_tournament_id: operation.tournamentId ?? "",
      p_match_id: operation.matchId,
      p_losing_side: operation.losingSide ?? "",
      p_reason: operation.reason ?? "팀 불참",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId: operation.matchId };
  }

if (operation.action === "submitMatchResult" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const sourceMatch = match?.id ? match : await loadSyncedMatch(context, matchId);
    if (sourceMatch?.rules?.recordType === RECORD_TYPES.matchRecord && sourceMatch.rules?.recordSetupReady !== true) {
      reject(409, "match_record_setup_required");
    }
    const { data, error } = await context.supabase.rpc("rankball_match_result_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_result: operation.result ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_result_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

if (["requestMatchRefereeAbsence", "confirmMatchRefereeAbsence"].includes(operation.action) && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_referee_absence_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_action: operation.action,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

if (operation.action === "setMatchRecordTeamRoster" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const sourceMatch = match?.id ? match : await loadSyncedMatch(context, matchId);
    if (sourceMatch?.rules?.recordType === RECORD_TYPES.matchRecord && sourceMatch.rules?.recordSetupReady === true) {
      reject(409, "match_record_roster_locked");
    }
    const { data, error } = await context.supabase.rpc("rankball_match_team_roster_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_payload: operation,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

if (operation.action === "setMatchRecordParticipants" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_record_participants_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_payload: operation.setup ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_record_participants_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  return null;

}
