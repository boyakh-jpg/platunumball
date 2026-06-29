import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadCompactMatchList } from "../matches/list.js";
import { loadCurrentProfileState, PROFILE_ME_COLUMNS } from "../profile/me.js";
import { loadCurrentUserRecruitingFeedList, loadLocalRecruitingFeedList } from "../recruiting/list.js";
import { REMOTE_CLIENT_MATCH_LIMIT } from "../../../src/data/repository.js";

const HOME_LOCAL_RECRUITING_LIMIT = 3;

function mergeById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function mergeHomeState(profileState = {}, feedState = {}) {
  return {
    ...profileState,
    ...feedState,
    users: mergeById(profileState.users, feedState.users),
    teams: mergeById(profileState.teams, feedState.teams),
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

function getCappedMatchLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return REMOTE_CLIENT_MATCH_LIMIT;
  return Math.max(1, Math.min(200, Math.floor(number)));
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
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId ? await getAdminLevel(context) : 0;
    const matchLimit = getCappedMatchLimit(body.matchLimit ?? body.limit ?? REMOTE_CLIENT_MATCH_LIMIT);

    const [profileResult, matchResult, recruitingResult, localRecruitingResult] = await Promise.all([
      loadCurrentProfileState(context),
      loadCompactMatchList(context, {
        limit: matchLimit,
        listOnly: true,
        activeOnly: true,
        includeRecruitingSchedule: false,
        adminContext: false,
      }, adminLevel, matchLimit, debugTiming),
      loadCurrentUserRecruitingFeedList(context, { adminLevel, limit: matchLimit }),
      loadLocalRecruitingFeedList(context, { adminLevel, limit: HOME_LOCAL_RECRUITING_LIMIT }),
    ]);

    if (debugTiming) debugTiming.totalMs = Date.now() - startedAt;
    const recruitingPosts = recruitingResult.state?.recruitingPosts ?? [];

    sendJson(response, 200, {
      ok: true,
      state: mergeHomeState(
        mergeHomeState(
          mergeHomeState(profileResult.state, matchResult.state),
          recruitingResult.state,
        ),
        localRecruitingResult.state,
      ),
      page: {
        ...matchResult.page,
        recruitingScheduleChecked: true,
        recruitingScheduleCount: recruitingPosts.length,
      },
      recruitingPage: {
        ...(localRecruitingResult.page ?? {}),
        feedCounts: recruitingResult.page?.feedCounts ?? localRecruitingResult.page?.feedCounts ?? null,
      },
      updatedAt: Math.max(profileResult.updatedAt ?? 0, matchResult.updatedAt ?? 0, recruitingResult.updatedAt ?? 0, localRecruitingResult.updatedAt ?? 0),
      debugTiming: debugTiming ?? undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "home_load_failed" });
  }
}
