import { getBearerToken, getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";

function assertAccess(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || getBearerToken(request) !== secret) {
    const error = new Error("invalid_cleanup_secret");
    error.statusCode = 401;
    throw error;
  }
}

async function closePrefix(client, table, column, prefix) {
  const { count, error } = await client
    .from(table)
    .update({ status: "closed", updated_at: new Date().toISOString() }, { count: "exact" })
    .gte(column, prefix)
    .lt(column, `${prefix}\uffff`)
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
    checks.push(await closePrefix(client, "matches", "id", "sim_m_"));
    checks.push(await closePrefix(client, "recruiting_posts", "id", "sim_q_"));

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
