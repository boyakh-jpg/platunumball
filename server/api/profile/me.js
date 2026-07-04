import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  DEFAULT_SETTINGS,
  createProfileShell,
  fromRemoteTeamInvitation,
  fromRemoteProfile,
  getRemoteAppSettings,
  normalizeState,
} from "../../../src/data/repository.js";

export const PROFILE_ME_COLUMNS = "id,name,handle,hashtag,position,region,region_sido,region_district,school,company,club,trust_score,streak,avatar_color,test_login_id,auth_user_id,birth_year,age_group,age_group_checked_season,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,discord_connection,discord_user_id,ratings,created_at,updated_at,app_settings";
const PROFILE_TEAM_MEMBER_COLUMNS = "id,name,handle,hashtag,position,trust_score,avatar_color,ratings,age_group,age_group_checked_season,onboarding_complete,updated_at";
const TEAM_COLUMNS = "id,name,home_court,region,mmr,wins,losses,accent,deleted_at,created_at,updated_at";
const TEAM_MEMBER_COLUMNS = "team_id,user_id,role";
const TEAM_INVITATION_COLUMNS = "id,team_id,from_user_id,target_user_id,role,status,created_at,updated_at";
const PROFILE_MATCH_SUMMARY_COLUMNS = "profile_id,match_count,win_count,loss_count,draw_count,points,rebounds,assists,steals,blocks,fouls,last_match_id,last_match_at,updated_at";
const FAVORITE_COLUMNS = "id,user_id,target_type,target_id,created_at";
const APPROVED_COURT_COLUMNS = "id,source_request_id,approved_by,name,hashtag,address_text,road_address,jibun_address,zonecode,lat,lng,status,hidden_at,hidden_by,hidden_reason,approved_at,created_at,updated_at,payload";

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
    createdAt: team.created_at ?? null,
    updatedAt: team.updated_at ?? team.created_at ?? null,
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
    trustScore: profile.trustScore,
    avatarColor: profile.avatarColor,
    hashtag: profile.hashtag,
    ageGroup: profile.ageGroup,
    ageGroupCheckedSeason: profile.ageGroupCheckedSeason,
    onboardingComplete: profile.onboardingComplete,
    ratings: profile.ratings,
  };
}

function fromProfileMatchSummary(row = {}) {
  const matchCount = Number(row.match_count ?? 0);
  const fouls = Number(row.fouls ?? 0);
  return {
    matchCount,
    wins: Number(row.win_count ?? 0),
    losses: Number(row.loss_count ?? 0),
    draws: Number(row.draw_count ?? 0),
    averageFouls: matchCount ? fouls / matchCount : 0,
    totals: {
      points: Number(row.points ?? 0),
      rebounds: Number(row.rebounds ?? 0),
      assists: Number(row.assists ?? 0),
      steals: Number(row.steals ?? 0),
      blocks: Number(row.blocks ?? 0),
      fouls,
    },
    lastMatchId: row.last_match_id ?? "",
    lastMatchAt: row.last_match_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function getPayload(row = {}) {
  return row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
}

function fromApprovedCourt(row = {}) {
  const payload = getPayload(row);
  return {
    ...payload,
    id: row.id ?? payload.id,
    sourceRequestId: row.source_request_id ?? payload.sourceRequestId,
    approvedBy: row.approved_by ?? payload.approvedBy,
    name: row.name ?? payload.name,
    hashtag: row.hashtag ?? payload.hashtag,
    addressText: row.address_text ?? payload.addressText,
    roadAddress: row.road_address ?? payload.roadAddress,
    jibunAddress: row.jibun_address ?? payload.jibunAddress,
    zonecode: row.zonecode ?? payload.zonecode,
    lat: row.lat ?? payload.lat,
    lng: row.lng ?? payload.lng,
    status: row.status ?? payload.status ?? "active",
    hiddenAt: row.hidden_at ?? payload.hiddenAt,
    hiddenBy: row.hidden_by ?? payload.hiddenBy,
    hiddenReason: row.hidden_reason ?? payload.hiddenReason,
    approvedAt: row.approved_at ?? payload.approvedAt,
    createdAt: row.created_at ?? payload.createdAt,
    updatedAt: row.updated_at ?? payload.updatedAt,
  };
}

async function loadCurrentUserFavorites(supabase, profileId = "") {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from("favorites")
    .select(FAVORITE_COLUMNS)
    .eq("user_id", profileId);
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) return [];
    throw error;
  }
  return data ?? [];
}

async function loadCurrentUserMatchSummary(supabase, profileId = "") {
  if (!profileId) return null;
  const { data, error } = await supabase
    .from("profile_match_summaries")
    .select(PROFILE_MATCH_SUMMARY_COLUMNS)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) {
    if (["42P01", "PGRST116", "PGRST205"].includes(error.code)) return null;
    throw error;
  }
  return data ? fromProfileMatchSummary(data) : null;
}

export async function loadCurrentUserTeamInvitations(supabase, profileId = "") {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from("team_invitations")
    .select(TEAM_INVITATION_COLUMNS)
    .or(`from_user_id.eq.${profileId},target_user_id.eq.${profileId}`)
    .order("created_at", { ascending: false });
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) return [];
    throw error;
  }
  return (data ?? []).map(fromRemoteTeamInvitation);
}

export async function loadCurrentUserTeams(supabase, profileId = "", extraTeamIds = [], options = {}) {
  if (!profileId) return { teams: [], users: [] };
  const includeTeamMemberProfiles = options.includeTeamMemberProfiles !== false;
  const { data: ownMemberships, error: ownMembershipsError } = Array.isArray(options.ownMemberships)
    ? { data: options.ownMemberships, error: null }
    : await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", profileId);
  if (ownMembershipsError) throw ownMembershipsError;

  const teamIds = unique([...(ownMemberships ?? []).map((row) => row.team_id), ...extraTeamIds]);
  if (!teamIds.length) return { teams: [], users: [] };

  const [{ data: teamRows, error: teamError }, { data: memberRows, error: memberError }] = await Promise.all([
    supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null),
    supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds),
  ]);
  if (teamError) throw teamError;
  if (memberError) throw memberError;

  const memberProfileIds = includeTeamMemberProfiles
    ? unique((memberRows ?? []).map((row) => row.user_id)).filter((userId) => userId !== profileId)
    : [];
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
    users: (profileRows ?? []).map(fromTeamMemberProfile),
  };
}

export async function loadCurrentProfileState(context, options = {}) {
  const profile = context.profile ?? null;
  const profileId = profile?.id ?? "";
  const ownMembershipsPromise = profileId
    ? context.supabase.from("team_members").select("team_id").eq("user_id", profileId)
    : Promise.resolve({ data: [], error: null });
  const [matchSummary, teamInvitations, ownMembershipsResult, favoriteRows] = await Promise.all([
    loadCurrentUserMatchSummary(context.supabase, profileId),
    loadCurrentUserTeamInvitations(context.supabase, profileId),
    ownMembershipsPromise,
    loadCurrentUserFavorites(context.supabase, profileId),
  ]);
  if (ownMembershipsResult.error) throw ownMembershipsResult.error;
  const favoritePlayerIds = favoriteRows.filter((favorite) => favorite.target_type === "player").map((favorite) => favorite.target_id);
  const favoriteTeamIds = favoriteRows.filter((favorite) => favorite.target_type === "team").map((favorite) => favorite.target_id);
  const favoriteCourtIds = favoriteRows.filter((favorite) => favorite.target_type === "court").map((favorite) => favorite.target_id);
  const favoriteRefereeIds = favoriteRows.filter((favorite) => favorite.target_type === "referee").map((favorite) => favorite.target_id);
  const user = profile
    ? { ...fromRemoteProfile(profile), matchSummary }
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const remoteAppSettings = getRemoteAppSettings(profile);
  const currentUserTeams = await loadCurrentUserTeams(
    context.supabase,
    profileId,
    [
      ...teamInvitations.filter((invitation) => invitation.status === "pending").map((invitation) => invitation.teamId),
      ...favoriteTeamIds,
    ],
    {
      includeTeamMemberProfiles: options.includeTeamMemberProfiles !== false,
      ownMemberships: ownMembershipsResult.data ?? [],
    },
  );
  const favoriteProfileIds = unique([...favoritePlayerIds, ...favoriteRefereeIds]);
  const invitationProfileIds = unique(teamInvitations.flatMap((invitation) => [
    invitation.fromUserId,
    invitation.targetUserId,
  ]));
  const extraProfileIds = unique([...invitationProfileIds, ...favoriteProfileIds])
    .filter((userId) => userId !== profileId && !currentUserTeams.users.some((item) => item.id === userId));
  const { data: extraProfileRows, error: extraProfileError } = extraProfileIds.length
    ? await context.supabase.from("public_profiles").select(PROFILE_TEAM_MEMBER_COLUMNS).in("id", extraProfileIds)
    : { data: [], error: null };
  if (extraProfileError) throw extraProfileError;
  const extraUsers = (extraProfileRows ?? []).map(fromTeamMemberProfile);
  const userById = new Map([...currentUserTeams.users, ...extraUsers].map((item) => [item.id, item]));
  userById.set(user.id, user);
  const { data: favoriteCourtRows, error: favoriteCourtError } = favoriteCourtIds.length
    ? await context.supabase.from("approved_courts").select(APPROVED_COURT_COLUMNS).in("id", favoriteCourtIds)
    : { data: [], error: null };
  if (favoriteCourtError) throw favoriteCourtError;
  const settings = {
    ...DEFAULT_SETTINGS,
    ...remoteAppSettings,
    favoritePlayerIds,
    favoriteTeamIds,
    favoriteCourtIds,
    favoriteRefereeIds,
    approvedCourts: unique([
      ...(remoteAppSettings.approvedCourts ?? []),
      ...(favoriteCourtRows ?? []).map(fromApprovedCourt),
    ]),
  };
  const state = normalizeState({
    currentUserId: user.id,
    users: [...userById.values()],
    teams: currentUserTeams.teams,
    teamInvitations,
    settings,
    settingsMeta: {
      themeExplicit: Boolean(remoteAppSettings.theme),
    },
  }, { includeDemo: false });

  return {
    state: {
      ...state,
      matches: [],
      recruitingPosts: [],
      tournaments: [],
    },
    updatedAt: profile?.updated_at ? new Date(profile.updated_at).getTime() : 0,
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
    const result = await loadCurrentProfileState(context);

    sendJson(response, 200, {
      ok: true,
      ...result,
      debug: body.debug === true ? { profileId: context.profile?.id ?? result.state.currentUserId } : undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "profile_me_failed" });
  }
}
