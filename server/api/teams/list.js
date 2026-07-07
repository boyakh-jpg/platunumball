import {
  getAuthenticatedContext,
  getRowsMaxUpdatedAt as getMaxUpdatedAt,
  groupRowsBy as groupBy,
  isMissingTable,
  readJsonBody,
  sendJson,
  toClientTeamWithMembers as toClientTeam,
  timeStep,
  uniqueValues as unique,
} from "../_supabaseAdmin.js";
import {
  normalizeState,
} from "../../../src/data/repository.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../src/data/profileMappers.js";
import { fromRemoteTeamInvitation } from "../../../src/data/teamMappers.js";
import { DEFAULT_SETTINGS } from "../../../src/data/repositoryDefaults.js";
import {
  PROFILE_ME_COLUMNS,
  TEAM_COLUMNS,
  TEAM_INVITATION_COLUMNS,
  TEAM_MEMBER_COLUMNS,
} from "../../../src/data/repositoryColumns.js";

const PROFILE_TEAM_MEMBER_COLUMNS = "id,name,handle,hashtag,position,region,trust_score,avatar_color,ratings,age_group,age_group_checked_season,onboarding_complete,updated_at";

function fromTeamMemberProfile(row = {}) {
  const profile = fromRemoteProfile(row);
  return {
    id: profile.id,
    name: profile.name,
    handle: profile.handle,
    position: profile.position,
    region: profile.region,
    trustScore: profile.trustScore,
    avatarColor: profile.avatarColor,
    hashtag: profile.hashtag,
    ageGroup: profile.ageGroup,
    ageGroupCheckedSeason: profile.ageGroupCheckedSeason,
    onboardingComplete: profile.onboardingComplete,
    ratings: profile.ratings,
  };
}

async function loadTeamInvitations(supabase, profileId = "", teamId = "") {
  if (!profileId) return [];
  let query = supabase
    .from("team_invitations")
    .select(TEAM_INVITATION_COLUMNS)
    .or(`from_user_id.eq.${profileId},target_user_id.eq.${profileId}`)
    .order("created_at", { ascending: false });
  if (teamId) query = query.eq("team_id", teamId);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []).map(fromRemoteTeamInvitation);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const startedAt = Date.now();
    const body = await readJsonBody(request);
    const debugTiming = body.debugTiming === true ? {} : null;
    const teamId = String(body.teamId ?? body.id ?? "").trim();
    const requestUrl = new URL(request.url || "/", "https://rankball.local");
    const queryPath = Array.isArray(request.query?.path) ? request.query.path[0] : request.query?.path;
    const routePath = request.rankballRoutePath ?? queryPath ?? requestUrl.pathname;
    const isDetailRequest = String(routePath).replace(/^\/?api\/?/, "").replace(/^\/+|\/+$/g, "") === "teams/detail";
    if (isDetailRequest && !teamId) {
      sendJson(response, 400, { error: "team_id_required" });
      return;
    }
    const context = await timeStep(debugTiming, "authMs", () => getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS }));
    const profile = context.profile ?? null;
    const user = profile
      ? fromRemoteProfile(profile)
      : createProfileShell(context.authUserId, context.authUser?.email ?? "");

    let teamQuery = context.supabase
      .from("teams")
      .select(TEAM_COLUMNS)
      .is("deleted_at", null)
      .order("mmr", { ascending: false });
    if (teamId) teamQuery = teamQuery.eq("id", teamId);
    const teamInvitationsPromise = timeStep(debugTiming, "invitationsMs", () => loadTeamInvitations(context.supabase, user.id, teamId));
    const { data: teamRows, error: teamError } = await timeStep(debugTiming, "teamsMs", () => teamQuery);
    if (teamError) throw teamError;
    if (teamId && !(teamRows ?? []).length) {
      sendJson(response, 404, { error: "team_not_found", teamId });
      return;
    }

    const teamIds = unique((teamRows ?? []).map((team) => team.id));
    const { data: memberRowsRaw, error: memberError } = teamIds.length
      ? await timeStep(debugTiming, "membersMs", () => context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds))
      : { data: [], error: null };
    if (memberError) throw memberError;
    const teamIdSet = new Set(teamIds);
    const memberRows = (memberRowsRaw ?? []).filter((member) => teamIdSet.has(member.team_id));

    const teamInvitations = await teamInvitationsPromise;
    const invitationProfileIds = teamInvitations.flatMap((invitation) => [
      invitation.fromUserId,
      invitation.targetUserId,
    ]);
    const memberProfileIds = isDetailRequest ? (memberRows ?? []).map((member) => member.user_id) : [];
    const profileIds = unique([...memberProfileIds, ...invitationProfileIds]).filter((profileId) => profileId !== user.id);
    const { data: profileRows, error: profileError } = profileIds.length
      ? await timeStep(debugTiming, "profilesMs", () => context.supabase.from("profiles").select(PROFILE_TEAM_MEMBER_COLUMNS).in("id", profileIds))
      : { data: [], error: null };
    if (profileError) throw profileError;

    const membersByTeam = groupBy(memberRows ?? [], "team_id");
    const userById = new Map((profileRows ?? []).map((row) => {
      const item = fromTeamMemberProfile(row);
      return [item.id, item];
    }));
    userById.set(user.id, { ...userById.get(user.id), ...user });

    const state = normalizeState({
      currentUserId: user.id,
      users: [...userById.values()],
      teams: (teamRows ?? []).map((team) => toClientTeam(team, membersByTeam.get(team.id) ?? [])),
      teamInvitations,
      settings: {
        ...DEFAULT_SETTINGS,
        ...getRemoteAppSettings(profile),
      },
    }, { includeDemo: false });

    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        matches: [],
        recruitingPosts: [],
        tournaments: [],
      },
      updatedAt: Math.max(getMaxUpdatedAt(teamRows ?? []), getMaxUpdatedAt(memberRows ?? []), getMaxUpdatedAt(profileRows ?? [])),
      debugTiming: debugTiming ? { ...debugTiming, totalMs: Date.now() - startedAt } : undefined,
    });
  } catch (error) {
    console.warn("Teams list load failed.", error.message);
    sendJson(response, error.statusCode || 500, { error: "teams_list_failed" });
  }
}
