import { COURT_COLUMNS, REPORT_COLUMNS } from "../../repositoryColumns.js";
import {
  applyIdScope,
  fetchOptionalFilteredRows,
  uniqueRowsById,
  uniqueScopeIds,
} from "../../remoteQuery.js";
import { supabase } from "../../../lib/supabase.js";

export async function fetchCourtRows(client = supabase, ids = []) {
  const scopedIds = uniqueScopeIds(ids);
  const approvedFilter = (query) => {
    const activeQuery = query.or("status.is.null,status.eq.active");
    return scopedIds.length ? applyIdScope(activeQuery, "id", scopedIds) : activeQuery;
  };
  return fetchOptionalFilteredRows("approved_courts", COURT_COLUMNS, "id", client, approvedFilter);
}

export async function fetchCurrentUserReports(currentUserId = "", client = supabase) {
  if (!currentUserId) return [];
  const [byReporter, byTarget, byReportedUser] = await Promise.all([
    fetchOptionalFilteredRows("reports", REPORT_COLUMNS, "created_at", client, (query) => query.eq("user_id", currentUserId)),
    fetchOptionalFilteredRows("reports", REPORT_COLUMNS, "created_at", client, (query) => query.eq("target_id", currentUserId)),
    fetchOptionalFilteredRows("reports", REPORT_COLUMNS, "created_at", client, (query) => query.filter("reported_user_ids", "cs", JSON.stringify([currentUserId]))),
  ]);
  return uniqueRowsById([...byReporter, ...byTarget, ...byReportedUser])
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
}
