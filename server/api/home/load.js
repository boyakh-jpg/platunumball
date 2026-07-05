import { getAdminLevel, getAuthenticatedContext, mergeById, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadCompactMatchList } from "../matches/list.js";
import { loadCurrentProfileState, PROFILE_ME_COLUMNS } from "../profile/me.js";
import { loadCurrentUserRecruitingFeedList } from "../recruiting/list.js";
import {
  REMOTE_CLIENT_ACTIVE_MATCH_LIMIT,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../../../src/data/repository.js";

const HOME_RECENT_COMPLETED_HOURS = 24 * 31 * REMOTE_CLIENT_RECORD_MONTHS;

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
    merged.set(item.id, {
      ...existing,
      ...item,
      members: members.length ? members : (item.members ?? existing.members ?? []),
    });
  });
  return [...merged.values()];
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

async function timeStep(debugTiming, key, callback) {
  const startedAt = Date.now();
  try {
    return await callback();
  } finally {
    if (debugTiming) debugTiming[key] = (debugTiming[key] ?? 0) + Date.now() - startedAt;
  }
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
    const context = await timeStep(debugTiming, "authMs", () => getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS }));
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId ? await timeStep(debugTiming, "adminMs", () => getAdminLevel(context)) : 0;
    const matchLimit = getCappedMatchLimit(body.matchLimit ?? body.limit ?? REMOTE_CLIENT_MATCH_LIMIT);
    const recruitingLimit = getCappedRecruitingLimit(body.recruitingLimit ?? REMOTE_CLIENT_RECRUITING_LIMIT);
    const includeFeedCounts = body.includeFeedCounts === true;

    const [profileResult, matchResult, recruitingResult] = await Promise.all([
      timeStep(debugTiming, "profileMs", () => loadCurrentProfileState(context, {
        debugTiming,
        includeFavorites: false,
        includeMatchSummary: false,
        includeTeamMemberProfiles: false,
        ownMembersOnly: true,
      })),
      loadCompactMatchList(context, {
        limit: matchLimit,
        listOnly: true,
        activeOnly: true,
        includeRecentCompleted: true,
        includeClosedNotices: false,
        recentCompletedHours: HOME_RECENT_COMPLETED_HOURS,
        includeRecruitingSchedule: false,
        adminContext: false,
      }, adminLevel, matchLimit, debugTiming),
      timeStep(debugTiming, "recruitingMs", () => loadCurrentUserRecruitingFeedList(context, {
        adminLevel,
        limit: recruitingLimit,
        includeFeedCounts,
        skipCardReferenceRows: true,
      })),
    ]);

    if (debugTiming) debugTiming.totalMs = Date.now() - startedAt;
    const currentUserRecruitingState = recruitingResult.state ?? {};
    const recruitingPosts = currentUserRecruitingState.recruitingPosts ?? [];

    sendJson(response, 200, {
      ok: true,
      state: mergeHomeState(
        mergeHomeState(profileResult.state, matchResult.state),
        currentUserRecruitingState,
      ),
      page: {
        ...matchResult.page,
        recruitingScheduleChecked: true,
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
      ),
      debugTiming: debugTiming ?? undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "home_load_failed" });
  }
}
