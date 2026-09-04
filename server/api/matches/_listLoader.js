import { fetchCourtRowsByIds, firstRowBy as firstBy, groupRowsBy as groupBy, loadCurrentUserTournamentIndex, mergeById, timeStep, uniqueValues as unique } from "../_supabaseAdmin.js";
import { projectMatchActivePlayerIds } from "../../../shared/lib/playerIds.js";
import { compactClientUser } from "../../lib/clientProjection.js";
import { attachRoomFeedCardSource } from "../../lib/roomFeedCards.js";
import { fetchRoomFeedSourceMap } from "../../lib/roomFeedSources.js";
import { normalizeState } from "../../../shared/lib/stateNormalizer.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../shared/lib/profileMappers.js";
import { DEFAULT_SETTINGS } from "../../../shared/lib/repositoryDefaults.js";
import { COURT_COLUMNS, MATCH_PLAYER_COLUMNS, MATCH_RESULT_COLUMNS, PLAYER_STAT_COLUMNS, PROFILE_CARD_COLUMNS, TEAM_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { REMOTE_CLIENT_MATCH_LIMIT } from "../../../shared/lib/constants.js";
import { loadCompactRecruitingList, loadCurrentUserRecruitingFeedList } from "../recruiting/list.js";
import { isMatchInPlayMenu } from "../../../shared/lib/matchUtils.js";

import { RECENT_COMPLETED_MATCH_HOURS, fetchClosedNoticeMatchFeedPage, fetchCurrentUserCompletedMatchIds, fetchCurrentUserMatchPage, fetchMatchFeedPage, fetchMatchRowsByIds, fetchPlayMatchPage, fetchRecentCompletedMatchFeedPage, fetchRefereeMatchPage, fetchRelatedActiveMatchPage, getCompletedSince, getRecentCompletedHours, isLegacyListFallbackAllowed, mergeMatchFeedPages } from "./_listQueries.js";
import { MATCH_RELATED_FALLBACK_MAX_LIMIT, fetchOperationsMatchPage } from "./_listOperationsQueries.js";
import { appendRowFallbackSource, attachMatchCardReferences, canReadMatchRow, collectMissingMatchCardReferences, filterActiveMatchCards, filterOperationsMatchCards, getMatchRowActorIds, isPlayableMatch, mergeMatchCardsWithRows, mergeMatchRowsById, sortByFeedOrder, toClientMatch, toClientTeam } from "./_listProjection.js";
import { attachMatchPlayerCountsToCards, attachOpenDisputeQueues } from "./_listEnrichment.js";

const MATCH_CARD_SOURCE_COLUMNS = "id,court_id,court_name,scheduled_date,scheduled_time,scheduled_at,timing_type:rules->>timingType,updated_at";

async function loadCurrentRecruitingSchedule(context, adminLevel = 0) {
  if (!context.profileId) return null;
  try {
    const result = await loadCurrentUserRecruitingFeedList(context, {
      adminLevel,
      limit: REMOTE_CLIENT_MATCH_LIMIT,
      includeFeedCounts: false,
      skipCardReferenceRows: false,
      preferFreshRows: true,
      includeClosed: true,
    });
    return result?.state?.recruitingPosts?.length ? result : null;
  } catch (error) {
    console.warn("Match list recruiting schedule skipped.", error.message);
    return null;
  }
}

async function loadReferencedRecruitingPosts(context, matches = [], adminLevel = 0) {
  const explicitPostIds = unique((matches ?? []).map((match) => match?.recruitingPostId));
  if (!context.profileId || !explicitPostIds.length) return null;
  try {
    const result = await loadCompactRecruitingList(context, {
      adminLevel,
      pagePostIds: explicitPostIds,
      limit: explicitPostIds.length,
      preferFreshRows: true,
    });
    return result?.state?.recruitingPosts?.length ? result : null;
  } catch (error) {
    console.warn("Match list referenced recruiting posts skipped.", error.message);
    return null;
  }
}

async function buildCompactMatchListResult({
  context,
  currentUser,
  state,
  matches,
  relatedTournamentState,
  recruitingSchedulePromise,
  debugTiming,
  limit,
  pageCursor,
  pageExhausted,
  pageSource,
  completedSince,
  shouldLoadRecruitingSchedule,
  updatedRows,
}) {
  const recruitingSchedule = await timeStep(debugTiming, "recruitingScheduleMs", () => recruitingSchedulePromise);
  const recruitingState = recruitingSchedule?.state ?? {};
  const recruitingScheduleCount = recruitingState.recruitingPosts?.length ?? 0;
  const mergedState = {
    ...state,
    users: mergeById(
      mergeById(mergeById(state.users, relatedTournamentState.users), recruitingState.users),
      [compactClientUser(currentUser, currentUser.id)],
    ),
    teams: mergeById(mergeById(state.teams, relatedTournamentState.teams), recruitingState.teams),
    recruitingPosts: recruitingState.recruitingPosts ?? [],
    tournaments: relatedTournamentState.tournaments ?? [],
  };
  return {
    state: {
      ...mergedState,
      affiliations: [],
      seasons: [],
      reports: [],
      notifications: [],
      discordNotificationDeliveries: [],
    },
    page: {
      limit,
      count: matches.length,
      cursor: pageCursor,
      exhausted: pageExhausted,
      source: pageSource,
      completedSince: completedSince || undefined,
      recruitingScheduleChecked: shouldLoadRecruitingSchedule,
      recruitingScheduleCount,
    },
    updatedAt: Math.max(
      ...updatedRows.filter(Boolean)
        .map((row) => new Date(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? 0).getTime())
        .filter((value) => Number.isFinite(value)),
      0,
    ),
  };
}

export async function loadCompactMatchList(context, body = {}, adminLevel = 0, limit = REMOTE_CLIENT_MATCH_LIMIT, debugTiming = null) {
  const cursor = String(body.cursor ?? body.matchUpdatedBefore ?? "").trim();
  const refereeProfileId = String(body.refereeProfileId ?? "").trim();
  const operationsOnly = String(body.scope ?? "").trim().toLowerCase() === "operations";
  const shouldLoadRecruitingSchedule = !operationsOnly && !cursor && body.includeRecruitingSchedule === true;
  const completedOnly = !operationsOnly && body.completedOnly === true;
  const playOnly = !operationsOnly && body.playOnly === true;
  const scheduleOnly = !operationsOnly && body.scheduleOnly === true && !playOnly && !completedOnly;
  const completedSince = completedOnly ? getCompletedSince(body) : "";
  const activeOnly = body.activeOnly === true || playOnly;
  const includeTeamSchedule = !operationsOnly && body.includeTeamSchedule === true;
  const shouldLoadRecentCompleted = !operationsOnly && !scheduleOnly && !completedOnly && activeOnly && !cursor && body.includeRecentCompleted === true;
  const recentCompletedHours = shouldLoadRecentCompleted ? getRecentCompletedHours(body) : RECENT_COMPLETED_MATCH_HOURS;
  const includeCancelledSchedule = scheduleOnly && body.includeCancelledSchedule === true;
  const shouldLoadClosedNotices = body.includeClosedNotices !== false
    && !operationsOnly
    && !refereeProfileId
    && !playOnly
    && !completedOnly
    && activeOnly
    && !cursor
    && (!scheduleOnly || includeCancelledSchedule);
  const allowLegacyFallback = isLegacyListFallbackAllowed(body);
  const filterMatchItems = (items = []) => {
    if (operationsOnly) return filterOperationsMatchCards(items, context.profileId);
    let filtered = filterActiveMatchCards(items, activeOnly, {
      includeRecentCompleted: shouldLoadRecentCompleted,
      includeRecordRooms: playOnly,
      scheduleOnly,
      includeCancelledSchedule,
    });
    if (playOnly) filtered = filtered.filter((match) => isMatchInPlayMenu(match) && isPlayableMatch(match, context.profileId));
    if (completedOnly) filtered = filtered.filter((match) => (
      match.status === "confirmed" &&
      (projectMatchActivePlayerIds(match).includes(context.profileId) || match.__feedRelations?.includes("participant"))
    ));
    return filtered;
  };
  const recruitingSchedulePromise = shouldLoadRecruitingSchedule
    ? loadCurrentRecruitingSchedule(context, adminLevel)
    : Promise.resolve(null);
  const [baseFeedPage, recentCompletedPage, closedNoticePage, relatedActivePage, relatedTournamentState] = await Promise.all([
    operationsOnly
      || playOnly
      || refereeProfileId
      ? Promise.resolve(null)
      : completedOnly
      ? timeStep(debugTiming, "completedFeedMs", () => fetchCurrentUserCompletedMatchIds(context.supabase, context.profileId, limit, completedSince, allowLegacyFallback))
      : timeStep(debugTiming, "feedMs", () => fetchMatchFeedPage(context.supabase, context.profileId, limit, cursor, activeOnly)),
    shouldLoadRecentCompleted
      ? timeStep(debugTiming, "recentCompletedMs", () => fetchRecentCompletedMatchFeedPage(context.supabase, context.profileId, recentCompletedHours))
      : Promise.resolve(null),
    shouldLoadClosedNotices
      ? timeStep(debugTiming, "closedNoticeMs", () => fetchClosedNoticeMatchFeedPage(context.supabase, context.profileId))
      : Promise.resolve(null),
    !operationsOnly && !refereeProfileId && !cursor && !completedOnly && !playOnly && (activeOnly || includeTeamSchedule)
      ? timeStep(debugTiming, "relatedActiveMatchIdsMs", () => (
          fetchRelatedActiveMatchPage(context.supabase, context.profileId, limit, includeTeamSchedule)
        ))
      : Promise.resolve({ rows: [], source: "none" }),
    !operationsOnly && !refereeProfileId && !cursor && !completedOnly && !playOnly
      ? timeStep(debugTiming, "relatedTournamentsMs", () => loadCurrentUserTournamentIndex(context.supabase, context.profileId))
      : Promise.resolve({ users: [], teams: [], tournaments: [] }),
  ]);
  const relatedActiveRows = relatedActivePage?.rows ?? [];
  const captainTournamentMatchIds = new Set(relatedActiveRows.filter((row) => row?.captainTournament).map((row) => row.id));
  const memberTeamMatchIds = new Set(relatedActiveRows.filter((row) => row?.memberTeam).map((row) => row.id));
  const feedPage = mergeMatchFeedPages(mergeMatchFeedPages(baseFeedPage, recentCompletedPage), closedNoticePage);
  const feedCardIds = new Set((feedPage?.cards ?? []).map((card) => card?.id).filter(Boolean));
  const recentCompletedIds = new Set(recentCompletedPage?.ids ?? []);
  let pageSource = "feed";
  let pageCursor = feedPage?.cursor ?? "";
  let pageExhausted = feedPage?.exhausted ?? true;
  let matchRows = [];
  let matches = [];
  let playPageIds = [];
  if (operationsOnly) {
    const operationsPage = await timeStep(debugTiming, "operationsMatchesMs", () => (
      fetchOperationsMatchPage(context.supabase, context.profileId, limit)
    ));
    matchRows = operationsPage.rows;
    pageSource = operationsPage.source;
    pageCursor = operationsPage.cursor;
    pageExhausted = operationsPage.exhausted;
  } else if (refereeProfileId) {
    const refereePage = await timeStep(debugTiming, "refereeMatchesMs", () => (
      fetchRefereeMatchPage(context.supabase, refereeProfileId, limit)
    ));
    matchRows = refereePage.rows;
    pageSource = "referee";
    pageCursor = refereePage.cursor;
    pageExhausted = refereePage.exhausted;
  } else if (feedPage) {
    pageSource = feedPage.source ?? "feed";
    let feedCards = feedPage.cards ?? [];
    if (feedCards.length) {
      const sourceById = await timeStep(debugTiming, "cardSourceRowsMs", () => fetchRoomFeedSourceMap(
        context.supabase,
        feedCards.map((card) => ({ entity_type: "match", entity_id: card.id })),
        { columnsByType: { match: MATCH_CARD_SOURCE_COLUMNS } },
      ));
      feedCards = feedCards.map((card) => attachRoomFeedCardSource(card, sourceById.get(`match:${card.id}`)));
    }
    if (feedPage.cards?.length) {
      matches = sortByFeedOrder(
        filterMatchItems(feedCards),
        feedPage.ids,
      );
    }
    const rowFallbackIds = completedOnly
      ? feedPage.ids ?? []
      : (feedPage.ids ?? []).filter((id) => !feedCardIds.has(id) || recentCompletedIds.has(id));
    if (rowFallbackIds.length) {
      pageSource = appendRowFallbackSource(pageSource);
      matchRows = await timeStep(debugTiming, "matchRowsMs", () => (
        fetchMatchRowsByIds(context.supabase, rowFallbackIds)
      ));
    }
  } else if (!playOnly) {
    pageSource = allowLegacyFallback ? "fallback_mine" : "feed_unavailable";
    if (allowLegacyFallback) {
      const minePage = await timeStep(debugTiming, "fallbackMineMs", () => (
        fetchCurrentUserMatchPage(context.supabase, context.profileId, limit, cursor, activeOnly)
      ));
      matchRows = minePage?.rows ?? [];
      pageCursor = minePage?.cursor ?? "";
      pageExhausted = minePage?.exhausted ?? true;
    }
  }

  if (playOnly) {
    const playPage = await timeStep(debugTiming, "playMatchesMs", () => (
      fetchPlayMatchPage(context.supabase, context.profileId, limit, cursor)
    ));
    const playRows = playPage?.rows ?? [];
    playPageIds = playRows.map((row) => row?.id).filter(Boolean);
    matchRows = mergeMatchRowsById(matchRows, playRows);
    pageSource = "play";
    pageCursor = playPage?.cursor ?? "";
    pageExhausted = playPage?.exhausted ?? true;
  }
  const loadedMatchIds = new Set(matchRows.map((row) => row?.id).filter(Boolean));
  const relatedRowIds = unique(relatedActiveRows.map((row) => row?.id)).filter((id) => (
    !loadedMatchIds.has(id)
    && (
      !feedCardIds.has(id)
      || captainTournamentMatchIds.has(id)
      || memberTeamMatchIds.has(id)
    )
  ));
  if (relatedRowIds.length) {
    const relatedMatchRows = await timeStep(debugTiming, "relatedActiveMatchRowsMs", () => (
      fetchMatchRowsByIds(context.supabase, relatedRowIds)
    ));
    matchRows = mergeMatchRowsById(matchRows, relatedMatchRows);
    pageSource = appendRowFallbackSource(pageSource);
  }

  const currentUser = context.profile
    ? fromRemoteProfile(context.profile)
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const settings = {
    ...DEFAULT_SETTINGS,
    ...getRemoteAppSettings(context.profile),
  };

  if (matches.length && !matchRows.length) {
    const countedMatches = await attachMatchPlayerCountsToCards(context.supabase, matches, debugTiming);
    const queuedMatches = await attachOpenDisputeQueues(context.supabase, countedMatches, debugTiming);
    const cardScope = collectMissingMatchCardReferences(queuedMatches);
    const [
      { data: teamRows, error: teamError },
      { data: courtRows, error: courtError },
    ] = await timeStep(debugTiming, "cardRelatedRowsMs", () => Promise.all([
      cardScope.teamIds.length
        ? context.supabase.from("teams").select(TEAM_COLUMNS).in("id", cardScope.teamIds).is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      fetchCourtRowsByIds(context.supabase, cardScope.courtIds, COURT_COLUMNS),
    ]));
    if (teamError) throw teamError;
    if (courtError) throw courtError;
    const teams = (teamRows ?? []).map(toClientTeam);
    const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
    const courtById = firstBy(courtRows ?? [], "id");
    const referencedMatches = queuedMatches.map((match) => attachMatchCardReferences(match, teamById, courtById));
    const state = normalizeState({
      currentUserId: currentUser.id,
      users: [compactClientUser(currentUser, currentUser.id)],
      teams,
      matches: referencedMatches,
      settings,
    }, { includeDemo: false });
    return buildCompactMatchListResult({
      context,
      currentUser,
      state,
      matches: referencedMatches,
      relatedTournamentState,
      recruitingSchedulePromise,
      debugTiming,
      limit,
      pageCursor,
      pageExhausted,
      pageSource,
      completedSince,
      shouldLoadRecruitingSchedule,
      updatedRows: [...referencedMatches, context.profile],
    });
  }

  const hydrateCandidateLimit = Math.max(
    1,
    Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT),
  );
  matchRows = (matchRows ?? []).slice(0, hydrateCandidateLimit);
  const matchIds = matchRows.map((row) => row.id).filter(Boolean);
  const playerRowsPromise = matchIds.length
    ? timeStep(debugTiming, "matchPlayersMs", () => context.supabase.from("match_players").select(MATCH_PLAYER_COLUMNS).in("match_id", matchIds))
    : Promise.resolve({ data: [], error: null });
  const { data: playerRows, error: playerError } = await playerRowsPromise;
  if (playerError) throw playerError;

  const playersByMatch = groupBy(playerRows ?? [], "match_id");
  const readableRows = matchRows.filter((row) => operationsOnly
    ? row.created_by === context.profileId || row.referee_id === context.profileId
    : (
      captainTournamentMatchIds.has(row.id) ||
      memberTeamMatchIds.has(row.id) ||
      canReadMatchRow(row, playersByMatch.get(row.id) ?? [], context.profileId ?? "", adminLevel >= 30)
    ));
  const hydrationRows = playOnly ? readableRows : readableRows.filter((row) => {
    const preview = toClientMatch(row, playersByMatch, {}, {}, {}, new Map());
    return filterMatchItems([preview]).length > 0;
  });
  const hydrationMatchIds = hydrationRows.map((row) => row.id).filter(Boolean);
  const resultRowsPromise = hydrationMatchIds.length
    ? timeStep(debugTiming, "matchResultsMs", () => context.supabase.from("match_results").select(MATCH_RESULT_COLUMNS).in("match_id", hydrationMatchIds))
    : Promise.resolve({ data: [], error: null });
  const statRowsPromise = hydrationMatchIds.length
    ? timeStep(debugTiming, "matchStatsMs", () => context.supabase.from("player_match_stats").select(PLAYER_STAT_COLUMNS).in("match_id", hydrationMatchIds))
    : Promise.resolve({ data: [], error: null });
  const teamIds = unique(hydrationRows.flatMap((row) => [
    row.team_a_id,
    row.team_b_id,
    ...(playersByMatch.get(row.id) ?? []).map((player) => player.team_id),
  ]));
  const courtIds = unique(hydrationRows.map((row) => (row.court_name ? "" : row.court_id)));
  const profileIds = unique(hydrationRows.flatMap((row) => getMatchRowActorIds(row, playersByMatch.get(row.id) ?? [])));
  const profileIdsForLookup = profileIds.filter((profileId) => profileId !== currentUser.id);

  const [
    { data: resultRows, error: resultError },
    { data: statRows, error: statError },
    { data: teamRows, error: teamError },
    { data: courtRows, error: courtError },
    { data: profileRows, error: profileError },
  ] = await Promise.all([
    resultRowsPromise,
    statRowsPromise,
    teamIds.length
      ? timeStep(debugTiming, "matchTeamsMs", () => context.supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null))
      : Promise.resolve({ data: [], error: null }),
    timeStep(debugTiming, "matchCourtsMs", () => fetchCourtRowsByIds(context.supabase, courtIds, COURT_COLUMNS)),
    profileIdsForLookup.length
      ? timeStep(debugTiming, "matchProfilesMs", () => context.supabase.from("profiles").select(PROFILE_CARD_COLUMNS).in("id", profileIdsForLookup))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (resultError) throw resultError;
  if (statError) throw statError;
  if (teamError) throw teamError;
  if (courtError) throw courtError;
  if (profileError) throw profileError;

  const resultsByMatch = firstBy(resultRows ?? [], "match_id");
  const statsByMatch = groupBy(statRows ?? [], "match_id");
  const userById = new Map((profileRows ?? []).map((row) => {
    const user = fromRemoteProfile(row);
    return [user.id, user];
  }));
  userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });
  const users = [...userById.values()].map((user) => compactClientUser(user, currentUser.id));

  const teams = (teamRows ?? []).map(toClientTeam);
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const courtById = firstBy(courtRows ?? [], "id");
  const rowMatches = hydrationRows
    .map((row) => {
      const match = toClientMatch(row, playersByMatch, teamById, courtById, resultsByMatch, statsByMatch);
      const relations = [
        ...(match.__feedRelations ?? []),
        ...(captainTournamentMatchIds.has(row.id) ? ["tournament_captain"] : []),
        ...(memberTeamMatchIds.has(row.id) ? ["team"] : []),
      ];
      return relations.length ? { ...match, __feedRelations: unique(relations) } : match;
    })
    .filter((match) => playOnly || filterMatchItems([match]).length > 0);
  const countedMatches = rowMatches.length
    ? await attachMatchPlayerCountsToCards(context.supabase, rowMatches, debugTiming)
    : rowMatches;
  matches = playOnly
    ? sortByFeedOrder(countedMatches, playPageIds)
    : feedPage?.ids?.length
      ? sortByFeedOrder(mergeMatchCardsWithRows(countedMatches, rowMatches), feedPage.ids)
      : countedMatches.sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
  matches = await attachOpenDisputeQueues(context.supabase, matches, debugTiming);
  if (playOnly || operationsOnly) {
    matches = matches.filter((match) => filterMatchItems([match]).length > 0);
  }
  const state = normalizeState({
    currentUserId: currentUser.id,
    users,
    teams,
    matches,
    settings,
  }, { includeDemo: false });
  const resultRecruitingSchedulePromise = operationsOnly
    ? loadReferencedRecruitingPosts(context, matches, adminLevel)
    : recruitingSchedulePromise;
  return buildCompactMatchListResult({
    context,
    currentUser,
    state,
    matches,
    relatedTournamentState,
    recruitingSchedulePromise: resultRecruitingSchedulePromise,
    debugTiming,
    limit,
    pageCursor,
    pageExhausted,
    pageSource,
    completedSince,
    shouldLoadRecruitingSchedule,
    updatedRows: [...(matchRows ?? []), ...matches, context.profile],
  });
}
