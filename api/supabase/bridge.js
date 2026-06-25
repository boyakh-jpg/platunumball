import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const TABLE_CONFIG = {
  notifications: { onConflict: "id", ownerFields: ["user_id", "target_user_id"] },
  reports: { onConflict: "id", ownerFields: ["user_id"] },
  court_requests: { onConflict: "id", ownerFields: ["requested_by"] },
  referee_requests: { onConflict: "id", ownerFields: ["requested_by"] },
  referee_exam_attempts: { onConflict: "id", ownerFields: ["user_id"] },
  discord_notification_deliveries: { onConflict: "id", ownerFields: ["target_user_id"] },
  approved_courts: { onConflict: "id", minAdminLevel: 30 },
  admin_appointments: { onConflict: "id", minAdminLevel: 80 },
  referee_appointments: { onConflict: "id", minAdminLevel: 50 },
  admin_audit_log: { onConflict: "id", minAdminLevel: 30 },
  admin_disciplinary_actions: { onConflict: "id", minAdminLevel: 50 },
};

const MAX_ROWS = 500;

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .slice(0, MAX_ROWS);
}

function rowBelongsToProfile(row, profileId, ownerFields = []) {
  return ownerFields.some((field) => row[field] && row[field] === profileId);
}

function validateRows({ rows, config, profileId, adminLevel }) {
  if (config.minAdminLevel && adminLevel < config.minAdminLevel) {
    const error = new Error("admin_permission_required");
    error.statusCode = 403;
    throw error;
  }

  return rows.flatMap((row) => {
    if (!row.id) {
      const error = new Error("missing_row_id");
      error.statusCode = 400;
      throw error;
    }

    if (!config.minAdminLevel && !rowBelongsToProfile(row, profileId, config.ownerFields) && adminLevel < 30) {
      return [];
    }

    return [row];
  });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const table = String(body.table ?? "");
    const config = TABLE_CONFIG[table];
    if (!config) {
      sendJson(response, 400, { error: "unsupported_bridge_table" });
      return;
    }

    const rows = normalizeRows(body.rows);
    if (!rows.length) {
      sendJson(response, 200, { ok: true, count: 0 });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const adminLevel = await getAdminLevel(context);
    const safeRows = validateRows({ rows, config, profileId: context.profileId, adminLevel });
    if (!safeRows.length) {
      sendJson(response, 200, { ok: true, count: 0 });
      return;
    }

    const { error } = await context.supabase
      .from(table)
      .upsert(safeRows, { onConflict: config.onConflict });

    if (error) throw error;

    sendJson(response, 200, { ok: true, count: safeRows.length });
  } catch (error) {
    console.error("Supabase bridge write failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "server_bridge_failed" });
  }
}
