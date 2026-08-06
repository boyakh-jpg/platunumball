import { MATCH_SYNC_DEPENDENCIES } from "./matchSyncDependencies.js";

import * as MATCH_SYNC_POLICY from "./matchSyncPolicy.js";
import { applySqlMatchCoreAction, loadSyncedMatch } from "./matchSqlCoreActions.js";

export { loadSyncedMatch };

const MATCH_SQL_ACTION_DEPENDENCIES = { ...MATCH_SYNC_DEPENDENCIES, ...MATCH_SYNC_POLICY };

const {

  DISCORD_QUEUE_TIMEOUT_MS, RECORD_TYPES, isMatchRecordMatch, isMissingSqlMatchReducer, queueMatchDiscordDeliveries,
  queueMatchParticipationCancellationDeliveries,

  reject, rejectSqlMatchFallback, withTimeout,

} = MATCH_SQL_ACTION_DEPENDENCIES;

export function getSqlMatchReloadPredicate(operation = {}) {
  const action = String(operation.action || "");
  if (action === "submitMatchResult") {
    return (match) => Boolean(match?.result) &&
      Number(match.result.scoreA ?? match.teamA?.score ?? 0) === Number(operation.result?.scoreA ?? 0) &&
      Number(match.result.scoreB ?? match.teamB?.score ?? 0) === Number(operation.result?.scoreB ?? 0);
  }
  if (action === "updateTournamentMatchSchedule") {
    return (match) => match?.scheduledDate === operation.schedule?.scheduledDate &&
      String(match?.scheduledTime || "").slice(0, 5) === String(operation.schedule?.scheduledTime || "").slice(0, 5) &&
      (!operation.schedule?.courtId || match?.courtId === operation.schedule.courtId);
  }
  if (action === "forfeitTournamentMatch") {
    return (match) => match?.status === "confirmed" && match?.forfeitSide === operation.losingSide;
  }
  if (action === "approveMatch") {
    return (match) => match?.status === "confirmed" || (match?.approvals?.[operation.sideName] ?? []).includes(operation.playerId);
  }
  if (action === "agreeMatch") {
    return (match) => match?.status === "agreed" || (match?.agreements?.[operation.sideName] ?? []).includes(operation.playerId);
  }
  if (action === "startMatch") return (match) => Boolean(match?.startedAt);
  if (action === "endMatch") return (match) => Boolean(match?.endedAt);
  if (action === "setMatchRecordTeamRoster") {
    const sideName = operation.sideName;
    const requestedPlayerIds = [...new Set(operation.roster?.playerIds ?? [])].filter(Boolean);
    const requestedReserveIds = [...new Set(operation.roster?.reservePlayerIds ?? [])].filter(Boolean);
    const hasSameIds = (actualIds = [], requestedIds = []) => (
      actualIds.length === requestedIds.length
      && requestedIds.every((playerId) => actualIds.includes(playerId))
    );
    return (match) => (
      match?.rules?.rosterReady?.[sideName] === true
      && hasSameIds(match?.[sideName]?.players ?? [], requestedPlayerIds)
      && hasSameIds(match?.reservePlayers?.[sideName] ?? [], requestedReserveIds)
    );
  }
  if (action === "checkInMatchPlayer") {
    return (match) => (match?.attendance?.[operation.sideName] ?? []).includes(operation.playerId);
  }
  if (action === "confirmPickupSideAssignment") {
    return (match) => match?.rules?.sideAssignmentStatus === "confirmed";
  }
  if (action === "generatePickupSideAssignment") {
    return (match) => match?.rules?.sideAssignmentStatus === "draft";
  }
  return null;
}

export async function loadSyncedMatchAfterWrite(context, matchId = "", fallbackMatch = null, options = {}) {
  const predicate = typeof options.predicate === "function" ? options.predicate : null;
  const delays = predicate ? [0, 60, 120, 240, 480] : [0];
  let latestMatch = fallbackMatch;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const loadedMatch = await loadSyncedMatch(context, matchId);
      if (loadedMatch) latestMatch = loadedMatch;
      if (!predicate || predicate(loadedMatch)) return loadedMatch;
    } catch (error) {
      console.warn("Match post-write reload failed.", error.message);
    }
  }
  return latestMatch;
}

export async function applySqlMatchAction(context, operation = {}, match = {}) {
  const coreResult = await applySqlMatchCoreAction(context, operation, match);
  if (coreResult) return coreResult;

  if (operation.action === "confirmPickupSideAssignment" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_confirm_pickup_assignment", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_rotation_mode: operation.rotationMode ?? "manual",
      p_rotation_interval_minutes: Number(operation.rotationIntervalMinutes ?? 5),
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "generatePickupSideAssignment" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_generate_pickup_assignment", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_assignment_mode: operation.assignmentMode ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "pickup_assignment_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "swapPickupMatchPlayers" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_swap_pickup_players", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_first_player_id: operation.firstPlayerId ?? "",
      p_second_player_id: operation.secondPlayerId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "pickup_player_swap_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "cancelMatchParticipation" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_participation_cancel_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_reason: operation.reason ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    const deliveryMatch = await loadSyncedMatchAfterWrite(context, matchId, match?.id ? match : null, {
      predicate: (loaded) => ![
        ...(loaded?.teamA?.players ?? []),
        ...(loaded?.teamB?.players ?? []),
        ...(loaded?.reservePlayers?.teamA ?? []),
        ...(loaded?.reservePlayers?.teamB ?? []),
      ].includes(context.profileId),
    });
    let discordDeliveryCount = 0;
    let discordDeliveryError = null;
    try {
      if (deliveryMatch?.id) {
        discordDeliveryCount = await withTimeout(
          queueMatchParticipationCancellationDeliveries(context.supabase, deliveryMatch, data),
          DISCORD_QUEUE_TIMEOUT_MS,
          "discord_match_participation_cancel_timeout",
        );
      }
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_match_participation_cancel_failed";
      console.error("Match participation cancellation Discord queue failed.", deliveryError);
    }
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId,
      discordDeliveryCount,
      discordDeliveryError,
    };
  }

  if (["setMatchRoomPlayerPlacement", "removeMatchRoomPlayer"].includes(operation.action) && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_room_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_action: operation.action,
      p_payload: operation,
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "resolveMatchDispute" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_resolve_dispute_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_dispute_id: operation.disputeId ?? "",
      p_decision: operation.decision ?? "",
      p_resolution_reason: operation.resolutionReason ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) reject(503, "match_dispute_resolution_rpc_required");
      throw error;
    }
    rejectSqlMatchFallback(data);
    return { ok: true, ...(data && typeof data === "object" ? data : {}), matchId };
  }

  if (operation.action === "disputeMatch" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_dispute_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_dispute_request: operation.reason ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);

    let discordDeliveryCount = 0;
    let discordDeliveryError = null;
    const deliveryMatch = await loadSyncedMatchAfterWrite(context, matchId, match?.id ? match : null);
    try {
      if (deliveryMatch?.id) {
        discordDeliveryCount = await withTimeout(
          queueMatchDiscordDeliveries(context.supabase, deliveryMatch, operation.action),
          DISCORD_QUEUE_TIMEOUT_MS,
          "discord_match_delivery_timeout",
        );
      }
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
      console.error("Match Discord delivery queue failed.", deliveryError);
    }

    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId,
      discordDeliveryCount,
      discordDeliveryError,
    };
  }

  if (["cancelMatch", "deleteSoloRecord", "voidMatch"].includes(operation.action) && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const { data, error } = await context.supabase.rpc("rankball_match_terminal_action", {
      p_actor_profile_id: context.profileId,
      p_action: operation.action,
      p_match_id: matchId,
      p_reason: operation.reason ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);

    let discordDeliveryCount = 0;
    let discordDeliveryError = null;
    if (operation.action !== "deleteSoloRecord") {
      const deliveryMatch = await loadSyncedMatchAfterWrite(context, matchId, match?.id ? match : null);
      try {
        if (deliveryMatch?.id) {
          discordDeliveryCount = await withTimeout(
            queueMatchDiscordDeliveries(context.supabase, deliveryMatch, operation.action),
            DISCORD_QUEUE_TIMEOUT_MS,
            "discord_match_delivery_timeout",
          );
        }
      } catch (deliveryError) {
        discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
        console.error("Match Discord delivery queue failed.", deliveryError);
      }
    }

    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId,
      discordDeliveryCount,
      discordDeliveryError,
    };
  }

  if (operation.action === "toggleMatchStar" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_star_toggle_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_target_user_id: operation.targetUserId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "submitMatchThumbs" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_thumbs_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_target_user_ids: operation.targetUserIds ?? [],
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "approveMatch" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_approval_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_side: operation.sideName ?? "",
      p_player_id: operation.playerId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "agreeMatch" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_agree_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_side: operation.sideName ?? "",
      p_player_id: operation.playerId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "checkInMatchPlayer" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_checkin_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_side: operation.sideName ?? "",
      p_player_id: operation.playerId ?? "",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "substituteMatchPlayer" && (match?.id || operation.matchId)) {
    const { data, error } = await context.supabase.rpc("rankball_match_substitute_action", {
      p_actor_profile_id: context.profileId,
      p_match_id: operation.matchId ?? match.id,
      p_side: operation.sideName ?? "",
      p_active_player_id: operation.activePlayerId ?? "",
      p_reserve_player_id: operation.reservePlayerId ?? "",
      p_reason: operation.reason ?? "operator",
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId: operation.matchId ?? match.id,
    };
  }

  if (operation.action === "startMatch" && (match?.id || operation.matchId)) {
    const matchId = operation.matchId ?? match.id;
    const pickup = (match?.formationMode ?? match?.rules?.formationMode) === "pickup"
      || (match?.matchIntent ?? match?.rules?.matchIntent) === "pickup";
    if (pickup && match?.rules?.sideAssignmentStatus !== "confirmed") {
      reject(409, "pickup_side_assignment_required");
    }
    const { data, error } = await context.supabase.rpc("rankball_match_start_action_guarded", {
      p_actor_profile_id: context.profileId,
      p_match_id: matchId,
      p_started_at: "",
      p_agreed_at: match?.agreedAt ?? "",
      p_attendance: match?.attendance ?? {},
    });
    if (error) {
      if (isMissingSqlMatchReducer(error)) return null;
      throw error;
    }
    rejectSqlMatchFallback(data);

    let discordDeliveryCount = 0;
    let discordDeliveryError = null;
    const deliveryMatch = match?.id ? match : await loadSyncedMatchAfterWrite(context, matchId, null);
    try {
      if (deliveryMatch?.id) {
        discordDeliveryCount = await withTimeout(
          queueMatchDiscordDeliveries(context.supabase, deliveryMatch, operation.action),
          DISCORD_QUEUE_TIMEOUT_MS,
          "discord_match_delivery_timeout",
        );
      }
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
      console.error("Match Discord delivery queue failed.", deliveryError);
    }

    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      matchId,
      discordDeliveryCount,
      discordDeliveryError,
    };
  }

  if (operation.action !== "endMatch" || !(match?.id || operation.matchId)) return null;
  const matchId = operation.matchId ?? match.id;
  const { data, error } = await context.supabase.rpc("rankball_match_end_action", {
    p_actor_profile_id: context.profileId,
    p_match_id: matchId,
    p_started_at: "",
    p_ended_at: "",
  });
  if (error) {
    if (isMissingSqlMatchReducer(error)) return null;
    throw error;
  }
  rejectSqlMatchFallback(data);

  let discordDeliveryCount = 0;
  let discordDeliveryError = null;
  const deliveryMatch = match?.id ? match : await loadSyncedMatchAfterWrite(context, matchId, null);
  try {
    if (deliveryMatch?.id) {
      discordDeliveryCount = await withTimeout(
        queueMatchDiscordDeliveries(context.supabase, deliveryMatch, operation.action),
        DISCORD_QUEUE_TIMEOUT_MS,
        "discord_match_delivery_timeout",
      );
    }
  } catch (deliveryError) {
    discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
    console.error("Match Discord delivery queue failed.", deliveryError);
  }

  return {
    ok: true,
    ...(data && typeof data === "object" ? data : {}),
    matchId,
    discordDeliveryCount,
    discordDeliveryError,
  };
}
