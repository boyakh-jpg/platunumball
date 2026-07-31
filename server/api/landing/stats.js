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

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["GET"])) return;

  try {
    const stats = await loadLandingStats(getSupabaseAdminClient());
    sendJson(response, 200, { ok: true, stats });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "landing_stats_load_failed" });
  }
}
