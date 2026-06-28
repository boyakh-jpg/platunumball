import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  DEFAULT_SETTINGS,
  createProfileShell,
  fromRemoteProfile,
  getRemoteAppSettings,
  loadNormalizedRemoteStateFromClient,
  normalizeState,
  REMOTE_CLIENT_MATCH_LIMIT,
} from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";
import { fetchCurrentUserRecruitingPostIds, loadCompactRecruitingList } from "../recruiting/list.js";

const PROFILE_ME_COLUMNS = "id,name,handle,hashtag,position,region,region_sido,region_district,school,company,club,trust_score,streak,avatar_color,test_login_id,auth_user_id,birth_year,age_group,age_group_checked_season,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,discord_connection,discord_user_id,ratings,created_at,updated_at,app_settings";
const PROFILE_CARD_COLUMNS = "id,name,handle,hashtag,position,region,trust_score,avatar_color,ratings,age_group,updated_at";
const MATCH_LIST_COLUMNS = "id,title,mode,court_id,court_name,visibility,status,ranked,referee_id,former_referee_id,stat_entry_minutes,dispute_minutes,stat_recorders,played_player_ids,reserve_players,mmr_excluded_player_ids,anonymous_players,official,pre_registered,scheduled_at,scheduled_date,scheduled_time,team_a_id,team_b_id,score_a,score_b,rules,created_by,agreed_at,started_at,ended_at,confirmed_at,cancelled_at,voided_at,tournament_id,updated_at,created_at";
const MATCH_PLAYER_COLUMNS = "match_id,team_id,user_id,side,slot_order";
const TEAM_COLUMNS = "id,name,home_court,region,mmr,wins,losses,accent,deleted_at";
const COURT_COLUMNS = "id,name";

let userRoomFeedAvailable = true;
const MATCH_LIST_MAX_LIMIT = 200;
const ACTIVE_MATCH_EXCLUDED_STATUSES = new Set(["confirmed", "cancelled", "void", "closed"]);

function getMatchCursor(matches = []) {
  const oldest = [...matches]
    .sort((a, b) => String(a.updatedAt ?? a.createdAt ?? "").localeCompare(String(b.updatedAt ?? b.createdAt ?? "")))
    .at(0);
  return oldest?.updatedAt ?? oldest?.createdAt ?? "";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function isMissingTable(error = {}, table = "") {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || (table && message.includes(table));
}

async function fetchCourtRowsByIds(supabase, courtIds = []) {
  const ids = unique(courtIds);
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

function isMissingUserRoomFeed(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || message.includes("user_room_feed");
}

function getFeedOffsetCursor(value = "") {
  const text = String(value ?? "");
  if (!text.startsWith("feed:")) return 0;
  const offset = Number(text.slice(5));
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

function getMineOffsetCursor(value = "") {
  const text = String(value ?? "");
  if (!text.startsWith("mine:")) return 0;
  const offset = Number(text.slice(5));
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

async function timeStep(debugTiming, key, callback) {
  const startedAt = Date.now();
  try {
    return await callback();
  } finally {
    if (debugTiming) debugTiming[key] = (debugTiming[key] ?? 0) + Date.now() - startedAt;
  }
}

function mergeById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function normalizeFeedCard(row = {}) {
  const card = row?.card_json ?? row?.cardJson ?? row?.card ?? null;
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
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

function flattenIdValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenIdValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenIdValues);
  return value ? [String(value)] : [];
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
  if (!Number.isFinite(number) || number <= 0) return REMOTE_CLIENT_MATCH_LIMIT;
  return Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Math.floor(number)));
}

async function fetchMatchFeedPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "", activeOnly = false) {
  if (!profileId || !userRoomFeedAvailable) return null;
  if (String(cursor ?? "").startsWith("mine:")) return null;
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const offset = getFeedOffsetCursor(cursor);
  const { data: rpcData, error: rpcError } = await client.rpc("rankball_match_list", {
    p_profile_id: profileId,
    p_limit: cappedLimit,
    p_cursor: cursor,
    p_active_only: activeOnly,
  });
  if (!rpcError) {
    const rows = Array.isArray(rpcData?.rows) ? rpcData.rows : [];
    const ids = unique(rows.map((row) => row?.entity_id ?? row?.entityId).filter(Boolean));
    const cards = uniqueFeedCards(rows, ids);
    return {
      ids,
      cards: cards.length === rows.length ? cards : [],
      cursor: String(rpcData?.cursor ?? ""),
      exhausted: rpcData?.exhausted !== false,
      source: cards.length === rows.length ? "rpc_card" : "rpc",
    };
  }
  if (!isMissingUserRoomFeed(rpcError) && rpcError?.code !== "PGRST202") throw rpcError;

  const rowLimit = Math.min(320, cappedLimit * 4);
  let query = client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation,card_json")
    .eq("entity_type", "match")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .neq("status", "closed")
    .in("relation", ["owner", "participant", "referee"]);
  if (activeOnly) query = query.not("status", "in", "(confirmed,cancelled,void,closed)");
  const { data, error } = await query
    .order("sort_at", { ascending: false, nullsFirst: false })
    .order("entity_id", { ascending: false })
    .range(offset, offset + rowLimit - 1);
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("Match feed skipped.", error.message);
      return null;
    }
    throw error;
  }
  const ids = unique((data ?? []).map((row) => row?.entity_id)).slice(0, cappedLimit);
  const rows = (data ?? []).filter((row) => ids.includes(row?.entity_id));
  const cards = uniqueFeedCards(rows, ids);
  return {
    ids,
    cards: cards.length === ids.length ? cards : [],
    cursor: ids.length ? `feed:${offset + (data ?? []).length}` : "",
    exhausted: (data ?? []).length < rowLimit || ids.length < cappedLimit,
    source: cards.length === ids.length ? "feed_card" : "feed",
  };
}

async function fetchMatchRowsByIds(client, matchIds = []) {
  const ids = unique(matchIds);
  if (!ids.length) return [];
  const { data, error } = await client
    .from("matches")
    .select(MATCH_LIST_COLUMNS)
    .in("id", ids);
  if (error) throw error;
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...(data ?? [])].sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
}

async function fetchCurrentUserMatchCandidateIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT) {
  if (!profileId) return [];
  const candidateLimit = Math.max(80, Math.min(500, Number(limit || REMOTE_CLIENT_MATCH_LIMIT) * 10));
  const [
    { data: playerRows, error: playerError },
    { data: createdRows, error: createdError },
    { data: refereeRows, error: refereeError },
    { data: formerRefereeRows, error: formerRefereeError },
  ] = await Promise.all([
    client
      .from("match_players")
      .select("match_id")
      .eq("user_id", profileId)
      .limit(candidateLimit),
    client
      .from("matches")
      .select("id")
      .eq("created_by", profileId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(candidateLimit),
    client
      .from("matches")
      .select("id")
      .eq("referee_id", profileId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(candidateLimit),
    client
      .from("matches")
      .select("id")
      .eq("former_referee_id", profileId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(candidateLimit),
  ]);
  if (playerError) throw playerError;
  if (createdError) throw createdError;
  if (refereeError) throw refereeError;
  if (formerRefereeError) throw formerRefereeError;
  return unique([
    ...(playerRows ?? []).map((row) => row.match_id),
    ...(createdRows ?? []).map((row) => row.id),
    ...(refereeRows ?? []).map((row) => row.id),
    ...(formerRefereeRows ?? []).map((row) => row.id),
  ]);
}

async function fetchCurrentUserMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "", activeOnly = false) {
  if (!profileId) return null;
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const offset = getMineOffsetCursor(cursor);
  const candidateIds = await fetchCurrentUserMatchCandidateIds(client, profileId, cappedLimit);
  if (!candidateIds.length) {
    return { rows: [], cursor: "", exhausted: true };
  }
  const rows = await fetchMatchRowsByIds(client, candidateIds);
  const filteredRows = activeOnly
    ? rows.filter((row) => !ACTIVE_MATCH_EXCLUDED_STATUSES.has(String(row.status ?? "")))
    : rows;
  const sortedRows = [...filteredRows].sort((a, b) => (
    String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? ""))
      || String(b.id ?? "").localeCompare(String(a.id ?? ""))
  ));
  const pageRows = sortedRows.slice(offset, offset + cappedLimit);
  const nextOffset = offset + pageRows.length;
  return {
    rows: pageRows,
    cursor: nextOffset < sortedRows.length ? `mine:${nextOffset}` : "",
    exhausted: nextOffset >= sortedRows.length,
  };
}

function getMatchUserIds(match = {}) {
  return unique([
    match.createdBy,
    match.refereeId,
    match.formerRefereeId,
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...(match.reservePlayers?.teamA ?? []),
    ...(match.reservePlayers?.teamB ?? []),
  ]);
}

function getRecorderMatchUserIds(match = {}) {
  return unique([
    ...getMatchUserIds(match),
    match.result?.submittedBy,
    ...Object.keys(match.result?.playerStats ?? {}),
    ...flattenIdValues(match.result?.statSubmissions),
    ...flattenIdValues(match.statRecorders),
    ...flattenIdValues(match.rules?.statRecorders),
  ]);
}

function isRecorderMatch(match = {}, profileId = "", isAdmin = false) {
  if (!["agreed", "approval", "disputed"].includes(match.status)) return false;
  if (isAdmin) return true;
  return getRecorderMatchUserIds(match).includes(profileId);
}

function getMatchRowActorIds(row = {}, players = []) {
  return unique([
    row.created_by,
    row.referee_id,
    row.former_referee_id,
    ...players.map((player) => player.user_id),
    ...flattenIdValues(row.played_player_ids),
    ...flattenIdValues(row.reserve_players),
    ...flattenIdValues(row.stat_recorders),
    ...flattenIdValues(row.rules?.playedPlayerIds),
    ...flattenIdValues(row.rules?.reservePlayers),
    ...flattenIdValues(row.rules?.statRecorders),
  ]);
}

function canReadMatchRow(row = {}, players = [], profileId = "", isAdmin = false) {
  if (isAdmin) return true;
  if ((row.visibility ?? row.rules?.visibility ?? "public") !== "private") return true;
  return getMatchRowActorIds(row, players).includes(profileId);
}

function getMatchTeamIds(match = {}) {
  return unique([match.teamA?.teamId, match.teamB?.teamId]);
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

function compactMatchSide(side = {}) {
  return {
    teamId: side.teamId,
    name: side.name,
    players: side.players ?? [],
    score: side.score,
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

function toClientMatchSide(row = {}, sideName = "teamA", playersByMatch = new Map(), teamById = {}) {
  const teamId = sideName === "teamA" ? row.team_a_id : row.team_b_id;
  const score = sideName === "teamA" ? row.score_a : row.score_b;
  return {
    teamId,
    name: teamById[teamId]?.name ?? (sideName === "teamA" ? "Team A" : "Team B"),
    players: [...(playersByMatch.get(row.id) ?? [])]
      .filter((player) => player.side === sideName)
      .sort((a, b) => (a.slot_order ?? 0) - (b.slot_order ?? 0))
      .map((player) => player.user_id),
    score: score ?? 0,
  };
}

function toClientMatch(row = {}, playersByMatch = new Map(), teamById = {}, courtById = {}) {
  const rawScheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);
  const timingType = row.rules?.timingType === "instant" || rawScheduledAt === "\uC989\uC2DC" ? "instant" : "scheduled";
  const playedPlayerIds = row.played_player_ids ?? row.rules?.playedPlayerIds ?? {};
  const reservePlayers = row.reserve_players ?? row.rules?.reservePlayers ?? {};
  const mmrExcludedPlayerIds = row.mmr_excluded_player_ids ?? row.rules?.mmrExcludedPlayerIds ?? [];
  const anonymousPlayers = row.anonymous_players ?? {};
  const statRecorders = row.stat_recorders ?? row.rules?.statRecorders ?? {};
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    court: row.court_name ?? courtById[row.court_id]?.name ?? "\uBBF8\uC815",
    visibility: row.visibility ?? row.rules?.visibility ?? "public",
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    scheduledAt: timingType === "instant" ? "\uC989\uC2DC" : rawScheduledAt,
    timingType,
    status: row.status ?? "contract",
    official: Boolean(row.official),
    preRegistered: Boolean(row.pre_registered),
    ranked: row.ranked !== false,
    refereeId: row.referee_id ?? "",
    formerRefereeId: row.former_referee_id ?? "",
    refereeWanted: Boolean(row.referee_id || row.rules?.refereeWanted),
    createdBy: row.created_by ?? "",
    recruitingPostId: row.rules?.recruitingPostId ?? "",
    tournamentId: row.tournament_id ?? "",
    teamA: toClientMatchSide(row, "teamA", playersByMatch, teamById),
    teamB: toClientMatchSide(row, "teamB", playersByMatch, teamById),
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    playedPlayerIds,
    reservePlayers,
    mmrExcludedPlayerIds,
    anonymousPlayers,
    parties: row.rules?.parties ?? {},
    result: null,
    rules: {
      targetScore: row.rules?.targetScore,
      timeLimit: row.rules?.timeLimit,
      winByTwo: row.rules?.winByTwo,
      ball: row.rules?.ball,
      playedPlayerIds,
      mmrExcludedPlayerIds,
      statRecorders,
    },
    statRecorders,
    statEntryMinutes: row.stat_entry_minutes ?? 60,
    disputeMinutes: row.dispute_minutes ?? 30,
    createdAt: row.created_at,
    agreedAt: row.agreed_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    voidedAt: row.voided_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

function compactMatch(match = {}) {
  const rules = match.rules ?? {};
  return {
    id: match.id,
    title: match.title,
    mode: match.mode,
    court: match.court,
    visibility: match.visibility,
    scheduledDate: match.scheduledDate,
    scheduledTime: match.scheduledTime,
    scheduledAt: match.scheduledAt,
    timingType: match.timingType,
    status: match.status,
    official: match.official,
    preRegistered: match.preRegistered,
    ranked: match.ranked,
    refereeId: match.refereeId,
    formerRefereeId: match.formerRefereeId,
    refereeWanted: match.refereeWanted,
    createdBy: match.createdBy,
    recruitingPostId: match.recruitingPostId,
    tournamentId: match.tournamentId,
    teamA: compactMatchSide(match.teamA),
    teamB: compactMatchSide(match.teamB),
    agreements: match.agreements,
    approvals: match.approvals,
    disputes: match.disputes,
    playedPlayerIds: match.playedPlayerIds,
    reservePlayers: match.reservePlayers,
    mmrExcludedPlayerIds: match.mmrExcludedPlayerIds,
    anonymousPlayers: match.anonymousPlayers,
    parties: match.parties,
    result: match.result,
    rules: {
      targetScore: rules.targetScore,
      timeLimit: rules.timeLimit,
      winByTwo: rules.winByTwo,
      ball: rules.ball,
      playedPlayerIds: rules.playedPlayerIds,
      mmrExcludedPlayerIds: rules.mmrExcludedPlayerIds,
      statRecorders: rules.statRecorders,
    },
    statRecorders: match.statRecorders,
    statEntryMinutes: match.statEntryMinutes,
    disputeMinutes: match.disputeMinutes,
    createdAt: match.createdAt,
    agreedAt: match.agreedAt,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    confirmedAt: match.confirmedAt,
    cancelledAt: match.cancelledAt,
    voidedAt: match.voidedAt,
    updatedAt: match.updatedAt,
  };
}

function compactMatchListState(state = {}, profileId = "") {
  const matches = (state.matches ?? []).map(compactMatch);
  const userIds = new Set(unique([profileId, ...matches.flatMap(getMatchUserIds)]));
  const teamIds = new Set(matches.flatMap(getMatchTeamIds));
  return {
    ...state,
    matches,
    users: (state.users ?? []).filter((user) => userIds.has(user.id)).map((user) => compactUser(user, profileId)),
    teams: (state.teams ?? []).filter((team) => teamIds.has(team.id)).map(compactTeam),
    affiliations: [],
    seasons: [],
    reports: [],
    notifications: [],
    discordNotificationDeliveries: [],
    settings: {
      theme: state.settings?.theme === "light" ? "light" : "dark",
    },
  };
}

async function loadCurrentRecruitingSchedule(context, adminLevel = 0) {
  if (!context.profileId) return null;
  try {
    const currentUserPostIds = await fetchCurrentUserRecruitingPostIds(context.supabase, context.profileId, 12);
    if (!currentUserPostIds.length) return null;
    return await loadCompactRecruitingList(context, {
      adminLevel,
      currentUserPostIds,
      includeMine: true,
      mineOnly: true,
      limit: 12,
    });
  } catch (error) {
    console.warn("Match list recruiting schedule skipped.", error.message);
    return null;
  }
}

async function loadNormalizedMatchList(context, body = {}, adminLevel = 0, limit = REMOTE_CLIENT_MATCH_LIMIT) {
  const normalized = await loadNormalizedRemoteStateFromClient(
    context.supabase,
    context.authUserId,
    context.authUser?.email ?? "",
    {
      clientState: true,
      isAdmin: adminLevel >= 30,
      scope: "matches",
      matchListOnly: false,
      matchLimit: limit,
      matchUpdatedBefore: body.cursor ?? body.matchUpdatedBefore ?? "",
      recruitingLimit: 0,
      tournamentLimit: 0,
    },
  );
  const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
  const state = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
  const scopedState = body.recorderOnly
    ? { ...state, matches: (state.matches ?? []).filter((match) => isRecorderMatch(match, profileId, adminLevel >= 30)) }
    : state;
  const matches = scopedState.matches ?? [];
  const responseState = body.listOnly === false && !body.recorderOnly
    ? scopedState
    : compactMatchListState(scopedState, profileId);
  return {
    state: {
      ...responseState,
      recruitingPosts: [],
      tournaments: [],
    },
    page: {
      limit,
      count: matches.length,
      cursor: getMatchCursor(matches),
      exhausted: matches.length < limit,
      recruitingScheduleChecked: false,
      recruitingScheduleCount: 0,
    },
    updatedAt: normalized?.updatedAt ?? 0,
  };
}

async function loadCompactMatchList(context, body = {}, adminLevel = 0, limit = REMOTE_CLIENT_MATCH_LIMIT, debugTiming = null) {
  const cursor = String(body.cursor ?? body.matchUpdatedBefore ?? "").trim();
  const shouldLoadRecruitingSchedule = !cursor && body.includeRecruitingSchedule === true;
  const activeOnly = body.activeOnly === true;
  const recruitingSchedulePromise = shouldLoadRecruitingSchedule
    ? loadCurrentRecruitingSchedule(context, adminLevel)
    : Promise.resolve(null);
  const feedPage = await timeStep(debugTiming, "feedMs", () => (
    fetchMatchFeedPage(context.supabase, context.profileId, limit, cursor, activeOnly)
  ));
  let pageSource = "feed";
  let pageCursor = feedPage?.cursor ?? "";
  let pageExhausted = feedPage?.exhausted ?? true;
  let matchRows = [];
  let matches = [];
  if (feedPage) {
    pageSource = feedPage.source ?? "feed";
    if (feedPage.cards?.length) {
      matches = feedPage.cards;
    } else {
      matchRows = await timeStep(debugTiming, "matchRowsMs", () => (
        fetchMatchRowsByIds(context.supabase, feedPage.ids)
      ));
    }
  } else {
    pageSource = "fallback_mine";
    const minePage = await timeStep(debugTiming, "fallbackMineMs", () => (
      fetchCurrentUserMatchPage(context.supabase, context.profileId, limit, cursor, activeOnly)
    ));
    matchRows = minePage?.rows ?? [];
    pageCursor = minePage?.cursor ?? "";
    pageExhausted = minePage?.exhausted ?? true;
  }

  const currentUser = context.profile
    ? fromRemoteProfile(context.profile)
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const settings = {
    ...DEFAULT_SETTINGS,
    ...getRemoteAppSettings(context.profile),
  };

  if (matches.length) {
    const state = normalizeState({
      currentUserId: currentUser.id,
      users: [compactUser(currentUser, currentUser.id)],
      teams: [],
      matches,
      settings,
    }, { includeDemo: false });
    const recruitingSchedule = await timeStep(debugTiming, "recruitingScheduleMs", () => recruitingSchedulePromise);
    const recruitingState = recruitingSchedule?.state ?? {};
    const recruitingScheduleCount = recruitingState.recruitingPosts?.length ?? 0;
    const mergedState = {
      ...state,
      users: mergeById(state.users, recruitingState.users),
      teams: mergeById(state.teams, recruitingState.teams),
      recruitingPosts: recruitingState.recruitingPosts ?? [],
    };

    return {
      state: {
        ...mergedState,
        tournaments: [],
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
        recruitingScheduleChecked: shouldLoadRecruitingSchedule,
        recruitingScheduleCount,
      },
      updatedAt: Math.max(
        ...[...matches, context.profile].filter(Boolean)
          .map((row) => new Date(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? 0).getTime())
          .filter((value) => Number.isFinite(value)),
        0,
      ),
    };
  }

  const matchIds = (matchRows ?? []).map((row) => row.id).filter(Boolean);
  const { data: playerRows, error: playerError } = matchIds.length
    ? await timeStep(debugTiming, "matchPlayersMs", () => (
      context.supabase.from("match_players").select(MATCH_PLAYER_COLUMNS).in("match_id", matchIds)
    ))
    : { data: [], error: null };
  if (playerError) throw playerError;

  const playersByMatch = groupBy(playerRows ?? [], "match_id");
  const readableRows = (matchRows ?? []).filter((row) => (
    canReadMatchRow(row, playersByMatch.get(row.id) ?? [], context.profileId ?? "", adminLevel >= 30)
  ));
  const teamIds = unique(readableRows.flatMap((row) => [row.team_a_id, row.team_b_id]));
  const courtIds = unique(readableRows.map((row) => row.court_id));
  const profileIds = unique(readableRows.flatMap((row) => getMatchRowActorIds(row, playersByMatch.get(row.id) ?? [])));

  const [
    { data: teamRows, error: teamError },
    { data: courtRows, error: courtError },
    { data: profileRows, error: profileError },
  ] = await timeStep(debugTiming, "relatedRowsMs", () => Promise.all([
    teamIds.length
      ? context.supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    fetchCourtRowsByIds(context.supabase, courtIds),
    profileIds.length
      ? context.supabase.from("public_profiles").select(PROFILE_CARD_COLUMNS).in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
  ]));
  if (teamError) throw teamError;
  if (courtError) throw courtError;
  if (profileError) throw profileError;

  const userById = new Map((profileRows ?? []).map((row) => {
    const user = fromRemoteProfile(row);
    return [user.id, user];
  }));
  userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });
  const users = [...userById.values()].map((user) => compactUser(user, currentUser.id));

  const teams = (teamRows ?? []).map(toClientTeam);
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const courtById = firstBy(courtRows ?? [], "id");
  matches = readableRows
    .map((row) => toClientMatch(row, playersByMatch, teamById, courtById))
    .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
  const state = normalizeState({
    currentUserId: currentUser.id,
    users,
    teams,
    matches,
    settings,
  }, { includeDemo: false });
  const recruitingSchedule = await timeStep(debugTiming, "recruitingScheduleMs", () => recruitingSchedulePromise);
  const recruitingState = recruitingSchedule?.state ?? {};
  const recruitingScheduleCount = recruitingState.recruitingPosts?.length ?? 0;
  const mergedState = {
    ...state,
    users: mergeById(state.users, recruitingState.users),
    teams: mergeById(state.teams, recruitingState.teams),
    recruitingPosts: recruitingState.recruitingPosts ?? [],
  };

  return {
    state: {
      ...mergedState,
      tournaments: [],
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
      recruitingScheduleChecked: shouldLoadRecruitingSchedule,
      recruitingScheduleCount,
    },
    updatedAt: Math.max(
      ...[...(matchRows ?? []), context.profile].filter(Boolean)
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
    const startedAt = Date.now();
    const body = await readJsonBody(request);
    const debugTiming = body.debugTiming === true ? {} : null;
    const context = await timeStep(debugTiming, "authMs", () => (
      getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS })
    ));
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId
      ? await timeStep(debugTiming, "adminMs", () => getAdminLevel(context))
      : 0;
    const limit = getCappedLimit(body.limit ?? body.matchLimit ?? REMOTE_CLIENT_MATCH_LIMIT);
    const result = body.listOnly === false
      ? await loadNormalizedMatchList(context, body, adminLevel, limit)
      : await loadCompactMatchList(context, body, adminLevel, limit, debugTiming);
    if (debugTiming) debugTiming.totalMs = Date.now() - startedAt;
    sendJson(response, 200, {
      ok: true,
      ...result,
      debugTiming: debugTiming ?? undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_list_failed" });
  }
}
