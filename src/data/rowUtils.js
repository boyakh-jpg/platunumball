import { REMOTE_WRITE_CHUNK_SIZE } from "../lib/constants.js";

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

export function chunkRows(rows, size = REMOTE_WRITE_CHUNK_SIZE) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
