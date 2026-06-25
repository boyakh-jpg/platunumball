import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const FORMATS = new Set(["league", "tournament"]);
const VISIBILITIES = new Set(["private", "public"]);
const STATUSES = new Set(["draft", "scheduled", "active", "closed", "cancelled"]);
const MMR_LIMIT_MODES = new Set(["off", "warn", "block"]);
const MMR_POLICIES = new Set(["gap_adjusted", "standard", "event_only"]);
const TEAM_STATUSES = new Set(["invited", "accepted", "declined"]);

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
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

function toTournamentRow(tournament = {}) {
  return {
    id: tournament.id,
    title: tournament.title,
    format: tournament.format,
    visibility: tournament.visibility,
    status: tournament.status,
    region: tournament.region,
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

function toNotificationRows(notifications = [], profileId = "") {
  return toArray(notifications).map((notification) => {
    const targetUserId = notification.targetUserId || profileId;
    if (targetUserId !== profileId) return null;
    return {
      id: notification.id,
      user_id: profileId,
      target_user_id: targetUserId,
      title: notification.title || "대회 변경",
      body: notification.body || "",
      tone: notification.tone || "match",
      type: notification.type || "tournament",
      match_id: notification.matchId || null,
      recruiting_post_id: notification.recruitingPostId || null,
      invitation_id: notification.invitationId || null,
      discord_event: notification.discordEvent || notification.eventType || null,
      read_at: notification.readAt || null,
      payload: notification,
      created_at: notification.createdAt || new Date().toISOString(),
      updated_at: notification.updatedAt || notification.createdAt || new Date().toISOString(),
    };
  }).filter((row) => row?.id);
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

  if (action === "approveTeam" && tournament.teamIds.includes(teamId) && await isTeamCaptain(context.supabase, teamId, context.profileId)) {
    return;
  }

  const error = new Error("tournament_sync_permission_denied");
  error.statusCode = 403;
  throw error;
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
    const tournament = normalizeTournament(body.tournament, context.profileId);
    const action = String(body.action || "sync");
    const teamId = String(body.teamId || "").trim();

    const { data: existingTournament, error: existingError } = await context.supabase
      .from("tournaments")
      .select("id, created_by")
      .eq("id", tournament.id)
      .maybeSingle();
    if (existingError) throw existingError;

    await assertCanSyncTournament(context, existingTournament, tournament, action, teamId);
    await assertTeamsExist(context.supabase, tournament.teamIds);

    const { error: tournamentError } = await context.supabase
      .from("tournaments")
      .upsert(toTournamentRow(tournament), { onConflict: "id" });
    if (tournamentError) throw tournamentError;

    const { error: deleteError } = await context.supabase
      .from("tournament_teams")
      .delete()
      .eq("tournament_id", tournament.id);
    if (deleteError) throw deleteError;

    const teamRows = toTournamentTeamRows(tournament);
    if (teamRows.length) {
      const { error: teamError } = await context.supabase
        .from("tournament_teams")
        .upsert(teamRows, { onConflict: "tournament_id,team_id" });
      if (teamError) throw teamError;
    }

    const notificationRows = toNotificationRows(body.notifications, context.profileId);
    if (notificationRows.length) {
      const { error: notificationError } = await context.supabase
        .from("notifications")
        .upsert(notificationRows, { onConflict: "id" });
      if (notificationError) throw notificationError;
    }

    sendJson(response, 200, {
      ok: true,
      tournamentId: tournament.id,
      teamCount: teamRows.length,
      notificationCount: notificationRows.length,
    });
  } catch (error) {
    console.error("Tournament sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "tournament_sync_failed" });
  }
}
