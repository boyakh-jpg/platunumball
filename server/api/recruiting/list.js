import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  DEFAULT_SETTINGS,
  createProfileShell,
  fromRemoteProfile,
  getRemoteAppSettings,
  loadNormalizedRemoteStateFromClient,
  normalizeState,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

let currentUserRecruitingRpcAvailable = true;
let userRoomFeedAvailable = true;

const PROFILE_ME_COLUMNS = "id,name,handle,hashtag,position,region,region_sido,region_district,school,company,club,trust_score,streak,avatar_color,test_login_id,auth_user_id,birth_year,age_group,age_group_checked_season,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,discord_connection,discord_user_id,ratings,created_at,updated_at,app_settings";
const PROFILE_PUBLIC_COLUMNS = "id,name,handle,hashtag,position,region,trust_score,avatar_color,ratings,age_group,updated_at";
const TEAM_COLUMNS = "id,name,home_court,region,mmr,wins,losses,accent,deleted_at";
const COURT_COLUMNS = "id,name";
const RECRUITING_POST_COLUMNS = "id,type,title,visibility,region,court_id,court_name,mode,scheduled_at,scheduled_date,scheduled_time,ranked,official,pre_registered,rating_scale,age_restriction,allowed_age_groups,rules,stakes,court_reserved,court_fee,spots,team_id,target_team_id,referee_id,referee_trust_min,stat_entry_minutes,dispute_minutes,room_state,host_join_mode,host_side,host_ready,side_capacity,player_ids,position,player_id,memo,status,confirmed_at,created_at,updated_at";
const RECRUITING_APPLICATION_COLUMNS = "post_id,kind,team_id,player_id,side,status,reserve,position,player_ids,source_team_id,source_entry_id,created_at,updated_at";

function getPageOffset(body = {}) {
  const rawOffset = body.offset ?? body.recruitingOffset ?? body.nextOffset;
  const numericOffset = Number(rawOffset);
  if (Number.isFinite(numericOffset) && numericOffset > 0) return Math.floor(numericOffset);

  const numericCursor = Number(body.cursor);
  if (Number.isFinite(numericCursor) && numericCursor > 0) return Math.floor(numericCursor);
  return 0;
}

function getTargetPostIds(body = {}) {
  return [
    body.postId,
    body.recruitingPostId,
    ...(Array.isArray(body.recruitingPostIds) ? body.recruitingPostIds : []),
  ].map((id) => String(id ?? "").trim()).filter(Boolean);
}

function uniqueIds(ids = []) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function isMissingTable(error = {}, table = "") {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || (table && message.includes(table));
}

async function fetchCourtRowsByIds(supabase, courtIds = []) {
  const ids = uniqueIds(courtIds);
  if (!ids.length) return { data: [], error: null };
  const [legacyResult, approvedResult] = await Promise.all([
    supabase.from("courts").select(COURT_COLUMNS).in("id", ids),
    supabase.from("approved_courts").select(COURT_COLUMNS).in("id", ids).or("status.is.null,status.eq.active"),
  ]);
  if (legacyResult.error && !isMissingTable(legacyResult.error, "courts")) return legacyResult;
  if (approvedResult.error) return approvedResult;
  const rowsById = new Map();
  (legacyResult.data ?? []).forEach((row) => rowsById.set(row.id, row));
  (approvedResult.data ?? []).forEach((row) => rowsById.set(row.id, row));
  return { data: [...rowsById.values()], error: null };
}

function flattenIdValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenIdValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenIdValues);
  return value ? [String(value)] : [];
}

function normalizeRegionKey(value = "") {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const district = parts.at(-1) || String(value ?? "");
  return district
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/(특별시|광역시|특별자치시|특별자치도|자치구|시|군|구)$/u, "");
}

function getProfileRegionKey(profile = {}) {
  return normalizeRegionKey(profile?.region_district || profile?.region || "");
}

function isMissingUserRoomFeed(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || message.includes("user_room_feed");
}

function createTimingProbe() {
  const startedAt = Date.now();
  const steps = [];
  return {
    async track(name, task) {
      const stepStartedAt = Date.now();
      try {
        return await task();
      } finally {
        steps.push({ name, ms: Date.now() - stepStartedAt });
      }
    },
    payload() {
      return { totalMs: Date.now() - startedAt, steps };
    },
    header() {
      const timing = this.payload();
      return [
        ...steps.map((step) => `${step.name};dur=${Math.max(0, step.ms)}`),
        `total;dur=${Math.max(0, timing.totalMs)}`,
      ].join(", ");
    },
  };
}

function sendTimedJson(response, statusCode, payload, timing, includeTiming = false) {
  if (typeof response.setHeader === "function") {
    response.setHeader("Server-Timing", timing.header());
  }
  const nextPayload = includeTiming
    ? { ...payload, debugTiming: timing.payload() }
    : payload;
  sendJson(response, statusCode, nextPayload);
}

function groupBy(rows = [], key = "id") {
  return rows.reduce((map, row) => {
    const value = row?.[key];
    if (!value) return map;
    const current = map.get(value) ?? [];
    current.push(row);
    map.set(value, current);
    return map;
  }, new Map());
}

function firstBy(rows = [], key = "id") {
  return Object.fromEntries((rows ?? []).filter((row) => row?.[key]).map((row) => [row[key], row]));
}

function toDateTime(date, time, fallback) {
  if (date && time) return `${date} ${String(time).slice(0, 5)}`;
  if (date) return date;
  return fallback ?? "\uBBF8\uC815";
}

function getCappedLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return REMOTE_CLIENT_RECRUITING_LIMIT;
  return Math.max(1, Math.min(80, Math.floor(number)));
}

function mergeById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function mergeStateById(current = {}, incoming = {}) {
  return {
    ...current,
    ...incoming,
    users: mergeById(current.users, incoming.users),
    teams: mergeById(current.teams, incoming.teams),
    recruitingPosts: mergeById(current.recruitingPosts, incoming.recruitingPosts),
    settings: {
      ...(current.settings ?? {}),
      ...(incoming.settings ?? {}),
    },
  };
}

function normalizeFeedCard(row = {}) {
  const card = row?.card_json ?? row?.cardJson ?? null;
  if (!card || typeof card !== "object" || Array.isArray(card) || !Object.keys(card).length) return null;
  const id = card.id ?? row.entity_id ?? row.entityId;
  return id ? { ...card, id } : null;
}

function uniqueFeedCards(rows = [], ids = []) {
  const idSet = new Set(ids);
  const cards = new Map();
  (rows ?? []).forEach((row) => {
    const id = row?.entity_id ?? row?.entityId;
    if (!id || !idSet.has(id) || cards.has(id)) return;
    const card = normalizeFeedCard(row);
    if (card) cards.set(id, card);
  });
  return ids.map((id) => cards.get(id)).filter(Boolean);
}

function compactUser(user = {}, profileId = "") {
  const compact = {
    id: user.id,
    name: user.name,
    handle: user.handle,
    hashtag: user.hashtag,
    position: user.position,
    region: user.region,
    avatarColor: user.avatarColor,
    trustScore: user.trustScore,
    ratings: Number.isFinite(Number(user.ratings?.integrated)) ? { integrated: user.ratings.integrated } : undefined,
    ageGroup: user.ageGroup,
  };
  if (user.id !== profileId) return compact;
  return {
    ...compact,
    regionSido: user.regionSido,
    regionDistrict: user.regionDistrict,
    school: user.school,
    company: user.company,
    club: user.club,
    streak: user.streak,
    ratings: user.ratings,
    authUserId: user.authUserId,
    testLoginId: user.testLoginId,
    birthYear: user.birthYear,
    ageGroupCheckedSeason: user.ageGroupCheckedSeason,
    onboardingComplete: user.onboardingComplete,
    profileVersion: user.profileVersion,
    handleLockedAt: user.handleLockedAt,
    birthYearLockedAt: user.birthYearLockedAt,
    nameUpdatedAt: user.nameUpdatedAt,
    discordConnection: user.discordConnection,
    discordUserId: user.discordUserId,
  };
}

function compactTeam(team = {}) {
  return {
    id: team.id,
    name: team.name,
    homeCourt: team.homeCourt,
    region: team.region,
    mmr: team.mmr,
    wins: team.wins,
    losses: team.losses,
    accent: team.accent,
    membersPartial: true,
    members: team.members ?? [],
  };
}

function compactRecruitingApplication(applicant = {}) {
  return {
    kind: applicant.kind,
    joinMode: applicant.joinMode,
    teamId: applicant.teamId,
    playerId: applicant.playerId,
    side: applicant.side,
    status: applicant.status,
    reserve: applicant.reserve,
    position: applicant.position,
    playerIds: applicant.playerIds ?? [],
    sourceTeamId: applicant.sourceTeamId,
    sourceEntryId: applicant.sourceEntryId,
    createdAt: applicant.createdAt,
    updatedAt: applicant.updatedAt,
  };
}

function compactRecruitingRoomState(roomState = {}, profileId = "") {
  const invitations = Array.isArray(roomState.invitations)
    ? roomState.invitations
      .filter((invitation) => invitation.targetUserId === profileId || invitation.fromUserId === profileId)
      .map((invitation) => ({
        id: invitation.id,
        role: invitation.role,
        targetUserId: invitation.targetUserId,
        fromUserId: invitation.fromUserId,
        teamId: invitation.teamId,
        side: invitation.side,
        reserve: invitation.reserve,
        status: invitation.status,
        createdAt: invitation.createdAt,
        updatedAt: invitation.updatedAt,
      }))
    : [];
  return {
    ownerId: roomState.ownerId,
    teamOnly: roomState.teamOnly,
    timingType: roomState.timingType,
    hostReserve: roomState.hostReserve,
    refereeWanted: roomState.refereeWanted,
    invitations,
    mmrRangeMode: roomState.mmrRangeMode,
    partyLeaders: roomState.partyLeaders ?? {},
    partyReserves: roomState.partyReserves ?? {},
    reserveReady: roomState.reserveReady ?? {},
    pinnedReservePlayers: roomState.pinnedReservePlayers ?? {},
    slotPositions: roomState.slotPositions ?? {},
    statRecorders: roomState.statRecorders ?? {},
    ruleRevision: roomState.ruleRevision,
    approvalModeA: roomState.approvalModeA,
    approvalModeB: roomState.approvalModeB,
  };
}

function compactRecruitingPost(post = {}, profileId = "") {
  const rules = post.rules ?? {};
  return {
    id: post.id,
    listCardOnly: post.listCardOnly,
    type: post.type,
    title: post.title,
    visibility: post.visibility,
    region: post.region,
    court: post.court,
    hostName: post.hostName,
    hostTeamName: post.hostTeamName,
    targetTeamName: post.targetTeamName,
    mode: post.mode,
    scheduledDate: post.scheduledDate,
    scheduledTime: post.scheduledTime,
    scheduledAt: post.scheduledAt,
    timingType: post.timingType,
    ranked: post.ranked,
    official: post.official,
    preRegistered: post.preRegistered,
    ratingScale: post.ratingScale,
    ageRestriction: post.ageRestriction,
    allowedAgeGroups: post.allowedAgeGroups ?? [],
    rules: {
      targetScore: rules.targetScore,
      timeLimit: rules.timeLimit,
      winByTwo: rules.winByTwo,
      ball: rules.ball,
      ageRestriction: rules.ageRestriction,
      allowedAgeGroups: rules.allowedAgeGroups,
    },
    stakes: post.stakes,
    spots: post.spots,
    teamId: post.teamId,
    targetTeamId: post.targetTeamId,
    refereeWanted: post.refereeWanted,
    refereeId: post.refereeId,
    refereeTrustMin: post.refereeTrustMin,
    statEntryMinutes: post.statEntryMinutes,
    disputeMinutes: post.disputeMinutes,
    roomState: compactRecruitingRoomState(post.roomState ?? {}, profileId),
    teamOnly: post.teamOnly,
    hostJoinMode: post.hostJoinMode,
    hostSide: post.hostSide,
    hostReady: post.hostReady,
    sideCapacity: post.sideCapacity,
    playerIds: post.playerIds ?? [],
    position: post.position,
    playerId: post.playerId,
    memo: post.memo,
    status: post.status,
    applicants: (post.applicants ?? []).map(compactRecruitingApplication),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    confirmedAt: post.confirmedAt,
  };
}

function compactRecruitingListState(state = {}, profileId = "") {
  return {
    ...state,
    users: (state.users ?? []).map((user) => compactUser(user, profileId)),
    teams: (state.teams ?? []).map(compactTeam),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => compactRecruitingPost(post, profileId)),
    matches: [],
    tournaments: [],
    affiliations: [],
    seasons: [],
    reports: [],
    notifications: [],
    discordNotificationDeliveries: [],
    settings: {
      theme: state.settings?.theme === "light" ? "light" : "dark",
      privacy: state.settings?.privacy,
      favoritePlayerIds: state.settings?.favoritePlayerIds ?? [],
      favoriteTeamIds: state.settings?.favoriteTeamIds ?? [],
      favoriteCourtIds: state.settings?.favoriteCourtIds ?? [],
      favoriteRefereeIds: state.settings?.favoriteRefereeIds ?? [],
      approvedCourts: state.settings?.approvedCourts ?? [],
      refereeAppointments: state.settings?.refereeAppointments ?? [],
    },
  };
}

async function fetchPostIds(query, idColumn = "id") {
  const { data, error } = await query;
  if (error) {
    console.warn("Current user recruiting id query skipped.", error.message);
    return [];
  }
  return (data ?? []).map((row) => row?.[idColumn]).filter(Boolean);
}

function getRoomStateParticipantIds(roomState = {}) {
  const reserveReadyIds = roomState.reserveReady && typeof roomState.reserveReady === "object"
    ? Object.entries(roomState.reserveReady).filter(([, ready]) => ready).map(([playerId]) => playerId)
    : [];
  return uniqueIds([
    ...flattenIdValues(roomState.partyLeaders),
    ...flattenIdValues(roomState.partyReserves),
    ...flattenIdValues(roomState.pinnedReservePlayers),
    ...reserveReadyIds,
  ]);
}

async function fetchRoomStateParticipantPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT) {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(200, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
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

async function fetchRecruitingFeedPostIds(client, {
  profileId = "*",
  relations = [],
  status = "open",
  regionKey = "",
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  offset = 0,
} = {}) {
  const page = await fetchRecruitingFeedPage(client, {
    profileId,
    relations,
    status,
    regionKey,
    limit,
    offset,
    includeCards: false,
  });
  return page?.ids ?? page;
}

async function fetchRecruitingFeedPage(client, {
  profileId = "*",
  relations = [],
  status = "open",
  regionKey = "",
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  offset = 0,
  includeCards = false,
} = {}) {
  if (!userRoomFeedAvailable) return null;
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  let query = client
    .from("user_room_feed")
    .select(includeCards ? "entity_id,sort_at,relation,card_json" : "entity_id,sort_at,relation")
    .eq("entity_type", "recruiting")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .eq("status", status)
    .order("sort_at", { ascending: false, nullsFirst: false })
    .order("entity_id", { ascending: false })
    .range(safeOffset, safeOffset + cappedLimit - 1);
  if (relations.length) query = query.in("relation", relations);
  if (regionKey) query = query.eq("region_key", regionKey);
  const { data, error } = await query;
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("User room feed skipped.", error.message);
      return null;
    }
    throw error;
  }
  const rows = data ?? [];
  const ids = uniqueIds(rows.map((row) => row?.entity_id)).slice(0, cappedLimit);
  const cards = includeCards ? uniqueFeedCards(rows, ids) : [];
  return {
    ids,
    cards,
    source: includeCards && cards.length === ids.length ? "feed_card" : "feed",
    exhausted: rows.length < cappedLimit || ids.length < cappedLimit,
  };
}

async function fetchRecruitingFeedCounts(client, profileId = "") {
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

async function fetchRecruitingFallbackCounts(client, profileId = "") {
  if (!profileId) return null;
  const countLimit = 200;
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

function mergeRecruitingCounts(feedCounts, fallbackCounts) {
  if (!feedCounts) return fallbackCounts;
  if (!fallbackCounts) return feedCounts;
  return {
    created: Math.max(Number(feedCounts.created) || 0, Number(fallbackCounts.created) || 0),
    joined: Math.max(Number(feedCounts.joined) || 0, Number(fallbackCounts.joined) || 0),
    invited: Math.max(Number(feedCounts.invited) || 0, Number(fallbackCounts.invited) || 0),
  };
}

async function fetchCurrentUserRecruitingFallbackPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT, roomScope = "") {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
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

function getRecruitingMineRelations(scope = "") {
  if (scope === "created") return ["owner"];
  if (scope === "joined") return ["participant", "referee"];
  if (scope === "invited") return ["invited"];
  return ["owner", "participant", "invited", "referee"];
}

export async function fetchCurrentUserRecruitingPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT, roomScope = "") {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const relations = getRecruitingMineRelations(roomScope);
  const [feedPostIds, fallbackPostIds] = await Promise.all([
    fetchRecruitingFeedPostIds(client, {
      profileId,
      relations,
      limit: cappedLimit,
    }),
    fetchCurrentUserRecruitingFallbackPostIds(client, profileId, cappedLimit, roomScope),
  ]);
  if (feedPostIds?.length || fallbackPostIds.length) {
    return uniqueIds([...fallbackPostIds, ...(feedPostIds ?? [])]).slice(0, cappedLimit);
  }
  if (!roomScope && currentUserRecruitingRpcAvailable) {
    const { data: rpcRows, error: rpcError } = await client.rpc("rankball_current_recruiting_post_ids", {
      p_profile_id: profileId,
      p_limit: cappedLimit,
    });
    if (!rpcError) {
      const rpcPostIds = uniqueIds((rpcRows ?? []).map((row) => row?.post_id ?? row?.id ?? row)).slice(0, cappedLimit);
      if (rpcPostIds.length) return rpcPostIds;
      console.warn("Current user recruiting RPC returned no rows; checking fallback.");
    } else {
      currentUserRecruitingRpcAvailable = false;
      console.warn("Current user recruiting RPC skipped.", rpcError.message);
    }
  }
  return fallbackPostIds;
}

async function fetchRecruitingFallbackPage(client, limit = REMOTE_CLIENT_RECRUITING_LIMIT, offset = 0, regionKey = "") {
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  let query = client
    .from("recruiting_posts")
    .select("id")
    .eq("status", "open")
    .eq("visibility", "public")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(safeOffset, safeOffset + cappedLimit - 1);
  if (regionKey) query = query.or(`region.eq.${regionKey},region.eq.${regionKey}구,region.ilike.%${regionKey}%`);
  const { data, error } = await query;
  if (error) throw error;
  const ids = (data ?? []).map((row) => row?.id).filter(Boolean);
  return { ids, cards: [], source: "fallback_public", exhausted: ids.length < cappedLimit };
}

async function fetchRecruitingPage(client, limit = REMOTE_CLIENT_RECRUITING_LIMIT, offset = 0, regionKey = "", includeCards = false) {
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const feedPage = await fetchRecruitingFeedPage(client, {
    profileId: "*",
    relations: ["region_public"],
    regionKey,
    limit: cappedLimit,
    offset: safeOffset,
    includeCards,
  });
  const fallbackPage = safeOffset === 0
    ? await fetchRecruitingFallbackPage(client, cappedLimit, safeOffset, regionKey)
    : null;
  if (feedPage?.ids?.length || fallbackPage?.ids?.length) {
    const ids = uniqueIds([...(fallbackPage?.ids ?? []), ...(feedPage?.ids ?? [])]).slice(0, cappedLimit);
    return {
      ids,
      cards: fallbackPage?.ids?.length ? [] : (feedPage?.cards ?? []),
      source: feedPage?.ids?.length && fallbackPage?.ids?.length ? "feed_fallback_public" : (feedPage?.source ?? fallbackPage?.source ?? "feed"),
      exhausted: Boolean(feedPage?.exhausted && (fallbackPage?.exhausted ?? true)) || ids.length < cappedLimit,
    };
  }
  if (feedPage && safeOffset > 0) return { ids: [], cards: [], source: feedPage.source ?? "feed", exhausted: true };
  return fallbackPage ?? { ids: [], cards: [], source: "fallback_public", exhausted: true };
}

async function fetchRecruitingRowsByIds(client, postIds = []) {
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

function collectTeamIdsFromRoomKeys(value = {}) {
  return Object.keys(value ?? {})
    .map((key) => String(key).startsWith("team:") ? String(key).slice(5) : "")
    .filter(Boolean);
}

function collectRecruitingScope(postRows = [], applicationRows = [], profileId = "") {
  const profileIds = [profileId];
  const teamIds = [];
  const courtIds = [];
  postRows.forEach((post) => {
    const roomState = post.room_state && typeof post.room_state === "object" ? post.room_state : {};
    profileIds.push(
      post.player_id,
      post.referee_id,
      ...flattenIdValues(post.player_ids),
      roomState.ownerId,
      ...flattenIdValues(roomState.partyLeaders),
      ...flattenIdValues(roomState.partyReserves),
      ...flattenIdValues(roomState.pinnedReservePlayers),
      ...flattenIdValues(roomState.reserveReady),
      ...(Array.isArray(roomState.invitations) ? roomState.invitations
        .flatMap((invitation) => [invitation.targetUserId, invitation.fromUserId, ...(invitation.playerIds ?? [])]) : []),
    );
    teamIds.push(
      post.team_id,
      post.target_team_id,
      ...collectTeamIdsFromRoomKeys(roomState.partyLeaders),
      ...collectTeamIdsFromRoomKeys(roomState.partyReserves),
    );
    courtIds.push(post.court_id);
  });
  applicationRows.forEach((application) => {
    teamIds.push(application.team_id, application.source_team_id);
    profileIds.push(application.player_id, ...flattenIdValues(application.player_ids));
  });
  return {
    profileIds: uniqueIds(profileIds),
    teamIds: uniqueIds(teamIds),
    courtIds: uniqueIds(courtIds),
  };
}

function toClientTeam(row = {}) {
  return {
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? 1200,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    accent: row.accent,
    membersPartial: true,
    members: [],
  };
}

function fromRemoteRecruitingApplication(row = {}) {
  return {
    kind: row.kind,
    joinMode: row.kind,
    teamId: row.team_id,
    playerId: row.player_id,
    side: row.side,
    status: row.status,
    reserve: row.reserve,
    position: row.position,
    playerIds: row.player_ids ?? [],
    sourceTeamId: row.source_team_id ?? null,
    sourceEntryId: row.source_entry_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromRemoteRecruitingPost(row = {}, applicationsByPost = new Map(), courtById = {}) {
  const rawScheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);
  const roomState = row.room_state && typeof row.room_state === "object" ? row.room_state : {};
  const timingType = roomState.timingType === "instant" || rawScheduledAt === "\uC989\uC2DC" ? "instant" : "scheduled";
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    visibility: row.visibility ?? "public",
    region: row.region,
    court: row.court_name ?? courtById[row.court_id]?.name ?? "\uBBF8\uC815",
    mode: row.mode,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    scheduledAt: timingType === "instant" ? "\uC989\uC2DC" : rawScheduledAt,
    timingType,
    ranked: row.ranked,
    official: Boolean(row.official),
    preRegistered: row.pre_registered !== false,
    ratingScale: Number(row.rating_scale ?? 1),
    ageRestriction: row.age_restriction ?? "any",
    allowedAgeGroups: row.allowed_age_groups ?? [],
    rules: row.rules ?? {},
    stakes: row.stakes ?? "",
    courtReserved: Boolean(row.court_reserved),
    courtFee: row.court_fee ?? "",
    spots: row.spots,
    teamId: row.team_id,
    targetTeamId: row.target_team_id,
    refereeWanted: Boolean(roomState.refereeWanted || row.referee_id),
    refereeId: row.referee_id ?? "",
    refereeTrustMin: row.referee_trust_min ?? 90,
    statEntryMinutes: row.stat_entry_minutes ?? 60,
    disputeMinutes: row.dispute_minutes ?? 30,
    roomState,
    teamOnly: roomState.teamOnly === true,
    hostJoinMode: row.host_join_mode,
    hostSide: row.host_side,
    hostReady: row.host_ready,
    sideCapacity: row.side_capacity,
    playerIds: row.player_ids ?? [],
    position: row.position,
    playerId: row.player_id,
    memo: row.memo,
    status: row.status,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    applicants: (applicationsByPost.get(row.id) ?? []).map(fromRemoteRecruitingApplication),
  };
}

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
  feedCounts = null,
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  offset = 0,
  regionScope = "local",
  regionKey = "",
} = {}) {
  const targetPostIds = uniqueIds([...explicitPostIds, ...(mineOnly ? currentUserPostIds : pagePostIds), ...(includeMine ? currentUserPostIds : [])]);
  const canUsePageCards = pageCards.length > 0
    && pageCards.length === pagePostIds.length
    && !explicitPostIds.length
    && !mineOnly
    && !includeMine;
  const currentUser = context.profile
    ? fromRemoteProfile(context.profile)
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const settings = {
    ...DEFAULT_SETTINGS,
    ...getRemoteAppSettings(context.profile),
  };

  if (canUsePageCards) {
    const state = normalizeState({
      currentUserId: currentUser.id,
      users: [currentUser],
      teams: [],
      recruitingPosts: pageCards,
      settings,
    }, { includeDemo: false });
    return {
      state: compactRecruitingListState(state, currentUser.id),
      page: {
        limit,
        count: pagePostIds.length,
        offset,
        nextOffset: offset + pagePostIds.length,
        cursor: String(offset + pagePostIds.length),
        exhausted: typeof pageExhausted === "boolean" ? pageExhausted : pagePostIds.length < limit,
        regionScope: regionKey ? "region" : regionScope,
        regionKey,
        source: pageSource || "feed_card",
        feedCounts,
      },
      updatedAt: Math.max(
        ...[...pageCards, context.profile].filter(Boolean)
          .map((row) => new Date(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? 0).getTime())
          .filter((value) => Number.isFinite(value)),
        0,
      ),
    };
  }

  const postRows = await fetchRecruitingRowsByIds(context.supabase, targetPostIds);
  const postIds = postRows.map((post) => post.id).filter(Boolean);
  const { data: applicationRows, error: applicationError } = postIds.length
    ? await context.supabase.from("recruiting_applications").select(RECRUITING_APPLICATION_COLUMNS).in("post_id", postIds)
    : { data: [], error: null };
  if (applicationError) throw applicationError;

  const scope = collectRecruitingScope(postRows, applicationRows ?? [], context.profileId ?? "");
  const [
    { data: teamRows, error: teamError },
    { data: profileRows, error: profileError },
    { data: courtRows, error: courtError },
  ] = await Promise.all([
    scope.teamIds.length
      ? context.supabase.from("teams").select(TEAM_COLUMNS).in("id", scope.teamIds).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    scope.profileIds.length
      ? context.supabase.from("public_profiles").select(PROFILE_PUBLIC_COLUMNS).in("id", scope.profileIds)
      : Promise.resolve({ data: [], error: null }),
    fetchCourtRowsByIds(context.supabase, scope.courtIds),
  ]);
  if (teamError) throw teamError;
  if (profileError) throw profileError;
  if (courtError) throw courtError;

  const userById = new Map((profileRows ?? []).map((row) => {
    const user = fromRemoteProfile(row);
    return [user.id, user];
  }));
  userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });

  const teams = (teamRows ?? []).map(toClientTeam);
  const courtById = firstBy(courtRows ?? [], "id");
  const applicationsByPost = groupBy(applicationRows ?? [], "post_id");
  const posts = postRows.map((post) => fromRemoteRecruitingPost(post, applicationsByPost, courtById));
  const state = normalizeState({
    currentUserId: currentUser.id,
    users: [...userById.values()],
    teams,
    recruitingPosts: posts,
    settings,
  }, { includeDemo: false });
  const responseState = compactRecruitingListState(state, currentUser.id);

  return {
    state: responseState,
    page: {
      limit,
      count: mineOnly ? posts.length : pagePostIds.length,
      offset,
      nextOffset: offset + pagePostIds.length,
      cursor: String(offset + pagePostIds.length),
      exhausted: mineOnly || Boolean(explicitPostIds.length) || (typeof pageExhausted === "boolean" ? pageExhausted : pagePostIds.length < limit),
      regionScope: regionKey ? "region" : regionScope,
      regionKey,
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

export default async function handler(request, response) {
  const timing = createTimingProbe();
  if (request.method !== "POST") {
    sendTimedJson(response, 405, { error: "method_not_allowed" }, timing);
    return;
  }

  let debugTiming = false;
  try {
    const body = await timing.track("body", () => readJsonBody(request));
    debugTiming = body.debugTiming === true;
    const context = await timing.track("auth", () => getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS }));
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId
      ? await timing.track("admin", () => getAdminLevel(context))
      : 0;
    const limit = getCappedLimit(body.limit ?? body.recruitingLimit ?? REMOTE_CLIENT_RECRUITING_LIMIT);
    const mineOnly = body.scope === "mine" || body.mine === true;
    const roomScope = ["created", "joined", "invited"].includes(body.roomScope) ? body.roomScope : "";
    const includeMine = mineOnly || body.includeMine === true;
    const includeFeedCounts = body.includeFeedCounts !== false;
    const mineLimit = mineOnly ? limit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const explicitPostIds = getTargetPostIds(body);
    const listOnly = body.listOnly !== false && !explicitPostIds.length;
    const offset = getPageOffset(body);
    const shouldPageList = !mineOnly && !explicitPostIds.length;
    const regionScope = body.regionScope === "all" ? "all" : "local";
    const regionKey = regionScope === "all"
      ? ""
      : normalizeRegionKey(body.regionKey || body.regionDistrict || getProfileRegionKey(context.profile));
    const [currentUserPostIds, pageResult, feedCountsResult] = await Promise.all([
      includeMine
        ? timing.track("mine", () => fetchCurrentUserRecruitingPostIds(context.supabase, context.profileId, mineLimit, roomScope))
        : Promise.resolve([]),
      shouldPageList
        ? timing.track("page", () => fetchRecruitingPage(context.supabase, limit, offset, regionKey, listOnly && !includeMine))
        : Promise.resolve({ ids: [], cards: [], source: "", exhausted: true }),
      context.profileId && includeFeedCounts
        ? timing.track("counts", () => fetchRecruitingFeedCounts(context.supabase, context.profileId))
        : Promise.resolve(null),
    ]);
    const fallbackCountsResult = context.profileId && includeFeedCounts
      ? await timing.track("fallbackCounts", () => fetchRecruitingFallbackCounts(context.supabase, context.profileId))
      : null;
    const pagePostIds = pageResult?.ids ?? [];
    const pageCards = pageResult?.cards ?? [];
    const pageSource = pageResult?.source ?? "";
    const pageExhausted = typeof pageResult?.exhausted === "boolean" ? pageResult.exhausted : null;
    const feedCounts = mergeRecruitingCounts(feedCountsResult, fallbackCountsResult);
    const targetPostIds = uniqueIds([...explicitPostIds, ...(mineOnly ? currentUserPostIds : pagePostIds)]);
    if (listOnly) {
      const compactResult = await timing.track("compact", () => loadCompactRecruitingList(context, {
        adminLevel,
        currentUserPostIds,
        explicitPostIds,
        includeMine,
        mineOnly,
        pagePostIds,
        pageCards,
        pageSource,
        pageExhausted,
        feedCounts,
        limit,
        offset,
        regionScope: regionKey ? "region" : regionScope,
        regionKey,
      }));
      sendTimedJson(response, 200, {
        ok: true,
        ...compactResult,
      }, timing, debugTiming);
      return;
    }
    const normalized = await timing.track("state", () => loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        isAdmin: adminLevel >= 30,
        scope: "recruiting",
        recruitingListOnly: listOnly,
        recruitingPostIds: targetPostIds,
        recruitingLimit: 0,
        matchLimit: 0,
        tournamentLimit: 0,
      },
    ));
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const pageState = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const pagePosts = pageState.recruitingPosts ?? [];
    let state = pageState;
    if (includeMine && !mineOnly) {
      const loadedIds = new Set(pagePosts.map((post) => post.id));
      const missingMineIds = currentUserPostIds.filter((postId) => !loadedIds.has(postId));
      if (missingMineIds.length) {
        const mineNormalized = await timing.track("missingMine", () => loadNormalizedRemoteStateFromClient(
          context.supabase,
          context.authUserId,
          context.authUser?.email ?? "",
          {
            clientState: true,
            isAdmin: adminLevel >= 30,
            scope: "recruiting",
            recruitingListOnly: listOnly,
            recruitingPostIds: missingMineIds,
            recruitingLimit: 0,
            matchLimit: 0,
            tournamentLimit: 0,
          },
        ));
        const mineState = filterStateForProfile(mineNormalized?.state ?? {}, profileId, adminLevel >= 30);
        state = mergeStateById(pageState, mineState);
      }
    }
    const responseState = listOnly ? compactRecruitingListState(state, profileId) : state;
    sendTimedJson(response, 200, {
      ok: true,
      state: {
        ...responseState,
        matches: [],
        tournaments: [],
      },
      page: {
        limit,
        count: pagePosts.length,
        offset,
        nextOffset: offset + pagePostIds.length,
        cursor: String(offset + pagePostIds.length),
        exhausted: mineOnly || Boolean(explicitPostIds.length) || (typeof pageExhausted === "boolean" ? pageExhausted : pagePostIds.length < limit),
        regionScope: regionKey ? "region" : regionScope,
        regionKey,
        source: pageSource || "row",
        feedCounts,
      },
      updatedAt: normalized?.updatedAt ?? 0,
    }, timing, debugTiming);
  } catch (error) {
    sendTimedJson(response, error.statusCode || 500, { error: error.message || "recruiting_list_failed" }, timing, debugTiming);
  }
}
