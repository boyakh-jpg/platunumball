import { REMOTE_WRITE_CHUNK_SIZE } from "../lib/constants.js";

export const clone = (value) => JSON.parse(JSON.stringify(value));

export const makeId = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const makeUuid = () => globalThis.crypto?.randomUUID?.() ?? makeId("id");

export function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function uniquePlayerIds(playerIds = []) {
  return [...new Set(playerIds.filter(Boolean))];
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

export function toDateTime(date, time, fallback) {
  if (date && time) return `${date} ${String(time).slice(0, 5)}`;
  if (date) return date;
  return fallback ?? "일정 미정";
}

export function getMaxUpdatedAt(rows) {
  const timestamps = rows
    .map((row) => row.updated_at ?? row.created_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  return timestamps.length ? Math.max(...timestamps) : 0;
}

export function flattenIdValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenIdValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenIdValues);
  return value ? [String(value)] : [];
}

export function toggleId(list = [], id, limit = Infinity) {
  if (list.includes(id)) return list.filter((item) => item !== id);
  if (list.length >= limit) return list;
  return [id, ...list];
}

export function chunkRows(rows, size = REMOTE_WRITE_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
