import { fetchCourtRowsByIds, firstRowBy as firstBy, groupRowsBy as groupBy, isMissingTable, toDateTime, uniqueStringIds as uniqueIds } from "../_supabaseAdmin.js";
import { normalizeState } from "../../../shared/lib/stateNormalizer.js";
import { fromRemoteRecruitingPost, toClientRecruitingTeam } from "../../../shared/lib/recruitingMappers.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../shared/lib/profileMappers.js";
import { DEFAULT_SETTINGS } from "../../../shared/lib/repositoryDefaults.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../shared/lib/constants.js";
import { COURT_COLUMNS, PROFILE_CARD_COLUMNS as PROFILE_PUBLIC_COLUMNS, RECRUITING_APPLICATION_COLUMNS, RECRUITING_POST_COLUMNS, TEAM_COLUMNS, TEAM_MEMBER_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { ROOM_CHAT_HISTORY_LIMIT, ROOM_CHAT_MESSAGE_COLUMNS, clampRoomChatHistoryLimit, fromRoomChatMessageRow } from "../../../shared/lib/roomChat.js";
import { RECRUITING_COUNT_POST_COLUMNS, fetchCurrentUserRecruitingFallbackPostIds, fetchRecruitingFeedCounts, fetchRecruitingFeedPage, getRecruitingMineRelations, mergeRecruitingFeedPages } from "./_listQueries.js";
import { appendMissingTeamMemberProfiles, attachFreshRecruitingListCounts, attachPendingInvitationsToFeedCards, attachRecruitingCardReferences, canReadRecruitingPostDetail, canUseFeedCardForProfile, collectRecruitingCardScope, collectRecruitingScope, compactRecruitingListState, getRecruitingFeedCardRejectReason, getRecruitingListCountsFromPost, hasThinRecruitingListCounts, normalizeRegionKey, toRecruitingCountPost, uniqueFeedCards } from "./_listProjection.js";

export const RECRUITING_APPROVED_COURT_COLUMNS = `${COURT_COLUMNS},paid`;

export async function fetchRoomChatMessagesByPostIds(client, postIds = [], limitPerRoom = ROOM_CHAT_HISTORY_LIMIT) {
  const ids = uniqueIds(postIds);
  if (!ids.length) return new Map();
  const cappedLimit = clampRoomChatHistoryLimit(limitPerRoom);
  const { data, error } = await client
    .from("room_chat_messages")
    .select(ROOM_CHAT_MESSAGE_COLUMNS)
    .eq("room_type", "recruiting")
    .in("room_id", ids)
    .order("message_seq", { ascending: false })
    .limit(ids.length * cappedLimit);
  if (error) {
    if (isMissingTable(error, "room_chat_messages")) return new Map();
    throw error;
  }
  const grouped = groupBy(data ?? [], "room_id");
  const messagesByPost = new Map();
  ids.forEach((postId) => {
    const messages = (grouped.get(postId) ?? [])
      .slice(0, cappedLimit)
      .map(fromRoomChatMessageRow)
      .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
    if (messages.length) messagesByPost.set(postId, messages);
  });
  return messagesByPost;
}

export async function fetchRecruitingListCountsByPostId(client, postIds = []) {
  const ids = uniqueIds(postIds);
  if (!ids.length) return new Map();
  const { data: postRows, error: postError } = await client
    .from("recruiting_posts")
    .select(RECRUITING_COUNT_POST_COLUMNS)
    .in("id", ids);
  if (postError) throw postError;
  const { data: applicationRows, error: applicationError } = await client
    .from("recruiting_applications")
    .select(RECRUITING_APPLICATION_COLUMNS)
    .in("post_id", ids);
  if (applicationError) throw applicationError;
  const applicationsByPost = groupBy(applicationRows ?? [], "post_id");
  return new Map((postRows ?? []).map((row) => {
    const post = toRecruitingCountPost(row, applicationsByPost);
    return [row.id, getRecruitingListCountsFromPost(post)];
  }));
}

export async function fetchRecruitingRowsByIds(client, postIds = []) {
  const ids = uniqueIds(postIds);
  if (!ids.length) return [];
  const { data, error } = await client
    .from("recruiting_posts")
    .select(RECRUITING_POST_COLUMNS)
    .in("id", ids);
  if (error) throw error;
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...(data ?? [])].sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
}

export async function fetchReadableRecruitingRows(client, postIds, profileId, adminLevel) {
  const postRowsRaw = await fetchRecruitingRowsByIds(client, postIds);
  const rawPostIds = postRowsRaw.map((post) => post.id).filter(Boolean);
  const { data: applicationRowsRaw, error: applicationError } = rawPostIds.length
    ? await client.from("recruiting_applications").select(RECRUITING_APPLICATION_COLUMNS).in("post_id", rawPostIds)
    : { data: [], error: null };
  if (applicationError) throw applicationError;
  const applicationsByRawPost = groupBy(applicationRowsRaw ?? [], "post_id");
  const postRows = postRowsRaw.filter((post) => (
    canReadRecruitingPostDetail(post, applicationsByRawPost.get(post.id) ?? [], profileId ?? "", adminLevel)
  ));
  const readablePostIds = new Set(postRows.map((post) => post.id).filter(Boolean));
  return {
    postRows,
    applicationRows: (applicationRowsRaw ?? []).filter((application) => readablePostIds.has(application.post_id)),
  };
}

export async function fetchRecruitingReferenceRows(client, scope, currentUserId, { loadTeamMembers = true } = {}) {
  const profileIdsForLookup = scope.profileIds.filter((profileId) => profileId !== currentUserId);
  const [
    { data: teamRows, error: teamError },
    { data: teamMemberRows, error: teamMemberError },
    { data: profileRows, error: profileError },
    { data: courtRows, error: courtError },
  ] = await Promise.all([
    scope.teamIds.length
      ? client.from("teams").select(TEAM_COLUMNS).in("id", scope.teamIds).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    loadTeamMembers && scope.teamIds.length
      ? client.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", scope.teamIds)
      : Promise.resolve({ data: [], error: null }),
    profileIdsForLookup.length
      ? client.from("profiles").select(PROFILE_PUBLIC_COLUMNS).in("id", profileIdsForLookup)
      : Promise.resolve({ data: [], error: null }),
    fetchCourtRowsByIds(client, scope.courtIds, COURT_COLUMNS, {
      approvedColumns: RECRUITING_APPROVED_COURT_COLUMNS,
    }),
  ]);
  if (teamError) throw teamError;
  if (teamMemberError) throw teamMemberError;
  if (profileError) throw profileError;
  if (courtError) throw courtError;
  return { teamRows, teamMemberRows, profileRows, courtRows };
}

export function createRecruitingUserMap(profileRows, currentUser) {
  const userById = new Map((profileRows ?? []).map((row) => {
    const user = fromRemoteProfile(row);
    return [user.id, user];
  }));
  userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });
  return userById;
}

export function buildCompactRecruitingResult({
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
  source,
  feedCounts,
  debugPage,
  inviteRepairCandidateCount,
  repairedCardCount,
  fallbackCount,
  fallbackCardReasons,
  updatedRows,
}) {
  return {
    state: compactRecruitingListState(state, currentUser.id, { includeRoomChat, includeRoomInvitations }),
    page: {
      limit,
      count: mineOnly ? responsePosts.length : pagePostIds.length,
      offset,
      nextOffset,
      cursor: String(nextOffset),
      exhausted: typeof pageExhausted === "boolean" ? pageExhausted : pagePostIds.length < limit,
      regionScope: regionKey ? "region" : regionScope,
      regionKey,
      startFilter,
      timingType,
      scheduledDate,
      source,
      feedCounts,
      inviteRepairCandidateCount: debugPage ? inviteRepairCandidateCount : undefined,
      inviteRepairCount: debugPage ? repairedCardCount : undefined,
      fallbackCount: debugPage ? fallbackCount : undefined,
      fallbackCardReasons,
    },
    updatedAt: Math.max(
      ...updatedRows.filter(Boolean)
        .map((row) => new Date(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? 0).getTime())
        .filter((value) => Number.isFinite(value)),
      0,
    ),
  };
}
