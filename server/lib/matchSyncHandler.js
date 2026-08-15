import { MATCH_SYNC_DEPENDENCIES } from "./matchSyncDependencies.js";
import * as MATCH_SYNC_POLICY from "./matchSyncPolicy.js";
import * as MATCH_SQL_ACTIONS from "./matchSqlActions.js";
import { copyDraftReceiptEmblems, getSafeMatchReceiptEmblems } from "../api/match-receipts/_emblemStorage.js";

export {
  getCheckedInMatchAttendanceIds,
  getDiscordProfiles,
  getMatchDisputeReminderTiming,
  getMatchNotificationId,
  getMatchPregameNotificationPlan,
  getMissingMatchAttendanceIds,
  getRequiredMatchAttendanceIds,
  getUpsertableDiscordDeliveryRows,
  hasScheduledNotificationRevisionChanged,
  queueMatchDiscordDeliveries,
  reconcileMatchAttendanceNotifications,
  toDiscordDeliveryRows,
  toMatchNotificationRows,
  upsertDiscordDeliveryRows,
} from "./matchNotifications.js";
export {
  toAuthoritativeMatchRow,
  toAuthoritativePlayerStatRows,
} from "./matchSnapshotRows.js";
export {
  validateMatchCreateCourt,
  validateMatchShape,
} from "./matchSnapshotValidation.js";
export { getMatchBenchPolicyError } from "./matchSyncPolicy.js";

const MATCH_SYNC_HANDLER_DEPENDENCIES = {
  ...MATCH_SYNC_DEPENDENCIES,
  ...MATCH_SYNC_POLICY,
  ...MATCH_SQL_ACTIONS,
};
const {
  CREATE_MATCH_ACTIONS, DISCORD_QUEUE_TIMEOUT_MS, MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS, PRACTICE_LOCAL_ONLY_ERROR, PROFILE_CARD_COLUMNS, PROFILE_ME_COLUMNS,
  TEAM_COLUMNS, TEAM_MEMBER_COLUMNS, applyAuthoritativeMatchOperation, applySqlMatchAction, canCommitRatingResult, canSyncMatchAction, canUseSqlMatchActionWithoutSnapshot,
  allowRequestMethod, fromRemoteProfile, fromRemoteTeam, getAuthenticatedContext, getMatchBenchPolicyError, getOperation, getSidePlayerRows, getSqlMatchReloadPredicate,
  getTimestamp, hasPracticeMutationPayload, isMissingSqlMatchReducer, isSoloRecordMatch, isSupportedMatchAction, loadAuthoritativeState, loadSyncedMatchAfterWrite,
  persistTournamentSnapshot, queueMatchDiscordDeliveries, readJsonBody, reject, sendJson, shouldReplaceMatchResult, shouldReplayMatchOperation,
  shouldUseSqlMatchAction, toAgreementRows, toApprovalRows, toAuthoritativeMatchRow, toAuthoritativePlayerStatRows, toDisputeRows, toNotificationRows,
  toResultRow, uniqueIds, uniqueItemsById, validateLockedMatchCore, validateMatchCreateCourt, validateMatchRosterEligibility, validateMatchShape,
  validateParticipantResultUnchanged, validateRefereeEligibility, validateResultOnlyOnSubmission, validateResultShape, validateSoloRecordSnapshot, withTimeout,
} = MATCH_SYNC_HANDLER_DEPENDENCIES;

const RECEIPT_DRAFT_PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function prepareReceiptSpecificEmblems(context, match, existingMatch, action) {
  const nextRules = { ...(match.rules ?? {}) };
  delete nextRules.receiptEmblems;

  const existingEmblems = getSafeMatchReceiptEmblems(existingMatch?.rules?.receiptEmblems, match.id);
  if (existingEmblems.home || existingEmblems.away) nextRules.receiptEmblems = existingEmblems;

  const publicId = String(nextRules.receiptDraftPublicId ?? "").trim();
  delete nextRules.receiptDraftPublicId;
  const shouldPromote = !existingMatch && CREATE_MATCH_ACTIONS.has(action) && isSoloRecordMatch(match);
  if (!publicId || !shouldPromote) return { ...match, rules: nextRules };
  if (!RECEIPT_DRAFT_PUBLIC_ID_PATTERN.test(publicId)) reject(400, "invalid_receipt_draft");

  const { data: receiptDraft, error } = await context.supabase
    .from("match_receipt_drafts")
    .select("public_id, payload, expires_at, claimed_by, claimed_at")
    .eq("public_id", publicId)
    .maybeSingle();
  if (error) throw error;
  const isExpired = !receiptDraft?.expires_at || new Date(receiptDraft.expires_at).getTime() <= Date.now();
  if (isExpired || !receiptDraft?.claimed_at || receiptDraft.claimed_by !== context.profileId) {
    reject(403, "receipt_draft_claim_required");
  }

  const promotedEmblems = await copyDraftReceiptEmblems({
    payload: receiptDraft.payload,
    sourcePublicId: receiptDraft.public_id,
    targetMatchId: match.id,
  });
  if (promotedEmblems.home || promotedEmblems.away) nextRules.receiptEmblems = promotedEmblems;
  return { ...match, rules: nextRules };
}

function getRatingCommitProfileIds(ratingCommit = {}) {
  return uniqueIds([
    ...(ratingCommit.ratingResult ?? []).map((item) => item?.playerId),
    ...(ratingCommit.profileUpdates ?? []).map((item) => item?.id),
  ]);
}
function getRatingCommitTeamIds(ratingCommit = {}) {
  return uniqueIds((ratingCommit.teamUpdates ?? []).map((item) => item?.id));
}
async function loadCommittedRatingState(context, ratingCommit = {}) {
  const profileIds = getRatingCommitProfileIds(ratingCommit);
  const teamIds = getRatingCommitTeamIds(ratingCommit);
  if (!profileIds.length && !teamIds.length) return null;

  const currentProfileId = profileIds.includes(context.profileId) ? context.profileId : "";
  const publicProfileIds = profileIds.filter((profileId) => profileId !== currentProfileId);

  const [
    { data: currentProfile, error: currentProfileError },
    { data: publicProfiles, error: publicProfilesError },
    { data: teamRows, error: teamError },
    { data: teamMemberRows, error: teamMemberError },
  ] = await Promise.all([
    currentProfileId
      ? context.supabase.from("profiles").select(PROFILE_ME_COLUMNS).eq("id", currentProfileId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    publicProfileIds.length
      ? context.supabase.from("profiles").select(PROFILE_CARD_COLUMNS).in("id", publicProfileIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? context.supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (currentProfileError) throw currentProfileError;
  if (publicProfilesError) throw publicProfilesError;
  if (teamError) throw teamError;
  if (teamMemberError) throw teamMemberError;

  const teamMembersByTeam = new Map();
  (teamMemberRows ?? []).forEach((row) => {
    const rows = teamMembersByTeam.get(row.team_id) ?? [];
    rows.push(row);
    teamMembersByTeam.set(row.team_id, rows);
  });

  const users = [
    ...(publicProfiles ?? []).map(fromRemoteProfile),
    ...(currentProfile ? [fromRemoteProfile(currentProfile)] : []),
  ];
  const teams = (teamRows ?? []).map((row) => fromRemoteTeam(row, teamMembersByTeam.get(row.id)));

  return users.length || teams.length ? { users, teams } : null;
}
export async function commitProfileTrustDeltas(context, trustCommit = {}) {
  const profileUpdates = (trustCommit.profileUpdates ?? []).filter((item) => item?.id && Number(item.trustDelta));
  if (!trustCommit.matchId || !profileUpdates.length) return { ok: true, skipped: true, profileCount: 0 };
  const { data, error } = await context.supabase.rpc("rankball_apply_profile_trust_deltas", {
    p_actor_profile_id: context.profileId,
    p_match_id: trustCommit.matchId,
    p_deltas: profileUpdates,
  });
  if (error) throw error;
  return data ?? { ok: true, profileCount: profileUpdates.length };
}
export async function persistMatchSnapshot(context, { match, notifications = [], action = "sync", body = {}, ratingCommit = null, trustCommit = null, trustedServerCreate = false, recruitingPersistence = null }) {
  if (!match?.id) reject(400, "missing_match");
  validateMatchShape(match);
  validateResultShape(match, action);
  const expectedUpdatedAt = body?.expectedUpdatedAt ?? body?.baseUpdatedAt ?? body?.operation?.expectedUpdatedAt ?? body?.operation?.baseUpdatedAt ?? null;

  const { data: existingMatch, error: existingError } = await context.supabase
      .from("matches")
      .select("id, visibility, status, created_by, referee_id, former_referee_id, referee_trust_min, stat_recorders, played_player_ids, reserve_players, score_a, score_b, rating_result, team_rating_result, agreed_at, started_at, ended_at, confirmed_at, rules")
      .eq("id", match.id)
      .maybeSingle();
  if (existingError) throw existingError;

  const { data: existingPlayers, error: playerError } = await context.supabase
      .from("match_players")
      .select("user_id, side, slot_order")
      .eq("match_id", match.id);
  if (playerError) throw playerError;

  const { data: existingResult, error: resultError } = await context.supabase
      .from("match_results")
      .select("score_a, score_b")
      .eq("match_id", match.id)
      .maybeSingle();
  if (resultError) throw resultError;

  const { data: existingStats, error: statError } = await context.supabase
      .from("player_match_stats")
      .select("user_id, points, rebounds, assists, steals, blocks, turnovers, fouls")
      .eq("match_id", match.id);
  if (statError) throw statError;

  if (!trustedServerCreate && !canSyncMatchAction(context.profileId, existingMatch, existingPlayers, match, action)) {
    reject(403, "match_sync_permission_denied");
  }
  validateSoloRecordSnapshot(match, context.profileId);
  if (!existingMatch && CREATE_MATCH_ACTIONS.has(action)) validateMatchCreateCourt(match);
  validateLockedMatchCore(existingMatch, existingPlayers, match, action);
  validateParticipantResultUnchanged(action, existingResult, existingStats, match);
  validateResultOnlyOnSubmission(action, existingResult, existingStats, match);
  await validateRefereeEligibility(context.supabase, existingMatch, match, action, context.profileId);
  await validateMatchRosterEligibility(context.supabase, match);

  const persistedMatch = await prepareReceiptSpecificEmblems(context, match, existingMatch, action);

  const matchRow = toAuthoritativeMatchRow(persistedMatch, context.profileId);
  if (expectedUpdatedAt) matchRow.__expectedUpdatedAt = expectedUpdatedAt;
  const playerRows = getSidePlayerRows(persistedMatch);
  const shouldCommitRating = canCommitRatingResult(action, existingResult, persistedMatch);
  const shouldReplaceResult = shouldReplaceMatchResult(action, persistedMatch);
  if (shouldCommitRating && !ratingCommit) reject(400, "missing_rating_commit");
  if (action !== "submitMatchResult" && existingMatch) {
    if (action !== "updateMatchRoomRules") {
      matchRow.visibility = existingMatch.visibility ?? matchRow.visibility;
      matchRow.rules = {
        ...(matchRow.rules ?? {}),
        visibility: matchRow.visibility,
      };
    }
    if (!shouldReplaceResult) {
      matchRow.score_a = Number(existingResult?.score_a ?? existingMatch.score_a ?? 0);
      matchRow.score_b = Number(existingResult?.score_b ?? existingMatch.score_b ?? 0);
    }
    if (shouldCommitRating) {
      matchRow.status = existingMatch.status ?? "approval";
      matchRow.rating_result = existingMatch.rating_result ?? null;
      matchRow.team_rating_result = existingMatch.team_rating_result ?? null;
      matchRow.confirmed_at = existingMatch.confirmed_at ?? null;
    } else {
      matchRow.rating_result = existingMatch.rating_result ?? null;
      matchRow.team_rating_result = existingMatch.team_rating_result ?? null;
    }
  }
  const resultRow = shouldReplaceResult ? toResultRow(persistedMatch, context.profileId) : null;
  const statRows = shouldReplaceResult ? toAuthoritativePlayerStatRows(persistedMatch) : [];
  const agreementRows = toAgreementRows(persistedMatch);
  const approvalRows = toApprovalRows(persistedMatch);
  const disputeRows = toDisputeRows(persistedMatch);
  const snapshotNotifications = ["cancelMatch", "voidMatch"].includes(action)
    ? notifications.filter((notification) => notification.matchId !== match.id)
    : notifications;
  const notificationRows = toNotificationRows(snapshotNotifications, context.profileId, { coalesce: "nullish", getUpdatedAt: getTimestamp });

  let persistRpcName = shouldCommitRating ? "rankball_match_action_with_rating" : "rankball_match_action";
  let persistArgs = {
    p_actor_profile_id: context.profileId,
    p_action: action,
    p_match_row: matchRow,
    p_player_rows: playerRows,
    p_result_row: resultRow,
    p_stat_rows: statRows,
    p_agreement_rows: agreementRows,
    p_approval_rows: approvalRows,
    p_dispute_rows: disputeRows,
    p_notification_rows: notificationRows,
    p_replace_result: shouldReplaceResult,
    ...(shouldCommitRating ? {
      p_rating_result: ratingCommit.ratingResult ?? [],
      p_team_rating_result: ratingCommit.teamRatingResult ?? {},
      p_profile_updates: ratingCommit.profileUpdates ?? [],
      p_team_updates: ratingCommit.teamUpdates ?? [],
      p_confirmed_at: ratingCommit.confirmedAt ?? new Date().toISOString(),
    } : {}),
  };
  if (recruitingPersistence) {
    if (shouldCommitRating || action !== "confirmRecruitingMatch") reject(400, "invalid_atomic_recruiting_confirmation");
    persistRpcName = "rankball_confirm_recruiting_match_action";
    persistArgs = {
      p_actor_profile_id: context.profileId,
      p_post_action: recruitingPersistence.p_action,
      p_post_row: recruitingPersistence.p_post_row,
      p_application_rows: recruitingPersistence.p_application_rows,
      p_recruiting_notification_rows: recruitingPersistence.p_notification_rows,
      p_expected_updated_at: recruitingPersistence.p_expected_updated_at,
      p_match_action: action,
      p_match_row: matchRow,
      p_player_rows: playerRows,
      p_result_row: resultRow,
      p_stat_rows: statRows,
      p_agreement_rows: agreementRows,
      p_approval_rows: approvalRows,
      p_dispute_rows: disputeRows,
      p_match_notification_rows: notificationRows,
      p_replace_result: shouldReplaceResult,
    };
  }
  const { data: persistResult, error: persistError } = await context.supabase.rpc(persistRpcName, persistArgs);
  if (persistError) throw persistError;
  const matchPersistResult = recruitingPersistence ? persistResult?.match : persistResult;
  const recruitingPersistResult = recruitingPersistence ? persistResult?.recruiting : null;
  const ratingCommitResult = shouldCommitRating ? matchPersistResult?.ratingCommit : null;
  const ratingState = shouldCommitRating ? await loadCommittedRatingState(context, ratingCommit) : null;
  const trustCommitResult = trustCommit ? await commitProfileTrustDeltas(context, trustCommit) : null;
  let discordDeliveryCount = 0;
  let discordDeliveryError = null;
  if (!isSoloRecordMatch(persistedMatch)) {
    try {
      discordDeliveryCount = await withTimeout(
        queueMatchDiscordDeliveries(context.supabase, persistedMatch, action),
        DISCORD_QUEUE_TIMEOUT_MS,
        "discord_match_delivery_timeout",
      );
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
      console.error("Match Discord delivery queue failed.", deliveryError);
    }
  }
  const syncedMatch = isSoloRecordMatch(persistedMatch) ? persistedMatch : await loadSyncedMatchAfterWrite(context, persistedMatch.id, persistedMatch);
  const responseState = ratingState ? { ...ratingState, matches: syncedMatch ? [syncedMatch] : [] } : null;

  return {
    ok: true,
    match: syncedMatch ?? match,
    matchId: match.id,
    playerCount: Number(matchPersistResult?.playerCount ?? playerRows.length),
    statCount: Number(matchPersistResult?.statCount ?? statRows.length),
    notificationCount: Number(matchPersistResult?.notificationCount ?? notificationRows.length),
    discordDeliveryCount,
    discordDeliveryError,
    ...(responseState ? { state: responseState } : {}),
    ratingCommitted: Boolean(ratingCommitResult?.ok),
    ratingAlreadyCommitted: Boolean(ratingCommitResult?.alreadyCommitted),
    ratingAtomic: Boolean(shouldCommitRating && matchPersistResult?.ratingAtomic),
    confirmationAtomic: Boolean(recruitingPersistence && persistResult?.confirmationAtomic),
    ...(recruitingPersistResult ? { recruitingPersistResult } : {}),
    trustCommitted: Boolean(trustCommitResult?.ok && !trustCommitResult?.skipped),
    trustProfileCount: Number(trustCommitResult?.profileCount ?? 0),
  };
}
export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    if (hasPracticeMutationPayload(body)) {
      sendJson(response, 400, { error: PRACTICE_LOCAL_ONLY_ERROR });
      return;
    }
    const context = await getAuthenticatedContext(request);
    const operation = getOperation(body, body.action ? String(body.action) : "sync");
    if (!operation) reject(400, "match_operation_required");
    if (!isSupportedMatchAction(operation.action) && operation.action !== "createMatch") {
      reject(400, "unsupported_match_operation");
    }
    const { error: disciplineError } = await context.supabase.rpc("rankball_assert_match_actor_active", {
      p_actor_profile_id: context.profileId,
    });
    if (disciplineError) {
      if (isMissingSqlMatchReducer(disciplineError)) reject(503, "match_actor_guard_required");
      throw disciplineError;
    }
    let match = null;
    let notifications = [];
    let action = operation.action;
    let ratingCommit = null;
    let trustCommit = null;
    let tournament = null;
    let createdTournamentMatches = [];
    let tournamentNotifications = [];

    if (operation && shouldUseSqlMatchAction(operation) && (match || canUseSqlMatchActionWithoutSnapshot(operation))) {
      const sqlResult = await applySqlMatchAction(context, operation, match);
      if (sqlResult) {
        const syncedMatch = operation.action === "submitMatchThumbs"
          ? null
          : await loadSyncedMatchAfterWrite(
            context,
            sqlResult.matchId ?? operation.matchId ?? match?.id,
            match,
            { predicate: getSqlMatchReloadPredicate(operation) },
          );
        let discordDeliveryCount = Number(sqlResult.discordDeliveryCount ?? 0);
        let discordDeliveryError = sqlResult.discordDeliveryError ?? null;
        const shouldRefreshMatchDeliveries = MATCH_REFRESH_SCHEDULED_NOTICE_ACTIONS.has(operation.action) ||
          ["submitMatchResult", "approveMatch", "finalizeMatch", "resolveMatchDispute", "forfeitTournamentMatch"].includes(operation.action);
        if (shouldRefreshMatchDeliveries && syncedMatch?.id) {
          try {
            discordDeliveryCount += await withTimeout(
              queueMatchDiscordDeliveries(context.supabase, syncedMatch, operation.action),
              DISCORD_QUEUE_TIMEOUT_MS,
              "discord_match_delivery_timeout",
            );
          } catch (deliveryError) {
            discordDeliveryError = deliveryError.message || "discord_match_delivery_failed";
            console.error("Match Discord delivery queue failed.", deliveryError);
          }
        }
        const finalizedState = sqlResult.ratingAtomic
          ? await loadAuthoritativeState(context, { operation: { action: "approveMatch", matchId: sqlResult.matchId ?? operation.matchId } })
          : null;
        const nextTournamentMatches = finalizedState && syncedMatch?.tournamentId
          ? (finalizedState.matches ?? []).filter((item) => (
              item.tournamentId === syncedMatch.tournamentId &&
              Number(item.tournamentRound ?? 0) > Number(syncedMatch.tournamentRound ?? 0)
            ))
          : [];
        sendJson(response, 200, {
          ...sqlResult,
          ratingCommitted: Boolean(sqlResult.ratingCommitted || sqlResult.ratingAtomic),
          discordDeliveryCount,
          discordDeliveryError,
          ...(syncedMatch ? { match: syncedMatch } : {}),
          ...(finalizedState ? { state: finalizedState } : {}),
          ...(syncedMatch?.tournamentId ? {
            tournamentSynced: true,
            createdTournamentMatchCount: nextTournamentMatches.length,
          } : {}),
        });
        return;
      }
      reject(503, "match_sql_reducer_unavailable");
    }

    if (shouldReplayMatchOperation(operation, match)) {
      const state = await loadAuthoritativeState(context, { operation });
      const result = applyAuthoritativeMatchOperation(state, operation);
      match = result.match;
      notifications = result.notifications;
      action = operation.action;
      ratingCommit = result.ratingCommit;
      trustCommit = result.trustCommit;
      tournament = result.tournament;
      createdTournamentMatches = result.createdTournamentMatches ?? [];
      tournamentNotifications = result.tournamentNotifications ?? [];
    } else if (operation && match) {
      action = operation.action;
    }

    const result = await persistMatchSnapshot(context, { match, notifications, action, body, ratingCommit, trustCommit });
    const tournamentPersistResult = tournament
      ? await persistTournamentSnapshot(context, tournament, tournamentNotifications.filter((notification) => !notification.matchId))
      : null;
    let createdTournamentMatchCount = 0;
    for (const tournamentMatch of createdTournamentMatches) {
      await persistMatchSnapshot(context, {
        match: tournamentMatch,
        notifications: tournamentNotifications.filter((notification) => notification.matchId === tournamentMatch.id),
        action: "createTournamentMatch",
        body: {},
        trustedServerCreate: true,
      });
      createdTournamentMatchCount += 1;
    }
    const responseStateMatches = uniqueItemsById([
      ...(result.state?.matches ?? []),
      result.match,
      ...createdTournamentMatches,
    ]);
    const responseState = result.state || tournament || responseStateMatches.length
      ? {
          ...(result.state ?? {}),
          ...(responseStateMatches.length ? { matches: responseStateMatches } : {}),
          ...(tournament ? { tournaments: [tournament] } : {}),
        }
      : null;
    sendJson(response, 200, {
      ...result,
      ...(responseState ? { state: responseState } : {}),
      tournamentSynced: Boolean(tournamentPersistResult?.ok),
      createdTournamentMatchCount,
    });
  } catch (error) {
    console.error("Match sync failed.", error);
    const benchPolicyError = getMatchBenchPolicyError(error);
    const permissionDenied = error.code === "42501";
    const invalidRequest = error.code === "22023";
    const missingResource = error.code === "P0002";
    const operationConflict = ["23505", "23514", "40001"].includes(error.code)
      || error.message === "match_stale_snapshot";
    const statusCode = benchPolicyError?.statusCode
      ?? error.statusCode
      ?? (permissionDenied ? 403 : invalidRequest ? 400 : missingResource ? 404 : operationConflict ? 409 : 500);
    sendJson(response, statusCode, {
      error: benchPolicyError?.message ?? (permissionDenied ? "match_sync_permission_denied" : error.message || "match_sync_failed"),
      ...(permissionDenied ? { reason: error.message || "match_sync_permission_denied" } : {}),
    });
  }
}
