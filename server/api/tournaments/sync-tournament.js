import { randomUUID } from "node:crypto";
import { allowRequestMethod, getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson, toArray, toNotificationRows } from "../_supabaseAdmin.js";
import {
  getOperation,
  loadAuthoritativeState,
} from "../_authoritativeState.js";
import { persistMatchSnapshot } from "../matches/sync-match.js";
import { isSupportedMatchMode } from "../../../shared/lib/matchConstants.js";
import { DEFAULT_TOURNAMENT_MMR_GAP, MMR_LIMIT_MODES as MMR_LIMIT_MODE_IDS } from "../../../shared/lib/constants.js";
import { sortPlainObject } from "../../../shared/lib/plainObject.js";
import { projectTournamentDbIdentity } from "../../lib/tournamentPersistence.js";
import { FORMATS, VISIBILITIES, STATUSES, MMR_LIMIT_MODES, MMR_POLICIES, TEAM_STATUSES, reject, getSupportedTournamentMode, pickAllowed, toDbDate, getTeamIds, sameJson, getTournamentCoreSnapshot, normalizeTournament, validateTournamentCreateCourt, toTournamentRow, toTournamentTeamRows, assertTeamsExist, persistTournamentCourtId, isTeamCaptain, getTournamentScopedState } from "./syncTournamentModel.js";
export { getSupportedTournamentMode } from "./syncTournamentModel.js";








const TOURNAMENT_OPERATION_ACTIONS = new Set([
  "createTournament",
  "approveTournamentTeam",
  "approveTournamentReferee",
  "declineTournamentReferee",
  "inviteTournamentReferee",
  "approveTournamentRegion",
  "rejectTournamentRegion",
  "startCommunityTournament",
  "assignTournamentMatchReferee",
  "loadTournament",
]);





function withTournamentCreateId(operation = null) {
  if (!operation || operation.action !== "createTournament") return operation;
  if (operation.preferredTournamentId || operation.tournamentId || operation.draft?.id) return operation;
  return {
    ...operation,
    preferredTournamentId: `trn_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
  };
}



























function toTournamentListMatch(match = {}) {
  const { teamRosterSnapshot: _teamRosterSnapshot, ...rules } = match.rules ?? {};
  return {
    ...match,
    rules,
    tournamentListOnly: true,
  };
}

async function assertCanLoadTournament(context, tournamentId) {
  const { data: tournament, error: tournamentError } = await context.supabase
    .from("tournaments")
    .select("id, created_by, visibility, referee_ids")
    .eq("id", tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament?.id) reject(404, "tournament_not_found");
  if (
    tournament.created_by === context.profileId
    || tournament.visibility === "public"
    || toArray(tournament.referee_ids).includes(context.profileId)
    || (await getAdminLevel(context)) >= 60
  ) return;

  const { data: teamRows, error: teamError } = await context.supabase
    .from("tournament_teams")
    .select("team_id")
    .eq("tournament_id", tournamentId);
  if (teamError) throw teamError;
  const teamIds = toArray(teamRows).map((row) => row.team_id).filter(Boolean);
  if (!teamIds.length) reject(403, "tournament_read_permission_denied");

  const { data: memberships, error: membershipError } = await context.supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", context.profileId)
    .in("team_id", teamIds)
    .limit(1);
  if (membershipError) throw membershipError;
  if (!memberships?.length) reject(403, "tournament_read_permission_denied");
}

async function loadTournamentOperation(context, operation = {}) {
  const tournamentId = String(operation.tournamentId ?? "").trim();
  if (!tournamentId) reject(400, "missing_tournament_id");
  await assertCanLoadTournament(context, tournamentId);
  const state = await loadAuthoritativeState(context, {
    operation: { action: "loadTournament", tournamentId },
  });
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId) ?? null;
  if (!tournament) reject(404, "tournament_not_found");
  const adminLevel = await getAdminLevel(context);
  const scopedState = getTournamentScopedState(state, {
    ...tournament,
    viewerCanReviewRegion: adminLevel >= 60,
  });
  const listMatches = scopedState.matches.map(toTournamentListMatch);
  return {
    ok: true,
    tournamentId,
    createdMatchCount: listMatches.length,
    state: { ...scopedState, matches: listMatches },
  };
}

async function assertCanSyncTournament(context, existingTournament, tournament, action, teamId) {
  if (!existingTournament) {
    if (tournament.createdBy !== context.profileId) {
      const error = new Error("tournament_creator_required");
      error.statusCode = 403;
      throw error;
    }
    return;
  }

  if (existingTournament.created_by === context.profileId) return;

  if (["approveTeam", "approveTournamentTeam"].includes(action) && tournament.teamIds.includes(teamId) && await isTeamCaptain(context.supabase, teamId, context.profileId)) {
    return;
  }

  const error = new Error("tournament_sync_permission_denied");
  error.statusCode = 403;
  throw error;
}

function getExistingTeamStatusMap(teamRows = []) {
  return Object.fromEntries(toArray(teamRows).map((row) => [row.team_id, row.status ?? "invited"]));
}

function validateTeamApprovalScope(context, existingTournament, existingTeamRows, tournament, action, teamId) {
  if (!existingTournament || existingTournament.created_by === context.profileId || action !== "approveTeam") return;

  const existingCore = getTournamentCoreSnapshot(existingTournament, existingTeamRows);
  const nextCore = getTournamentCoreSnapshot(tournament);
  if (!sameJson(existingCore, nextCore)) {
    const error = new Error("tournament_core_locked");
    error.statusCode = 403;
    throw error;
  }

  const existingStatuses = getExistingTeamStatusMap(existingTeamRows);
  const nextStatuses = tournament.teamStatuses ?? {};
  for (const existingTeamId of Object.keys(existingStatuses)) {
    const expectedStatus = existingTeamId === teamId ? "accepted" : existingStatuses[existingTeamId];
    if ((nextStatuses[existingTeamId] ?? "invited") !== expectedStatus) {
      const error = new Error("tournament_team_status_locked");
      error.statusCode = 403;
      throw error;
    }
  }

  if ((tournament.teamApprovals?.[teamId]?.by ?? tournament.teamApprovals?.[teamId]?.approvedBy) !== context.profileId) {
    const error = new Error("tournament_team_approval_required");
    error.statusCode = 403;
    throw error;
  }
}

function isMissingTournamentOperationRpc(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST202" || message.includes("rankball_tournament_operation_action");
}

function getInitialTournamentFixtures(format, teamCount) {
  if (teamCount < 2) return [];
  if (format === "league") {
    return Array.from({ length: (teamCount * (teamCount - 1)) / 2 }, (_, index) => index + 1);
  }

  let bracketSize = 2;
  while (bracketSize < teamCount) bracketSize *= 2;
  const matchCount = bracketSize / 2;
  const byeCount = bracketSize - teamCount;
  const byeFixtures = new Set();
  let leftIndex = 0;
  let rightIndex = matchCount - 1;
  while (byeFixtures.size < byeCount && leftIndex <= rightIndex) {
    byeFixtures.add(leftIndex + 1);
    if (byeFixtures.size < byeCount && rightIndex !== leftIndex) byeFixtures.add(rightIndex + 1);
    leftIndex += 1;
    rightIndex -= 1;
  }
  return Array.from({ length: matchCount }, (_, index) => index + 1).filter((fixture) => !byeFixtures.has(fixture));
}

async function assertPreferredMatchIdsAssignable(context, operation = {}) {
  if (!["approveTournamentRegion", "startCommunityTournament"].includes(operation.action)) return;

  const preferredMatchIds = toArray(operation.preferredMatchIds ?? operation.draft?.preferredMatchIds)
    .map((matchId) => String(matchId ?? "").trim());
  if (!preferredMatchIds.some(Boolean)) return;

  const tournamentId = String(operation.preferredTournamentId ?? operation.tournamentId ?? operation.draft?.id ?? "").trim();
  if (!tournamentId) reject(400, "missing_tournament_id");

  const { data: tournament, error: tournamentError } = await context.supabase
    .from("tournaments")
    .select("id, format")
    .eq("id", tournamentId)
    .maybeSingle();
  if (tournamentError) throw tournamentError;
  if (!tournament) reject(404, "tournament_not_found");

  const { data: teamRows, error: teamError } = await context.supabase
    .from("tournament_teams")
    .select("team_id, status, seed_order")
    .eq("tournament_id", tournamentId)
    .order("seed_order", { ascending: true });
  if (teamError) throw teamError;

  const activeTeams = toArray(teamRows).filter((row) => row.status !== "declined");
  const allAccepted = activeTeams.length >= 2
    && activeTeams.every((row) => row.status === "accepted");
  if (!allAccepted) return;

  const fixtures = getInitialTournamentFixtures(tournament.format, activeTeams.length);
  const effectiveMatchIds = preferredMatchIds.slice(0, fixtures.length);
  const nonEmptyIds = effectiveMatchIds.filter(Boolean);
  if (new Set(nonEmptyIds).size !== nonEmptyIds.length) {
    reject(409, "tournament_preferred_match_id_conflict");
  }
  if (!nonEmptyIds.length) return;

  const { data: existingMatches, error: matchError } = await context.supabase
    .from("matches")
    .select("id, tournament_id, tournament_round, tournament_fixture")
    .in("id", nonEmptyIds);
  if (matchError) throw matchError;

  const fixtureByMatchId = new Map(
    effectiveMatchIds.map((matchId, index) => [matchId, fixtures[index]]).filter(([matchId]) => Boolean(matchId)),
  );
  const conflict = toArray(existingMatches).some((match) => (
    match.tournament_id !== tournamentId
    || Number(match.tournament_round) !== 1
    || Number(match.tournament_fixture) !== Number(fixtureByMatchId.get(match.id))
  ));
  if (conflict) reject(409, "tournament_preferred_match_id_conflict");
}

async function applySqlTournamentOperation(context, operation = {}) {
  if (operation.action === "createTournament") {
    getSupportedTournamentMode(operation.draft?.mode);
  }
  await assertPreferredMatchIdsAssignable(context, operation);
  const { data, error } = await context.supabase.rpc("rankball_tournament_operation_action", {
    p_actor_profile_id: context.profileId,
    p_operation: operation,
  });
  if (error) {
    if (isMissingTournamentOperationRpc(error)) return null;
    throw error;
  }

  const tournamentId = String(data?.tournamentId ?? operation.tournamentId ?? operation.preferredTournamentId ?? operation.draft?.id ?? "").trim();
  const state = await loadAuthoritativeState(context, {
    operation: { action: "loadTournament", tournamentId },
  });
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId) ?? null;
  const adminLevel = await getAdminLevel(context);
  const scopedTournament = tournament ? {
    ...tournament,
    viewerCanReviewRegion: adminLevel >= 60,
  } : null;
  const scopedState = getTournamentScopedState(state, scopedTournament);
  const createdMatchIds = new Set(toArray(data?.createdMatches).map((item) => item?.id).filter(Boolean));
  const createdMatches = scopedState.matches.filter((match) => createdMatchIds.has(match.id));
  return {
    ok: true,
    ...data,
    tournamentId,
    tournament: scopedTournament,
    createdMatches,
    createdMatchCount: createdMatches.length,
    state: scopedState,
  };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request);
    const operation = withTournamentCreateId(getOperation(body, body.action ? String(body.action) : "sync"));
    if (!operation) reject(400, "tournament_operation_required");
    if (!TOURNAMENT_OPERATION_ACTIONS.has(operation.action)) reject(400, "unsupported_tournament_operation");
    if (operation.action === "loadTournament") {
      sendJson(response, 200, await loadTournamentOperation(context, operation));
      return;
    }
    let tournament = null;
    let notifications = body.notifications ?? [];
    let createdMatches = [];
    let action = String(body.action || "sync");
    let teamId = String(body.teamId || "").trim();

    if (operation) {
      const sqlResult = await applySqlTournamentOperation(context, operation);
      if (sqlResult) {
        sendJson(response, 200, sqlResult);
        return;
      }
      const error = new Error("tournament_operation_rpc_missing");
      error.statusCode = 503;
      throw error;
    } else {
      tournament = normalizeTournament(body.tournament, context.profileId);
    }
    if (action === "createTournament") validateTournamentCreateCourt(tournament);

    const { data: existingTournament, error: existingError } = await context.supabase
      .from("tournaments")
      .select("id, title, format, visibility, status, region, court_id, court_name, mode, ranked, official, start_date, end_date, schedule_policy, schedule_note, mmr_limit_mode, max_mmr_gap, mmr_policy, rules, memo, created_by, started_at, match_ids, bracket, referee_ids, referee_statuses, referee_approvals, sanction_status, sanction_reviewed_by, sanction_reviewed_at, sanction_review_note")
      .eq("id", tournament.id)
      .maybeSingle();
    if (existingError) throw existingError;

    const { data: existingTeamRows, error: existingTeamError } = await context.supabase
      .from("tournament_teams")
      .select("team_id, status, seed_order")
      .eq("tournament_id", tournament.id);
    if (existingTeamError) throw existingTeamError;

    await assertCanSyncTournament(context, existingTournament, tournament, action, teamId);
    if (!operation) validateTeamApprovalScope(context, existingTournament, existingTeamRows, tournament, action, teamId);
    await assertTeamsExist(context.supabase, tournament.teamIds);

    const teamRows = toTournamentTeamRows(tournament);
    const notificationRows = toNotificationRows(notifications, context.profileId, {
      defaultTitle: "대회 변경",
      defaultTone: "match",
      defaultType: "tournament",
      filterToProfile: true,
    });
    const { data: persistResult, error: persistError } = await context.supabase.rpc("rankball_persist_tournament_snapshot_locked", {
      p_tournament_row: toTournamentRow(tournament),
      p_team_rows: teamRows,
      p_notification_rows: notificationRows,
    });
    if (persistError) throw persistError;
    await persistTournamentCourtId(context.supabase, tournament);

    const persistedCreatedMatches = [];
    for (const match of createdMatches) {
      const matchResult = await persistMatchSnapshot(context, { match, notifications: [], action: "createTournamentMatch", body: {}, trustedServerCreate: true });
      if (matchResult?.match) persistedCreatedMatches.push(matchResult.match);
    }

    sendJson(response, 200, {
      ok: true,
      tournamentId: tournament.id,
      tournament,
      createdMatches: persistedCreatedMatches.length ? persistedCreatedMatches : createdMatches,
      teamCount: Number(persistResult?.teamCount ?? teamRows.length),
      notificationCount: Number(persistResult?.notificationCount ?? notificationRows.length),
      createdMatchCount: createdMatches.length,
    });
  } catch (error) {
    console.error("Tournament sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "tournament_sync_failed" });
  }
}
