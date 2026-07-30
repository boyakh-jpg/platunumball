import { MATCH_SYNC_DEPENDENCIES } from "./matchSyncDependencies.js";
import { REFEREE_ACTIVE_TRUST_MIN, TEST_REFEREE_LOGIN_IDS } from "../../shared/lib/constants.js";

const TEST_REFEREE_LOGIN_ID_SET = new Set(TEST_REFEREE_LOGIN_IDS);

export const {

  DEFAULT_TOURNAMENT_MMR_GAP, MATCH_SIDES, PLAYER_STAT_FIELDS, RECORD_TYPES, getMatchPlayedIdMap, getParticipantIds, isRefereeGrade,

  projectTournamentDbIdentity, sortPlainObject, toArray, toNotificationRows, uniqueIds,

} = MATCH_SYNC_DEPENDENCIES;

export function toFiniteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

export function toTournamentRow(tournament = {}) {
  return {
    ...projectTournamentDbIdentity(tournament, {
      courtId: tournament.courtId ?? tournament.court_id ?? null,
      courtName: tournament.court ?? tournament.courtName ?? tournament.court_name ?? null,
    }),
    ranked: tournament.ranked !== false,
    official: Boolean(tournament.official),
    start_date: tournament.startDate || tournament.start_date || null,
    end_date: tournament.endDate || tournament.end_date || null,
    schedule_policy: tournament.schedulePolicy ?? tournament.schedule_policy ?? "weekly",
    schedule_note: tournament.scheduleNote ?? tournament.schedule_note ?? "",
    mmr_limit_mode: tournament.mmrLimitMode ?? tournament.mmr_limit_mode ?? "warn",
    max_mmr_gap: Number(tournament.maxMmrGap ?? tournament.max_mmr_gap ?? DEFAULT_TOURNAMENT_MMR_GAP),
    mmr_policy: tournament.mmrPolicy ?? tournament.mmr_policy ?? "gap_adjusted",
    rules: tournament.rules ?? {},
    memo: tournament.memo ?? "",
    created_by: tournament.createdBy ?? tournament.created_by ?? null,
    created_at: tournament.createdAt ?? tournament.created_at ?? new Date().toISOString(),
    started_at: tournament.startedAt ?? tournament.started_at ?? null,
    match_ids: toArray(tournament.matchIds ?? tournament.match_ids),
    team_statuses: tournament.teamStatuses ?? tournament.team_statuses ?? {},
    team_approvals: tournament.teamApprovals ?? tournament.team_approvals ?? {},
    bracket: tournament.bracket ?? {},
    updated_at: new Date().toISOString(),
  };
}

export function toTournamentTeamRows(tournament = {}) {
  return toArray(tournament.teamIds ?? tournament.team_ids).map((teamId, index) => {
    const approval = tournament.teamApprovals?.[teamId] ?? {};
    return {
      tournament_id: tournament.id,
      team_id: teamId,
      seed_order: index + 1,
      status: tournament.teamStatuses?.[teamId] ?? "invited",
      approved_by: approval.by || approval.approvedBy || null,
      approved_at: approval.approvedAt || approval.approved_at || null,
    };
  });
}

export async function persistTournamentSnapshot(context, tournament = {}, notifications = []) {
  if (!tournament?.id) return null;
  const notificationRows = toNotificationRows(notifications, context.profileId, {
    defaultTitle: "대회 변경",
    defaultTone: "match",
    defaultType: "tournament",
    filterToProfile: true,
  });
  const { data, error } = await context.supabase.rpc("rankball_persist_tournament_snapshot_locked", {
    p_tournament_row: toTournamentRow(tournament),
    p_team_rows: toTournamentTeamRows(tournament),
    p_notification_rows: notificationRows,
  });
  if (error) throw error;
  return data ?? { ok: true };
}

export function normalizePlayerStats(stats = {}) {
  return Object.fromEntries(Object.entries(stats ?? {})
    .filter(([userId]) => Boolean(userId))
    .map(([userId, stat]) => [
      userId,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field, toFiniteNumber(stat?.[field])])),
    ]));
}

export function normalizeStatRows(rows = []) {
  return Object.fromEntries(toArray(rows)
    .filter((row) => Boolean(row.user_id))
    .map((row) => [
      row.user_id,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field, toFiniteNumber(row[field])])),
    ]));
}

export function normalizeResultSnapshot(result = null, statRows = []) {
  if (!result) return null;
  return sortPlainObject({
    scoreA: toFiniteNumber(result.score_a ?? result.scoreA),
    scoreB: toFiniteNumber(result.score_b ?? result.scoreB),
    playerStats: result.playerStats ? normalizePlayerStats(result.playerStats) : normalizeStatRows(statRows),
  });
}

export async function isActiveReferee(supabase, userId, _minTrust = 90) {
  if (!userId) return false;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("trust_score, test_login_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (
    Number(profile?.trust_score ?? 0) < REFEREE_ACTIVE_TRUST_MIN
    && !TEST_REFEREE_LOGIN_ID_SET.has(String(profile?.test_login_id ?? "").toLowerCase())
  ) return false;

  const { data, error } = await supabase
    .from("referee_appointments")
    .select("id, role, grade, status, starts_at, ends_at")
    .eq("user_id", userId)
    .eq("role", "referee")
    .eq("status", "active");
  if (error) throw error;

  const now = Date.now();
  return toArray(data).some((row) => {
    const startsAt = row.starts_at ? Date.parse(row.starts_at) : 0;
    const endsAt = row.ends_at ? Date.parse(row.ends_at) : 0;
    return isRefereeGrade(row.grade) && (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
  });
}
