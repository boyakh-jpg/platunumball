import { getAuthenticatedContext, mergeById, readJsonBody, sendJson, toClientTeamWithMembers as toClientTeam, uniqueValues as unique } from "../_supabaseAdmin.js";
import { loadCompactMatchList } from "../matches/list.js";
import {
  fromRemoteTeamInvitation,
  normalizeState,
} from "../../../src/data/repository.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../src/data/profileMappers.js";
import { DEFAULT_SETTINGS } from "../../../src/data/repositoryDefaults.js";
import {
  APPROVED_COURT_COLUMNS,
  FAVORITE_COLUMNS,
  PROFILE_ME_COLUMNS,
  TEAM_COLUMNS,
  TEAM_INVITATION_COLUMNS,
  TEAM_MEMBER_COLUMNS,
} from "../../../src/data/repositoryColumns.js";
import { REMOTE_CLIENT_RECORD_MONTHS } from "../../../src/lib/constants.js";

export { PROFILE_ME_COLUMNS };
const PROFILE_TEAM_MEMBER_COLUMNS = "id,name,handle,hashtag,position,trust_score,avatar_color,ratings,age_group,age_group_checked_season,onboarding_complete,updated_at";
const PROFILE_MATCH_SUMMARY_COLUMNS = "profile_id,match_count,win_count,loss_count,draw_count,points,rebounds,assists,steals,blocks,fouls,last_match_id,last_match_at,updated_at";
const PROFILE_RECENT_RECORD_LIMIT = 6;

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

async function loadRecentProfileRecords(context, debugTiming = null) {
  if (!context.profileId) return null;
  const startedAt = Date.now();
  try {
    return await loadCompactMatchList(context, {
      limit: PROFILE_RECENT_RECORD_LIMIT,
      completedMonths: REMOTE_CLIENT_RECORD_MONTHS,
      completedOnly: true,
      includeRecruitingSchedule: false,
      adminContext: false,
    }, 0, PROFILE_RECENT_RECORD_LIMIT, debugTiming);
  } finally {
    if (debugTiming) debugTiming.recentRecordsMs = (debugTiming.recentRecordsMs ?? 0) + Date.now() - startedAt;
  }
}

function mergeRecentProfileRecords(profileState = {}, recordsState = {}) {
  if (!recordsState?.matches?.length) return profileState;
  return {
    ...profileState,
    users: mergeById(profileState.users, recordsState.users),
    teams: mergeById(profileState.teams, recordsState.teams),
    matches: recordsState.matches,
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
  const ownMembersOnly = options.ownMembersOnly === true;
  const { data: ownMemberships, error: ownMembershipsError } = Array.isArray(options.ownMemberships)
    ? { data: options.ownMemberships, error: null }
    : await supabase
      .from("team_members")
      .select("team_id,user_id,role")
      .eq("user_id", profileId);
  if (ownMembershipsError) throw ownMembershipsError;

  const teamIds = unique([...(ownMemberships ?? []).map((row) => row.team_id), ...extraTeamIds]);
  if (!teamIds.length) return { teams: [], users: [] };

  const [{ data: teamRows, error: teamError }, { data: memberRows, error: memberError }] = await Promise.all([
    supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null),
    ownMembersOnly
      ? Promise.resolve({
          data: (ownMemberships ?? [])
            .filter((row) => teamIds.includes(row.team_id))
            .map((row) => ({ team_id: row.team_id, user_id: row.user_id ?? profileId, role: row.role ?? "regular" })),
          error: null,
        })
      : supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", teamIds),
  ]);
  if (teamError) throw teamError;
  if (memberError) throw memberError;

  const memberProfileIds = includeTeamMemberProfiles
    ? unique((memberRows ?? []).map((row) => row.user_id)).filter((userId) => userId !== profileId)
    : [];
  const { data: profileRows, error: profileError } = memberProfileIds.length
    ? await supabase.from("profiles").select(PROFILE_TEAM_MEMBER_COLUMNS).in("id", memberProfileIds)
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
  const debugTiming = options.debugTiming ?? null;
  const time = async (key, callback) => {
    const startedAt = Date.now();
    try {
      return await callback();
    } finally {
      if (debugTiming) debugTiming[key] = (debugTiming[key] ?? 0) + Date.now() - startedAt;
    }
  };
  const profile = context.profile ?? null;
  const profileId = profile?.id ?? "";
  const remoteAppSettings = getRemoteAppSettings(profile);
  const includeMatchSummary = options.includeMatchSummary !== false;
  const includeFavorites = options.includeFavorites !== false;
  const includeTeams = options.includeTeams !== false;
  const includeTeamInvitations = options.includeTeamInvitations !== false;
  const includeExtraProfiles = options.includeExtraProfiles !== false;
  const ownMembershipsPromise = profileId
    ? includeTeams
      ? context.supabase.from("team_members").select("team_id,user_id,role").eq("user_id", profileId)
      : Promise.resolve({ data: [], error: null })
    : Promise.resolve({ data: [], error: null });
  const [matchSummary, teamInvitations, ownMembershipsResult, favoriteRows] = await Promise.all([
    includeMatchSummary ? time("matchSummaryMs", () => loadCurrentUserMatchSummary(context.supabase, profileId)) : Promise.resolve(null),
    includeTeamInvitations ? time("teamInvitationsMs", () => loadCurrentUserTeamInvitations(context.supabase, profileId)) : Promise.resolve([]),
    time("ownMembershipsMs", () => ownMembershipsPromise),
    includeFavorites ? time("favoritesMs", () => loadCurrentUserFavorites(context.supabase, profileId)) : Promise.resolve([]),
  ]);
  if (ownMembershipsResult.error) throw ownMembershipsResult.error;
  const favoritePlayerIds = includeFavorites ? favoriteRows.filter((favorite) => favorite.target_type === "player").map((favorite) => favorite.target_id) : (remoteAppSettings.favoritePlayerIds ?? []);
  const favoriteTeamIds = includeFavorites ? favoriteRows.filter((favorite) => favorite.target_type === "team").map((favorite) => favorite.target_id) : (remoteAppSettings.favoriteTeamIds ?? []);
  const favoriteCourtIds = includeFavorites ? favoriteRows.filter((favorite) => favorite.target_type === "court").map((favorite) => favorite.target_id) : (remoteAppSettings.favoriteCourtIds ?? []);
  const favoriteRefereeIds = includeFavorites ? favoriteRows.filter((favorite) => favorite.target_type === "referee").map((favorite) => favorite.target_id) : (remoteAppSettings.favoriteRefereeIds ?? []);
  const user = profile
    ? { ...fromRemoteProfile(profile), matchSummary }
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const currentUserTeamsPromise = includeTeams
    ? time("teamsMs", () => loadCurrentUserTeams(
      context.supabase,
      profileId,
      [
        ...teamInvitations.filter((invitation) => invitation.status === "pending").map((invitation) => invitation.teamId),
        ...favoriteTeamIds,
      ],
      {
        includeTeamMemberProfiles: options.includeTeamMemberProfiles !== false,
        ownMembersOnly: options.ownMembersOnly === true,
        ownMemberships: ownMembershipsResult.data ?? [],
      },
    ))
    : Promise.resolve({ teams: [], users: [] });
  const favoriteProfileIds = unique([...favoritePlayerIds, ...favoriteRefereeIds]);
  const invitationProfileIds = unique(teamInvitations.flatMap((invitation) => [
    invitation.fromUserId,
    invitation.targetUserId,
  ]));
  const extraProfileIds = includeExtraProfiles
    ? unique([...invitationProfileIds, ...favoriteProfileIds]).filter((userId) => userId !== profileId)
    : [];
  const extraProfileRowsPromise = extraProfileIds.length
    ? time("extraProfilesMs", () => context.supabase.from("profiles").select(PROFILE_TEAM_MEMBER_COLUMNS).in("id", extraProfileIds))
    : Promise.resolve({ data: [], error: null });
  const favoriteCourtRowsPromise = favoriteCourtIds.length
    ? time("favoriteCourtsMs", () => context.supabase.from("approved_courts").select(APPROVED_COURT_COLUMNS).in("id", favoriteCourtIds))
    : Promise.resolve({ data: [], error: null });
  const [currentUserTeams, { data: extraProfileRows, error: extraProfileError }, { data: favoriteCourtRows, error: favoriteCourtError }] = await Promise.all([
    currentUserTeamsPromise,
    extraProfileRowsPromise,
    favoriteCourtRowsPromise,
  ]);
  if (extraProfileError) throw extraProfileError;
  const currentTeamUserIds = new Set(currentUserTeams.users.map((item) => item.id));
  const extraUsers = (extraProfileRows ?? [])
    .filter((row) => !currentTeamUserIds.has(row.id))
    .map(fromTeamMemberProfile);
  const userById = new Map([...currentUserTeams.users, ...extraUsers].map((item) => [item.id, item]));
  userById.set(user.id, user);
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
    const startedAt = Date.now();
    const body = await readJsonBody(request);
    const debugTiming = body.debugTiming === true ? {} : null;
    const contextStartedAt = Date.now();
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
    if (debugTiming) debugTiming.authMs = Date.now() - contextStartedAt;
    const result = await loadCurrentProfileState(context, {
      debugTiming,
      includeFavorites: body.includeFavorites !== false,
      includeMatchSummary: body.includeMatchSummary !== false,
      includeTeamInvitations: body.includeTeamInvitations !== false,
      includeTeams: body.includeTeams !== false,
      includeExtraProfiles: body.includeExtraProfiles !== false,
      includeTeamMemberProfiles: body.includeTeamMemberProfiles !== false,
    });
    let profileRecordsLoaded = false;
    if (body.includeRecentRecords === true) {
      try {
        const recordsResult = await loadRecentProfileRecords(context, debugTiming);
        result.state = mergeRecentProfileRecords(result.state, recordsResult?.state);
        result.updatedAt = Math.max(result.updatedAt ?? 0, recordsResult?.updatedAt ?? 0);
        profileRecordsLoaded = true;
      } catch (error) {
        console.warn("Profile recent records skipped.", error.message);
      }
    }
    if (debugTiming) debugTiming.totalMs = Date.now() - startedAt;

    sendJson(response, 200, {
      ok: true,
      ...result,
      profileRecordsLoaded,
      debugTiming: debugTiming ?? undefined,
      debug: body.debug === true ? { profileId: context.profile?.id ?? result.state.currentUserId } : undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "profile_me_failed" });
  }
}
