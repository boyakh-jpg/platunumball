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

export const FORMATS = new Set(["league", "tournament"]);

export const VISIBILITIES = new Set(["private", "public"]);

export const STATUSES = new Set(["draft", "scheduled", "active", "closed", "cancelled"]);

export const MMR_LIMIT_MODES = new Set(MMR_LIMIT_MODE_IDS);

export const MMR_POLICIES = new Set(["gap_adjusted", "standard", "event_only"]);

export const TEAM_STATUSES = new Set(["invited", "accepted", "declined"]);

export function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function getSupportedTournamentMode(mode = "5v5") {
  const value = String(mode ?? "").trim() || "5v5";
  if (!isSupportedMatchMode(value)) reject(400, "unsupported_match_mode");
  return value;
}

export function pickAllowed(value, allowed, fallback) {
  const text = String(value || "").trim();
  return allowed.has(text) ? text : fallback;
}

export function toDbDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

export function getTeamIds(tournament = {}) {
  return Array.from(new Set(toArray(tournament.teamIds || tournament.team_ids).map((teamId) => String(teamId).trim()).filter(Boolean)));
}

export function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getTournamentCoreSnapshot(tournament = {}, teamRows = []) {
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

export function normalizeTournament(tournament = {}, actorProfileId = "") {
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

export function validateTournamentCreateCourt(tournament = {}) {
  if (String(tournament.courtId ?? tournament.court_id ?? "").trim()) return;
  const error = new Error("missing_tournament_court");
  error.statusCode = 400;
  throw error;
}

export function toTournamentRow(tournament = {}) {
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

export function toTournamentTeamRows(tournament = {}) {
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

export async function assertTeamsExist(supabase, teamIds = []) {
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

export async function persistTournamentCourtId(supabase, tournament = {}) {
  const courtId = String(tournament.courtId ?? tournament.court_id ?? "").trim();
  if (!courtId) return;
  const { error } = await supabase
    .from("tournaments")
    .update({ court_id: courtId })
    .eq("id", tournament.id);
  if (error) throw error;
}

export async function isTeamCaptain(supabase, teamId, profileId) {
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

export function getTournamentScopedState(state = {}, tournament = null) {
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
