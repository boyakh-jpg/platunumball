import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const MAX_TEAM_NAME_LENGTH = 14;
const MAX_TEAM_MEMBERSHIPS = 3;

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueMembers(members = []) {
  const seen = new Set();
  return toArray(members).map((member) => ({
    userId: String(member.userId || member.user_id || "").trim(),
    role: String(member.role || "regular").trim() || "regular",
  })).filter((member) => {
    if (!member.userId || seen.has(member.userId)) return false;
    seen.add(member.userId);
    return true;
  });
}

function normalizeTeam(team = {}, actorProfileId = "") {
  const name = String(team.name || "").trim().replace(/\s+/g, " ");
  const members = uniqueMembers(team.members);
  if (!team.id) {
    const error = new Error("missing_team_id");
    error.statusCode = 400;
    throw error;
  }
  if (!name || name.length > MAX_TEAM_NAME_LENGTH) {
    const error = new Error("invalid_team_name");
    error.statusCode = 400;
    throw error;
  }
  if (!members.some((member) => member.userId === actorProfileId && member.role === "captain")) {
    const error = new Error("team_captain_required");
    error.statusCode = 403;
    throw error;
  }
  if (!members.some((member) => member.role === "captain")) {
    members[0] = { ...members[0], role: "captain" };
  }
  return {
    id: String(team.id),
    name,
    region: team.region || null,
    homeCourt: team.homeCourt || team.home_court || null,
    mmr: Number(team.mmr ?? 1200),
    wins: Number(team.wins ?? 0),
    losses: Number(team.losses ?? 0),
    accent: team.accent || "#58d2c0",
    members,
  };
}

function toTeamRow(team = {}) {
  return {
    id: team.id,
    name: team.name,
    region: team.region,
    home_court: team.homeCourt,
    mmr: team.mmr,
    wins: team.wins,
    losses: team.losses,
    accent: team.accent,
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };
}

function withLockedCompetitiveFields(team = {}, existingTeam = null) {
  if (!existingTeam) return { ...team, mmr: 1200, wins: 0, losses: 0 };
  if (existingTeam.deleted_at) {
    const error = new Error("team_deleted");
    error.statusCode = 403;
    throw error;
  }
  return {
    ...team,
    mmr: Number(existingTeam.mmr ?? 1200),
    wins: Number(existingTeam.wins ?? 0),
    losses: Number(existingTeam.losses ?? 0),
  };
}

function toMemberRows(team = {}) {
  return team.members.map((member) => ({
    team_id: team.id,
    user_id: member.userId,
    role: member.role || "regular",
  }));
}

function toNotificationRows(notifications = [], profileId = "") {
  return toArray(notifications).map((notification) => {
    const targetUserId = notification.targetUserId || profileId;
    if (targetUserId !== profileId) return null;
    return {
      id: notification.id,
      user_id: profileId,
      target_user_id: targetUserId,
      title: notification.title || "팀 변경",
      body: notification.body || "",
      tone: notification.tone || "team",
      type: notification.type || "team",
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

async function getExistingCaptainIds(supabase, teamId) {
  const { data, error } = await supabase
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", teamId);
  if (error) throw error;
  return new Set((data ?? []).filter((member) => member.role === "captain").map((member) => member.user_id));
}

async function getExistingTeam(supabase, teamId) {
  const { data, error } = await supabase
    .from("teams")
    .select("id, mmr, wins, losses, deleted_at")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function assertMembersExist(supabase, memberIds = []) {
  if (!memberIds.length) return;
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .in("id", memberIds);
  if (error) throw error;
  const existingIds = new Set((data ?? []).map((profile) => profile.id));
  const missingId = memberIds.find((id) => !existingIds.has(id));
  if (missingId) {
    const error = new Error("team_member_profile_not_found");
    error.statusCode = 404;
    throw error;
  }
}

async function assertMembershipLimit(supabase, teamId, memberIds = []) {
  if (!memberIds.length) return;
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id, user_id")
    .in("user_id", memberIds);
  if (error) throw error;

  for (const userId of memberIds) {
    const otherTeamCount = new Set((data ?? [])
      .filter((member) => member.user_id === userId && member.team_id !== teamId)
      .map((member) => member.team_id)).size;
    if (otherTeamCount >= MAX_TEAM_MEMBERSHIPS) {
      const limitError = new Error("team_membership_limit_exceeded");
      limitError.statusCode = 400;
      throw limitError;
    }
  }
}

async function syncTeam(context, rawTeam, notifications = []) {
  const team = normalizeTeam(rawTeam, context.profileId);
  const existingTeam = await getExistingTeam(context.supabase, team.id);
  const existingCaptainIds = await getExistingCaptainIds(context.supabase, team.id);
  if (existingCaptainIds.size && !existingCaptainIds.has(context.profileId)) {
    const error = new Error("team_sync_permission_denied");
    error.statusCode = 403;
    throw error;
  }

  const memberIds = team.members.map((member) => member.userId);
  await assertMembersExist(context.supabase, memberIds);
  await assertMembershipLimit(context.supabase, team.id, memberIds);
  const safeTeam = withLockedCompetitiveFields(team, existingTeam);

  const { error: teamError } = await context.supabase
    .from("teams")
    .upsert(toTeamRow(safeTeam), { onConflict: "id" });
  if (teamError) throw teamError;

  const { error: deleteError } = await context.supabase
    .from("team_members")
    .delete()
    .eq("team_id", team.id);
  if (deleteError) throw deleteError;

  const memberRows = toMemberRows(team);
  if (memberRows.length) {
    const { error: memberError } = await context.supabase
      .from("team_members")
      .upsert(memberRows, { onConflict: "team_id,user_id" });
    if (memberError) throw memberError;
  }

  const notificationRows = toNotificationRows(notifications, context.profileId);
  if (notificationRows.length) {
    const { error: notificationError } = await context.supabase
      .from("notifications")
      .upsert(notificationRows, { onConflict: "id" });
    if (notificationError) throw notificationError;
  }

  return { ok: true, teamId: team.id, memberCount: memberRows.length, notificationCount: notificationRows.length };
}

async function deleteTeam(context, teamId, notifications = []) {
  const safeTeamId = String(teamId || "").trim();
  if (!safeTeamId) {
    const error = new Error("missing_team_id");
    error.statusCode = 400;
    throw error;
  }
  const existingCaptainIds = await getExistingCaptainIds(context.supabase, safeTeamId);
  if (!existingCaptainIds.has(context.profileId)) {
    const error = new Error("team_delete_permission_denied");
    error.statusCode = 403;
    throw error;
  }

  const deletedAt = new Date().toISOString();
  let response = await context.supabase.from("team_members").delete().eq("team_id", safeTeamId);
  if (response.error) throw response.error;

  response = await context.supabase.from("favorites").delete().eq("target_type", "team").eq("target_id", safeTeamId);
  if (response.error) throw response.error;

  response = await context.supabase.from("recruiting_posts").update({ status: "closed", updated_at: deletedAt }).eq("team_id", safeTeamId);
  if (response.error) throw response.error;

  response = await context.supabase.from("teams").update({ deleted_at: deletedAt, updated_at: deletedAt }).eq("id", safeTeamId);
  if (response.error) throw response.error;

  const notificationRows = toNotificationRows(notifications, context.profileId);
  if (notificationRows.length) {
    const { error: notificationError } = await context.supabase
      .from("notifications")
      .upsert(notificationRows, { onConflict: "id" });
    if (notificationError) throw notificationError;
  }

  return { ok: true, teamId: safeTeamId, deleted: true, notificationCount: notificationRows.length };
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
    const result = body.deletedTeamId
      ? await deleteTeam(context, body.deletedTeamId, body.notifications)
      : await syncTeam(context, body.team, body.notifications);
    sendJson(response, 200, result);
  } catch (error) {
    console.error("Team sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "team_sync_failed" });
  }
}
