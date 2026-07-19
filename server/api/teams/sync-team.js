import { getAuthenticatedContext, readJsonBody, sendJson, toArray } from "../_supabaseAdmin.js";
import { loadCurrentProfileState, PROFILE_ME_COLUMNS } from "../profile/me.js";
import { isTeamInviteRole, MAX_TEAM_MEMBERS, MAX_TEAM_NAME_LENGTH, normalizeTeamRole } from "../../../src/lib/constants.js";

function uniqueMembers(members = []) {
  const seen = new Set();
  return toArray(members).map((member) => ({
    userId: String(member.userId || member.user_id || "").trim(),
    role: normalizeTeamRole(member.role),
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
  const { data: existingMembers, error: existingMembersError } = await context.supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", team.id);
  if (existingMembersError) throw existingMembersError;
  const existingMemberIds = new Set(toArray(existingMembers).map((member) => member.user_id));
  const isExistingTeam = existingMemberIds.size > 0;
  if (!isExistingTeam && (
    team.members.length !== 1
    || team.members[0].userId !== context.profileId
    || team.members[0].role !== "captain"
  )) {
    const error = new Error("team_initial_member_must_be_actor_captain");
    error.statusCode = 403;
    throw error;
  }
  if (isExistingTeam && team.members.some((member) => !existingMemberIds.has(member.userId))) {
    const error = new Error("team_member_invite_required");
    error.statusCode = 400;
    throw error;
  }
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

async function inviteTeamMember(context, body = {}) {
  const role = normalizeTeamRole(body.role, { allowCaptain: false });
  const { data, error } = await context.supabase.rpc("rankball_invite_team_member", {
    p_actor_profile_id: context.profileId,
    p_team_id: String(body.teamId || "").trim(),
    p_target_user_id: String(body.targetUserId || "").trim(),
    p_invitation_id: String(body.invitationId || "").trim() || null,
    p_role: isTeamInviteRole(role) ? role : "regular",
  });
  if (error) throw error;
  const result = data ?? { ok: true };
  const invitationId = result.invitationId || body.invitationId || "";
  if (invitationId) {
    const notificationId = `n_${invitationId}`;
    const { data: notification, error: notificationReadError } = await context.supabase
      .from("notifications")
      .select("id,payload")
      .eq("id", notificationId)
      .maybeSingle();
    if (notificationReadError) console.warn("Team invitation notification actor read failed.", notificationReadError.message);
    if (notification) {
      const { error: notificationUpdateError } = await context.supabase
        .from("notifications")
        .update({
          payload: { ...(notification.payload ?? {}), fromUserId: context.profileId },
          updated_at: new Date().toISOString(),
        })
        .eq("id", notificationId);
      if (notificationUpdateError) console.warn("Team invitation notification actor update failed.", notificationUpdateError.message);
    }
  }
  return result;
}

async function respondTeamInvitation(context, body = {}) {
  const { data, error } = await context.supabase.rpc("rankball_respond_team_invitation", {
    p_actor_profile_id: context.profileId,
    p_invitation_id: String(body.invitationId || "").trim(),
    p_action: String(body.teamInviteAction || "").trim(),
  });
  if (error) throw error;
  return data ?? { ok: true };
}

async function withCurrentProfileState(context, result = {}) {
  try {
    const profileResult = await loadCurrentProfileState(context);
    return {
      ...(result ?? { ok: true }),
      state: profileResult.state,
      updatedAt: profileResult.updatedAt,
    };
  } catch (error) {
    console.warn("Team sync profile reload failed.", error.message);
    return result ?? { ok: true };
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
    const context = await getAuthenticatedContext(request, { profileSelect: PROFILE_ME_COLUMNS });
    const teamInviteAction = String(body.teamInviteAction || "").trim();
    const result = teamInviteAction === "invite"
      ? await withCurrentProfileState(context, await inviteTeamMember(context, body))
      : ["accept", "decline", "cancel"].includes(teamInviteAction)
        ? await withCurrentProfileState(context, await respondTeamInvitation(context, body))
        : body.deletedTeamId
      ? await deleteTeam(context, body.deletedTeamId, body.notifications)
      : await syncTeam(context, body.team, body.notifications);
    sendJson(response, 200, result);
  } catch (error) {
    console.error("Team sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "team_sync_failed" });
  }
}
