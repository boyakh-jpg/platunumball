export const MATCH_PUBLIC_CODE_PATTERN = /^BT-\d{8}$/;

export function normalizeMatchPublicCode(value = "") {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^#+/, "")
    .toUpperCase();
  return MATCH_PUBLIC_CODE_PATTERN.test(normalized) ? normalized : "";
}

export function formatMatchPublicCode(value = "") {
  const code = normalizeMatchPublicCode(value);
  return code ? `#${code}` : "";
}
