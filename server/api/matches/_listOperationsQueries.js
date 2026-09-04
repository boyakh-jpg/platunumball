import { REMOTE_CLIENT_MATCH_LIMIT } from "../../../shared/lib/constants.js";
import { MATCH_LIST_COLUMNS } from "../../../shared/lib/repositoryColumns.js";

import { isSafePostgrestLiteral } from "./_listFeedQueries.js";

export const MATCH_RELATED_FALLBACK_MAX_LIMIT = 80;

export async function fetchOperationsMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT) {
  const safeProfileId = String(profileId ?? "").trim();
  if (!safeProfileId || !isSafePostgrestLiteral(safeProfileId)) {
    return { rows: [], cursor: "", exhausted: true, source: "operations" };
  }
  const candidateLimit = Math.max(
    1,
    Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT),
  );
  const { data, error } = await client
    .from("matches")
    .select(MATCH_LIST_COLUMNS)
    .or(`created_by.eq.${safeProfileId},referee_id.eq.${safeProfileId}`)
    .neq("status", "closed")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(candidateLimit);
  if (error) throw error;
  const rows = data ?? [];
  return {
    rows,
    cursor: "",
    exhausted: rows.length < candidateLimit,
    source: "operations",
  };
}
