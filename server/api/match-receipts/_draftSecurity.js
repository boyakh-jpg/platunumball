import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { normalizeMatchPublicCode } from "../../../shared/lib/matchPublicCode.js";
import {
  MATCH_RECEIPT_LOCALES,
  MATCH_RECEIPT_STYLES,
  getMatchReceiptFormatPlayerCount,
  sanitizeMatchReceiptComment,
} from "../../../shared/lib/thermalReceipt.js";

export const RECEIPT_CAPABILITY_COOKIE = "boxtier_receipt_capability";
export const RECEIPT_DRAFT_TTL_SECONDS = 30 * 24 * 60 * 60;

const TEXT_LIMITS = Object.freeze({
  serialSeed: 96,
  homeTeam: 24,
  awayTeam: 24,
  playedOn: 10,
  venue: 36,
  address: 48,
  originalAddress: 96,
  format: 5,
  matchNature: 11,
  comment: 22,
  receiptShortName: 12,
  officialMatchId: 96,
  tournamentName: 32,
  profileHashtag: 32,
  assetKey: 256,
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

function cleanOptionalScore(value) {
  const number = cleanOptionalNumber(value);
  return number === null ? null : Math.round(Math.min(999, Math.max(0, number)));
}

const RECEIPT_PERIOD_LABELS = new Set(["1Q", "2Q", "3Q", "4Q", "1H", "2H", "REG", "OT"]);

function cleanPeriodScores(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((item) => {
    const label = cleanText(item?.label, 3).toUpperCase();
    if (!RECEIPT_PERIOD_LABELS.has(label) || seen.has(label)) return [];
    const scoreA = cleanOptionalScore(item?.scoreA);
    const scoreB = cleanOptionalScore(item?.scoreB);
    if (scoreA === null || scoreB === null) return [];
    seen.add(label);
    return [{ label, scoreA, scoreB }];
  }).slice(0, 5);
}

function cleanTeamEmblemKey(value) {
  const key = cleanText(value, TEXT_LIMITS.assetKey).replace(/^\/+/, "");
  return key.startsWith("team-emblems/") && !key.includes("..") && /^[A-Za-z0-9/_.-]+$/.test(key) ? key : "";
}

function cleanColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value).toLowerCase() : fallback;
}

function cleanSerialSeed(value) {
  const seed = cleanText(value, TEXT_LIMITS.serialSeed);
  return /^[A-Za-z0-9:_-]{8,96}$/.test(seed) ? seed : randomBytes(16).toString("hex");
}

export function sanitizeReceiptDraftPayload(value = {}, options = {}) {
  const trustedCanonical = options.trustedCanonical === true;
  const format = ["1v1", "2v2", "3v3", "3x3", "5v5"].includes(value.format) ? value.format : "3v3";
  const comment = sanitizeMatchReceiptComment(value.comment || value.receiptComment);
  const playerCountSource = trustedCanonical && value.playerCountSource === "record" ? "record" : "format";
  const matchNature = ["friendly", "competitive", "revenge", "semifinal", "final"].includes(value.matchNature)
    ? value.matchNature
    : "competitive";
  return {
    serialSeed: cleanSerialSeed(value.serialSeed),
    homeTeam: cleanText(value.homeTeam, TEXT_LIMITS.homeTeam),
    awayTeam: cleanText(value.awayTeam, TEXT_LIMITS.awayTeam),
    homeScore: Math.round(cleanNumber(value.homeScore, 0, 999)),
    awayScore: Math.round(cleanNumber(value.awayScore, 0, 999)),
    playedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(value.playedOn ?? "")) ? String(value.playedOn) : "",
    venue: cleanText(value.venue, TEXT_LIMITS.venue),
    address: cleanText(value.address, TEXT_LIMITS.address),
    originalAddress: cleanText(value.originalAddress, TEXT_LIMITS.originalAddress),
    format,
    matchNature: cleanText(matchNature, TEXT_LIMITS.matchNature),
    homeColor: cleanColor(value.homeColor, "#f05a46"),
    awayColor: cleanColor(value.awayColor, "#27354d"),
    comment,
    receiptStyle: Object.values(MATCH_RECEIPT_STYLES).includes(value.receiptStyle)
      ? value.receiptStyle
      : MATCH_RECEIPT_STYLES.score,
    receiptLocale: Object.values(MATCH_RECEIPT_LOCALES).includes(value.receiptLocale)
      ? value.receiptLocale
      : MATCH_RECEIPT_LOCALES.ko,
    includePhoto: value.includePhoto !== false,
    receiptComment: comment,
    homeReceiptShortName: cleanText(value.homeReceiptShortName, TEXT_LIMITS.receiptShortName),
    awayReceiptShortName: cleanText(value.awayReceiptShortName, TEXT_LIMITS.receiptShortName),
    playedTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.playedTime ?? "")) ? String(value.playedTime) : "20:30",
    photoZoom: cleanNumber(value.photoZoom, 1, 3, 1),
    photoX: cleanNumber(value.photoX, -100, 100, 0),
    photoY: cleanNumber(value.photoY, -100, 100, 0),
    photoRotation: Math.round(cleanNumber(value.photoRotation, -270, 270, 0) / 90) * 90,
    tournamentName: cleanText(value.tournamentName, TEXT_LIMITS.tournamentName),
    periodScores: cleanPeriodScores(value.periodScores),
    q1Home: cleanOptionalScore(value.q1Home),
    q1Away: cleanOptionalScore(value.q1Away),
    q2Home: cleanOptionalScore(value.q2Home),
    q2Away: cleanOptionalScore(value.q2Away),
    q3Home: cleanOptionalScore(value.q3Home),
    q3Away: cleanOptionalScore(value.q3Away),
    q4Home: cleanOptionalScore(value.q4Home),
    q4Away: cleanOptionalScore(value.q4Away),
    otHome: cleanOptionalScore(value.otHome),
    otAway: cleanOptionalScore(value.otAway),
    homeUseLineArt: Boolean(value.homeUseLineArt),
    awayUseLineArt: Boolean(value.awayUseLineArt),
    homeMmr: cleanOptionalNumber(value.homeMmr),
    awayMmr: cleanOptionalNumber(value.awayMmr),
    ...(trustedCanonical ? {
      personalMmr: cleanOptionalNumber(value.personalMmr),
      profileHashtag: cleanText(value.profileHashtag, TEXT_LIMITS.profileHashtag),
    } : {}),
    personalPoints: cleanOptionalNumber(value.personalPoints),
    personalRebounds: cleanOptionalNumber(value.personalRebounds),
    personalStatsEligible: trustedCanonical && value.personalStatsEligible === true,
    ...(trustedCanonical ? {
      hasCanonicalTeamMatch: Boolean(value.hasCanonicalTeamMatch),
      homeEmblemKey: cleanTeamEmblemKey(value.homeEmblemKey),
      awayEmblemKey: cleanTeamEmblemKey(value.awayEmblemKey),
      officialMatchId: cleanText(value.officialMatchId, TEXT_LIMITS.officialMatchId),
      refereeAssigned: Boolean(value.refereeAssigned),
    } : {}),
    playerCountSource,
    playerCount: playerCountSource === "record"
      ? Math.round(cleanNumber(value.playerCount, 0, 1000, 0))
      : getMatchReceiptFormatPlayerCount(format),
    verified: trustedCanonical && value.verified === true,
  };
}

export function getLegacyCanonicalReceiptMatchId(value = {}) {
  if (value?._canonicalReceipt !== true) return "";
  const officialMatchId = cleanText(value.officialMatchId, TEXT_LIMITS.officialMatchId);
  if (/^[A-Za-z0-9:_-]{1,96}$/.test(officialMatchId)) return officialMatchId;
  const serialSeed = cleanText(value.serialSeed, TEXT_LIMITS.serialSeed);
  if (!serialSeed.startsWith("match:")) return "";
  const matchId = serialSeed.slice("match:".length);
  return /^[A-Za-z0-9:_-]{1,90}$/.test(matchId) ? matchId : "";
}

export function projectPublicReceiptDraft(value = {}, options = {}) {
  const legacyMatchId = getLegacyCanonicalReceiptMatchId(value);
  const { originalAddress, personalMmr, profileHashtag, officialMatchId, ...publicDraft } = sanitizeReceiptDraftPayload(value, {
    trustedCanonical: value?._canonicalReceipt === true,
  });
  const projected = legacyMatchId
    ? { ...publicDraft, serialSeed: createCanonicalReceiptSerialSeed(legacyMatchId, options.serialSecret) }
    : publicDraft;
  const publicCode = normalizeMatchPublicCode(options.publicCode);
  return publicCode ? { ...projected, publicCode } : projected;
}

export function createReceiptClonePayload(value = {}) {
  return sanitizeReceiptDraftPayload(projectPublicReceiptDraft(value));
}

export function createCanonicalReceiptSerialSeed(matchId, secret = process.env.MATCH_RECEIPT_SERIAL_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY) {
  if (!matchId || !secret) throw new Error("receipt_serial_seed_unavailable");
  return `canonical:${createHmac("sha256", String(secret)).update(String(matchId)).digest("hex").slice(0, 32)}`;
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

function getReceiptCapabilityCookieName(publicId = "") {
  const suffix = String(publicId).replace(/[^A-Za-z0-9-]/g, "");
  return suffix ? `${RECEIPT_CAPABILITY_COOKIE}_${suffix}` : RECEIPT_CAPABILITY_COOKIE;
}

export function getReceiptCapabilityCookie(request, publicId = "") {
  const header = String(request.headers?.cookie ?? "");
  const names = publicId
    ? [getReceiptCapabilityCookieName(publicId), RECEIPT_CAPABILITY_COOKIE]
    : [RECEIPT_CAPABILITY_COOKIE];
  const parts = header.split(";").map((part) => part.trim());
  const raw = names
    .map((name) => parts.find((part) => part.startsWith(`${name}=`)))
    .find(Boolean);
  if (!raw) return null;
  try {
    const encoded = raw.slice(raw.indexOf("=") + 1);
    const [cookiePublicId, secret] = decodeURIComponent(encoded).split(".");
    return cookiePublicId && secret ? { publicId: cookiePublicId, secret } : null;
  } catch {
    return null;
  }
}

export function setReceiptCapabilityCookie(response, capability) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const name = getReceiptCapabilityCookieName(capability.publicId);
  response.setHeader("Set-Cookie", `${name}=${encodeURIComponent(`${capability.publicId}.${capability.secret}`)}; HttpOnly; SameSite=Lax${secure}; Path=/api/match-receipts; Max-Age=${RECEIPT_DRAFT_TTL_SECONDS}`);
}

export function getReceiptRequestHash(request) {
  const forwarded = String(request.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim();
  const address = forwarded || String(request.socket?.remoteAddress ?? "unknown");
  const salt = process.env.MATCH_RECEIPT_RATE_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "boxtier";
  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}
