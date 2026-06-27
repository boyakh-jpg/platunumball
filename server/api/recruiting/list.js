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
    type: post.type,
    title: post.title,
    visibility: post.visibility,
    region: post.region,
    court: post.court,
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

async function fetchRecruitingFeedPostIds(client, {
  profileId = "*",
  relations = [],
  status = "open",
  regionKey = "",
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  offset = 0,
} = {}) {
  if (!userRoomFeedAvailable) return null;
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  let query = client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation")
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
  return uniqueIds((data ?? []).map((row) => row?.entity_id));
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
  const [ownedPostIds, roomOwnerPostIds, hostedPlayerPostIds, refereedPostIds, invitedPostIds, applicantPostIds, applicantPartyPostIds] = await Promise.all([
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("room_state->>ownerId", profileId).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("referee_id", profileId).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("room_state", { invitations: [{ targetUserId: profileId, status: "pending" }] }).order("updated_at", { ascending: false }).limit(countLimit)),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(countLimit), "post_id"),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(countLimit), "post_id"),
  ]);
  const created = new Set([...ownedPostIds, ...roomOwnerPostIds]);
  const joined = new Set([...hostedPlayerPostIds, ...refereedPostIds, ...applicantPostIds, ...applicantPartyPostIds]);
  created.forEach((postId) => joined.delete(postId));
  return {
    created: created.size,
    joined: joined.size,
    invited: uniqueIds(invitedPostIds).length,
  };
}

export async function fetchCurrentUserRecruitingPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT) {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const feedPostIds = await fetchRecruitingFeedPostIds(client, {
    profileId,
    relations: ["owner", "participant", "invited", "referee"],
    limit: cappedLimit,
  });
  if (feedPostIds?.length) return feedPostIds.slice(0, cappedLimit);
  if (currentUserRecruitingRpcAvailable) {
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
  const [ownedPostIds, roomOwnerPostIds, hostedPlayerPostIds, refereedPostIds, invitedPostIds, applicantPostIds, applicantPartyPostIds] = await Promise.all([
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("room_state->>ownerId", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("referee_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("room_state", { invitations: [{ targetUserId: profileId, status: "pending" }] }).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit), "post_id"),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(cappedLimit), "post_id"),
  ]);
  return uniqueIds([
    ...ownedPostIds,
    ...roomOwnerPostIds,
    ...hostedPlayerPostIds,
    ...refereedPostIds,
    ...invitedPostIds,
    ...applicantPostIds,
    ...applicantPartyPostIds,
  ]).slice(0, cappedLimit);
}

async function fetchRecruitingPagePostIds(client, limit = REMOTE_CLIENT_RECRUITING_LIMIT, offset = 0, regionKey = "") {
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const feedPostIds = await fetchRecruitingFeedPostIds(client, {
    profileId: "*",
    relations: ["region_public"],
    regionKey,
    limit: cappedLimit,
    offset: safeOffset,
  });
  if (feedPostIds?.length) return feedPostIds;
  if (feedPostIds && safeOffset > 0) return [];
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
  return (data ?? []).map((row) => row?.id).filter(Boolean);
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
  feedCounts = null,
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  offset = 0,
} = {}) {
  const targetPostIds = uniqueIds([...explicitPostIds, ...(mineOnly ? currentUserPostIds : pagePostIds), ...(includeMine ? currentUserPostIds : [])]);
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
    scope.courtIds.length
      ? context.supabase.from("courts").select(COURT_COLUMNS).in("id", scope.courtIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (teamError) throw teamError;
  if (profileError) throw profileError;
  if (courtError) throw courtError;

  const currentUser = context.profile
    ? fromRemoteProfile(context.profile)
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const userById = new Map((profileRows ?? []).map((row) => {
    const user = fromRemoteProfile(row);
    return [user.id, user];
  }));
  userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });

  const teams = (teamRows ?? []).map(toClientTeam);
  const courtById = firstBy(courtRows ?? [], "id");
  const applicationsByPost = groupBy(applicationRows ?? [], "post_id");
  const posts = postRows.map((post) => fromRemoteRecruitingPost(post, applicationsByPost, courtById));
  const settings = {
    ...DEFAULT_SETTINGS,
    ...getRemoteAppSettings(context.profile),
  };
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
      exhausted: mineOnly || Boolean(explicitPostIds.length) || pagePostIds.length < limit,
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
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId ? await getAdminLevel(context) : 0;
    const limit = getCappedLimit(body.limit ?? body.recruitingLimit ?? REMOTE_CLIENT_RECRUITING_LIMIT);
    const mineOnly = body.scope === "mine" || body.mine === true;
    const includeMine = mineOnly || body.includeMine === true;
    const mineLimit = mineOnly ? limit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const explicitPostIds = getTargetPostIds(body);
    const listOnly = body.listOnly !== false && !explicitPostIds.length;
    const offset = getPageOffset(body);
    const shouldPageList = !mineOnly && !explicitPostIds.length;
    const regionScope = body.regionScope === "all" ? "all" : "local";
    const regionKey = regionScope === "all"
      ? ""
      : normalizeRegionKey(body.regionKey || body.regionDistrict || getProfileRegionKey(context.profile));
    const [currentUserPostIds, pagePostIds, feedCountsResult] = await Promise.all([
      includeMine ? fetchCurrentUserRecruitingPostIds(context.supabase, context.profileId, mineLimit) : Promise.resolve([]),
      shouldPageList ? fetchRecruitingPagePostIds(context.supabase, limit, offset, regionKey) : Promise.resolve([]),
      context.profileId ? fetchRecruitingFeedCounts(context.supabase, context.profileId) : Promise.resolve(null),
    ]);
    const feedCounts = feedCountsResult ?? (context.profileId ? await fetchRecruitingFallbackCounts(context.supabase, context.profileId) : null);
    const targetPostIds = uniqueIds([...explicitPostIds, ...(mineOnly ? currentUserPostIds : pagePostIds)]);
    if (listOnly) {
      const compactResult = await loadCompactRecruitingList(context, {
        adminLevel,
        currentUserPostIds,
        explicitPostIds,
        includeMine,
        mineOnly,
        pagePostIds,
        feedCounts,
        limit,
        offset,
      });
      sendJson(response, 200, {
        ok: true,
        ...compactResult,
      });
      return;
    }
    const normalized = await loadNormalizedRemoteStateFromClient(
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
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const pageState = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const pagePosts = pageState.recruitingPosts ?? [];
    let state = pageState;
    if (includeMine && !mineOnly) {
      const loadedIds = new Set(pagePosts.map((post) => post.id));
      const missingMineIds = currentUserPostIds.filter((postId) => !loadedIds.has(postId));
      if (missingMineIds.length) {
        const mineNormalized = await loadNormalizedRemoteStateFromClient(
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
        );
        const mineState = filterStateForProfile(mineNormalized?.state ?? {}, profileId, adminLevel >= 30);
        state = mergeStateById(pageState, mineState);
      }
    }
    const responseState = listOnly ? compactRecruitingListState(state, profileId) : state;
    sendJson(response, 200, {
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
        exhausted: mineOnly || Boolean(explicitPostIds.length) || pagePostIds.length < limit,
        feedCounts,
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "recruiting_list_failed" });
  }
}
