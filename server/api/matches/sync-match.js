import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

const PLAYER_STAT_FIELDS = ["points", "rebounds", "assists", "steals", "blocks", "fouls"];

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function toDbTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function getTimestamp(item = {}) {
  return item.updatedAt ?? item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? new Date().toISOString();
}

function getSidePlayerRows(match = {}) {
  return [
    ...(match.teamA?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: match.teamA.teamId ?? null,
      user_id: userId,
      side: "teamA",
      slot_order: index,
    })),
    ...(match.teamB?.players ?? []).map((userId, index) => ({
      match_id: match.id,
      team_id: match.teamB.teamId ?? null,
      user_id: userId,
      side: "teamB",
      slot_order: index,
    })),
  ].filter((row) => row.user_id);
}

function getParticipantIds(match = {}) {
  return new Set([
    match.createdBy,
    match.refereeId,
    match.formerRefereeId,
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...Object.values(match.reservePlayers ?? match.rules?.reservePlayers ?? {}).flatMap(toArray),
    ...Object.values(match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {}).flatMap(toArray),
    ...Object.values(match.attendance ?? {}).flatMap(toArray),
  ].filter(Boolean));
}

function getModeCapacity(mode = "5v5") {
  const match = String(mode).match(/^(\d+)/);
  const value = match ? Number(match[1]) : 5;
  return Math.max(1, Math.min(5, Number.isFinite(value) ? value : 5));
}

function getMatchPlayerIds(match = {}) {
  return [
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
  ].filter(Boolean);
}

function getMatchReserveIds(match = {}) {
  return Object.values(match.reservePlayers ?? match.rules?.reservePlayers ?? {}).flatMap(toArray);
}

function getMatchPlayedIds(match = {}) {
  return Object.values(match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {}).flatMap(toArray);
}

function validateMatchShape(match = {}) {
  const capacity = getModeCapacity(match.mode);
  if ((match.teamA?.players ?? []).filter(Boolean).length > capacity) reject(400, "team_a_exceeds_mode_capacity");
  if ((match.teamB?.players ?? []).filter(Boolean).length > capacity) reject(400, "team_b_exceeds_mode_capacity");

  const allPlayerIds = [...getMatchPlayerIds(match), ...getMatchReserveIds(match)];
  const duplicate = allPlayerIds.find((playerId, index) => allPlayerIds.indexOf(playerId) !== index);
  if (duplicate) reject(400, "duplicate_match_player");
  if (match.refereeId && allPlayerIds.includes(match.refereeId)) reject(400, "referee_cannot_be_player");
}

function validateResultShape(match = {}, action = "sync") {
  if (action !== "submitMatchResult" || !match.result) return;

  const scoreA = toFiniteNumber(match.result.scoreA, -1);
  const scoreB = toFiniteNumber(match.result.scoreB, -1);
  if (scoreA < 0 || scoreA > 999 || scoreB < 0 || scoreB > 999) reject(400, "invalid_match_score");

  const recordableIds = new Set([
    ...getMatchPlayerIds(match),
    ...getMatchReserveIds(match),
    ...getMatchPlayedIds(match),
  ].filter(Boolean));
  const invalidPlayerId = Object.keys(match.result.playerStats ?? {}).find((userId) => !recordableIds.has(userId));
  if (invalidPlayerId) reject(400, "stat_player_not_in_match");

  const invalidStat = Object.values(match.result.playerStats ?? {}).some((stat) => (
    PLAYER_STAT_FIELDS.some((field) => {
      const value = toFiniteNumber(stat?.[field], -1);
      return value < 0 || value > 999;
    })
  ));
  if (invalidStat) reject(400, "invalid_player_stat");
}

function toMatchRow(match = {}, actorProfileId = "") {
  const statRecorders = match.statRecorders ?? match.rules?.statRecorders ?? {};
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const mmrExcludedPlayerIds = match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? [];
  return {
    id: match.id,
    title: match.title ?? "경기",
    mode: match.mode ?? "5v5",
    court_id: match.courtId ?? null,
    court_name: match.court ?? match.courtName ?? "미정",
    status: match.status ?? "contract",
    ranked: match.ranked !== false,
    mmr_limit_mode: match.mmrLimitMode ?? "block",
    trust_feedback: match.trustFeedback ?? {},
    referee_id: match.refereeId || null,
    former_referee_id: match.formerRefereeId || null,
    referee_trust_min: Number(match.refereeTrustMin ?? 90),
    stat_entry_minutes: Number(match.statEntryMinutes ?? 60),
    dispute_minutes: Number(match.disputeMinutes ?? 120),
    stat_recorders: statRecorders,
    played_player_ids: playedPlayerIds,
    reserve_players: match.reservePlayers ?? match.rules?.reservePlayers ?? {},
    promoted_reserve_ids: match.promotedReserveIds ?? {},
    attendance: match.attendance ?? { teamA: [], teamB: [] },
    referee_absence_request: match.refereeAbsenceRequest ?? null,
    dispute_draft_result: match.disputeDraftResult ?? null,
    dispute_draft_updated_at: match.disputeDraftUpdatedAt ?? null,
    dispute_resolved_at: match.disputeResolvedAt ?? null,
    mmr_excluded_player_ids: mmrExcludedPlayerIds,
    anonymous_players: match.anonymousPlayers ?? {},
    tournament_id: match.tournamentId ?? null,
    tournament_format: match.tournamentFormat ?? null,
    tournament_round: match.tournamentRound ?? null,
    tournament_fixture: match.tournamentFixture ?? null,
    tournament_mmr_policy: match.tournamentMmrPolicy ?? null,
    official: Boolean(match.official),
    pre_registered: Boolean(match.preRegistered),
    scheduled_at: match.scheduledAt && !["일정 미정", "즉시"].includes(match.scheduledAt) ? match.scheduledAt : null,
    scheduled_date: match.scheduledDate || null,
    scheduled_time: toDbTime(match.scheduledTime),
    team_a_id: match.teamA?.teamId ?? null,
    team_b_id: match.teamB?.teamId ?? null,
    score_a: Number(match.result?.scoreA ?? match.teamA?.score ?? 0),
    score_b: Number(match.result?.scoreB ?? match.teamB?.score ?? 0),
    rules: {
      ...(match.rules ?? {}),
      timingType: match.timingType ?? match.rules?.timingType ?? "scheduled",
      statRecorders,
      playedPlayerIds,
      mmrExcludedPlayerIds,
    },
    memo: match.memo ?? "",
    stakes: match.stakes ?? "",
    objection_window: match.objectionWindow ?? null,
    evidence: match.evidence ?? [],
    created_by: match.createdBy ?? match.teamA?.players?.[0] ?? actorProfileId,
    created_at: match.createdAt ?? new Date().toISOString(),
    agreed_at: match.agreedAt ?? null,
    started_at: match.startedAt ?? null,
    ended_at: match.endedAt ?? null,
    confirmed_at: match.confirmedAt ?? null,
    cancelled_at: match.cancelledAt ?? null,
    voided_at: match.voidedAt ?? null,
    rating_result: match.ratingResult ?? null,
    team_rating_result: match.teamRatingResult ?? null,
    updated_at: new Date().toISOString(),
  };
}

function toResultRow(match = {}, actorProfileId = "") {
  if (!match.result) return null;
  return {
    match_id: match.id,
    submitted_by: match.result.submittedBy ?? match.refereeId ?? match.teamA?.players?.[0] ?? actorProfileId,
    score_a: Number(match.result.scoreA ?? match.teamA?.score ?? 0),
    score_b: Number(match.result.scoreB ?? match.teamB?.score ?? 0),
    stat_submissions: match.result.statSubmissions ?? {},
    submitted_at: match.result.submittedAt ?? new Date().toISOString(),
  };
}

function toStatRows(match = {}) {
  return Object.entries(match.result?.playerStats ?? {}).map(([userId, stat]) => ({
    match_id: match.id,
    user_id: userId,
    recorded_by: match.result?.statSubmissions?.[userId]?.by ?? null,
    record_source: match.result?.statSubmissions?.[userId]?.source ?? "player",
    points: Number(stat.points ?? 0),
    rebounds: Number(stat.rebounds ?? 0),
    assists: Number(stat.assists ?? 0),
    steals: Number(stat.steals ?? 0),
    blocks: Number(stat.blocks ?? 0),
    fouls: Number(stat.fouls ?? 0),
    updated_at: new Date().toISOString(),
  }));
}

function toAgreementRows(match = {}) {
  return [
    ...(match.agreements?.teamA ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamA" })),
    ...(match.agreements?.teamB ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamB" })),
  ];
}

function toApprovalRows(match = {}) {
  return [
    ...(match.approvals?.teamA ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamA" })),
    ...(match.approvals?.teamB ?? []).map((userId) => ({ match_id: match.id, user_id: userId, side: "teamB" })),
  ];
}

function toDisputeRows(match = {}) {
  return toArray(match.disputes).map((dispute) => ({
    id: dispute.id,
    match_id: match.id,
    user_id: dispute.by ?? dispute.userId,
    reason: dispute.reason ?? "",
    created_at: dispute.createdAt ?? new Date().toISOString(),
  })).filter((row) => row.id && row.user_id);
}

function toNotificationRows(notifications = [], fallbackProfileId = "") {
  return toArray(notifications).map((notification) => ({
    id: notification.id,
    user_id: notification.targetUserId ?? fallbackProfileId,
    target_user_id: notification.targetUserId ?? null,
    title: notification.title ?? "알림",
    body: notification.body ?? "",
    tone: notification.tone ?? "match",
    type: notification.type ?? null,
    match_id: notification.matchId ?? null,
    recruiting_post_id: notification.recruitingPostId ?? null,
    invitation_id: notification.invitationId ?? null,
    discord_event: notification.discordEvent ?? notification.eventType ?? null,
    read_at: notification.readAt ?? null,
    payload: notification,
    created_at: notification.createdAt ?? new Date().toISOString(),
    updated_at: getTimestamp(notification),
  })).filter((row) => row.id);
}

function existingParticipantIds(existingMatch, existingPlayers = []) {
  return new Set([
    existingMatch?.created_by,
    existingMatch?.referee_id,
    existingMatch?.former_referee_id,
    ...(existingPlayers ?? []).map((player) => player.user_id),
  ].filter(Boolean));
}

function getExistingSidePlayerIds(existingPlayers = [], side) {
  return toArray(existingPlayers)
    .filter((player) => player.side === side)
    .sort((a, b) => Number(a.slot_order ?? 0) - Number(b.slot_order ?? 0))
    .map((player) => player.user_id)
    .filter(Boolean);
}

function sameOrderedIds(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function sortPlainObject(value) {
  if (Array.isArray(value)) return value.map(sortPlainObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortPlainObject(value[key])]));
}

function normalizePlayerStats(stats = {}) {
  return Object.fromEntries(Object.entries(stats ?? {})
    .filter(([userId]) => Boolean(userId))
    .map(([userId, stat]) => [
      userId,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field, toFiniteNumber(stat?.[field])])),
    ]));
}

function normalizeStatRows(rows = []) {
  return Object.fromEntries(toArray(rows)
    .filter((row) => Boolean(row.user_id))
    .map((row) => [
      row.user_id,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field, toFiniteNumber(row[field])])),
    ]));
}

function normalizeResultSnapshot(result = null, statRows = []) {
  if (!result) return null;
  return sortPlainObject({
    scoreA: toFiniteNumber(result.score_a ?? result.scoreA),
    scoreB: toFiniteNumber(result.score_b ?? result.scoreB),
    playerStats: result.playerStats ? normalizePlayerStats(result.playerStats) : normalizeStatRows(statRows),
  });
}

function getStatRecorderIds(match = {}) {
  const recorders = match.statRecorders ?? match.rules?.statRecorders ?? {};
  return Object.values(recorders).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean);
}

async function isActiveReferee(supabase, userId, minTrust = 90) {
  if (!userId) return false;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("trust_score")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (Number(profile?.trust_score ?? 0) < Number(minTrust ?? 90)) return false;

  const { data, error } = await supabase
    .from("referee_appointments")
    .select("id, role, status, starts_at, ends_at")
    .eq("user_id", userId)
    .eq("role", "referee")
    .eq("status", "active");
  if (error) throw error;

  const now = Date.now();
  return toArray(data).some((row) => {
    const startsAt = row.starts_at ? Date.parse(row.starts_at) : 0;
    const endsAt = row.ends_at ? Date.parse(row.ends_at) : 0;
    return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
  });
}

function isMatchOperator(profileId, existingMatch, nextMatch) {
  return Boolean(profileId && [
    existingMatch?.created_by,
    existingMatch?.referee_id,
    nextMatch?.createdBy,
    nextMatch?.refereeId,
  ].filter(Boolean).includes(profileId));
}

const CREATE_MATCH_ACTIONS = new Set([
  "createMatch",
  "confirmRecruitingMatch",
  "createTournamentMatch",
]);

const OPERATOR_MATCH_ACTIONS = new Set([
  "updateTournamentMatchSchedule",
  "handoffMatchRecorder",
  "checkInMatchPlayer",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "cancelMatch",
  "voidMatch",
  "resumeMatchApproval",
  "startMatch",
  "endMatch",
  "addMatchLatePlayer",
  "removeMatchLatePlayer",
  "updateMatchRoomRules",
  "setMatchRoomPlayerPlacement",
  "removeMatchRoomPlayer",
]);

const PARTICIPANT_MATCH_ACTIONS = new Set([
  "agreeMatch",
  "approveMatch",
  "toggleMatchStar",
  "submitMatchThumbs",
  "disputeMatch",
]);

const REFEREE_ELIGIBILITY_ACTIONS = new Set([
  "createMatch",
  "confirmRecruitingMatch",
  "createTournamentMatch",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

const ROSTER_LOCKED_MATCH_ACTIONS = new Set([
  ...PARTICIPANT_MATCH_ACTIONS,
  "checkInMatchPlayer",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

const REFEREE_LOCKED_MATCH_ACTIONS = new Set([
  ...PARTICIPANT_MATCH_ACTIONS,
  "checkInMatchPlayer",
  "requestMatchRefereeAbsence",
  "startMatch",
  "endMatch",
  "submitMatchResult",
]);

function canSubmitResult(profileId, existingMatch, nextMatch) {
  const refereeId = nextMatch.refereeId || existingMatch?.referee_id;
  if (refereeId) return profileId === refereeId;
  const recorderIds = getStatRecorderIds(nextMatch);
  if (recorderIds.length) return recorderIds.includes(profileId) || isMatchOperator(profileId, existingMatch, nextMatch);
  return isMatchOperator(profileId, existingMatch, nextMatch) || getParticipantIds(nextMatch).has(profileId);
}

function canSyncMatchAction(profileId, existingMatch, existingPlayers, nextMatch, action) {
  if (!profileId || !nextMatch?.id) return false;
  const nextParticipants = getParticipantIds(nextMatch);
  if (!existingMatch) return CREATE_MATCH_ACTIONS.has(action) && nextParticipants.has(profileId);
  const existingParticipants = existingParticipantIds(existingMatch, existingPlayers);
  if (OPERATOR_MATCH_ACTIONS.has(action)) return isMatchOperator(profileId, existingMatch, nextMatch);
  if (action === "submitMatchResult") return canSubmitResult(profileId, existingMatch, nextMatch);
  if (PARTICIPANT_MATCH_ACTIONS.has(action)) return existingParticipants.has(profileId) || nextParticipants.has(profileId);
  return existingParticipants.has(profileId) || nextParticipants.has(profileId);
}

async function validateRefereeEligibility(supabase, existingMatch, nextMatch, action) {
  const refereeId = nextMatch.refereeId || existingMatch?.referee_id;
  if (!refereeId) return;

  const refereeChanged = refereeId !== existingMatch?.referee_id;
  if (!refereeChanged && !REFEREE_ELIGIBILITY_ACTIONS.has(action)) return;

  const minTrust = Number(nextMatch.refereeTrustMin ?? existingMatch?.referee_trust_min ?? 90);
  if (!(await isActiveReferee(supabase, refereeId, minTrust))) reject(403, "referee_not_eligible");
}

function validateLockedMatchCore(existingMatch, existingPlayers, nextMatch, action) {
  if (!existingMatch) return;

  if (ROSTER_LOCKED_MATCH_ACTIONS.has(action)) {
    const existingTeamA = getExistingSidePlayerIds(existingPlayers, "teamA");
    const existingTeamB = getExistingSidePlayerIds(existingPlayers, "teamB");
    const nextTeamA = toArray(nextMatch.teamA?.players);
    const nextTeamB = toArray(nextMatch.teamB?.players);
    if (!sameOrderedIds(existingTeamA, nextTeamA) || !sameOrderedIds(existingTeamB, nextTeamB)) {
      reject(403, "match_roster_locked");
    }
  }

  if (REFEREE_LOCKED_MATCH_ACTIONS.has(action)) {
    const existingRefereeId = existingMatch.referee_id || "";
    const nextRefereeId = nextMatch.refereeId || "";
    if (existingRefereeId !== nextRefereeId) reject(403, "match_referee_locked");
  }
}

function validateParticipantResultUnchanged(action, existingResult, existingStats, nextMatch) {
  if (!PARTICIPANT_MATCH_ACTIONS.has(action)) return;
  const existingSnapshot = normalizeResultSnapshot(existingResult, existingStats);
  const nextSnapshot = normalizeResultSnapshot(nextMatch.result);
  if (!existingSnapshot && !nextSnapshot) return;
  if (JSON.stringify(existingSnapshot) !== JSON.stringify(nextSnapshot)) {
    reject(403, "participant_cannot_change_result");
  }
}

async function deleteMatchChildren(supabase, table, matchId) {
  const { error } = await supabase.from(table).delete().eq("match_id", matchId);
  if (error) throw error;
}

async function upsertRows(supabase, table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const match = body.match && typeof body.match === "object" ? body.match : null;
    const action = body.action ? String(body.action) : "sync";
    if (!match?.id) {
      sendJson(response, 400, { error: "missing_match" });
      return;
    }
    validateMatchShape(match);
    validateResultShape(match, action);

    const context = await getAuthenticatedContext(request);
    const { data: existingMatch, error: existingError } = await context.supabase
      .from("matches")
      .select("id, created_by, referee_id, former_referee_id, referee_trust_min, stat_recorders")
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
      .select("user_id, points, rebounds, assists, steals, blocks, fouls")
      .eq("match_id", match.id);
    if (statError) throw statError;

    if (!canSyncMatchAction(context.profileId, existingMatch, existingPlayers, match, action)) {
      sendJson(response, 403, { error: "match_sync_permission_denied" });
      return;
    }
    validateLockedMatchCore(existingMatch, existingPlayers, match, action);
    validateParticipantResultUnchanged(action, existingResult, existingStats, match);
    await validateRefereeEligibility(context.supabase, existingMatch, match, action);

    const matchRow = toMatchRow(match, context.profileId);
    const playerRows = getSidePlayerRows(match);
    const resultRow = toResultRow(match, context.profileId);
    const statRows = toStatRows(match);
    const agreementRows = toAgreementRows(match);
    const approvalRows = toApprovalRows(match);
    const disputeRows = toDisputeRows(match);
    const notificationRows = toNotificationRows(body.notifications, context.profileId);

    const { error: matchError } = await context.supabase.from("matches").upsert(matchRow, { onConflict: "id" });
    if (matchError) throw matchError;

    await deleteMatchChildren(context.supabase, "match_players", match.id);
    await deleteMatchChildren(context.supabase, "player_match_stats", match.id);
    await deleteMatchChildren(context.supabase, "match_agreements", match.id);
    await deleteMatchChildren(context.supabase, "match_approvals", match.id);
    await deleteMatchChildren(context.supabase, "match_disputes", match.id);
    await deleteMatchChildren(context.supabase, "match_results", match.id);

    await upsertRows(context.supabase, "match_players", playerRows, "match_id,user_id");
    if (resultRow) await upsertRows(context.supabase, "match_results", [resultRow], "match_id");
    await upsertRows(context.supabase, "player_match_stats", statRows, "match_id,user_id");
    await upsertRows(context.supabase, "match_agreements", agreementRows, "match_id,user_id");
    await upsertRows(context.supabase, "match_approvals", approvalRows, "match_id,user_id");
    await upsertRows(context.supabase, "match_disputes", disputeRows, "id");
    await upsertRows(context.supabase, "notifications", notificationRows, "id");

    sendJson(response, 200, {
      ok: true,
      matchId: match.id,
      playerCount: playerRows.length,
      statCount: statRows.length,
      notificationCount: notificationRows.length,
    });
  } catch (error) {
    console.error("Match sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "match_sync_failed" });
  }
}
