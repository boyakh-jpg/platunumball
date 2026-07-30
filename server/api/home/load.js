import { allowRequestMethod, attachNotificationActors, attachNotificationTargetState, getAdminLevel, getAuthenticatedContext, getRowsMaxUpdatedAt, mergeById, readJsonBody, sendJson, timeStep, toClientTeamWithMembers } from "../_supabaseAdmin.js";
import { loadCompactMatchList } from "../matches/list.js";
import { loadCurrentProfileState, PROFILE_ME_COLUMNS } from "../profile/me.js";
import { loadCurrentUserRecruitingFeedList } from "../recruiting/list.js";
import { DEFAULT_RATING } from "../../../shared/lib/matchConstants.js";
import { fromRemoteProfile } from "../../../shared/lib/profileMappers.js";
import { fromRemoteNotification } from "../../../shared/lib/remotePayloadMappers.js";
import { NOTIFICATION_COLUMNS, PUBLIC_PROFILE_COLUMNS, TEAM_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { compareNotificationsNewestFirst, dedupeNotifications, isNotificationDisplayable, isNotificationVisibleToUser } from "../../../shared/lib/notifications.js";
import {
  FAVORITE_LIMIT,
  HOME_REGION_PLAYER_LIMIT,
  REMOTE_CLIENT_ACTIVE_MATCH_LIMIT,
  HOME_RIVAL_TEAM_LIMIT,
  MAX_TEAM_MEMBERSHIPS,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../../../shared/lib/constants.js";

const HOME_RECENT_COMPLETED_HOURS = 24 * 31 * REMOTE_CLIENT_RECORD_MONTHS;
const HOME_NOTIFICATION_QUERY_LIMIT = 80;
const HOME_NOTIFICATION_LIMIT = 12;
const HOME_TEAM_SUMMARY_LIMIT = MAX_TEAM_MEMBERSHIPS + FAVORITE_LIMIT + HOME_RIVAL_TEAM_LIMIT;
const HOME_REGION_RANKING_PRIVACY_FILTER = "app_settings->privacy->>regionRanking.is.null,app_settings->privacy->>regionRanking.neq.false";

const EMPTY_HOME_MATCH_RESULT = Object.freeze({
  state: {},
  page: {
    cursor: "",
    exhausted: true,
    error: "home_match_load_failed",
  },
  updatedAt: 0,
});

const EMPTY_HOME_RECRUITING_RESULT = Object.freeze({
  state: {},
  page: {
    exhausted: true,
    feedCounts: null,
  },
  updatedAt: 0,
});

async function loadOptionalHomeSection(label, loader, fallback, sectionErrors = null, errorKey = label) {
  try {
    return await loader();
  } catch (error) {
    console.warn(`Home ${label} load skipped.`, error.message);
    if (sectionErrors) sectionErrors[errorKey] = `home_${String(errorKey).replace(/[^a-z0-9]+/gi, "_")}_load_failed`;
    return fallback;
  }
}

function mergeHomeState(profileState = {}, feedState = {}) {
  return {
    ...profileState,
    ...feedState,
    users: mergeById(profileState.users, feedState.users),
    teams: mergeTeamsById(profileState.teams, feedState.teams),
    teamInvitations: profileState.teamInvitations ?? [],
    matches: mergeById(profileState.matches, feedState.matches),
    recruitingPosts: mergeById(profileState.recruitingPosts, feedState.recruitingPosts),
    tournaments: mergeById(profileState.tournaments, feedState.tournaments),
    notifications: mergeById(profileState.notifications, feedState.notifications),
    settings: {
      ...(profileState.settings ?? {}),
      ...(feedState.settings ?? {}),
    },
  };
}

function mergeTeamMembers(current = [], incoming = []) {
  const merged = new Map();
  [...(current ?? []), ...(incoming ?? [])].forEach((member) => {
    if (!member?.userId) return;
    merged.set(member.userId, { ...(merged.get(member.userId) ?? {}), ...member });
  });
  return [...merged.values()];
}

function mergeTeamsById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      return;
    }
    const members = mergeTeamMembers(existing.members, item.members);
    const membersPartial = existing.membersPartial === true && item.membersPartial === true;
    merged.set(item.id, {
      ...existing,
      ...item,
      members: members.length ? members : (item.members ?? existing.members ?? []),
      membersPartial,
    });
  });
  return [...merged.values()];
}

function uniqueIds(values = [], limit = Number.POSITIVE_INFINITY) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, limit);
}

function getCappedMatchLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return REMOTE_CLIENT_MATCH_LIMIT;
  return Math.max(1, Math.min(REMOTE_CLIENT_ACTIVE_MATCH_LIMIT, Math.floor(number)));
}

function getCappedRecruitingLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return REMOTE_CLIENT_RECRUITING_LIMIT;
  return Math.max(1, Math.min(REMOTE_CLIENT_RECRUITING_LIMIT, Math.floor(number)));
}

async function loadHomeRegionTeams(supabase, region = "") {
  const safeRegion = String(region ?? "").trim();
  if (!safeRegion) return { teams: [], updatedAt: 0 };
  const { data, error } = await supabase
    .from("teams")
    .select(TEAM_COLUMNS)
    .eq("region", safeRegion)
    .is("deleted_at", null)
    .order("mmr", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(HOME_RIVAL_TEAM_LIMIT + MAX_TEAM_MEMBERSHIPS);
  if (error) throw error;
  return {
    teams: (data ?? []).map((team) => ({
      ...toClientTeamWithMembers(team, []),
      membersPartial: true,
    })),
    updatedAt: getRowsMaxUpdatedAt(data ?? []),
  };
}

async function loadHomeRegionPlayers(supabase, profile = null) {
  const region = String(profile?.region ?? "").trim();
  const profileId = String(profile?.id ?? "").trim();
  const placementMatchCount = Number(
    profile?.placement_match_count
      ?? profile?.ratings?.placement?.matchCount
      ?? 5,
  );
  if (!region || !profileId || placementMatchCount < 5) {
    return { users: [], playerIds: [], rank: null, updatedAt: 0 };
  }

  const integratedRatingValue = Number(profile?.ratings?.integrated);
  const integratedRating = Number.isFinite(integratedRatingValue) ? integratedRatingValue : DEFAULT_RATING;
  const topQuery = supabase
    .from("profiles")
    .select(`${PUBLIC_PROFILE_COLUMNS},app_settings`)
    .eq("region", region)
    .gte("placement_match_count", 5)
    .or(HOME_REGION_RANKING_PRIVACY_FILTER)
    .order("ratings->integrated", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(HOME_REGION_PLAYER_LIMIT);
  const higherQuery = supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("region", region)
    .gte("placement_match_count", 5)
    .or(HOME_REGION_RANKING_PRIVACY_FILTER)
    .gt("ratings->integrated", integratedRating);
  const tiedBeforeQuery = supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("region", region)
    .gte("placement_match_count", 5)
    .or(HOME_REGION_RANKING_PRIVACY_FILTER)
    .eq("ratings->integrated", integratedRating)
    .lt("id", profileId);
  const [
    { data: topRows, error: topError },
    { count: higherCount, error: higherError },
    { count: tiedBeforeCount, error: tiedBeforeError },
  ] = await Promise.all([topQuery, higherQuery, tiedBeforeQuery]);
  if (topError) throw topError;
  if (higherError) throw higherError;
  if (tiedBeforeError) throw tiedBeforeError;

  const rank = Number(higherCount ?? 0) + Number(tiedBeforeCount ?? 0) + 1;
  const entries = (topRows ?? []).map((row) => ({
    id: row.id,
    rating: Number(row.ratings?.integrated ?? DEFAULT_RATING),
  }));
  const currentUserIsPublic = profile?.app_settings?.privacy?.regionRanking !== false;
  if (!currentUserIsPublic && rank <= HOME_REGION_PLAYER_LIMIT && !entries.some((entry) => entry.id === profileId)) {
    entries.push({ id: profileId, rating: integratedRating });
    entries.sort((a, b) => b.rating - a.rating || a.id.localeCompare(b.id));
  }

  return {
    users: (topRows ?? []).filter((row) => row.id !== profileId).map((row) => {
      const { app_settings: _appSettings, ...publicRow } = row;
      return {
        ...fromRemoteProfile(publicRow),
        privacy: { regionRanking: true },
      };
    }),
    playerIds: entries.slice(0, HOME_REGION_PLAYER_LIMIT).map((entry) => entry.id),
    rank,
    updatedAt: getRowsMaxUpdatedAt(topRows ?? []),
  };
}

async function loadHomeTeamMemberCounts(supabase, teamIds = []) {
  const scopedTeamIds = uniqueIds(teamIds, HOME_TEAM_SUMMARY_LIMIT);
  if (!scopedTeamIds.length) return {};
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id")
    .in("team_id", scopedTeamIds);
  if (error) throw error;
  const counts = Object.fromEntries(scopedTeamIds.map((teamId) => [teamId, 0]));
  (data ?? []).forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(counts, row.team_id)) counts[row.team_id] += 1;
  });
  return counts;
}

function attachHomeTeamMemberCounts(state = {}, memberCounts = {}) {
  return {
    ...state,
    teams: (state.teams ?? []).map((team) => (
      Object.prototype.hasOwnProperty.call(memberCounts, team.id)
        ? { ...team, memberCount: memberCounts[team.id] }
        : team
    )),
  };
}

async function loadCurrentUserHomeNotifications(supabase, profileId = "", blockedUserIds = []) {
  if (!profileId) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .or(`user_id.eq.${profileId},target_user_id.eq.${profileId}`)
    .is("read_at", null)
    .lte("due_at", now)
    .order("created_at", { ascending: false })
    .limit(HOME_NOTIFICATION_QUERY_LIMIT);
  if (error) throw error;
  const notificationsWithActors = await attachNotificationActors(supabase, (data ?? []).map(fromRemoteNotification));
  return dedupeNotifications((await attachNotificationTargetState(supabase, notificationsWithActors))
    .filter((notification) => isNotificationVisibleToUser(notification, profileId, { blockedUserIds }))
    .filter((notification) => isNotificationDisplayable(notification)))
    .sort(compareNotificationsNewestFirst)
    .slice(0, HOME_NOTIFICATION_LIMIT);
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const startedAt = Date.now();
    const body = await readJsonBody(request);
    const debugTiming = body.debugTiming === true ? {} : null;
    const sectionErrors = {};
    const context = await timeStep(debugTiming, "authMs", () => getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS }));
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId ? await timeStep(debugTiming, "adminMs", () => getAdminLevel(context)) : 0;
    const matchLimit = getCappedMatchLimit(body.matchLimit ?? body.limit ?? REMOTE_CLIENT_MATCH_LIMIT);
    const recruitingLimit = getCappedRecruitingLimit(body.recruitingLimit ?? REMOTE_CLIENT_RECRUITING_LIMIT);
    const includeFeedCounts = body.includeFeedCounts === true;

    const [profileResult, matchResult, recruitingResult, homeNotifications, regionTeamResult, regionPlayerResult] = await Promise.all([
      timeStep(debugTiming, "profileMs", () => loadCurrentProfileState(context, {
        debugTiming,
        includeFavorites: true,
        includeMatchSummary: false,
        includeTeams: true,
        includeTeamMemberProfiles: false,
        ownMembersOnly: true,
      })),
      loadOptionalHomeSection("match", () => loadCompactMatchList(context, {
        limit: matchLimit,
        listOnly: true,
        activeOnly: true,
        includeRecentCompleted: true,
        includeClosedNotices: false,
        recentCompletedHours: HOME_RECENT_COMPLETED_HOURS,
        includeRecruitingSchedule: false,
        adminContext: false,
      }, adminLevel, matchLimit, debugTiming), EMPTY_HOME_MATCH_RESULT, sectionErrors, "matches"),
      loadOptionalHomeSection("recruiting", () => timeStep(debugTiming, "recruitingMs", () => loadCurrentUserRecruitingFeedList(context, {
        adminLevel,
        limit: recruitingLimit,
        includeFeedCounts,
        skipCardReferenceRows: true,
      })), EMPTY_HOME_RECRUITING_RESULT, sectionErrors, "recruiting"),
      loadOptionalHomeSection("notifications", () => timeStep(debugTiming, "notificationsMs", () => loadCurrentUserHomeNotifications(
        context.supabase,
        context.profileId,
        context.profile?.app_settings?.blockedUserIds,
      )), [], sectionErrors, "notifications"),
      loadOptionalHomeSection("region teams", () => timeStep(debugTiming, "regionTeamsMs", () => loadHomeRegionTeams(
        context.supabase,
        context.profile?.region,
      )), { teams: [], updatedAt: 0 }, sectionErrors, "region_teams"),
      loadOptionalHomeSection("region players", () => timeStep(debugTiming, "regionPlayersMs", () => loadHomeRegionPlayers(
        context.supabase,
        context.profile,
      )), { users: [], playerIds: [], rank: null, updatedAt: 0 }, sectionErrors, "region_players"),
    ]);

    const currentUserRecruitingState = recruitingResult.state ?? {};
    const recruitingPosts = currentUserRecruitingState.recruitingPosts ?? [];
    const ownTeamIds = uniqueIds((profileResult.state?.teams ?? [])
      .filter((team) => (team.members ?? []).some((member) => member.userId === context.profileId))
      .map((team) => team.id), MAX_TEAM_MEMBERSHIPS);
    const favoriteTeamIds = uniqueIds(profileResult.state?.settings?.favoriteTeamIds ?? [], FAVORITE_LIMIT);
    const rivalTeamIds = (regionTeamResult.teams ?? [])
      .filter((team) => !ownTeamIds.includes(team.id))
      .slice(0, HOME_RIVAL_TEAM_LIMIT)
      .map((team) => team.id);
    const memberCounts = await loadOptionalHomeSection(
      "team member counts",
      () => timeStep(debugTiming, "teamMemberCountsMs", () => loadHomeTeamMemberCounts(
        context.supabase,
        [...ownTeamIds, ...favoriteTeamIds, ...(regionTeamResult.teams ?? []).map((team) => team.id)],
      )),
      {},
      sectionErrors,
      "team_member_counts",
    );
    const homeState = attachHomeTeamMemberCounts(
      mergeHomeState(
        mergeHomeState(
          mergeHomeState(
            mergeHomeState(
              mergeHomeState(profileResult.state, { teams: regionTeamResult.teams }),
              { users: regionPlayerResult.users },
            ),
            matchResult.state,
          ),
          currentUserRecruitingState,
        ),
        { notifications: homeNotifications },
      ),
      memberCounts,
    );
    homeState.homeSummary = {
      ownTeamIds,
      rivalTeamIds,
      regionalPlayerIds: regionPlayerResult.playerIds,
      regionalRank: regionPlayerResult.rank,
    };
    if (debugTiming) debugTiming.totalMs = Date.now() - startedAt;

    sendJson(response, 200, {
      ok: true,
      state: homeState,
      page: {
        ...matchResult.page,
        recruitingScheduleChecked: false,
        recruitingScheduleCount: recruitingPosts.length,
      },
      recruitingPage: {
        count: recruitingPosts.length,
        exhausted: true,
        feedCounts: recruitingResult.page?.feedCounts ?? null,
      },
      updatedAt: Math.max(
        profileResult.updatedAt ?? 0,
        matchResult.updatedAt ?? 0,
        recruitingResult.updatedAt ?? 0,
        regionTeamResult.updatedAt ?? 0,
        regionPlayerResult.updatedAt ?? 0,
      ),
      sectionErrors,
      debugTiming: debugTiming ?? undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "home_load_failed" });
  }
}
