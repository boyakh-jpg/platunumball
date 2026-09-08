import { allowRequestMethod, readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";
import {
  ADMIN_DASHBOARD_MIN_LEVEL,
  normalizeAdminDashboardQuery,
} from "../../../shared/lib/adminDashboardPolicy.js";

const SUMMARY_FIELDS = {
  members: ["total", "today"],
  teams: ["total", "today"],
  matches: ["total", "active", "confirmed", "today"],
  tournaments: ["total", "active", "completed"],
};
const COMMON_ROW_FIELDS = ["id", "name", "region", "createdAt", "status"];
const ROW_FIELDS = {
  members: ["hashtag"],
  teams: ["memberCount"],
  matches: ["mode", "scheduledAt", "courtName", "startedAt", "endedAt"],
  tournaments: ["format", "startDate", "endDate", "teamCount", "approvedTeamCount", "matchCount", "confirmedMatchCount", "cancelledMatchCount"],
};

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function getAdminDashboardErrorStatus(error) {
  const explicitStatus = Number(error?.statusCode);
  if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) return explicitStatus;
  if (error?.code === "42501" || /admin_permission_required/.test(String(error?.message ?? ""))) return 403;
  return 500;
}

export async function loadAdminDashboard(context, body = {}) {
  const query = normalizeAdminDashboardQuery(body);
  const { data, error } = await context.supabase.rpc("rankball_admin_dashboard", {
    p_actor_profile_id: context.profileId,
    p_actor_admin_level: context.adminLevel,
    p_kind: query.kind,
    p_search: query.search,
    p_status: query.status,
    p_limit: query.limit,
    p_offset: query.offset,
  });
  if (error) throw error;

  // Missing or partial aggregates are an error, never an empty dashboard.
  if (
    data?.ok !== true
    || !Number.isFinite(Date.parse(data.generatedAt))
    || !Object.entries(SUMMARY_FIELDS).every(([kind, fields]) => fields.every((field) => isCount(data.summary?.[kind]?.[field])))
    || !Array.isArray(data.rows)
    || data.rows.length > query.limit
    || !data.rows.every((row) => row && typeof row.id === "string")
    || !Object.entries(query).every(([key, value]) => data.page?.[key] === value)
    || !isCount(data.page?.total)
    || typeof data.page?.hasMore !== "boolean"
    || !(data.page?.nextOffset === null || isCount(data.page?.nextOffset))
  ) {
    throw Object.assign(new Error("admin_dashboard_invalid_response"), { statusCode: 502 });
  }

  const rowFields = [...COMMON_ROW_FIELDS, ...ROW_FIELDS[query.kind]];
  return {
    ok: true,
    generatedAt: data.generatedAt,
    summary: Object.fromEntries(Object.entries(SUMMARY_FIELDS).map(([kind, fields]) => [
      kind,
      Object.fromEntries(fields.map((field) => [field, data.summary[kind][field]])),
    ])),
    rows: data.rows.map((row) => Object.fromEntries(rowFields.map((field) => [field, row[field] ?? null]))),
    page: {
      ...query,
      total: data.page.total,
      hasMore: data.page.hasMore,
      nextOffset: data.page.nextOffset,
    },
  };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;
  try {
    const context = await requireAdminContext(request, { minimumLevel: ADMIN_DASHBOARD_MIN_LEVEL });
    const body = await readJsonBody(request);
    sendJson(response, 200, await loadAdminDashboard(context, body));
  } catch (error) {
    console.error("Admin dashboard load failed.", error);
    sendJson(response, getAdminDashboardErrorStatus(error), { error: error.message || "admin_dashboard_load_failed" });
  }
}
