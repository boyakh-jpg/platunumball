import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const RECEIPT_CAPABILITY_COOKIE = "boxtier_receipt_capability";
export const RECEIPT_DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60;

const TEXT_LIMITS = Object.freeze({
  homeTeam: 24,
  awayTeam: 24,
  playedOn: 10,
  venue: 36,
  address: 48,
  format: 5,
  matchNature: 11,
  comment: 60,
});

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanNumber(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function cleanOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value).toLowerCase() : fallback;
}

export function sanitizeReceiptDraftPayload(value = {}) {
  const format = ["3v3", "5v5", "other"].includes(value.format) ? value.format : "3v3";
  const matchNature = ["friendly", "competitive", "revenge", "semifinal", "final"].includes(value.matchNature)
    ? value.matchNature
    : "competitive";
  return {
    homeTeam: cleanText(value.homeTeam, TEXT_LIMITS.homeTeam),
    awayTeam: cleanText(value.awayTeam, TEXT_LIMITS.awayTeam),
    homeScore: Math.round(cleanNumber(value.homeScore, 0, 999)),
    awayScore: Math.round(cleanNumber(value.awayScore, 0, 999)),
    playedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(value.playedOn ?? "")) ? String(value.playedOn) : "",
    venue: cleanText(value.venue, TEXT_LIMITS.venue),
    address: cleanText(value.address, TEXT_LIMITS.address),
    format,
    matchNature: cleanText(matchNature, TEXT_LIMITS.matchNature),
    homeColor: cleanColor(value.homeColor, "#f05a46"),
    awayColor: cleanColor(value.awayColor, "#27354d"),
    comment: cleanText(value.comment, TEXT_LIMITS.comment),
    homeMmr: cleanOptionalNumber(value.homeMmr),
    awayMmr: cleanOptionalNumber(value.awayMmr),
    personalPoints: cleanOptionalNumber(value.personalPoints),
    personalRebounds: cleanOptionalNumber(value.personalRebounds),
    verified: false,
  };
}

export function createReceiptCapability() {
  return {
    publicId: randomUUID(),
    secret: randomBytes(32).toString("base64url"),
  };
}

export function hashReceiptCapability(secret = "") {
  return createHash("sha256").update(String(secret)).digest("hex");
}

export function receiptCapabilityMatches(secret = "", expectedHash = "") {
  const actual = Buffer.from(hashReceiptCapability(secret), "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function getReceiptCapabilityCookie(request) {
  const header = String(request.headers?.cookie ?? "");
  const raw = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${RECEIPT_CAPABILITY_COOKIE}=`));
  if (!raw) return null;
  try {
    const [publicId, secret] = decodeURIComponent(raw.slice(RECEIPT_CAPABILITY_COOKIE.length + 1)).split(".");
    return publicId && secret ? { publicId, secret } : null;
  } catch {
    return null;
  }
}

export function setReceiptCapabilityCookie(response, capability) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${RECEIPT_CAPABILITY_COOKIE}=${encodeURIComponent(`${capability.publicId}.${capability.secret}`)}; HttpOnly; SameSite=Lax${secure}; Path=/api/match-receipts; Max-Age=${RECEIPT_DRAFT_TTL_SECONDS}`);
}

export function getReceiptRequestHash(request) {
  const forwarded = String(request.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim();
  const address = forwarded || String(request.socket?.remoteAddress ?? "unknown");
  const salt = process.env.MATCH_RECEIPT_RATE_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "boxtier";
  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}
