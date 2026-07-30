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

const FORMATS = new Set(["league", "tournament"]);
const VISIBILITIES = new Set(["private", "public"]);
const STATUSES = new Set(["draft", "scheduled", "active", "closed", "cancelled"]);
const MMR_LIMIT_MODES = new Set(MMR_LIMIT_MODE_IDS);
const MMR_POLICIES = new Set(["gap_adjusted", "standard", "event_only"]);
const TEAM_STATUSES = new Set(["invited", "accepted", "declined"]);
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

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function getSupportedTournamentMode(mode = "5v5") {
  const value = String(mode ?? "").trim() || "5v5";
  if (!isSupportedMatchMode(value)) reject(400, "unsupported_match_mode");
  return value;
}

function withTournamentCreateId(operation = null) {
  if (!operation || operation.action !== "createTournament") return operation;
  if (operation.preferredTournamentId || operation.tournamentId || operation.draft?.id) return operation;
  return {
    ...operation,
    preferredTournamentId: `trn_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
  };
}

function pickAllowed(value, allowed, fallback) {
  const text = String(value || "").trim();
  return allowed.has(text) ? text : fallback;
}

function toDbDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

function getTeamIds(tournament = {}) {
  return Array.from(new Set(toArray(tournament.teamIds || tournament.team_ids).map((teamId) => String(teamId).trim()).filter(Boolean)));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getTournamentCoreSnapshot(tournament = {}, teamRows = []) {
  const teamIds = teamRows.length
    ? [...teamRows]
        .sort((a, b) => Number(a.seed_order ?? 0) - Number(b.seed_order ?? 0))
        .map((row) => row.team_id)
    : getTeamIds(tournament);
  return sortPlainObject({
    title: tournament.title,
    format: tournament.format,
    visibility: tournament.visibility,
    status: tournament.status,
    region: tournament.region ?? null,
    courtId: tournament.courtId ?? tournament.court_id ?? null,
    court: tournament.court ?? tournament.courtName ?? tournament.court_name ?? null,
    mode: tournament.mode,
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    startDate: toDbDate(tournament.startDate ?? tournament.start_date),
    endDate: toDbDate(tournament.endDate ?? tournament.end_date),
    schedulePolicy: tournament.schedulePolicy ?? tournament.schedule_policy ?? "weekly",
    scheduleNote: tournament.scheduleNote ?? tournament.schedule_note ?? "",
    mmrLimitMode: tournament.mmrLimitMode ?? tournament.mmr_limit_mode ?? "warn",
    maxMmrGap: Number(tournament.maxMmrGap ?? tournament.max_mmr_gap ?? DEFAULT_TOURNAMENT_MMR_GAP),
    mmrPolicy: tournament.mmrPolicy ?? tournament.mmr_policy ?? "gap_adjusted",
    rules: tournament.rules ?? {},
    memo: tournament.memo ?? "",
    createdBy: tournament.createdBy ?? tournament.created_by ?? "",
    startedAt: tournament.startedAt ?? tournament.started_at ?? null,
    matchIds: toArray(tournament.matchIds ?? tournament.match_ids),
    bracket: tournament.bracket ?? {},
    teamIds,
    refereeIds: toArray(tournament.refereeIds ?? tournament.referee_ids),
    refereeStatuses: tournament.refereeStatuses ?? tournament.referee_statuses ?? {},
    refereeApprovals: tournament.refereeApprovals ?? tournament.referee_approvals ?? {},
    sanctionStatus: tournament.sanctionStatus ?? tournament.sanction_status ?? "pending",
  });
}

function normalizeTournament(tournament = {}, actorProfileId = "") {
  const id = String(tournament.id || "").trim();
  const title = String(tournament.title || "").trim();
  if (!id) {
    const error = new Error("missing_tournament_id");
    error.statusCode = 400;
    throw error;
  }
  if (!title) {
    const error = new Error("missing_tournament_title");
    error.statusCode = 400;
    throw error;
  }
  const teamIds = getTeamIds(tournament);
  if (teamIds.length < 2) {
    const error = new Error("tournament_requires_two_teams");
    error.statusCode = 400;
    throw error;
  }

  return {
    id,
    title,
    format: pickAllowed(tournament.format, FORMATS, "league"),
    visibility: pickAllowed(tournament.visibility, VISIBILITIES, "private"),
    status: pickAllowed(tournament.status, STATUSES, "draft"),
    region: tournament.region || null,
    courtId: tournament.courtId || tournament.court_id || tournament.approvedCourtId || tournament.registeredCourtId || null,
    court: tournament.court || tournament.courtName || tournament.court_name || null,
    mode: getSupportedTournamentMode(tournament.mode),
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    startDate: toDbDate(tournament.startDate || tournament.start_date),
    endDate: toDbDate(tournament.endDate || tournament.end_date || tournament.startDate || tournament.start_date),
    schedulePolicy: tournament.schedulePolicy || tournament.schedule_policy || "weekly",
    scheduleNote: tournament.scheduleNote || tournament.schedule_note || "",
    mmrLimitMode: pickAllowed(tournament.mmrLimitMode || tournament.mmr_limit_mode, MMR_LIMIT_MODES, "warn"),
    maxMmrGap: Number(tournament.maxMmrGap ?? tournament.max_mmr_gap ?? DEFAULT_TOURNAMENT_MMR_GAP),
    mmrPolicy: pickAllowed(tournament.mmrPolicy || tournament.mmr_policy, MMR_POLICIES, "gap_adjusted"),
    rules: tournament.rules && typeof tournament.rules === "object" ? tournament.rules : {},
    memo: tournament.memo || "",
    createdBy: tournament.createdBy || tournament.created_by || actorProfileId,
    createdAt: tournament.createdAt || tournament.created_at || new Date().toISOString(),
    startedAt: tournament.startedAt || tournament.started_at || null,
    matchIds: toArray(tournament.matchIds || tournament.match_ids),
    teamIds,
    teamStatuses: tournament.teamStatuses || tournament.team_statuses || {},
    teamApprovals: tournament.teamApprovals || tournament.team_approvals || {},
    refereeIds: toArray(tournament.refereeIds || tournament.referee_ids),
    refereeStatuses: tournament.refereeStatuses || tournament.referee_statuses || {},
    refereeApprovals: tournament.refereeApprovals || tournament.referee_approvals || {},
    sanctionStatus: tournament.sanctionStatus || tournament.sanction_status || "pending",
    sanctionReviewedBy: tournament.sanctionReviewedBy || tournament.sanction_reviewed_by || null,
    sanctionReviewedAt: tournament.sanctionReviewedAt || tournament.sanction_reviewed_at || null,
    sanctionReviewNote: tournament.sanctionReviewNote || tournament.sanction_review_note || "",
    bracket: tournament.bracket || {},
  };
}

function validateTournamentCreateCourt(tournament = {}) {
  if (String(tournament.courtId ?? tournament.court_id ?? "").trim()) return;
  const error = new Error("missing_tournament_court");
  error.statusCode = 400;
  throw error;
}

function toTournamentRow(tournament = {}) {
  return {
    ...projectTournamentDbIdentity(tournament, {
      courtId: tournament.courtId ?? null,
    }),
    ranked: tournament.ranked,
    official: tournament.official,
    start_date: tournament.startDate,
    end_date: tournament.endDate,
    schedule_policy: tournament.schedulePolicy,
    schedule_note: tournament.scheduleNote,
    mmr_limit_mode: tournament.mmrLimitMode,
    max_mmr_gap: tournament.maxMmrGap,
    mmr_policy: tournament.mmrPolicy,
    rules: tournament.rules,
    memo: tournament.memo,
    created_by: tournament.createdBy,
    created_at: tournament.createdAt,
    started_at: tournament.startedAt,
    match_ids: tournament.matchIds,
    team_statuses: tournament.teamStatuses,
    team_approvals: tournament.teamApprovals,
    referee_ids: tournament.refereeIds,
    referee_statuses: tournament.refereeStatuses,
    referee_approvals: tournament.refereeApprovals,
    sanction_status: tournament.sanctionStatus,
    sanction_reviewed_by: tournament.sanctionReviewedBy,
    sanction_reviewed_at: tournament.sanctionReviewedAt,
    sanction_review_note: tournament.sanctionReviewNote,
    bracket: tournament.bracket || {},
    updated_at: new Date().toISOString(),
  };
}

function toTournamentTeamRows(tournament = {}) {
  return tournament.teamIds.map((teamId, index) => {
    const approval = tournament.teamApprovals?.[teamId] || {};
    return {
      tournament_id: tournament.id,
      team_id: teamId,
      seed_order: index + 1,
      status: pickAllowed(tournament.teamStatuses?.[teamId], TEAM_STATUSES, "invited"),
      approved_by: approval.by || approval.approvedBy || null,
      approved_at: approval.approvedAt || approval.approved_at || null,
    };
  });
}

async function assertTeamsExist(supabase, teamIds = []) {
  const { data, error } = await supabase
    .from("teams")
    .select("id")
    .in("id", teamIds)
    .is("deleted_at", null);
  if (error) throw error;
  const existingIds = new Set((data ?? []).map((team) => team.id));
  const missingId = teamIds.find((teamId) => !existingIds.has(teamId));
  if (missingId) {
    const missingError = new Error("tournament_team_not_found");
    missingError.statusCode = 404;
    throw missingError;
  }
}

async function persistTournamentCourtId(supabase, tournament = {}) {
  const courtId = String(tournament.courtId ?? tournament.court_id ?? "").trim();
  if (!courtId) return;
  const { error } = await supabase
    .from("tournaments")
    .update({ court_id: courtId })
    .eq("id", tournament.id);
  if (error) throw error;
}

async function isTeamCaptain(supabase, teamId, profileId) {
  const { data, error } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .eq("user_id", profileId)
    .eq("role", "captain")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.user_id);
}

function getTournamentScopedState(state = {}, tournament = null) {
  if (!tournament?.id) return { ...state, users: [], teams: [], matches: [], tournaments: [] };
  const teamIds = new Set(getTeamIds(tournament));
  const teams = (state.teams ?? []).filter((team) => teamIds.has(team.id));
  const userIds = new Set([
    state.currentUserId,
    tournament.createdBy,
    tournament.sanctionReviewedBy,
    ...(tournament.refereeIds ?? []),
    ...teams.flatMap((team) => toArray(team.members).map((member) => member.userId)),
  ].filter(Boolean));
  const matches = (state.matches ?? []).filter((match) => match.tournamentId === tournament.id);
  return {
    ...state,
    users: (state.users ?? []).filter((user) => userIds.has(user.id)),
    teams,
    matches,
    recruitingPosts: [],
    tournaments: [tournament],
    notifications: [],
    discordNotificationDeliveries: [],
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
