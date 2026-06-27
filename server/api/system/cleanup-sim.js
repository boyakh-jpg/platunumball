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

async function closeLike(client, table, column, pattern) {
  const { count, error } = await client
    .from(table)
    .update({ status: "closed", updated_at: new Date().toISOString() }, { count: "exact" })
    .like(column, pattern)
    .neq("status", "closed");
  if (error) return { table, ok: false, error: error.message, closed: 0 };
  return { table, ok: true, error: null, closed: count ?? 0 };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    assertAccess(request);
    const client = getSupabaseAdminClient();
    const checks = [];
    checks.push(await closeLike(client, "matches", "id", "sim_m_%"));
    checks.push(await closeLike(client, "recruiting_posts", "id", "sim_q_%"));

    const failed = checks.filter((check) => !check.ok);
    sendJson(response, 200, {
      ok: failed.length === 0,
      failedCount: failed.length,
      closed: checks.reduce((sum, check) => sum + Number(check.closed ?? 0), 0),
      checks,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "cleanup_sim_failed" });
  }
}
