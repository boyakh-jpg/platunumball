export function normalizeRegionText(value = "") {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}
