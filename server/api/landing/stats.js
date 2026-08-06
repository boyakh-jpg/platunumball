import {
  allowRequestMethod,
  getSupabaseAdminClient,
  sendJson,
} from "../_supabaseAdmin.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../shared/lib/constants.js";

const LANDING_RECRUITING_LIMIT = 3;

function getRecruitingLimit(request) {
  const rawLimit = Array.isArray(request.query?.recruitingLimit)
    ? request.query.recruitingLimit[0]
    : request.query?.recruitingLimit;
  const limit = Number.parseInt(rawLimit, 10);
  return Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, REMOTE_CLIENT_RECRUITING_LIMIT)
    : LANDING_RECRUITING_LIMIT;
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

export async function loadLandingFeed(supabase, recruitingLimit = LANDING_RECRUITING_LIMIT) {
  const [recruitingRows, matchRows] = await Promise.all([
    readRows(
      supabase
        .from("recruiting_posts")
        .select("id,type,title,mode,court_id,court_name,region,scheduled_date,scheduled_time,scheduled_at,timing_type:room_state->>timingType,ranked,official,pre_registered,rating_scale,age_restriction,allowed_age_groups,rules,stakes,court_reserved,court_fee,spots,referee_wanted,referee_trust_min,stat_entry_minutes,dispute_minutes,host_join_mode,side_capacity,bench_capacity")
        .eq("status", "open")
        .eq("visibility", "public")
        .order("updated_at", { ascending: false })
        .limit(recruitingLimit),
    ),
    readRows(
      supabase
        .from("matches")
        .select("id,title,team_a_id,team_b_id,score_a,score_b")
        .eq("status", "confirmed")
        .eq("visibility", "public")
        .order("confirmed_at", { ascending: false, nullsFirst: false })
        .limit(3),
    ),
  ]);
  const teamIds = [...new Set(matchRows.flatMap((row) => [row.team_a_id, row.team_b_id]).filter(Boolean))];
  const teamRows = teamIds.length
    ? await readRows(supabase.from("teams").select("id,name").in("id", teamIds).is("deleted_at", null))
    : [];
  const teamNames = new Map(teamRows.map((team) => [team.id, team.name]));

  return {
    openRecruiting: recruitingRows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      mode: row.mode,
      courtId: row.court_id,
      court: row.court_name,
      region: row.region,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
      scheduledAt: row.scheduled_at,
      timingType: row.timing_type,
      ranked: row.ranked !== false,
      official: row.official === true,
      preRegistered: row.pre_registered === true,
      ratingScale: Number(row.rating_scale) || 1,
      ageRestriction: row.age_restriction ?? "any",
      allowedAgeGroups: row.allowed_age_groups ?? [],
      rules: row.rules ?? {},
      stakes: row.stakes ?? "",
      courtReserved: row.court_reserved === true,
      courtFee: row.court_fee ?? "",
      spots: Number(row.spots) || 0,
      refereeWanted: row.referee_wanted === true,
      refereeTrustMin: Number(row.referee_trust_min) || 0,
      statEntryMinutes: Number(row.stat_entry_minutes) || 0,
      disputeMinutes: Number(row.dispute_minutes) || 0,
      hostJoinMode: row.host_join_mode ?? "player",
      sideCapacity: Number(row.side_capacity) || 0,
      benchCapacity: Number(row.bench_capacity) || 0,
      status: "open",
      visibility: "public",
    })),
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
      loadLandingFeed(supabase, getRecruitingLimit(request)),
    ]);
    sendJson(response, 200, { ok: true, stats, feed });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "landing_stats_load_failed" });
  }
}
