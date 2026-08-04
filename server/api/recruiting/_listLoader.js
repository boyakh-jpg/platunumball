import { firstRowBy as firstBy, groupRowsBy as groupBy, toDateTime, uniqueStringIds as uniqueIds } from "../_supabaseAdmin.js";
import { normalizeState } from "../../../shared/lib/stateNormalizer.js";
import { fromRemoteRecruitingPost, toClientRecruitingTeam } from "../../../shared/lib/recruitingMappers.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../shared/lib/profileMappers.js";
import { DEFAULT_SETTINGS } from "../../../shared/lib/repositoryDefaults.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../shared/lib/constants.js";
import { fetchRoomFeedSourceMap } from "../../lib/roomFeedSources.js";

import {
  fetchCurrentUserRecruitingFallbackPostIds,
  fetchRecruitingFeedCounts,
  fetchRecruitingFeedPage,
  getRecruitingMineRelations,
  mergeRecruitingFeedPages,
} from "./_listQueries.js";
import {
  appendMissingTeamMemberProfiles,
  attachFreshRecruitingListCounts,
  attachPendingInvitationsToFeedCards,
  attachRecruitingCardReferences,
  attachRecruitingCardSource,
  canUseFeedCardForProfile,
  collectRecruitingCardScope,
  collectRecruitingScope,
  compactRecruitingListState,
  getRecruitingFeedCardRejectReason,
  hasThinRecruitingListCounts,
  normalizeRegionKey,
  uniqueFeedCards,
} from "./_listProjection.js";
import {
  fetchRoomChatMessagesByPostIds,
  fetchRecruitingListCountsByPostId,
  fetchReadableRecruitingRows,
  fetchRecruitingReferenceRows,
  createRecruitingUserMap,
  buildCompactRecruitingResult,
} from "./_listLoaderHelpers.js";

const RECRUITING_CARD_SOURCE_COLUMNS = "id,court_id,court_name,scheduled_date,scheduled_time,scheduled_at,timing_type:room_state->>timingType,updated_at";


















export async function loadCompactRecruitingList(context, {
  adminLevel = 0,
  currentUserPostIds = [],
  explicitPostIds = [],
  includeMine = false,
  mineOnly = false,
  pagePostIds = [],
  pageCards = [],
  pageSource = "",
  pageExhausted = null,
  pageNextOffset = null,
  feedCounts = null,
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  offset = 0,
  regionScope = "local",
  regionKey = "",
  startFilter = "all",
  timingType = "",
  scheduledDate = "",
  debugPage = false,
  skipCardReferenceRows = false,
  preferFreshRows = false,
} = {}) {
  const targetPostIds = uniqueIds([...explicitPostIds, ...(mineOnly ? currentUserPostIds : pagePostIds), ...(includeMine ? currentUserPostIds : [])]);
  const targetCards = preferFreshRows ? [] : uniqueFeedCards(pageCards.map((card) => ({ entity_id: card?.id, card_json: card })), targetPostIds);
  const includeRoomChat = explicitPostIds.length > 0;
  const includeRoomInvitations = explicitPostIds.length > 0;
  const canUsePageCards = pageCards.length > 0
    && !preferFreshRows
    && !explicitPostIds.length
    && targetCards.length > 0
    && targetPostIds.length > 0;
  const currentUser = context.profile
    ? fromRemoteProfile(context.profile)
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const settings = {
    ...DEFAULT_SETTINGS,
    ...getRemoteAppSettings(context.profile),
  };
  const nextOffset = Number.isFinite(Number(pageNextOffset))
    ? Math.max(offset, Math.floor(Number(pageNextOffset)))
    : offset + pagePostIds.length;

  if (!targetPostIds.length) {
    const state = normalizeState({
      currentUserId: currentUser.id,
      users: [currentUser],
      teams: [],
      recruitingPosts: [],
      settings,
    }, { includeDemo: false });
    return {
      state: compactRecruitingListState(state, currentUser.id, { includeRoomChat, includeRoomInvitations }),
      page: {
        limit,
        count: 0,
        offset,
        nextOffset,
        cursor: String(nextOffset),
        exhausted: true,
        regionScope: regionKey ? "region" : regionScope,
        regionKey,
        startFilter,
        timingType,
        scheduledDate,
        source: pageSource || "empty",
        feedCounts,
      },
      updatedAt: Number(new Date(context.profile?.updated_at ?? 0).getTime()) || 0,
    };
  }

  if (canUsePageCards) {
    const shouldRefreshListCounts = targetCards.some(hasThinRecruitingListCounts);
    const freshListCountsByPost = shouldRefreshListCounts
      ? await fetchRecruitingListCountsByPostId(context.supabase, targetPostIds)
      : new Map();
    let countedTargetCards = attachFreshRecruitingListCounts(targetCards, freshListCountsByPost);
    const sourceById = await fetchRoomFeedSourceMap(
      context.supabase,
      countedTargetCards.map((card) => ({ entity_type: "recruiting", entity_id: card.id })),
      { columnsByType: { recruiting: RECRUITING_CARD_SOURCE_COLUMNS } },
    );
    countedTargetCards = countedTargetCards.map((card) => (
      attachRecruitingCardSource(card, sourceById.get(`recruiting:${card.id}`))
    ));
    const cardById = new Map(
      countedTargetCards
        .filter((card) => canUseFeedCardForProfile(card, context.profileId))
        .map((card) => [card.id, card]),
    );
    const inviteRepairCandidateCount = debugPage
      ? countedTargetCards.filter((card) => getRecruitingFeedCardRejectReason(card, context.profileId) === "missing_pending_invitation").length
      : 0;
    const repairedCards = await attachPendingInvitationsToFeedCards(context.supabase, countedTargetCards, context.profileId);
    repairedCards.forEach((card) => cardById.set(card.id, card));
    const fallbackPostIds = targetPostIds.filter((postId) => !cardById.has(postId));
    const fallbackCardReasons = debugPage && fallbackPostIds.length
      ? fallbackPostIds.map((postId) => {
        const card = countedTargetCards.find((item) => item.id === postId);
        return { postId, reason: getRecruitingFeedCardRejectReason(card, context.profileId) };
      })
      : undefined;
    const { postRows, applicationRows } = await fetchReadableRecruitingRows(
      context.supabase,
      fallbackPostIds,
      context.profileId,
      adminLevel,
    );
    if (skipCardReferenceRows && !fallbackPostIds.length) {
      const cardCourtIds = collectRecruitingCardScope(countedTargetCards).courtIds;
      const { courtRows } = await fetchRecruitingReferenceRows(
        context.supabase,
        { profileIds: [], teamIds: [], courtIds: cardCourtIds },
        context.profileId,
        { loadTeamMembers: false },
      );
      const courtById = firstBy(courtRows ?? [], "id");
      const responsePosts = targetPostIds
        .map((postId) => cardById.get(postId))
        .filter(Boolean)
        .map((card) => attachRecruitingCardReferences(card, courtById));
      const state = normalizeState({
        currentUserId: currentUser.id,
        users: [currentUser],
        teams: [],
        recruitingPosts: responsePosts,
        settings,
      }, { includeDemo: false });
      return buildCompactRecruitingResult({
        state,
        currentUser,
        includeRoomChat,
        includeRoomInvitations,
        responsePosts,
        mineOnly,
        pagePostIds,
        limit,
        offset,
        nextOffset,
        pageExhausted,
        regionScope,
        regionKey,
        startFilter,
        timingType,
        scheduledDate,
        source: pageSource || "feed_card",
        feedCounts,
        debugPage,
        inviteRepairCandidateCount,
        repairedCardCount: repairedCards.length,
        fallbackCount: 0,
        fallbackCardReasons,
        updatedRows: [...responsePosts, context.profile],
      });
    }

    const rowScope = collectRecruitingScope(postRows, applicationRows ?? [], context.profileId ?? "");
    const cardScope = collectRecruitingCardScope(countedTargetCards, context.profileId ?? "");
    const scope = {
      profileIds: uniqueIds([...rowScope.profileIds, ...cardScope.profileIds]),
      teamIds: uniqueIds([...rowScope.teamIds, ...cardScope.teamIds]),
      courtIds: uniqueIds([...rowScope.courtIds, ...cardScope.courtIds]),
    };
    const shouldLoadTeamMembers = fallbackPostIds.length > 0 || countedTargetCards.some((card) => (
      Array.isArray(card?.playerIds) && card.playerIds.length > 0
    ));
    const { teamRows, teamMemberRows, profileRows, courtRows } = await fetchRecruitingReferenceRows(
      context.supabase,
      scope,
      currentUser.id,
      { loadTeamMembers: shouldLoadTeamMembers },
    );
    const userById = createRecruitingUserMap(profileRows, currentUser);

    const teamMembersByTeam = groupBy(teamMemberRows ?? [], "team_id");
    const teams = (teamRows ?? []).map((team) => toClientRecruitingTeam(team, teamMembersByTeam.get(team.id)));
    const courtById = firstBy(courtRows ?? [], "id");
    const applicationsByPost = groupBy(applicationRows ?? [], "post_id");
    const rowPostById = new Map(postRows.map((post) => [post.id, fromRemoteRecruitingPost(post, {
      applicationsByPost,
      courtById,
      normalizeRegionKey,
      toDateTime,
    })]));
    const responsePosts = targetPostIds
      .map((postId) => {
        const card = cardById.get(postId);
        return card ? attachRecruitingCardReferences(card, courtById) : rowPostById.get(postId);
      })
      .filter(Boolean);
    const state = normalizeState({
      currentUserId: currentUser.id,
      users: [...userById.values()],
      teams,
      recruitingPosts: responsePosts,
      settings,
    }, { includeDemo: false });
    return buildCompactRecruitingResult({
      state,
      currentUser,
      includeRoomChat,
      includeRoomInvitations,
      responsePosts,
      mineOnly,
      pagePostIds,
      limit,
      offset,
      nextOffset,
      pageExhausted,
      regionScope,
      regionKey,
      startFilter,
      timingType,
      scheduledDate,
      source: pageSource
        ? (fallbackPostIds.length ? `${pageSource}+row` : pageSource)
        : (fallbackPostIds.length ? "feed_card+row" : "feed_card"),
      feedCounts,
      debugPage,
      inviteRepairCandidateCount,
      repairedCardCount: repairedCards.length,
      fallbackCount: fallbackPostIds.length,
      fallbackCardReasons,
      updatedRows: [...pageCards, ...postRows, context.profile],
    });
  }

  const { postRows, applicationRows } = await fetchReadableRecruitingRows(
    context.supabase,
    targetPostIds,
    context.profileId,
    adminLevel,
  );
  const postIds = postRows.map((post) => post.id).filter(Boolean);

  const chatMessagesByPost = includeRoomChat
    ? await fetchRoomChatMessagesByPostIds(context.supabase, postIds)
    : new Map();
  const chatProfileIds = [...chatMessagesByPost.values()]
    .flat()
    .map((message) => message.userId)
    .filter(Boolean);
  const scope = collectRecruitingScope(postRows, applicationRows ?? [], context.profileId ?? "");
  scope.profileIds = uniqueIds([...scope.profileIds, ...chatProfileIds]);
  const { teamRows, teamMemberRows, profileRows, courtRows } = await fetchRecruitingReferenceRows(
    context.supabase,
    scope,
    currentUser.id,
  );

  const profileRowsWithTeamMembers = await appendMissingTeamMemberProfiles(context.supabase, profileRows ?? [], teamMemberRows ?? [], currentUser.id);
  const userById = createRecruitingUserMap(profileRowsWithTeamMembers, currentUser);

  const teamMembersByTeam = groupBy(teamMemberRows ?? [], "team_id");
  const teams = (teamRows ?? []).map((team) => toClientRecruitingTeam(team, teamMembersByTeam.get(team.id)));
  const courtById = firstBy(courtRows ?? [], "id");
  const applicationsByPost = groupBy(applicationRows ?? [], "post_id");
  const posts = postRows.map((post) => fromRemoteRecruitingPost(post, {
    applicationsByPost,
    courtById,
    chatMessagesByPost,
    normalizeRegionKey,
    toDateTime,
  }));
  const state = normalizeState({
    currentUserId: currentUser.id,
    users: [...userById.values()],
    teams,
    recruitingPosts: posts,
    settings,
  }, { includeDemo: false });
  const responseState = compactRecruitingListState(state, currentUser.id, { includeRoomChat, includeRoomInvitations });

  return {
    state: responseState,
    page: {
      limit,
      count: mineOnly ? posts.length : pagePostIds.length,
      offset,
      nextOffset,
      cursor: String(nextOffset),
      exhausted: mineOnly || Boolean(explicitPostIds.length) || (typeof pageExhausted === "boolean" ? pageExhausted : pagePostIds.length < limit),
      regionScope: regionKey ? "region" : regionScope,
      regionKey,
      startFilter,
      timingType,
      scheduledDate,
      source: pageSource || "row",
      feedCounts,
    },
    updatedAt: Math.max(
      ...[...postRows, context.profile].filter(Boolean)
        .map((row) => new Date(row.updated_at ?? row.created_at ?? 0).getTime())
        .filter((value) => Number.isFinite(value)),
      0,
    ),
  };
}

export async function loadCurrentUserRecruitingFeedList(context, {
  adminLevel = 0,
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  includeFeedCounts = false,
  allowLegacyFallback = false,
  roomScope = "",
  skipCardReferenceRows = false,
  preferFreshRows = false,
  includeClosed = false,
} = {}) {
  if (!context.profileId) {
    return loadCompactRecruitingList(context, { adminLevel, limit, mineOnly: true });
  }
  const relations = getRecruitingMineRelations(roomScope);
  const [activePageResult, terminalPageResult, feedCounts] = await Promise.all([
    fetchRecruitingFeedPage(context.supabase, {
      profileId: context.profileId,
      relations,
      limit,
      includeCards: true,
    }),
    includeClosed
      ? fetchRecruitingFeedPage(context.supabase, {
          profileId: context.profileId,
          relations,
          statuses: ["closed", "cancelled"],
          isActive: false,
          limit,
          includeCards: true,
        })
      : Promise.resolve(null),
    includeFeedCounts
      ? fetchRecruitingFeedCounts(context.supabase, context.profileId)
      : Promise.resolve(null),
  ]);
  const pageResult = mergeRecruitingFeedPages(activePageResult, terminalPageResult);
  if (pageResult) {
    return loadCompactRecruitingList(context, {
      adminLevel,
      pagePostIds: pageResult.ids ?? [],
      pageCards: pageResult.cards ?? [],
      pageSource: pageResult.source ?? "feed",
      pageExhausted: pageResult.exhausted,
      pageNextOffset: pageResult.nextOffset,
      feedCounts,
      limit,
      skipCardReferenceRows,
      preferFreshRows,
    });
  }
  if (!allowLegacyFallback) {
    return loadCompactRecruitingList(context, {
      adminLevel,
      pagePostIds: [],
      pageCards: [],
      pageSource: "feed_unavailable",
      pageExhausted: true,
      feedCounts,
      limit,
    });
  }
  const currentUserPostIds = await fetchCurrentUserRecruitingFallbackPostIds(context.supabase, context.profileId, limit);
  return loadCompactRecruitingList(context, {
    adminLevel,
    currentUserPostIds,
    includeMine: true,
    mineOnly: true,
    limit,
  });
}
