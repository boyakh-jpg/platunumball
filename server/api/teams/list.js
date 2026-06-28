import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  DEFAULT_SETTINGS,
  createProfileShell,
  fromRemoteProfile,
  fromRemoteTeamInvitation,
  getRemoteAppSettings,
  normalizeState,
} from "../../../src/data/repository.js";

const PROFILE_ME_COLUMNS = "id,name,handle,hashtag,position,region,region_sido,region_district,school,company,club,trust_score,streak,avatar_color,test_login_id,auth_user_id,birth_year,age_group,age_group_checked_season,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,discord_connection,discord_user_id,ratings,created_at,updated_at,app_settings";
const PROFILE_TEAM_MEMBER_COLUMNS = "id,name,handle,hashtag,position,region,trust_score,avatar_color,ratings,age_group,age_group_checked_season,onboarding_complete,updated_at";
const TEAM_COLUMNS = "id,name,home_court,region,mmr,wins,losses,accent,deleted_at,updated_at";
const TEAM_MEMBER_COLUMNS = "team_id,user_id,role";
const TEAM_INVITATION_COLUMNS = "id,team_id,from_user_id,target_user_id,role,status,created_at,updated_at";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function isMissingTable(error = {}) {
  return ["42P01", "PGRST205"].includes(error?.code);
}

function getMaxUpdatedAt(rows = []) {
  return rows.reduce((max, row) => {
    const time = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
    return Number.isFinite(time) ? Math.max(max, time) : max;
  }, 0);
}

function groupBy(rows = [], key = "id") {
  return rows.reduce((map, row) => {
    const value = row?.[key];
    if (!value) return map;
    const list = map.get(value) ?? [];
    list.push(row);
    map.set(value, list);
    return map;
  }, new Map());
}

function toClientTeam(team = {}, memberRows = []) {
  return {
    id: team.id,
    name: team.name,
    homeCourt: team.home_court,
    region: team.region,
    mmr: team.mmr ?? 1200,
    wins: team.wins ?? 0,
    losses: team.losses ?? 0,
    accent: team.accent,
    members: [...memberRows]
      .sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.user_id).localeCompare(String(b.user_id)))
      .map((member) => ({ userId: member.user_id, role: member.role ?? "regular" })),
  };
}

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
    const body = await readJsonBody(request);
    const teamId = String(body.teamId ?? body.id ?? "").trim();
    const requestUrl = new URL(request.url || "/", "https://rankball.local");
    const queryPath = Array.isArray(request.query?.path) ? request.query.path[0] : request.query?.path;
    const routePath = request.rankballRoutePath ?? queryPath ?? requestUrl.pathname;
    const isDetailRequest = String(routePath).replace(/^\/?api\/?/, "").replace(/^\/+|\/+$/g, "") === "teams/detail";
    if (isDetailRequest && !teamId) {
      sendJson(response, 400, { error: "team_id_required" });
      return;
    }
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
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
    const { data: teamRows, error: teamError } = await teamQuery;
    if (teamError) throw teamError;
    if (teamId && !(teamRows ?? []).length) {
      sendJson(response, 404, { error: "team_not_found", teamId });
      return;
    }

    const teamIds = unique((teamRows ?? []).map((team) => team.id));
    const { data: memberRows, error: memberError } = teamIds.length
      ? await context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds)
      : { data: [], error: null };
    if (memberError) throw memberError;

    const profileIds = unique([user.id, ...(memberRows ?? []).map((member) => member.user_id)]);
    const { data: profileRows, error: profileError } = profileIds.length
      ? await context.supabase.from("public_profiles").select(PROFILE_TEAM_MEMBER_COLUMNS).in("id", profileIds)
      : { data: [], error: null };
    if (profileError) throw profileError;

    const teamInvitations = await loadTeamInvitations(context.supabase, user.id, teamId);
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
    });
  } catch (error) {
    console.warn("Teams list load failed.", error.message);
    sendJson(response, error.statusCode || 500, { error: "teams_list_failed" });
  }
}
