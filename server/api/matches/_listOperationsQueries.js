import { REMOTE_CLIENT_MATCH_LIMIT } from "../../../shared/lib/constants.js";
import { MATCH_LIST_COLUMNS } from "../../../shared/lib/repositoryColumns.js";

import {
  ACTIVE_MATCH_EXCLUDED_STATUS_VALUES,
  isSafePostgrestLiteral,
  MATCH_TERMINAL_STATUS_FILTER,
} from "./_listFeedQueries.js";

export const MATCH_RELATED_FALLBACK_MAX_LIMIT = 80;

export async function fetchOperationsMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "") {
  const safeProfileId = String(profileId ?? "").trim();
  if (!safeProfileId || !isSafePostgrestLiteral(safeProfileId)) {
    return { rows: [], cursor: "", exhausted: true, source: "operations" };
  }
  const candidateLimit = Math.max(
    1,
    Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Math.floor(Number(limit)) || REMOTE_CLIENT_MATCH_LIMIT),
  );
  const cursorParts = /^operations:(active|past):(\d+)$/.exec(String(cursor ?? ""));
  const validCursor = cursorParts && Number.isSafeInteger(Number(cursorParts[2]));
  const phase = validCursor ? cursorParts[1] : "active";
  const offset = validCursor ? Number(cursorParts[2]) : 0;
  const fetchRows = async (past, from, count) => {
    let query = client
      .from("matches")
      .select(MATCH_LIST_COLUMNS)
      .or(`created_by.eq.${safeProfileId},referee_id.eq.${safeProfileId}`)
      .neq("status", "closed");
    query = past
      ? query.in("status", ACTIVE_MATCH_EXCLUDED_STATUS_VALUES)
      : query.not("status", "in", MATCH_TERMINAL_STATUS_FILTER);
    const { data, error } = await query
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(from, from + count - 1);
    if (error) throw error;
    return data ?? [];
  };
  const activeRows = phase === "active" ? await fetchRows(false, offset, candidateLimit) : [];
  if (activeRows.length === candidateLimit) {
    return {
      rows: activeRows,
      cursor: `operations:active:${offset + activeRows.length}`,
      exhausted: false,
      source: "operations",
    };
  }
  const pastOffset = phase === "past" ? offset : 0;
  const pastLimit = candidateLimit - activeRows.length;
  const pastRows = await fetchRows(true, pastOffset, pastLimit);
  const exhausted = pastRows.length < pastLimit;
  return {
    rows: [...activeRows, ...pastRows],
    cursor: exhausted ? "" : `operations:past:${pastOffset + pastRows.length}`,
    exhausted,
    source: "operations",
  };
}
