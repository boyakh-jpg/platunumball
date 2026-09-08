import {
  ADMIN_DEFAULT_PAGE_LIMIT,
  ADMIN_MAX_PAGE_LIMIT,
  DIRECTORY_MAX_OFFSET,
  clampQueryInteger,
  normalizeDirectoryFilter,
} from "./queryPolicy.js";

export const ADMIN_DASHBOARD_MIN_LEVEL = 50;
export const ADMIN_DASHBOARD_DEFAULT_KIND = "tournaments";
export const ADMIN_DASHBOARD_KINDS = Object.freeze(["members", "teams", "matches", "tournaments"]);
export const ADMIN_DASHBOARD_STATUSES = Object.freeze(["all", "active", "completed"]);

export function normalizeAdminDashboardQuery(input = {}) {
  const body = input ?? {};
  const requestedKind = String(body.kind ?? "").trim();
  const kind = ADMIN_DASHBOARD_KINDS.includes(requestedKind) ? requestedKind : ADMIN_DASHBOARD_DEFAULT_KIND;
  const requestedStatus = String(body.status ?? "").trim();
  return {
    kind,
    search: normalizeDirectoryFilter(body.search),
    status: ["matches", "tournaments"].includes(kind) && ADMIN_DASHBOARD_STATUSES.includes(requestedStatus)
      ? requestedStatus
      : "all",
    limit: clampQueryInteger(body.limit ?? undefined, ADMIN_DEFAULT_PAGE_LIMIT, 1, ADMIN_MAX_PAGE_LIMIT),
    offset: clampQueryInteger(body.offset ?? undefined, 0, 0, DIRECTORY_MAX_OFFSET),
  };
}
