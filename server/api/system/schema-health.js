import { getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";

const REQUIRED_COLUMNS = {
  profiles: [
    "id",
    "auth_user_id",
    "test_login_id",
    "hashtag",
    "onboarding_complete",
    "discord_user_id",
  ],
  recruiting_posts: [
    "id",
    "visibility",
    "player_id",
    "mode",
    "room_state",
    "host_join_mode",
    "host_ready",
    "side_capacity",
    "status",
  ],
  recruiting_applications: [
    "post_id",
    "player_id",
    "kind",
    "side",
    "status",
    "player_ids",
  ],
  matches: [
    "id",
    "title",
    "mode",
    "court_name",
    "visibility",
    "status",
    "ranked",
    "scheduled_date",
    "scheduled_time",
    "team_a_id",
    "team_b_id",
    "score_a",
    "score_b",
    "rules",
    "created_by",
    "agreed_at",
    "started_at",
    "ended_at",
    "confirmed_at",
    "cancelled_at",
    "voided_at",
    "updated_at",
  ],
  match_players: [
    "match_id",
    "user_id",
    "side",
    "slot_order",
  ],
  match_results: [
    "match_id",
    "score_a",
    "score_b",
    "submitted_by",
    "stat_submissions",
  ],
  notifications: [
    "id",
    "user_id",
    "target_user_id",
    "match_id",
    "recruiting_post_id",
    "payload",
  ],
};

function getBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function assertAccess(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || getBearerToken(request) !== secret) {
    const error = new Error("invalid_schema_health_secret");
    error.statusCode = 401;
    throw error;
  }
}

async function checkTable(client, table, columns) {
  const { error } = await client
    .from(table)
    .select(columns.join(","))
    .limit(1);
  return {
    table,
    ok: !error,
    error: error?.message ?? null,
    columns,
  };
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    assertAccess(request);
    const client = getSupabaseAdminClient();
    const checks = await Promise.all(
      Object.entries(REQUIRED_COLUMNS).map(([table, columns]) => checkTable(client, table, columns)),
    );
    const failed = checks.filter((check) => !check.ok);
    sendJson(response, 200, {
      ok: failed.length === 0,
      failedCount: failed.length,
      checks,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "schema_health_failed" });
  }
}
