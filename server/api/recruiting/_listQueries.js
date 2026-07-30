import { isMissingUserRoomFeed, uniqueStringIds as uniqueIds } from "../_supabaseAdmin.js";
import { mergeRoomFeedCards as mergeFeedCards } from "../../lib/roomFeedCards.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../shared/lib/constants.js";

import { attachRoomFeedCards, getRoomStateParticipantIds, isSameRegionKey, uniqueFeedCards } from "./_listProjection.js";

let userRoomFeedAvailable = true;

let userRoomFeedScopeAvailable = true;

let userRoomFeedTimingColumnsAvailable = true;

export const RECRUITING_COUNT_POST_COLUMNS = "id,type,visibility,mode,rules,room_state,host_join_mode,host_side,side_capacity,bench_capacity,player_ids,player_id,team_id,status";

const RECRUITING_FEED_MAX_LIMIT = 200;

export const RECRUITING_PUBLIC_PAGE_MAX_LIMIT = 80;

const RECRUITING_FEED_ROW_MAX_LIMIT = 320;

const RECRUITING_FEED_RELATION_ROW_FACTOR = 4;

const RECRUITING_FEED_PUBLIC_ROW_FACTOR = 2;

const LEGACY_PUBLIC_RECRUITING_FEED_PROFILE_ID = "*";

const PUBLIC_RECRUITING_FEED_SCOPE = "public";

const PROFILE_RECRUITING_FEED_SCOPE = "profile";

export const INSTANT_TIMING_TYPE = "instant";

const LEGACY_INSTANT_LABEL = "즉시";

function isMissingUserRoomFeedScope(error = {}) {
  const message = String(error?.message ?? "");
  return message.includes("feed_scope");
}

function isMissingUserRoomFeedTimingColumns(error = {}) {
  const message = String(error?.message ?? "");
  return message.includes("timing_type") || message.includes("scheduled_date");
}

function isMissingRecruitingFeedCountsRpc(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST202" || error?.code === "42883" || message.includes("rankball_recruiting_feed_counts");
}

function isMissingRecruitingFeedRefreshRpc(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST202" || error?.code === "42883" || message.includes("rankball_refresh_recruiting_feed_for_post");
}

async function fetchPostIds(query, idColumn = "id") {
  const { data, error } = await query;
  if (error) {
    console.warn("Current user recruiting id query skipped.", error.message);
    return [];
  }
  return (data ?? []).map((row) => row?.[idColumn]).filter(Boolean);
}

async function fetchRoomStateParticipantPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT) {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(RECRUITING_FEED_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const { data, error } = await client
    .from("recruiting_posts")
    .select("id,room_state")
    .eq("status", "open")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(cappedLimit);
  if (error) {
    console.warn("Current user recruiting room_state query skipped.", error.message);
    return [];
  }
  return (data ?? [])
    .filter((row) => getRoomStateParticipantIds(row?.room_state ?? {}).includes(profileId))
    .map((row) => row.id)
    .filter(Boolean);
}


async function queryRecruitingFeedPage(client, {
  profileId = "",
  feedScope = PROFILE_RECRUITING_FEED_SCOPE,
  relations = [],
  status = "open",
  statuses = [],
  isActive = true,
  regionKey = "",
  rowLimit = RECRUITING_FEED_ROW_MAX_LIMIT,
  safeOffset = 0,
  includeCards = false,
  timingType = "",
  scheduledDate = "",
  useFeedScope = false,
  useTimingColumns = true,
} = {}) {
  const selectColumns = includeCards
    ? (useTimingColumns ? "entity_id,sort_at,relation,timing_type,scheduled_date" : "entity_id,sort_at,relation,card_json")
    : (useTimingColumns ? "entity_id,sort_at,relation,timing_type,scheduled_date" : "entity_id,sort_at,relation");
  let query = client
    .from("user_room_feed")
    .select(selectColumns)
    .eq("entity_type", "recruiting")
    .eq("is_active", isActive)
    .order("sort_at", { ascending: false, nullsFirst: false })
    .order("entity_id", { ascending: false })
    .range(safeOffset, safeOffset + rowLimit - 1);
  query = statuses.length ? query.in("status", statuses) : query.eq("status", status);
  if (useFeedScope) {
    query = query.eq("feed_scope", feedScope);
    if (feedScope !== PUBLIC_RECRUITING_FEED_SCOPE) query = query.eq("profile_id", profileId);
  } else {
    query = query.eq("profile_id", profileId);
  }
  if (relations.length) query = query.in("relation", relations);
  if (regionKey) query = query.eq("region_key", regionKey);
  if (useTimingColumns) {
    if (timingType === INSTANT_TIMING_TYPE) query = query.eq("timing_type", INSTANT_TIMING_TYPE);
    if (scheduledDate) query = query.eq("scheduled_date", scheduledDate);
  } else {
    if (timingType === INSTANT_TIMING_TYPE) query = query.or(`card_json->>timingType.eq.${INSTANT_TIMING_TYPE},card_json->>scheduledAt.eq.${LEGACY_INSTANT_LABEL}`);
    if (scheduledDate) query = query.eq("card_json->>scheduledDate", scheduledDate);
  }
  return query;
}

export async function fetchRecruitingFeedPage(client, {
  profileId = "",
  feedScope = "",
  relations = [],
  status = "open",
  statuses = [],
  isActive = true,
  regionKey = "",
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  offset = 0,
  includeCards = false,
  timingType = "",
  scheduledDate = "",
} = {}) {
  if (!userRoomFeedAvailable) return null;
  const scope = feedScope || (relations.includes("region_public") ? PUBLIC_RECRUITING_FEED_SCOPE : PROFILE_RECRUITING_FEED_SCOPE);
  const feedProfileId = scope === PUBLIC_RECRUITING_FEED_SCOPE ? LEGACY_PUBLIC_RECRUITING_FEED_PROFILE_ID : profileId;
  if (scope !== PUBLIC_RECRUITING_FEED_SCOPE && !feedProfileId) return null;
  const cappedLimit = Math.max(1, Math.min(RECRUITING_FEED_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const rowLimit = Math.min(RECRUITING_FEED_ROW_MAX_LIMIT, cappedLimit * (relations.length ? RECRUITING_FEED_RELATION_ROW_FACTOR : RECRUITING_FEED_PUBLIC_ROW_FACTOR));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const queryOptions = {
    profileId: feedProfileId,
    feedScope: scope,
    relations,
    status,
    statuses,
    isActive,
    regionKey,
    rowLimit,
    safeOffset,
    includeCards,
    timingType,
    scheduledDate,
  };
  let { data, error } = await queryRecruitingFeedPage(client, {
    ...queryOptions,
    useFeedScope: userRoomFeedScopeAvailable,
    useTimingColumns: userRoomFeedTimingColumnsAvailable,
  });
  if (error && userRoomFeedScopeAvailable && isMissingUserRoomFeedScope(error)) {
    userRoomFeedScopeAvailable = false;
    console.warn("User room feed scope skipped.", error.message);
    ({ data, error } = await queryRecruitingFeedPage(client, {
      ...queryOptions,
      useFeedScope: false,
      useTimingColumns: userRoomFeedTimingColumnsAvailable,
    }));
  }
  if (error && userRoomFeedTimingColumnsAvailable && isMissingUserRoomFeedTimingColumns(error)) {
    userRoomFeedTimingColumnsAvailable = false;
    console.warn("User room feed timing columns skipped.", error.message);
    ({ data, error } = await queryRecruitingFeedPage(client, {
      ...queryOptions,
      useFeedScope: userRoomFeedScopeAvailable,
      useTimingColumns: false,
    }));
  }
  if (error && userRoomFeedScopeAvailable && isMissingUserRoomFeedScope(error)) {
    userRoomFeedScopeAvailable = false;
    console.warn("User room feed scope skipped.", error.message);
    ({ data, error } = await queryRecruitingFeedPage(client, {
      ...queryOptions,
      useFeedScope: false,
      useTimingColumns: userRoomFeedTimingColumnsAvailable,
    }));
  }
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("User room feed skipped.", error.message);
      return null;
    }
    throw error;
  }
  const rows = includeCards ? await attachRoomFeedCards(client, data ?? [], "recruiting") : (data ?? []);
  const ids = uniqueIds(rows.map((row) => row?.entity_id)).slice(0, cappedLimit);
  const cards = includeCards ? uniqueFeedCards(rows, ids) : [];
  const nextOffset = safeOffset + rows.length;
  return {
    ids,
    cards,
    source: includeCards && cards.length === ids.length ? "feed_card" : "feed",
    nextOffset,
    cursor: String(nextOffset),
    exhausted: rows.length < rowLimit,
  };
}

export function mergeRecruitingFeedPages(activePage, terminalPage) {
  if (!activePage) return terminalPage;
  if (!terminalPage?.ids?.length) return activePage;
  return {
    ...activePage,
    ids: uniqueIds([...(activePage.ids ?? []), ...(terminalPage.ids ?? [])]),
    cards: mergeFeedCards(activePage.cards ?? [], terminalPage.cards ?? []),
    source: `${activePage.source ?? "feed"}+${terminalPage.source ?? "terminal_feed"}`,
  };
}

async function fetchRecruitingFeedCountsFromRows(client, profileId = "") {
  if (!profileId || !userRoomFeedAvailable) return null;
  const { data, error } = await client
    .from("user_room_feed")
    .select("entity_id,relation")
    .eq("entity_type", "recruiting")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .eq("status", "open")
    .in("relation", ["owner", "participant", "invited", "referee"]);
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("User room feed counts skipped.", error.message);
      return null;
    }
    throw error;
  }
  const created = new Set();
  const joined = new Set();
  const invited = new Set();
  (data ?? []).forEach((row) => {
    if (!row?.entity_id) return;
    if (row.relation === "owner") created.add(row.entity_id);
    if (row.relation === "participant" || row.relation === "referee") joined.add(row.entity_id);
    if (row.relation === "invited") invited.add(row.entity_id);
  });
  created.forEach((postId) => joined.delete(postId));
  return {
    created: created.size,
    joined: joined.size,
    invited: invited.size,
  };
}

export async function fetchRecruitingFeedCounts(client, profileId = "") {
  if (!profileId || !userRoomFeedAvailable) return null;
  const { data, error } = await client.rpc("rankball_recruiting_feed_counts", {
    p_profile_id: profileId,
  });
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("User room feed counts skipped.", error.message);
      return null;
    }
    if (isMissingRecruitingFeedCountsRpc(error)) {
      return fetchRecruitingFeedCountsFromRows(client, profileId);
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    created: Number(row?.created ?? 0) || 0,
    joined: Number(row?.joined ?? 0) || 0,
    invited: Number(row?.invited ?? 0) || 0,
  };
}

export async function fetchRecruitingFallbackCounts(client, profileId = "") {
  if (!profileId) return null;
  const countLimit = RECRUITING_FEED_MAX_LIMIT;
  const [ownedPostIds, roomOwnerPostIds, hostedPlayerPostIds, refereedPostIds, invitedPostIds, applicantPostIds, applicantPartyPostIds, roomStateParticipantPostIds] = await Promise.all([
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("room_state->>ownerId", profileId).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("referee_id", profileId).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("room_state", { invitations: [{ targetUserId: profileId, status: "pending" }] }).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(countLimit), "post_id"),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(countLimit), "post_id"),
    fetchRoomStateParticipantPostIds(client, profileId, countLimit),
  ]);
  const created = new Set([...ownedPostIds, ...roomOwnerPostIds]);
  const joined = new Set([...hostedPlayerPostIds, ...refereedPostIds, ...applicantPostIds, ...applicantPartyPostIds, ...roomStateParticipantPostIds]);
  created.forEach((postId) => joined.delete(postId));
  return {
    created: created.size,
    joined: joined.size,
    invited: uniqueIds(invitedPostIds).length,
  };
}

export function selectRecruitingCounts(feedCounts, fallbackCounts) {
  return feedCounts ?? fallbackCounts ?? null;
}

export async function fetchCurrentUserRecruitingFallbackPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT, roomScope = "") {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(RECRUITING_FEED_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const relations = getRecruitingMineRelations(roomScope);
  const [ownedPostIds, roomOwnerPostIds, hostedPlayerPostIds, refereedPostIds, invitedPostIds, applicantPostIds, applicantPartyPostIds, roomStateParticipantPostIds] = await Promise.all([
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("room_state->>ownerId", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("referee_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("room_state", { invitations: [{ targetUserId: profileId, status: "pending" }] }).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit), "post_id"),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(cappedLimit), "post_id"),
    fetchRoomStateParticipantPostIds(client, profileId, cappedLimit),
  ]);
  const fallbackIdsByRelation = {
    owner: [...ownedPostIds, ...roomOwnerPostIds],
    participant: [...hostedPlayerPostIds, ...applicantPostIds, ...applicantPartyPostIds, ...roomStateParticipantPostIds],
    invited: invitedPostIds,
    referee: refereedPostIds,
  };
  return uniqueIds(relations.flatMap((relation) => fallbackIdsByRelation[relation] ?? [])).slice(0, cappedLimit);
}

export function getRecruitingMineRelations(scope = "") {
  if (scope === "created") return ["owner"];
  if (scope === "joined") return ["participant", "referee"];
  if (scope === "invited") return ["invited"];
  return ["owner", "participant", "invited", "referee"];
}

export function isLegacyListFallbackAllowed(body = {}) {
  return body.allowLegacyFallback === true || process.env.RANKBALL_ALLOW_LEGACY_LIST_FALLBACK === "true";
}

export async function fetchCurrentUserRecruitingPage(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT, roomScope = "", includeCards = false, allowLegacyFallback = false) {
  if (!profileId) return { ids: [], cards: [], source: "", exhausted: true };
  const cappedLimit = Math.max(1, Math.min(RECRUITING_FEED_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const relations = getRecruitingMineRelations(roomScope);
  const feedPage = await fetchRecruitingFeedPage(client, {
    profileId,
    relations,
    limit: cappedLimit,
    includeCards,
  });
  if (feedPage) return feedPage;
  if (!allowLegacyFallback) return { ids: [], cards: [], source: "feed_unavailable", exhausted: true };
  const ids = await fetchCurrentUserRecruitingFallbackPostIds(client, profileId, cappedLimit, roomScope);
  return { ids, cards: [], source: "fallback_mine", exhausted: true };
}

async function fetchRecruitingFallbackPage(client, limit = REMOTE_CLIENT_RECRUITING_LIMIT, offset = 0, regionKey = "", startFilter = {}) {
  const cappedLimit = Math.max(1, Math.min(RECRUITING_FEED_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const rowLimit = regionKey
    ? Math.min(RECRUITING_FEED_ROW_MAX_LIMIT, Math.max(safeOffset + cappedLimit * 3, cappedLimit))
    : cappedLimit;
  let query = client
    .from("recruiting_posts")
    .select("id,region")
    .eq("status", "open")
    .eq("visibility", "public")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(regionKey ? 0 : safeOffset, (regionKey ? 0 : safeOffset) + rowLimit - 1);
  if (startFilter.timingType === INSTANT_TIMING_TYPE) query = query.or(`room_state->>timingType.eq.${INSTANT_TIMING_TYPE},scheduled_at.eq.${LEGACY_INSTANT_LABEL}`);
  if (startFilter.scheduledDate) query = query.eq("scheduled_date", startFilter.scheduledDate);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  const matchingRows = regionKey ? rows.filter((row) => isSameRegionKey(row?.region, regionKey)) : rows;
  const pagedRows = regionKey ? matchingRows.slice(safeOffset, safeOffset + cappedLimit) : matchingRows;
  const ids = pagedRows.map((row) => row?.id).filter(Boolean);
  return {
    ids,
    cards: [],
    source: "fallback_public",
    exhausted: regionKey ? rows.length < rowLimit && matchingRows.length <= safeOffset + cappedLimit : ids.length < cappedLimit,
  };
}

function shouldRepairEmptyPublicRecruitingFeed(regionKey = "", startFilter = {}) {
  return Boolean(regionKey && (startFilter.timingType === INSTANT_TIMING_TYPE || startFilter.scheduledDate));
}

async function fetchRecruitingRepairCandidatePostIds(client, limit = REMOTE_CLIENT_RECRUITING_LIMIT, startFilter = {}) {
  const cappedLimit = Math.max(1, Math.min(RECRUITING_FEED_ROW_MAX_LIMIT, Number(limit) || RECRUITING_PUBLIC_PAGE_MAX_LIMIT));
  let query = client
    .from("recruiting_posts")
    .select("id")
    .eq("status", "open")
    .eq("visibility", "public")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(cappedLimit);
  if (startFilter.timingType === INSTANT_TIMING_TYPE) query = query.or(`room_state->>timingType.eq.${INSTANT_TIMING_TYPE},scheduled_at.eq.${LEGACY_INSTANT_LABEL}`);
  if (startFilter.scheduledDate) query = query.eq("scheduled_date", startFilter.scheduledDate);
  const { data, error } = await query;
  if (error) throw error;
  return uniqueIds((data ?? []).map((row) => row?.id));
}

async function refreshRecruitingFeedForPosts(client, postIds = []) {
  const ids = uniqueIds(postIds);
  if (!ids.length) return false;
  const results = await Promise.all(ids.map((postId) => client.rpc("rankball_refresh_recruiting_feed_for_post", { p_post_id: postId })));
  const failed = results.find((result) => result.error);
  if (!failed?.error) return true;
  if (isMissingRecruitingFeedRefreshRpc(failed.error)) return false;
  console.warn("Recruiting feed repair skipped.", failed.error.message);
  return false;
}

export async function fetchRecruitingPage(client, limit = REMOTE_CLIENT_RECRUITING_LIMIT, offset = 0, regionKey = "", includeCards = false, startFilter = {}, allowLegacyFallback = false, allowFeedRepair = false) {
  const cappedLimit = Math.max(1, Math.min(RECRUITING_PUBLIC_PAGE_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const feedPage = await fetchRecruitingFeedPage(client, {
    profileId: LEGACY_PUBLIC_RECRUITING_FEED_PROFILE_ID,
    feedScope: PUBLIC_RECRUITING_FEED_SCOPE,
    relations: ["region_public"],
    regionKey,
    limit: cappedLimit,
    offset: safeOffset,
    includeCards,
    timingType: startFilter.timingType,
    scheduledDate: startFilter.scheduledDate,
  });
  if (feedPage?.ids?.length) return feedPage;
  if (allowFeedRepair && feedPage && shouldRepairEmptyPublicRecruitingFeed(regionKey, startFilter)) {
    const repairIds = await fetchRecruitingRepairCandidatePostIds(client, Math.max(RECRUITING_PUBLIC_PAGE_MAX_LIMIT, cappedLimit * 3), startFilter);
    if (!repairIds.length) return feedPage;
    const repaired = await refreshRecruitingFeedForPosts(client, repairIds);
    if (repaired) {
      const repairedFeedPage = await fetchRecruitingFeedPage(client, {
        profileId: LEGACY_PUBLIC_RECRUITING_FEED_PROFILE_ID,
        feedScope: PUBLIC_RECRUITING_FEED_SCOPE,
        relations: ["region_public"],
        regionKey,
        limit: cappedLimit,
        offset: safeOffset,
        includeCards,
        timingType: startFilter.timingType,
        scheduledDate: startFilter.scheduledDate,
      });
      if (repairedFeedPage?.ids?.length) return { ...repairedFeedPage, source: repairedFeedPage.source === "feed_card" ? "feed_card" : "feed_repaired" };
    }
    return feedPage;
  }
  if (feedPage) return feedPage;
  if (!allowLegacyFallback) return { ids: [], cards: [], source: "public_feed_unavailable", exhausted: true, nextOffset: safeOffset };
  return fetchRecruitingFallbackPage(client, cappedLimit, safeOffset, regionKey, startFilter);
}
