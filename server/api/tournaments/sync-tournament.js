import { getAuthenticatedContext, readJsonBody, sendJson, toArray, toNotificationRows } from "../_supabaseAdmin.js";
import {
  applyAuthoritativeTournamentOperation,
  getOperation,
  loadAuthoritativeState,
} from "../_authoritativeState.js";
import { persistMatchSnapshot } from "../matches/sync-match.js";

const FORMATS = new Set(["league", "tournament"]);
const VISIBILITIES = new Set(["private", "public"]);
const STATUSES = new Set(["draft", "scheduled", "active", "closed", "cancelled"]);
const MMR_LIMIT_MODES = new Set(["off", "warn", "block"]);
const MMR_POLICIES = new Set(["gap_adjusted", "standard", "event_only"]);
const TEAM_STATUSES = new Set(["invited", "accepted", "declined"]);

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

function sortPlainObject(value) {
  if (Array.isArray(value)) return value.map(sortPlainObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortPlainObject(value[key])]));
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
    maxMmrGap: Number(tournament.maxMmrGap ?? tournament.max_mmr_gap ?? 250),
    mmrPolicy: tournament.mmrPolicy ?? tournament.mmr_policy ?? "gap_adjusted",
    rules: tournament.rules ?? {},
    memo: tournament.memo ?? "",
    createdBy: tournament.createdBy ?? tournament.created_by ?? "",
    startedAt: tournament.startedAt ?? tournament.started_at ?? null,
    matchIds: toArray(tournament.matchIds ?? tournament.match_ids),
    bracket: tournament.bracket ?? {},
    teamIds,
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
    mode: tournament.mode || "5v5",
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    startDate: toDbDate(tournament.startDate || tournament.start_date),
    endDate: toDbDate(tournament.endDate || tournament.end_date || tournament.startDate || tournament.start_date),
    schedulePolicy: tournament.schedulePolicy || tournament.schedule_policy || "weekly",
    scheduleNote: tournament.scheduleNote || tournament.schedule_note || "",
    mmrLimitMode: pickAllowed(tournament.mmrLimitMode || tournament.mmr_limit_mode, MMR_LIMIT_MODES, "warn"),
    maxMmrGap: Number(tournament.maxMmrGap ?? tournament.max_mmr_gap ?? 250),
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
    id: tournament.id,
    title: tournament.title,
    format: tournament.format,
    visibility: tournament.visibility,
    status: tournament.status,
    region: tournament.region,
    court_id: tournament.courtId ?? null,
    court_name: tournament.court,
    mode: tournament.mode,
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

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request);
    const operation = getOperation(body, body.action ? String(body.action) : "sync");
    let tournament = null;
    let notifications = body.notifications ?? [];
    let createdMatches = [];
    let action = String(body.action || "sync");
    let teamId = String(body.teamId || "").trim();

    if (operation) {
      const state = await loadAuthoritativeState(context, { operation });
      const result = applyAuthoritativeTournamentOperation(state, operation);
      tournament = normalizeTournament(result.tournament, context.profileId);
      notifications = result.notifications;
      createdMatches = result.createdMatches;
      action = operation.action;
      teamId = String(operation.teamId || teamId || "").trim();
    } else {
      tournament = normalizeTournament(body.tournament, context.profileId);
    }
    if (action === "createTournament") validateTournamentCreateCourt(tournament);

    const { data: existingTournament, error: existingError } = await context.supabase
      .from("tournaments")
      .select("id, title, format, visibility, status, region, court_id, court_name, mode, ranked, official, start_date, end_date, schedule_policy, schedule_note, mmr_limit_mode, max_mmr_gap, mmr_policy, rules, memo, created_by, started_at, match_ids, bracket")
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

    for (const match of createdMatches) {
      await persistMatchSnapshot(context, { match, notifications: [], action: "createTournamentMatch", body: {}, trustedServerCreate: true });
    }

    sendJson(response, 200, {
      ok: true,
      tournamentId: tournament.id,
      teamCount: Number(persistResult?.teamCount ?? teamRows.length),
      notificationCount: Number(persistResult?.notificationCount ?? notificationRows.length),
      createdMatchCount: createdMatches.length,
    });
  } catch (error) {
    console.error("Tournament sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "tournament_sync_failed" });
  }
}
