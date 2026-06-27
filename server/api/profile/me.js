import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  DEFAULT_SETTINGS,
  createProfileShell,
  fromRemoteProfile,
  getRemoteAppSettings,
  normalizeState,
} from "../../../src/data/repository.js";

const PROFILE_ME_COLUMNS = "id,name,handle,hashtag,position,region,region_sido,region_district,school,company,club,trust_score,streak,avatar_color,test_login_id,auth_user_id,birth_year,age_group,age_group_checked_season,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,discord_connection,discord_user_id,ratings,created_at,updated_at,app_settings";
const PROFILE_TEAM_MEMBER_COLUMNS = "id,name,handle,hashtag,position,trust_score,avatar_color,ratings,age_group,age_group_checked_season,onboarding_complete,test_login_id,updated_at";
const TEAM_COLUMNS = "id,name,home_court,region,mmr,wins,losses,accent,deleted_at";
const TEAM_MEMBER_COLUMNS = "team_id,user_id,role";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
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

async function loadCurrentUserTeams(supabase, profileId = "") {
  if (!profileId) return { teams: [], users: [] };
  const { data: ownMemberships, error: ownMembershipsError } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", profileId);
  if (ownMembershipsError) throw ownMembershipsError;

  const teamIds = unique((ownMemberships ?? []).map((row) => row.team_id));
  if (!teamIds.length) return { teams: [], users: [] };

  const [{ data: teamRows, error: teamError }, { data: memberRows, error: memberError }] = await Promise.all([
    supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null),
    supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds),
  ]);
  if (teamError) throw teamError;
  if (memberError) throw memberError;

  const memberProfileIds = unique((memberRows ?? []).map((row) => row.user_id)).filter((userId) => userId !== profileId);
  const { data: profileRows, error: profileError } = memberProfileIds.length
    ? await supabase.from("public_profiles").select(PROFILE_TEAM_MEMBER_COLUMNS).in("id", memberProfileIds)
    : { data: [], error: null };
  if (profileError) throw profileError;

  const membersByTeam = new Map();
  (memberRows ?? []).forEach((row) => {
    const rows = membersByTeam.get(row.team_id) ?? [];
    rows.push(row);
    membersByTeam.set(row.team_id, rows);
  });

  return {
    teams: (teamRows ?? []).map((team) => toClientTeam(team, membersByTeam.get(team.id) ?? [])),
    users: (profileRows ?? []).map(fromRemoteProfile),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
    const profile = context.profile ?? null;
    const user = profile
      ? fromRemoteProfile(profile)
      : createProfileShell(context.authUserId, context.authUser?.email ?? "");
    const currentUserTeams = await loadCurrentUserTeams(context.supabase, profile?.id ?? "");
    const userById = new Map(currentUserTeams.users.map((item) => [item.id, item]));
    userById.set(user.id, user);
    const settings = {
      ...DEFAULT_SETTINGS,
      ...getRemoteAppSettings(profile),
    };
    const state = normalizeState({
      currentUserId: user.id,
      users: [...userById.values()],
      teams: currentUserTeams.teams,
      settings,
    }, { includeDemo: false });

    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        matches: [],
        recruitingPosts: [],
        tournaments: [],
      },
      updatedAt: profile?.updated_at ? new Date(profile.updated_at).getTime() : 0,
      debug: body.debug === true ? { profileId: profile?.id ?? user.id } : undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "profile_me_failed" });
  }
}
