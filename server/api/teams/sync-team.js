import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const MAX_TEAM_NAME_LENGTH = 14;
const MAX_TEAM_MEMBERS = 10;

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
  if (members.length > MAX_TEAM_MEMBERS) {
    const error = new Error("team_members_limit_exceeded");
    error.statusCode = 400;
    throw error;
  }
  return {
    id: String(team.id),
    name,
    region: team.region || null,
    homeCourt: team.homeCourt || team.home_court || null,
    accent: team.accent || "#58d2c0",
    members,
  };
}

async function syncTeam(context, rawTeam, notifications = []) {
  const team = normalizeTeam(rawTeam, context.profileId);
  const { data, error } = await context.supabase.rpc("rankball_sync_team_membership", {
    p_actor_profile_id: context.profileId,
    p_team: team,
    p_notifications: toArray(notifications),
  });
  if (error) throw error;
  return data ?? { ok: true, teamId: team.id };
}

async function deleteTeam(context, teamId, notifications = []) {
  const safeTeamId = String(teamId || "").trim();
  if (!safeTeamId) {
    const error = new Error("missing_team_id");
    error.statusCode = 400;
    throw error;
  }

  const { data, error } = await context.supabase.rpc("rankball_delete_team", {
    p_actor_profile_id: context.profileId,
    p_team_id: safeTeamId,
    p_notifications: toArray(notifications),
  });
  if (error) throw error;
  return data ?? { ok: true, teamId: safeTeamId, deleted: true };
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
