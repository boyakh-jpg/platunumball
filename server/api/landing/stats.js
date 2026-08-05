import {
  allowRequestMethod,
  getSupabaseAdminClient,
  sendJson,
} from "../_supabaseAdmin.js";

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

export async function loadLandingFeed(supabase) {
  const [recruitingRows, matchRows] = await Promise.all([
    readRows(
      supabase
        .from("recruiting_posts")
        .select("id,title,mode,court_name,scheduled_date,scheduled_time,scheduled_at")
        .eq("status", "open")
        .eq("visibility", "public")
        .order("updated_at", { ascending: false })
        .limit(3),
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
      title: row.title,
      mode: row.mode,
      court: row.court_name,
      scheduledDate: row.scheduled_date,
      scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
      scheduledAt: row.scheduled_at,
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
    const [stats, feed] = await Promise.all([loadLandingStats(supabase), loadLandingFeed(supabase)]);
    sendJson(response, 200, { ok: true, stats, feed });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "landing_stats_load_failed" });
  }
}
