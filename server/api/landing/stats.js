import {
  allowRequestMethod,
  getSupabaseAdminClient,
  sendJson,
} from "../_supabaseAdmin.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../shared/lib/constants.js";
import { fromRemoteProfile } from "../../../shared/lib/profileMappers.js";
import {
  fromRemoteRecruitingPost,
  toClientRecruitingTeam,
} from "../../../shared/lib/recruitingMappers.js";
import {
  PROFILE_CARD_COLUMNS,
  TEAM_COLUMNS,
} from "../../../shared/lib/repositoryColumns.js";

const LANDING_RECRUITING_LIMIT = 3;
const PUBLIC_RECRUITING_COLUMNS = "id,type,title,status,visibility,mode,court_id,court_name,region,scheduled_date,scheduled_time,scheduled_at,timing_type:room_state->>timingType,mmr_range_mode:room_state->>mmrRangeMode,mmr_limit_mode:room_state->>mmrLimitMode,team_only:room_state->teamOnly,referee_wanted:room_state->refereeWanted,host_reserve:room_state->hostReserve,party_reserves:room_state->partyReserves,pinned_reserve_players:room_state->pinnedReservePlayers,party_leaders:room_state->partyLeaders,party_sides:room_state->partySides,slot_positions:room_state->slotPositions,ranked,official,pre_registered,rating_scale,age_restriction,allowed_age_groups,rules,stakes,court_reserved,court_fee,spots,referee_trust_min,stat_entry_minutes,dispute_minutes,host_join_mode,host_side,host_ready,side_capacity,bench_capacity,player_id,player_ids,position,team_id,target_team_id,referee_id,created_at,updated_at";

function getRecruitingLimit(request) {
  const rawLimit = Array.isArray(request.query?.recruitingLimit)
    ? request.query.recruitingLimit[0]
    : request.query?.recruitingLimit;
  const limit = Number.parseInt(rawLimit, 10);
  return Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, REMOTE_CLIENT_RECRUITING_LIMIT)
    : LANDING_RECRUITING_LIMIT;
}

function getRequestedRecruitingPostId(request) {
  const rawPostId = Array.isArray(request.query?.recruitingPostId)
    ? request.query.recruitingPostId[0]
    : request.query?.recruitingPostId;
  const postId = typeof rawPostId === "string" ? rawPostId.trim() : "";
  return postId && postId.length <= 128 ? postId : "";
}

function getRecruitingRegion(request) {
  const rawRegion = Array.isArray(request.query?.recruitingRegion)
    ? request.query.recruitingRegion[0]
    : request.query?.recruitingRegion;
  const region = typeof rawRegion === "string"
    ? rawRegion.trim().replace(/[%_,]/g, "")
    : "";
  return region && region.length <= 40 ? region : "";
}

export function resolveRequestedRecruitingResult(requestedPostId, row = null, post = null) {
  if (!requestedPostId) return null;
  if (!row) return { status: "not_found", post: null };
  if (row.visibility !== "public") return { status: "private", post: null };
  if (row.status !== "open") return { status: "closed", post: null };
  return post ? { status: "open", post } : { status: "not_found", post: null };
}

async function readCount(query, label) {
  const { count, error } = await query;
  if (error) throw error;
  const value = Number(count);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`landing_${label}_count_invalid`);
  return value;
}

async function readRows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item) : [];
}

function stringRecord(value, allowedValues = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => (
    key && typeof item === "string" && item && (!allowedValues || allowedValues.has(item))
  )));
}

function stringArrayRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, items]) => [key, stringArray(items)])
    .filter(([key, items]) => key && items.length));
}

export function projectPublicRecruitingRoomState(value = {}, ownerId = "") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ownerId,
    timingType: source.timingType === "instant" ? "instant" : "scheduled",
    mmrRangeMode: source.mmrRangeMode,
    mmrLimitMode: source.mmrLimitMode,
    teamOnly: source.teamOnly === true,
    refereeWanted: source.refereeWanted === true,
    hostReserve: source.hostReserve === true,
    matchRosterProjection: true,
    partyReserves: stringArrayRecord(source.partyReserves),
    pinnedReservePlayers: stringArrayRecord(source.pinnedReservePlayers),
    partyLeaders: stringRecord(source.partyLeaders),
    partySides: stringRecord(source.partySides, new Set(["teamA", "teamB"])),
    slotPositions: stringRecord(source.slotPositions),
  };
}

function getRowPublicRoomState(row = {}) {
  return {
    timingType: row.timing_type,
    mmrRangeMode: row.mmr_range_mode,
    mmrLimitMode: row.mmr_limit_mode,
    teamOnly: row.team_only,
    refereeWanted: row.referee_wanted,
    hostReserve: row.host_reserve,
    partyReserves: row.party_reserves,
    pinnedReservePlayers: row.pinned_reserve_players,
    partyLeaders: row.party_leaders,
    partySides: row.party_sides,
    slotPositions: row.slot_positions,
  };
}

export function getPublicRosterIds(row = {}) {
  const roomState = projectPublicRecruitingRoomState(getRowPublicRoomState(row), row.player_id);
  return [...new Set([
    row.player_id,
    row.referee_id,
    ...stringArray(row.player_ids),
    ...Object.values(roomState.partyReserves).flat(),
    ...Object.values(roomState.pinnedReservePlayers).flat(),
  ].filter(Boolean))];
}

function getPublicRosterTeamIds(row = {}) {
  return [...new Set([
    row.team_id,
    row.target_team_id,
  ].filter(Boolean))];
}

async function readRowsByIds(supabase, table, columns, ids = []) {
  const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_item, index) => ids.slice(index * 100, index * 100 + 100));
  return (await Promise.all(chunks.map((chunk) => readRows(supabase.from(table).select(columns).in("id", chunk))))).flat();
}

export async function loadLandingStats(supabase) {
  const [openRecruiting, completedMatches, activeTeams, players] = await Promise.all([
    readCount(
      supabase
        .from("recruiting_posts")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .eq("visibility", "public"),
      "open_recruiting",
    ),
    readCount(
      supabase
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("status", "confirmed")
        .eq("visibility", "public"),
      "completed_matches",
    ),
    readCount(
      supabase
        .from("teams")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
      "active_teams",
    ),
    readCount(
      supabase
        .from("public_profiles")
        .select("id", { count: "exact", head: true }),
      "players",
    ),
  ]);

  return { openRecruiting, completedMatches, activeTeams, players };
}

export async function loadLandingFeed(supabase, recruitingLimit = LANDING_RECRUITING_LIMIT, requestedPostId = "", recruitingRegion = "") {
  let recruitingQuery = supabase
    .from("recruiting_posts")
    .select(PUBLIC_RECRUITING_COLUMNS)
    .eq("status", "open")
    .eq("visibility", "public")
    .order("updated_at", { ascending: false })
    .limit(recruitingLimit);
  if (recruitingRegion) recruitingQuery = recruitingQuery.ilike("region", `%${recruitingRegion}%`);
  const [recruitingRows, matchRows, requestedRows] = await Promise.all([
    readRows(recruitingQuery),
    readRows(
      supabase
        .from("matches")
        .select("id,title,team_a_id,team_b_id,score_a,score_b")
        .eq("status", "confirmed")
        .eq("visibility", "public")
        .order("confirmed_at", { ascending: false, nullsFirst: false })
        .limit(3),
    ),
    requestedPostId
      ? readRows(supabase
        .from("recruiting_posts")
        .select(PUBLIC_RECRUITING_COLUMNS)
        .eq("id", requestedPostId)
        .limit(1))
      : [],
  ]);
  const requestedRow = requestedRows[0] ?? null;
  const requestedPublicRow = requestedRow?.status === "open" && requestedRow?.visibility === "public"
    ? requestedRow
    : null;
  const publicRecruitingRows = requestedPublicRow && !recruitingRows.some((row) => row.id === requestedPublicRow.id)
    ? [...recruitingRows, requestedPublicRow]
    : recruitingRows;
  const rosterIdsByPost = new Map(publicRecruitingRows.map((row) => [
    row.id,
    getPublicRosterIds(row),
  ]));
  const rosterTeamIdsByPost = new Map(publicRecruitingRows.map((row) => [
    row.id,
    getPublicRosterTeamIds(row),
  ]));
  const profileIds = [...new Set([...rosterIdsByPost.values()].flat())];
  const teamIds = [...new Set([
    ...matchRows.flatMap((row) => [row.team_a_id, row.team_b_id]),
    ...[...rosterTeamIdsByPost.values()].flat(),
  ].filter(Boolean))];
  const [profileRows, teamRows] = await Promise.all([
    readRowsByIds(supabase, "public_profiles", PROFILE_CARD_COLUMNS, profileIds),
    teamIds.length
      ? readRows(supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null))
      : [],
  ]);
  const publicProfileById = new Map(profileRows.map((row) => [row.id, fromRemoteProfile(row)]));
  const publicTeamById = new Map(teamRows.map((row) => [row.id, toClientRecruitingTeam(row)]));
  const teamNames = new Map(teamRows.map((team) => [team.id, team.name]));
  const projectPublicRoom = (row) => {
    const rosterIds = rosterIdsByPost.get(row.id) ?? [];
    const rosterTeamIds = rosterTeamIdsByPost.get(row.id) ?? [];
    return {
      ...fromRemoteRecruitingPost({
        ...row,
        status: "open",
        room_state: projectPublicRecruitingRoomState(getRowPublicRoomState(row), row.player_id),
      }),
      publicParticipants: rosterIds.map((id) => publicProfileById.get(id)).filter(Boolean),
      publicTeams: rosterTeamIds.map((id) => publicTeamById.get(id)).filter(Boolean),
    };
  };
  const requestedPost = requestedPublicRow ? projectPublicRoom(requestedPublicRow) : null;

  return {
    openRecruiting: recruitingRows.map(projectPublicRoom),
    requestedRecruiting: resolveRequestedRecruitingResult(requestedPostId, requestedRow, requestedPost),
    recentMatches: matchRows.map((row) => ({
      id: row.id,
      title: row.title,
      teamAName: teamNames.get(row.team_a_id) ?? null,
      teamBName: teamNames.get(row.team_b_id) ?? null,
      scoreA: Number(row.score_a) || 0,
      scoreB: Number(row.score_b) || 0,
    })),
  };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["GET"])) return;

  try {
    const supabase = getSupabaseAdminClient();
    const [stats, feed] = await Promise.all([
      loadLandingStats(supabase),
      loadLandingFeed(
        supabase,
        getRecruitingLimit(request),
        getRequestedRecruitingPostId(request),
        getRecruitingRegion(request),
      ),
    ]);
    sendJson(response, 200, { ok: true, stats, feed });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "landing_stats_load_failed" });
  }
}
