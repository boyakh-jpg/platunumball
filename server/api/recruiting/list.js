import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  DEFAULT_SETTINGS,
  createProfileShell,
  fromRemoteProfile,
  getRemoteAppSettings,
  normalizeState,
  REMOTE_CLIENT_HOME_LOCAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../../../src/data/repository.js";

let currentUserRecruitingRpcAvailable = true;
let userRoomFeedAvailable = true;
let userRoomFeedScopeAvailable = true;
let userRoomFeedTimingColumnsAvailable = true;

const PROFILE_ME_COLUMNS = "id,name,handle,hashtag,position,region,region_sido,region_district,school,company,club,trust_score,streak,avatar_color,test_login_id,auth_user_id,birth_year,age_group,age_group_checked_season,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,discord_connection,discord_user_id,ratings,created_at,updated_at,app_settings";
const PROFILE_PUBLIC_COLUMNS = "id,name,handle,hashtag,position,region,trust_score,avatar_color,ratings,age_group,updated_at";
const TEAM_COLUMNS = "id,name,home_court,region,mmr,wins,losses,accent,deleted_at,created_at,updated_at";
const TEAM_MEMBER_COLUMNS = "team_id,user_id,role";
const COURT_COLUMNS = "id,name";
const RECRUITING_POST_COLUMNS = "id,type,title,visibility,region,court_id,court_name,mode,scheduled_at,scheduled_date,scheduled_time,ranked,official,pre_registered,rating_scale,age_restriction,allowed_age_groups,rules,stakes,court_reserved,court_fee,spots,team_id,target_team_id,referee_id,referee_trust_min,stat_entry_minutes,dispute_minutes,room_state,host_join_mode,host_side,host_ready,side_capacity,player_ids,position,player_id,memo,status,confirmed_at,created_at,updated_at";
const RECRUITING_APPLICATION_COLUMNS = "post_id,kind,team_id,player_id,side,status,reserve,position,player_ids,source_team_id,source_entry_id,created_at,updated_at";
const ROOM_CHAT_MESSAGE_COLUMNS = "id,room_type,room_id,user_id,body,created_at,message_seq";
const RECRUITING_FEED_MAX_LIMIT = 200;
const RECRUITING_PUBLIC_PAGE_MAX_LIMIT = 80;
const RECRUITING_FEED_ROW_MAX_LIMIT = 320;
const RECRUITING_FEED_RELATION_ROW_FACTOR = 4;
const RECRUITING_FEED_PUBLIC_ROW_FACTOR = 2;
const LEGACY_PUBLIC_RECRUITING_FEED_PROFILE_ID = "*";
const PUBLIC_RECRUITING_FEED_SCOPE = "public";
const PROFILE_RECRUITING_FEED_SCOPE = "profile";
const INSTANT_TIMING_TYPE = "instant";
const LEGACY_INSTANT_LABEL = "즉시";
const REGION_SIDO_PREFIXES = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전남광주통합특별시",
  "광주광역시",
  "전라남도",
  "전남광주특별시",
  "광주전남통합특별시",
  "광주전남특별통합시",
  "광주특별시",
  "전라북도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
];
const REGION_KEY_ALIASES = new Map([
  ["성수", "성동"],
  ["잠실", "송파"],
  ["seoul:mapo", "마포"],
  ["seoulmapo", "마포"],
  ["mapo", "마포"],
]);

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

function getRecruitingStartFilter(body = {}) {
  const startFilter = String(body.startFilter ?? "").trim();
  if (startFilter === INSTANT_TIMING_TYPE) return { startFilter, timingType: INSTANT_TIMING_TYPE, scheduledDate: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(startFilter)) return { startFilter, timingType: "", scheduledDate: startFilter };
  const timingType = String(body.timingType ?? "").trim() === INSTANT_TIMING_TYPE ? INSTANT_TIMING_TYPE : "";
  const scheduledDate = String(body.scheduledDate ?? "").trim();
  if (timingType === INSTANT_TIMING_TYPE) return { startFilter: INSTANT_TIMING_TYPE, timingType, scheduledDate: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { startFilter: scheduledDate, timingType: "", scheduledDate };
  return { startFilter: "all", timingType: "", scheduledDate: "" };
}

function getRecruitingRegionScope(body = {}) {
  const regionScope = String(body.regionScope ?? "").trim();
  if (regionScope === "all") return "all";
  if (regionScope === "region") return "region";
  return "local";
}

function uniqueIds(ids = []) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function isMissingTable(error = {}, table = "") {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || (table && message.includes(table));
}

function fromRoomChatMessageRow(row = {}) {
  return {
    id: String(row.id ?? ""),
    messageSeq: Number(row.message_seq ?? 0),
    userId: row.user_id ?? "",
    body: String(row.body ?? "").slice(0, 60),
    createdAt: row.created_at ?? "",
  };
}

function mergeRoomChatMessages(legacyMessages = [], remoteMessages = []) {
  const merged = [];
  [...(legacyMessages ?? []), ...(remoteMessages ?? [])].forEach((message) => {
    const next = {
      id: String(message?.id ?? ""),
      messageSeq: Number(message?.messageSeq ?? message?.message_seq ?? 0),
      userId: message?.userId ?? message?.user_id ?? "",
      body: String(message?.body ?? "").slice(0, 60),
      createdAt: message?.createdAt ?? message?.created_at ?? "",
    };
    if (!next.userId || !next.body.trim()) return;
    const nextTime = Date.parse(next.createdAt || 0);
    const duplicate = merged.some((item) => {
      if (next.id && item.id === next.id) return true;
      if (item.userId !== next.userId || item.body !== next.body) return false;
      const itemTime = Date.parse(item.createdAt || 0);
      return Number.isFinite(nextTime) && Number.isFinite(itemTime) && Math.abs(nextTime - itemTime) <= 30000;
    });
    if (!duplicate) merged.push(next);
  });
  return merged
    .sort((a, b) => (Number(a.messageSeq ?? 0) - Number(b.messageSeq ?? 0)) || String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
    .slice(-50);
}

async function fetchRoomChatMessagesByPostIds(client, postIds = [], limitPerRoom = 30) {
  const ids = uniqueIds(postIds);
  if (!ids.length) return new Map();
  const cappedLimit = Math.max(1, Math.min(30, Number(limitPerRoom) || 30));
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
  (approvedResult.data ?? []).forEach((row) => rowsById.set(row.id, row));
  (legacyResult.data ?? []).forEach((row) => rowsById.set(row.id, row));
  return { data: [...rowsById.values()], error: null };
}

function flattenIdValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenIdValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenIdValues);
  return value ? [String(value)] : [];
}

function normalizeRegionKey(value = "") {
  const compact = String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
  if (!compact) return "";
  if (REGION_KEY_ALIASES.has(compact)) return REGION_KEY_ALIASES.get(compact);
  const parts = String(value ?? "").trim().toLowerCase().split(/[\s:/_-]+/).filter(Boolean);
  let district = parts.at(-1) || compact;
  for (const prefix of REGION_SIDO_PREFIXES) {
    const normalizedPrefix = prefix.toLowerCase();
    if (district.startsWith(normalizedPrefix)) {
      district = district.slice(normalizedPrefix.length);
      break;
    }
  }
  const key = district
    .replace(/\s+/g, "")
    .replace(/(특별시|광역시|특별자치시|특별자치도|자치구|시|군|구)$/u, "");
  return REGION_KEY_ALIASES.get(key) ?? key;
}

function normalizeRecruitingListCountSide(value = {}, fallbackCapacity = 5) {
  if (Array.isArray(value)) {
    const [filled, projectedFilled, confirmationProjectedFilled, capacity] = value;
    return {
      filled: Number(filled ?? 0) || 0,
      projectedFilled: Number(projectedFilled ?? filled ?? 0) || 0,
      confirmationProjectedFilled: Number(confirmationProjectedFilled ?? projectedFilled ?? filled ?? 0) || 0,
      capacity: Number(capacity ?? fallbackCapacity) || fallbackCapacity,
    };
  }
  const filled = Number(value?.filled ?? value?.f ?? value?.count ?? 0) || 0;
  const projectedFilled = Number(value?.projectedFilled ?? value?.p ?? filled) || filled;
  const confirmationProjectedFilled = Number(value?.confirmationProjectedFilled ?? value?.cf ?? projectedFilled) || projectedFilled;
  return {
    filled,
    projectedFilled,
    confirmationProjectedFilled,
    capacity: Number(value?.capacity ?? value?.c ?? fallbackCapacity) || fallbackCapacity,
  };
}

function normalizeRecruitingListCounts(value = {}, sideCapacity = 5) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const teamA = normalizeRecruitingListCountSide(value.teamA ?? value.a, sideCapacity);
  const teamB = normalizeRecruitingListCountSide(value.teamB ?? value.b, sideCapacity);
  return {
    teamA,
    teamB,
    filled: Number(value.filled ?? value.f ?? teamA.filled + teamB.filled) || 0,
    projectedFilled: Number(value.projectedFilled ?? value.p ?? teamA.projectedFilled + teamB.projectedFilled) || 0,
    capacity: Number(value.capacity ?? value.c ?? teamA.capacity + teamB.capacity) || 0,
    partyCount: Number(value.partyCount ?? value.pc ?? 0) || 0,
  };
}

function isSameRegionKey(value = "", regionKey = "") {
  return Boolean(regionKey && normalizeRegionKey(value) === regionKey);
}

function getProfileRegionKey(profile = {}) {
  return normalizeRegionKey(profile?.region_district || profile?.region || "");
}

function isMissingUserRoomFeed(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || message.includes("user_room_feed");
}

function isMissingRoomFeedCards(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || message.includes("room_feed_cards");
}

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
  return Math.max(1, Math.min(RECRUITING_PUBLIC_PAGE_MAX_LIMIT, Math.floor(number)));
}

function normalizeFeedCard(row = {}) {
  const card = row?.card_json ?? row?.cardJson ?? null;
  if (!card || typeof card !== "object" || Array.isArray(card) || !Object.keys(card).length) return null;
  const id = card.id ?? row.entity_id ?? row.entityId;
  if (!id) return null;
  const roomState = card.roomState && typeof card.roomState === "object" && !Array.isArray(card.roomState) ? card.roomState : {};
  const ownerId = card.ownerId ?? roomState.ownerId ?? card.createdBy ?? card.playerId ?? "";
  const playerId = card.playerId ?? ownerId;
  const teamId = String(card.teamId ?? card.team_id ?? "").trim();
  const hostJoinMode = card.hostJoinMode === "player" || !teamId ? "player" : "team";
  return {
    ...card,
    id,
    regionKey: normalizeRegionKey(card.regionKey ?? card.region ?? ""),
    ...(card.listCounts ? { listCounts: normalizeRecruitingListCounts(card.listCounts, Number(card.sideCapacity ?? 5) || 5) } : {}),
    teamId: teamId || null,
    hostJoinMode,
    ...(ownerId ? { ownerId } : {}),
    ...(playerId ? { playerId } : {}),
    roomState: ownerId && !roomState.ownerId ? { ...roomState, ownerId } : roomState,
  };
}

function hasThinRecruitingListCounts(card = {}) {
  return Boolean(
    card?.listCardOnly === true &&
    card?.listCounts &&
    typeof card.listCounts === "object" &&
    !Array.isArray(card.listCounts) &&
    card.listCounts.teamA &&
    card.listCounts.teamB,
  );
}

function uniqueFeedCards(rows = [], ids = []) {
  const idSet = new Set(ids);
  const cards = new Map();
  (rows ?? []).forEach((row) => {
    const id = row?.entity_id ?? row?.entityId;
    if (!id || !idSet.has(id)) return;
    const relation = String(row?.relation ?? "").trim();
    if (cards.has(id)) {
      if (relation) {
        const existing = cards.get(id);
        existing.__feedRelations = [...new Set([...(existing.__feedRelations ?? []), relation])];
      }
      return;
    }
    const card = normalizeFeedCard(row);
    if (card) cards.set(id, relation ? { ...card, __feedRelations: [relation] } : card);
  });
  return ids.map((id) => cards.get(id)).filter(Boolean);
}

async function attachRoomFeedCards(client, rows = [], entityType = "recruiting") {
  const ids = uniqueIds(rows.map((row) => row?.entity_id));
  if (!ids.length) return rows;
  const { data, error } = await client
    .from("room_feed_cards")
    .select("entity_id,card_json")
    .eq("entity_type", entityType)
    .in("entity_id", ids);
  if (error) {
    if (isMissingRoomFeedCards(error)) return rows;
    throw error;
  }
  const cardById = new Map((data ?? []).map((row) => [row.entity_id, row.card_json]));
  return rows.map((row) => ({
    ...row,
    card_json: cardById.get(row?.entity_id) ?? row?.card_json ?? {},
  }));
}

function mergeFeedCards(...cardGroups) {
  const cards = new Map();
  cardGroups.flat().forEach((card) => {
    const id = card?.id;
    if (!id) return;
    if (cards.has(id)) {
      const existing = cards.get(id);
      const feedRelations = [...new Set([...(existing.__feedRelations ?? []), ...(card.__feedRelations ?? [])])];
      const existingTime = Number(new Date(existing.updatedAt ?? existing.updated_at ?? existing.createdAt ?? existing.created_at ?? 0).getTime()) || 0;
      const cardTime = Number(new Date(card.updatedAt ?? card.updated_at ?? card.createdAt ?? card.created_at ?? 0).getTime()) || 0;
      if (cardTime > existingTime) cards.set(id, { ...card, __feedRelations: feedRelations });
      else existing.__feedRelations = feedRelations;
      return;
    }
    cards.set(id, card);
  });
  return [...cards.values()];
}

function hasPendingInvitationForProfile(card = {}, profileId = "") {
  const invitations = card?.roomState?.invitations;
  if (!profileId || !Array.isArray(invitations)) return false;
  return invitations.some((invitation) => (
    invitation?.id &&
    invitation?.targetUserId === profileId &&
    String(invitation?.status ?? "pending") === "pending"
  ));
}

function hasUsableRecruitingFeedCard(card = {}) {
  if (!card?.playerId && !card?.ownerId && !card?.roomState?.ownerId) return false;
  if (!card.updatedAt && !card.updated_at) return false;
  const hasListCounts = hasThinRecruitingListCounts(card);
  if (!hasListCounts && !Array.isArray(card.playerIds)) return false;
  if (!hasListCounts && !Array.isArray(card.applicants)) return false;
  if (card.hostJoinMode === "team" && !card.teamId) return false;
  return true;
}

function getRecruitingFeedCardRejectReason(card = {}, profileId = "") {
  if (!card) return "missing_card";
  if (!card?.playerId && !card?.ownerId && !card?.roomState?.ownerId) return "missing_host_identity";
  if (!card.updatedAt && !card.updated_at) return "missing_updated_at";
  const hasListCounts = hasThinRecruitingListCounts(card);
  if (!hasListCounts && !Array.isArray(card.playerIds)) return "missing_player_ids";
  if (!hasListCounts && !Array.isArray(card.applicants)) return "missing_applicants";
  if (card.hostJoinMode === "team" && !card.teamId) return "missing_team_id";
  if (!profileId) return "";
  const relations = Array.isArray(card?.__feedRelations) ? card.__feedRelations : [];
  if (relations.includes("invited") && !hasPendingInvitationForProfile(card, profileId)) return "missing_pending_invitation";
  return "";
}

function canUseFeedCardForProfile(card = {}, profileId = "") {
  return !getRecruitingFeedCardRejectReason(card, profileId);
}

async function attachPendingInvitationsToFeedCards(client, cards = [], profileId = "") {
  if (!profileId) return [];
  const candidates = cards.filter((card) => getRecruitingFeedCardRejectReason(card, profileId) === "missing_pending_invitation");
  const ids = uniqueIds(candidates.map((card) => card?.id));
  if (!ids.length) return [];
  const { data, error } = await client
    .from("recruiting_posts")
    .select("id,room_state,updated_at")
    .in("id", ids);
  if (error) throw error;
  const rowById = new Map((data ?? []).map((row) => [row.id, row]));
  return candidates
    .map((card) => {
      const row = rowById.get(card.id);
      const invitations = Array.isArray(row?.room_state?.invitations) ? row.room_state.invitations : [];
      const invitation = invitations.find((item) => (
        item?.id &&
        item.targetUserId === profileId &&
        String(item.status ?? "pending") === "pending"
      ));
      if (!invitation) return null;
      const roomState = card.roomState && typeof card.roomState === "object" && !Array.isArray(card.roomState) ? card.roomState : {};
      return {
        ...card,
        updatedAt: card.updatedAt ?? row?.updated_at,
        roomState: {
          ...roomState,
          invitations: [invitation],
        },
      };
    })
    .filter(Boolean);
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

function compactRecruitingRoomState(roomState = {}, profileId = "", options = {}) {
  const includeRoomInvitations = options.includeRoomInvitations === true;
  const invitations = Array.isArray(roomState.invitations)
    ? roomState.invitations
      .filter((invitation) => (
        includeRoomInvitations ||
        invitation.targetUserId === profileId ||
        invitation.fromUserId === profileId
      ))
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
  const compactRoomState = {
    ownerId: roomState.ownerId,
    teamOnly: roomState.teamOnly,
    timingType: roomState.timingType,
    hostReserve: roomState.hostReserve,
    refereeWanted: roomState.refereeWanted,
    invitations,
    mmrRangeMode: roomState.mmrRangeMode,
    mmrLimitMode: roomState.mmrLimitMode,
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
  if (options.includeRoomChat === true) {
    compactRoomState.chatMessages = Array.isArray(roomState.chatMessages)
      ? roomState.chatMessages
        .map((message) => ({
          id: message.id,
          userId: message.userId,
          body: String(message.body ?? "").slice(0, 500),
          createdAt: message.createdAt,
        }))
        .filter((message) => message.userId && message.body.trim())
      : [];
  }
  return compactRoomState;
}

function compactRecruitingPost(post = {}, profileId = "", options = {}) {
  const rules = post.rules ?? {};
  return {
    id: post.id,
    listCardOnly: post.listCardOnly,
    type: post.type,
    title: post.title,
    visibility: post.visibility,
    region: post.region,
    regionKey: post.regionKey,
    courtId: post.courtId,
    court: post.court,
    ownerId: post.ownerId,
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
    roomState: compactRecruitingRoomState(post.roomState ?? {}, profileId, options),
    mmrLimitMode: post.mmrLimitMode,
    teamOnly: post.teamOnly,
    hostJoinMode: post.hostJoinMode,
    hostSide: post.hostSide,
    hostReady: post.hostReady,
    sideCapacity: post.sideCapacity,
    listCounts: post.listCounts,
    __feedRelations: post.__feedRelations,
    __invitationsPartial: true,
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

function compactRecruitingListState(state = {}, profileId = "", options = {}) {
  return {
    ...state,
    users: (state.users ?? []).map((user) => compactUser(user, profileId)),
    teams: (state.teams ?? []).map(compactTeam),
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => compactRecruitingPost(post, profileId, options)),
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

function hasReadableRecruitingInvitation(roomState = {}, profileId = "") {
  if (!profileId || !Array.isArray(roomState.invitations)) return false;
  return roomState.invitations.some((invitation) => (
    invitation?.targetUserId === profileId &&
    ["pending", "accepted", "ready"].includes(String(invitation?.status ?? "pending"))
  ));
}

function canReadRecruitingPostDetail(row = {}, applications = [], profileId = "", adminLevel = 0) {
  if ((row.visibility ?? "public") !== "private") return true;
  if (adminLevel > 0) return true;
  if (!profileId) return false;
  const roomState = row.room_state && typeof row.room_state === "object" ? row.room_state : {};
  const readableIds = uniqueIds([
    row.player_id,
    row.referee_id,
    ...flattenIdValues(row.player_ids),
    roomState.ownerId,
    ...flattenIdValues(roomState.partyLeaders),
    ...flattenIdValues(roomState.partyReserves),
    ...flattenIdValues(roomState.pinnedReservePlayers),
    ...flattenIdValues(roomState.statRecorders),
    ...getRoomStateParticipantIds(roomState),
    ...applications.flatMap((application) => [
      application?.player_id,
      ...flattenIdValues(application?.player_ids),
    ]),
  ]);
  return readableIds.includes(profileId) || hasReadableRecruitingInvitation(roomState, profileId);
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

async function fetchRecruitingFeedPostIds(client, {
  profileId = "",
  feedScope = "",
  relations = [],
  status = "open",
  regionKey = "",
  limit = REMOTE_CLIENT_RECRUITING_LIMIT,
  offset = 0,
} = {}) {
  const page = await fetchRecruitingFeedPage(client, {
    profileId,
    feedScope,
    relations,
    status,
    regionKey,
    limit,
    offset,
    includeCards: false,
  });
  return page?.ids ?? page;
}

async function queryRecruitingFeedPage(client, {
  profileId = "",
  feedScope = PROFILE_RECRUITING_FEED_SCOPE,
  relations = [],
  status = "open",
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
    .eq("is_active", true)
    .eq("status", status)
    .order("sort_at", { ascending: false, nullsFirst: false })
    .order("entity_id", { ascending: false })
    .range(safeOffset, safeOffset + rowLimit - 1);
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

async function fetchRecruitingFeedPage(client, {
  profileId = "",
  feedScope = "",
  relations = [],
  status = "open",
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

async function fetchRecruitingFeedCounts(client, profileId = "") {
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

async function fetchRecruitingFallbackCounts(client, profileId = "") {
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

function selectRecruitingCounts(feedCounts, fallbackCounts) {
  return feedCounts ?? fallbackCounts ?? null;
}

async function fetchCurrentUserRecruitingFallbackPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT, roomScope = "") {
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

function getRecruitingMineRelations(scope = "") {
  if (scope === "created") return ["owner"];
  if (scope === "joined") return ["participant", "referee"];
  if (scope === "invited") return ["invited"];
  return ["owner", "participant", "invited", "referee"];
}

export async function fetchCurrentUserRecruitingPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT, roomScope = "", allowLegacyFallback = false) {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(RECRUITING_FEED_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  const relations = getRecruitingMineRelations(roomScope);
  const feedPostIds = await fetchRecruitingFeedPostIds(client, {
    profileId,
    relations,
    limit: cappedLimit,
  });
  if (feedPostIds) {
    return uniqueIds(feedPostIds).slice(0, cappedLimit);
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
  if (!allowLegacyFallback) return [];
  return fetchCurrentUserRecruitingFallbackPostIds(client, profileId, cappedLimit, roomScope);
}

function isLegacyListFallbackAllowed(body = {}) {
  return body.allowLegacyFallback === true || process.env.RANKBALL_ALLOW_LEGACY_LIST_FALLBACK === "true";
}

async function fetchCurrentUserRecruitingPage(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT, roomScope = "", includeCards = false, allowLegacyFallback = false) {
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

async function fetchRecruitingPage(client, limit = REMOTE_CLIENT_RECRUITING_LIMIT, offset = 0, regionKey = "", includeCards = false, startFilter = {}, allowLegacyFallback = false, allowFeedRepair = false) {
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
      ...getRoomStateParticipantIds(roomState),
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

function collectRecruitingCardScope(cards = [], profileId = "") {
  const profileIds = [profileId];
  const teamIds = [];
  const courtIds = [];
  cards.forEach((post) => {
    const roomState = post?.roomState && typeof post.roomState === "object" && !Array.isArray(post.roomState)
      ? post.roomState
      : {};
    const invitations = Array.isArray(roomState.invitations) ? roomState.invitations : [];
    const applicants = Array.isArray(post?.applicants) ? post.applicants : [];
    profileIds.push(
      post?.ownerId,
      post?.playerId,
      post?.refereeId,
      roomState.ownerId,
      ...flattenIdValues(post?.playerIds),
      ...flattenIdValues(roomState.partyLeaders),
      ...flattenIdValues(roomState.partyReserves),
      ...flattenIdValues(roomState.pinnedReservePlayers),
      ...getRoomStateParticipantIds(roomState),
      ...invitations.flatMap((invitation) => [
        invitation?.targetUserId,
        invitation?.fromUserId,
        ...(invitation?.playerIds ?? []),
      ]),
    );
    teamIds.push(
      post?.teamId,
      post?.targetTeamId,
      ...collectTeamIdsFromRoomKeys(roomState.partyLeaders),
      ...collectTeamIdsFromRoomKeys(roomState.partyReserves),
    );
    courtIds.push(post?.courtId);
    applicants.forEach((application) => {
      profileIds.push(application?.playerId, ...flattenIdValues(application?.playerIds));
      teamIds.push(application?.teamId, application?.sourceTeamId);
    });
  });
  return {
    profileIds: uniqueIds(profileIds),
    teamIds: uniqueIds(teamIds),
    courtIds: uniqueIds(courtIds),
  };
}

function attachRecruitingCardReferences(card = {}, courtById = {}) {
  if (!card?.id) return card;
  const courtName = card.court ?? courtById[card.courtId]?.name;
  return courtName ? { ...card, court: courtName } : card;
}

function toClientTeam(row = {}, memberRows = []) {
  const members = [...(memberRows ?? [])]
    .sort((a, b) => String(a.role).localeCompare(String(b.role)) || String(a.user_id).localeCompare(String(b.user_id)))
    .map((member) => ({ userId: member.user_id, role: member.role ?? "regular" }));
  return {
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? 1200,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    accent: row.accent,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
    membersPartial: members.length === 0,
    members,
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

async function appendMissingTeamMemberProfiles(client, profileRows = [], teamMemberRows = [], currentUserId = "") {
  const existingIds = new Set((profileRows ?? []).map((row) => row.id).filter(Boolean));
  if (currentUserId) existingIds.add(currentUserId);
  const missingIds = uniqueIds((teamMemberRows ?? []).map((row) => row.user_id)).filter((id) => !existingIds.has(id));
  if (!missingIds.length) return profileRows ?? [];
  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_PUBLIC_COLUMNS)
    .in("id", missingIds);
  if (error) throw error;
  return [...(profileRows ?? []), ...(data ?? [])];
}

function fromRemoteRecruitingPost(row = {}, applicationsByPost = new Map(), courtById = {}, chatMessagesByPost = new Map()) {
  const rawScheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);
  const roomState = row.room_state && typeof row.room_state === "object" ? row.room_state : {};
  const chatMessages = chatMessagesByPost.has(row.id)
    ? mergeRoomChatMessages(roomState.chatMessages ?? [], chatMessagesByPost.get(row.id) ?? [])
    : roomState.chatMessages;
  const timingType = roomState.timingType === "instant" || rawScheduledAt === "\uC989\uC2DC" ? "instant" : "scheduled";
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    visibility: row.visibility ?? "public",
    region: row.region,
    regionKey: normalizeRegionKey(row.region),
    courtId: row.court_id ?? null,
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
    roomState: chatMessages ? { ...roomState, chatMessages } : roomState,
    mmrLimitMode: ["off", "warn", "block"].includes(roomState.mmrLimitMode) ? roomState.mmrLimitMode : "block",
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
    const cardById = new Map(
      targetCards
        .filter((card) => canUseFeedCardForProfile(card, context.profileId))
        .map((card) => [card.id, card]),
    );
    const inviteRepairCandidateCount = debugPage
      ? targetCards.filter((card) => getRecruitingFeedCardRejectReason(card, context.profileId) === "missing_pending_invitation").length
      : 0;
    const repairedCards = await attachPendingInvitationsToFeedCards(context.supabase, targetCards, context.profileId);
    repairedCards.forEach((card) => cardById.set(card.id, card));
    const fallbackPostIds = targetPostIds.filter((postId) => !cardById.has(postId));
    const fallbackCardReasons = debugPage && fallbackPostIds.length
      ? fallbackPostIds.map((postId) => {
        const card = targetCards.find((item) => item.id === postId);
        return { postId, reason: getRecruitingFeedCardRejectReason(card, context.profileId) };
      })
      : undefined;
    const postRowsRaw = fallbackPostIds.length ? await fetchRecruitingRowsByIds(context.supabase, fallbackPostIds) : [];
    const rawPostIds = postRowsRaw.map((post) => post.id).filter(Boolean);
    const { data: applicationRowsRaw, error: applicationError } = rawPostIds.length
      ? await context.supabase.from("recruiting_applications").select(RECRUITING_APPLICATION_COLUMNS).in("post_id", rawPostIds)
      : { data: [], error: null };
    if (applicationError) throw applicationError;
    const applicationsByRawPost = groupBy(applicationRowsRaw ?? [], "post_id");
    const postRows = postRowsRaw.filter((post) => canReadRecruitingPostDetail(post, applicationsByRawPost.get(post.id) ?? [], context.profileId ?? "", adminLevel));
    const postIds = postRows.map((post) => post.id).filter(Boolean);
    const readablePostIds = new Set(postIds);
    const applicationRows = (applicationRowsRaw ?? []).filter((application) => readablePostIds.has(application.post_id));
    if (skipCardReferenceRows && !fallbackPostIds.length) {
      const responsePosts = targetPostIds.map((postId) => cardById.get(postId)).filter(Boolean);
      const state = normalizeState({
        currentUserId: currentUser.id,
        users: [currentUser],
        teams: [],
        recruitingPosts: responsePosts,
        settings,
      }, { includeDemo: false });
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
          source: pageSource || "feed_card",
          feedCounts,
          inviteRepairCandidateCount: debugPage ? inviteRepairCandidateCount : undefined,
          inviteRepairCount: debugPage ? repairedCards.length : undefined,
          fallbackCount: debugPage ? 0 : undefined,
          fallbackCardReasons,
        },
        updatedAt: Math.max(
          ...[...responsePosts, context.profile].filter(Boolean)
            .map((row) => new Date(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? 0).getTime())
            .filter((value) => Number.isFinite(value)),
          0,
        ),
      };
    }

    const rowScope = collectRecruitingScope(postRows, applicationRows ?? [], context.profileId ?? "");
    const cardScope = collectRecruitingCardScope(targetCards, context.profileId ?? "");
    const scope = {
      profileIds: uniqueIds([...rowScope.profileIds, ...cardScope.profileIds]),
      teamIds: uniqueIds([...rowScope.teamIds, ...cardScope.teamIds]),
      courtIds: uniqueIds([...rowScope.courtIds, ...cardScope.courtIds]),
    };
    const profileIdsForLookup = scope.profileIds.filter((profileId) => profileId !== currentUser.id);
    const shouldLoadTeamMembers = fallbackPostIds.length > 0 || targetCards.some((card) => (
      Array.isArray(card?.playerIds) && card.playerIds.length > 0
    ));
    const [
      { data: teamRows, error: teamError },
      { data: teamMemberRows, error: teamMemberError },
      { data: profileRows, error: profileError },
      { data: courtRows, error: courtError },
    ] = await Promise.all([
      scope.teamIds.length
        ? context.supabase.from("teams").select(TEAM_COLUMNS).in("id", scope.teamIds).is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      shouldLoadTeamMembers && scope.teamIds.length
        ? context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", scope.teamIds)
        : Promise.resolve({ data: [], error: null }),
      profileIdsForLookup.length
        ? context.supabase.from("profiles").select(PROFILE_PUBLIC_COLUMNS).in("id", profileIdsForLookup)
        : Promise.resolve({ data: [], error: null }),
      fetchCourtRowsByIds(context.supabase, scope.courtIds),
    ]);
    if (teamError) throw teamError;
    if (teamMemberError) throw teamMemberError;
    if (profileError) throw profileError;
    if (courtError) throw courtError;

    const userById = new Map((profileRows ?? []).map((row) => {
      const user = fromRemoteProfile(row);
      return [user.id, user];
    }));
    userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });

    const teamMembersByTeam = groupBy(teamMemberRows ?? [], "team_id");
    const teams = (teamRows ?? []).map((team) => toClientTeam(team, teamMembersByTeam.get(team.id)));
    const courtById = firstBy(courtRows ?? [], "id");
    const applicationsByPost = groupBy(applicationRows ?? [], "post_id");
    const rowPostById = new Map(postRows.map((post) => [post.id, fromRemoteRecruitingPost(post, applicationsByPost, courtById)]));
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
        source: pageSource ? (fallbackPostIds.length ? `${pageSource}+row` : pageSource) : (fallbackPostIds.length ? "feed_card+row" : "feed_card"),
        feedCounts,
        inviteRepairCandidateCount: debugPage ? inviteRepairCandidateCount : undefined,
        inviteRepairCount: debugPage ? repairedCards.length : undefined,
        fallbackCount: debugPage ? fallbackPostIds.length : undefined,
        fallbackCardReasons,
      },
      updatedAt: Math.max(
        ...[...pageCards, ...postRows, context.profile].filter(Boolean)
          .map((row) => new Date(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? 0).getTime())
          .filter((value) => Number.isFinite(value)),
        0,
      ),
    };
  }

  const postRowsRaw = await fetchRecruitingRowsByIds(context.supabase, targetPostIds);
  const rawPostIds = postRowsRaw.map((post) => post.id).filter(Boolean);
  const { data: applicationRowsRaw, error: applicationError } = rawPostIds.length
    ? await context.supabase.from("recruiting_applications").select(RECRUITING_APPLICATION_COLUMNS).in("post_id", rawPostIds)
    : { data: [], error: null };
  if (applicationError) throw applicationError;
  const applicationsByRawPost = groupBy(applicationRowsRaw ?? [], "post_id");
  const postRows = postRowsRaw.filter((post) => canReadRecruitingPostDetail(post, applicationsByRawPost.get(post.id) ?? [], context.profileId ?? "", adminLevel));
  const postIds = postRows.map((post) => post.id).filter(Boolean);
  const readablePostIds = new Set(postIds);
  const applicationRows = (applicationRowsRaw ?? []).filter((application) => readablePostIds.has(application.post_id));

  const chatMessagesByPost = includeRoomChat
    ? await fetchRoomChatMessagesByPostIds(context.supabase, postIds)
    : new Map();
  const chatProfileIds = [...chatMessagesByPost.values()]
    .flat()
    .map((message) => message.userId)
    .filter(Boolean);
  const scope = collectRecruitingScope(postRows, applicationRows ?? [], context.profileId ?? "");
  scope.profileIds = uniqueIds([...scope.profileIds, ...chatProfileIds]);
  const profileIdsForLookup = scope.profileIds.filter((profileId) => profileId !== currentUser.id);
  const [
    { data: teamRows, error: teamError },
    { data: teamMemberRows, error: teamMemberError },
    { data: profileRows, error: profileError },
    { data: courtRows, error: courtError },
  ] = await Promise.all([
    scope.teamIds.length
      ? context.supabase.from("teams").select(TEAM_COLUMNS).in("id", scope.teamIds).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    scope.teamIds.length
      ? context.supabase.from("team_members").select(TEAM_MEMBER_COLUMNS).in("team_id", scope.teamIds)
      : Promise.resolve({ data: [], error: null }),
    profileIdsForLookup.length
      ? context.supabase.from("profiles").select(PROFILE_PUBLIC_COLUMNS).in("id", profileIdsForLookup)
      : Promise.resolve({ data: [], error: null }),
    fetchCourtRowsByIds(context.supabase, scope.courtIds),
  ]);
  if (teamError) throw teamError;
  if (teamMemberError) throw teamMemberError;
  if (profileError) throw profileError;
  if (courtError) throw courtError;

  const profileRowsWithTeamMembers = await appendMissingTeamMemberProfiles(context.supabase, profileRows ?? [], teamMemberRows ?? [], currentUser.id);
  const userById = new Map((profileRowsWithTeamMembers ?? []).map((row) => {
    const user = fromRemoteProfile(row);
    return [user.id, user];
  }));
  userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });

  const teamMembersByTeam = groupBy(teamMemberRows ?? [], "team_id");
  const teams = (teamRows ?? []).map((team) => toClientTeam(team, teamMembersByTeam.get(team.id)));
  const courtById = firstBy(courtRows ?? [], "id");
  const applicationsByPost = groupBy(applicationRows ?? [], "post_id");
  const posts = postRows.map((post) => fromRemoteRecruitingPost(post, applicationsByPost, courtById, chatMessagesByPost));
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
  includeFeedCounts = true,
  allowLegacyFallback = false,
  roomScope = "",
  skipCardReferenceRows = false,
  preferFreshRows = false,
} = {}) {
  if (!context.profileId) {
    return loadCompactRecruitingList(context, { adminLevel, limit, mineOnly: true });
  }
  const relations = getRecruitingMineRelations(roomScope);
  const [pageResult, feedCounts] = await Promise.all([
    fetchRecruitingFeedPage(context.supabase, {
      profileId: context.profileId,
      relations,
      limit,
      includeCards: true,
    }),
    includeFeedCounts
      ? fetchRecruitingFeedCounts(context.supabase, context.profileId)
      : Promise.resolve(null),
  ]);
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

export async function loadLocalRecruitingFeedList(context, {
  adminLevel = 0,
  limit = REMOTE_CLIENT_HOME_LOCAL_RECRUITING_LIMIT,
} = {}) {
  const regionKey = getProfileRegionKey(context.profile);
  const pageResult = await fetchRecruitingFeedPage(context.supabase, {
    profileId: LEGACY_PUBLIC_RECRUITING_FEED_PROFILE_ID,
    feedScope: PUBLIC_RECRUITING_FEED_SCOPE,
    relations: ["region_public"],
    regionKey,
    limit,
    includeCards: true,
  });
  if (!pageResult) {
    return loadCompactRecruitingList(context, { adminLevel, limit });
  }
  return loadCompactRecruitingList(context, {
    adminLevel,
    pagePostIds: pageResult.ids ?? [],
    pageCards: pageResult.cards ?? [],
    pageSource: pageResult.source ?? "feed",
    pageExhausted: pageResult.exhausted,
    pageNextOffset: pageResult.nextOffset,
    limit,
    regionScope: regionKey ? "region" : "local",
    regionKey,
  });
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
    const includeFallbackCounts = body.includeFallbackCounts === true;
    const allowLegacyFallback = isLegacyListFallbackAllowed(body);
    const allowFeedRepair = body.allowFeedRepair === true || process.env.RANKBALL_ALLOW_READ_FEED_REPAIR === "true";
    const mineLimit = mineOnly ? limit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const explicitPostIds = getTargetPostIds(body);
    const listOnly = body.listOnly !== false && !explicitPostIds.length;
    const offset = getPageOffset(body);
    const shouldPageList = !mineOnly && !explicitPostIds.length;
    const startFilter = getRecruitingStartFilter(body);
    const regionScope = getRecruitingRegionScope(body);
    const regionKey = regionScope === "all"
      ? ""
      : normalizeRegionKey(body.regionKey || body.regionDistrict || getProfileRegionKey(context.profile));
    const [mineResult, pageResult, feedCountsResult] = await Promise.all([
      includeMine
        ? timing.track("mine", () => fetchCurrentUserRecruitingPage(context.supabase, context.profileId, mineLimit, roomScope, listOnly, allowLegacyFallback))
        : Promise.resolve({ ids: [], cards: [], source: "", exhausted: true }),
      shouldPageList
        ? timing.track("page", () => fetchRecruitingPage(context.supabase, limit, offset, regionKey, listOnly, startFilter, allowLegacyFallback, allowFeedRepair))
        : Promise.resolve({ ids: [], cards: [], source: "", exhausted: true }),
      context.profileId && includeFeedCounts
        ? timing.track("counts", () => fetchRecruitingFeedCounts(context.supabase, context.profileId))
        : Promise.resolve(null),
    ]);
    const fallbackCountsResult = context.profileId && includeFeedCounts && includeFallbackCounts && !feedCountsResult
      ? await timing.track("fallbackCounts", () => fetchRecruitingFallbackCounts(context.supabase, context.profileId))
      : null;
    const currentUserPostIds = mineResult?.ids ?? [];
    const pagePostIds = pageResult?.ids ?? [];
    const pageCards = mergeFeedCards(mineResult?.cards ?? [], pageResult?.cards ?? []);
    const pageSource = pageResult?.source ?? "";
    const pageExhausted = typeof pageResult?.exhausted === "boolean" ? pageResult.exhausted : null;
    const pageNextOffset = pageResult?.nextOffset;
    const feedCounts = selectRecruitingCounts(feedCountsResult, fallbackCountsResult);
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
        pageNextOffset,
        feedCounts,
        limit,
        offset,
        regionScope: regionKey ? "region" : regionScope,
        regionKey,
        startFilter: startFilter.startFilter,
        timingType: startFilter.timingType,
        scheduledDate: startFilter.scheduledDate,
        debugPage: debugTiming,
      }));
      sendTimedJson(response, 200, {
        ok: true,
        ...compactResult,
      }, timing, debugTiming);
      return;
    }
    if (!targetPostIds.length) {
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
        pageNextOffset,
        feedCounts,
        limit,
        offset,
        regionScope: regionKey ? "region" : regionScope,
        regionKey,
        startFilter: startFilter.startFilter,
        timingType: startFilter.timingType,
        scheduledDate: startFilter.scheduledDate,
        debugPage: debugTiming,
      }));
      sendTimedJson(response, 200, {
        ok: true,
        ...compactResult,
      }, timing, debugTiming);
      return;
    }
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
      pageNextOffset,
      feedCounts,
      limit,
      offset,
      regionScope: regionKey ? "region" : regionScope,
      regionKey,
      startFilter: startFilter.startFilter,
      timingType: startFilter.timingType,
      scheduledDate: startFilter.scheduledDate,
      debugPage: debugTiming,
    }));
    sendTimedJson(response, 200, {
      ok: true,
      ...compactResult,
    }, timing, debugTiming);
  } catch (error) {
    sendTimedJson(response, error.statusCode || 500, { error: error.message || "recruiting_list_failed" }, timing, debugTiming);
  }
}
