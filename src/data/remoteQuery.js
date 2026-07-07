import { REMOTE_CLIENT_MAX_LIMIT, REMOTE_PAGE_SIZE } from "../lib/constants.js";
import { supabase } from "../lib/supabase.js";

export function uniqueScopeIds(values = []) {
  return [...new Set([values].flat().filter(Boolean).map((value) => String(value)))];
}

export function applyIdScope(query, column, ids = []) {
  if (!ids.length) return query;
  return ids.length === 1 ? query.eq(column, ids[0]) : query.in(column, ids);
}

export function applyUpdatedBefore(query, column, value) {
  const cursor = String(value ?? "").trim();
  return cursor ? query.lt(column, cursor) : query;
}

export function composeFilters(...filters) {
  const activeFilters = filters.filter(Boolean);
  if (!activeFilters.length) return null;
  return (query) => activeFilters.reduce((currentQuery, filter) => filter(currentQuery), query);
}

export function getClientLimit(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(REMOTE_CLIENT_MAX_LIMIT, Math.floor(number));
}

function requireSelectColumns(table, select) {
  if (typeof select === "string" && select.trim()) return select;
  throw new Error(`Missing explicit select columns for ${table}`);
}

export async function fetchFilteredRows(table, select, order = "id", client = supabase, applyFilter = null, limit = null, ascending = true) {
  const rows = [];
  const hasLimit = limit !== undefined && limit !== null && limit !== "";
  const numericLimit = Number(limit);
  if (hasLimit && Number.isFinite(numericLimit) && numericLimit <= 0) return rows;
  const maxRows = hasLimit && Number.isFinite(numericLimit) ? numericLimit : null;
  const selectColumns = requireSelectColumns(table, select);
  for (let from = 0; ; from += REMOTE_PAGE_SIZE) {
    if (maxRows && rows.length >= maxRows) break;
    const to = maxRows ? Math.min(from + REMOTE_PAGE_SIZE - 1, maxRows - 1) : from + REMOTE_PAGE_SIZE - 1;
    const baseQuery = client.from(table).select(selectColumns).range(from, to);
    const query = applyFilter ? applyFilter(baseQuery) : baseQuery;
    const { data, error } = order ? await query.order(order, { ascending, nullsFirst: false }) : await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < REMOTE_PAGE_SIZE) break;
  }
  return rows;
}

export async function fetchAllRows(table, select, order = "id", client = supabase) {
  return fetchFilteredRows(table, select, order, client);
}

export async function fetchOptionalRows(table, select, order = "id", client = supabase) {
  try {
    return await fetchAllRows(table, select, order, client);
  } catch (error) {
    console.warn(`Supabase optional table skipped: ${table}`, error.message);
    return [];
  }
}

export async function fetchOptionalFilteredRows(table, select, order = "id", client = supabase, applyFilter = null) {
  try {
    return await fetchFilteredRows(table, select, order, client, applyFilter);
  } catch (error) {
    console.warn(`Supabase optional table skipped: ${table}`, error.message);
    return [];
  }
}

export async function fetchRowsByIds(table, select, column = "id", ids = [], order = "id", client = supabase, optional = false) {
  const scopedIds = uniqueScopeIds(ids);
  if (!scopedIds.length) return [];
  const fetcher = optional ? fetchOptionalFilteredRows : fetchFilteredRows;
  return fetcher(table, select, order, client, (query) => applyIdScope(query, column, scopedIds));
}

export function uniqueRowsById(rows = []) {
  const byId = new Map();
  rows.forEach((row) => {
    if (row?.id) byId.set(row.id, row);
  });
  return [...byId.values()];
}
