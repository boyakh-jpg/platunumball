import { getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";

function getBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function assertAccess(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || getBearerToken(request) !== secret) {
    const error = new Error("invalid_cleanup_secret");
    error.statusCode = 401;
    throw error;
  }
}

async function deleteLike(client, table, column, pattern) {
  const { count, error } = await client
    .from(table)
    .delete({ count: "exact" })
    .like(column, pattern);
  if (error) return { table, ok: false, error: error.message, deleted: 0 };
  return { table, ok: true, error: null, deleted: count ?? 0 };
}

export default async function handler(request, response) {
  if (!["POST", "DELETE"].includes(request.method)) {
    response.setHeader("Allow", "POST, DELETE");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    assertAccess(request);
    const client = getSupabaseAdminClient();
    const checks = [];
    checks.push(await deleteLike(client, "discord_notification_deliveries", "id", "discord-%-sim_m_%"));
    checks.push(await deleteLike(client, "notifications", "match_id", "sim_m_%"));
    checks.push(await deleteLike(client, "notifications", "recruiting_post_id", "sim_q_%"));
    checks.push(await deleteLike(client, "player_match_stats", "match_id", "sim_m_%"));
    checks.push(await deleteLike(client, "match_results", "match_id", "sim_m_%"));
    checks.push(await deleteLike(client, "match_disputes", "match_id", "sim_m_%"));
    checks.push(await deleteLike(client, "match_approvals", "match_id", "sim_m_%"));
    checks.push(await deleteLike(client, "match_agreements", "match_id", "sim_m_%"));
    checks.push(await deleteLike(client, "match_players", "match_id", "sim_m_%"));
    checks.push(await deleteLike(client, "matches", "id", "sim_m_%"));
    checks.push(await deleteLike(client, "recruiting_applications", "post_id", "sim_q_%"));
    checks.push(await deleteLike(client, "recruiting_posts", "id", "sim_q_%"));

    const failed = checks.filter((check) => !check.ok);
    sendJson(response, 200, {
      ok: failed.length === 0,
      failedCount: failed.length,
      deleted: checks.reduce((sum, check) => sum + Number(check.deleted ?? 0), 0),
      checks,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "cleanup_sim_failed" });
  }
}
