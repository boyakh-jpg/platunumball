import { REMOTE_WRITE_CHUNK_SIZE } from "./constants.js";
import { flattenPlayerIdValues, uniquePlayerIds } from "./playerIds.js";

export { uniquePlayerIds };
export { toDateTime } from "./matchPersistence.js";

export const clone = (value) => JSON.parse(JSON.stringify(value));

export const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const makeUuid = () => globalThis.crypto?.randomUUID?.() ?? makeId("id");

export function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function groupBy(rows, key) {
  return rows.reduce((map, row) => {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
    return map;
  }, new Map());
}

export function firstBy(rows, key) {
  return Object.fromEntries(rows.map((row) => [row[key], row]));
}

export function getMaxUpdatedAt(rows) {
  const timestamps = rows
    .map((row) => row.metrics_updated_at ?? row.updated_at ?? row.created_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  return timestamps.length ? Math.max(...timestamps) : 0;
}

export function flattenIdValues(value) {
  return flattenPlayerIdValues(value);
}

export function toggleId(list = [], id, limit = Infinity) {
  if (list.includes(id)) return list.filter((item) => item !== id);
  if (list.length >= limit) return list;
  return [id, ...list];
}

export function shuffleItems(items = []) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export function chunkRows(rows, size = REMOTE_WRITE_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
