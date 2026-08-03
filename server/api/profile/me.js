import { allowRequestMethod, getAuthenticatedContext, mergeById, readJsonBody, sendJson, toClientTeamWithMembers as toClientTeam, uniqueValues as unique } from "../_supabaseAdmin.js";
import { loadCompactMatchList } from "../matches/list.js";
import {
  normalizeState,
} from "../../../shared/lib/stateNormalizer.js";
import { createProfileShell, fromRemoteProfile, fromTeamMemberProfile, getRemoteAppSettings } from "../../../shared/lib/profileMappers.js";
import { fromRemoteTeamInvitation } from "../../../shared/lib/teamMappers.js";
import { fromRemoteAffiliation } from "../../../shared/lib/affiliationMappers.js";
import { fromRemoteApprovedCourt } from "../../../shared/lib/remotePayloadMappers.js";
import { projectProfileSettings } from "../../../shared/lib/settingsMappers.js";
import {
  APPROVED_COURT_COLUMNS,
  AFFILIATION_COLUMNS,
  FAVORITE_COLUMNS,
  PROFILE_ME_COLUMNS,
  TEAM_COLUMNS,
  TEAM_INVITATION_COLUMNS,
  TEAM_MEMBER_COLUMNS,
} from "../../../shared/lib/repositoryColumns.js";
import { REMOTE_CLIENT_RECORD_MONTHS } from "../../../shared/lib/constants.js";

export { PROFILE_ME_COLUMNS };
const PROFILE_TEAM_MEMBER_COLUMNS = "id,name,handle,hashtag,position,trust_score,avatar_color,avatar_key,avatar_source,avatar_icon_key,avatar_updated_at,avatar_background_enabled,avatar_border_enabled,avatar_border_color,discord_avatar_url,ratings,age_group,age_group_checked_season,onboarding_complete,updated_at";
const PROFILE_MATCH_SUMMARY_COLUMNS = "profile_id,match_count,stat_match_count,win_count,loss_count,draw_count,points,rebounds,assists,steals,blocks,turnovers,fouls,last_match_id,last_match_at,updated_at";
const PROFILE_RECENT_RECORD_LIMIT = 6;

function fromProfileMatchSummary(row = {}) {
  const matchCount = Number(row.match_count ?? 0);
  const statMatchCount = Number(row.stat_match_count ?? 0);
  const fouls = Number(row.fouls ?? 0);
  return {
    matchCount,
    statMatchCount,
    wins: Number(row.win_count ?? 0),
    losses: Number(row.loss_count ?? 0),
    draws: Number(row.draw_count ?? 0),
    averageFouls: statMatchCount ? fouls / statMatchCount : 0,
    totals: {
      points: Number(row.points ?? 0),
      rebounds: Number(row.rebounds ?? 0),
      assists: Number(row.assists ?? 0),
      steals: Number(row.steals ?? 0),
      blocks: Number(row.blocks ?? 0),
      turnovers: Number(row.turnovers ?? 0),
      fouls,
    },
    lastMatchId: row.last_match_id ?? "",
    lastMatchAt: row.last_match_at ?? null,
    updatedAt: row.updated_at ?? null,
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
    teams: (teamRows ?? []).map((team) => ({
      ...toClientTeam(team, membersByTeam.get(team.id) ?? []),
      ...(ownMembersOnly ? { membersPartial: true } : {}),
    })),
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
  const affiliationPromise = profile?.affiliation_id
    ? context.supabase
      .from("affiliations")
      .select(AFFILIATION_COLUMNS)
      .eq("id", profile.affiliation_id)
      .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [matchSummary, teamInvitations, ownMembershipsResult, favoriteRows, affiliationResult] = await Promise.all([
    includeMatchSummary ? time("matchSummaryMs", () => loadCurrentUserMatchSummary(context.supabase, profileId)) : Promise.resolve(null),
    includeTeamInvitations ? time("teamInvitationsMs", () => loadCurrentUserTeamInvitations(context.supabase, profileId)) : Promise.resolve([]),
    time("ownMembershipsMs", () => ownMembershipsPromise),
    includeFavorites ? time("favoritesMs", () => loadCurrentUserFavorites(context.supabase, profileId)) : Promise.resolve([]),
    time("affiliationMs", () => affiliationPromise),
  ]);
  if (ownMembershipsResult.error) throw ownMembershipsResult.error;
  if (affiliationResult.error && !["42P01", "42703", "PGRST205"].includes(affiliationResult.error.code)) throw affiliationResult.error;
  const currentAffiliation = affiliationResult.data ? fromRemoteAffiliation(affiliationResult.data) : null;
  const profileSettings = projectProfileSettings(remoteAppSettings, favoriteRows, {
    favoriteRowsAuthoritative: includeFavorites,
  });
  const {
    favoritePlayerIds,
    favoriteTeamIds,
    favoriteCourtIds,
    favoriteRefereeIds,
  } = profileSettings;
  const user = profile
    ? { ...fromRemoteProfile({ ...profile, affiliation: affiliationResult.data }), matchSummary }
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
    ...profileSettings,
    approvedCourts: unique([
      ...(remoteAppSettings.approvedCourts ?? []),
      ...(favoriteCourtRows ?? []).map(fromRemoteApprovedCourt),
    ]),
  };
  const state = normalizeState({
    currentUserId: user.id,
    users: [...userById.values()],
    teams: currentUserTeams.teams,
    teamInvitations,
    affiliations: currentAffiliation ? [currentAffiliation] : [],
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
  if (!allowRequestMethod(request, response)) return;

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
