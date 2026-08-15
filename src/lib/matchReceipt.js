import { RECORD_TYPES } from "./constants.js";
import { isPersonalRecordMatch, isPubliclyReadableConfirmedMatch } from "../../shared/lib/matchRecordTypes.js";
import { hasVerifiedPlayerStats } from "../../shared/lib/matchSummary.js";
import { assetUrl, BOXTIER_LETTER_DARK_URL, BOXTIER_LOGO_URL } from "./assets.js";
import { createQrMatrix } from "./qrCode.js";
import { getMatchFormatLabel } from "./matchRules.js";
import { getTier, getTierDivisionNumber } from "./tier.js";
import { createMatchReceiptLineArt } from "./matchReceiptEmblem.js";

export const MATCH_RECEIPT_DRAFT_STORAGE_KEY = "boxtier.match-receipt.draft.v1";
export const MATCH_RECEIPT_CREATE_RETURN_TO = "/app/create?intent=record&source=receipt";
export const MATCH_RECEIPT_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const MATCH_RECEIPT_DRAFT_VERSION = 3;
const MATCH_RECEIPT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const PHOTO_DB_NAME = "boxtier-match-receipt";
const PHOTO_STORE_NAME = "photos";
const PHOTO_KEY = "current";
const MATCH_RECEIPT_QR_ACCENT = "#d4582b";
const MATCH_RECEIPT_TEAM_WATERMARK_OPACITY = 0.08;

export const MATCH_RECEIPT_LIMITS = Object.freeze({
  serialSeed: 96,
  teamName: 24,
  venue: 36,
  address: 48,
  originalAddress: 96,
  comment: 11,
  tournamentName: 20,
  profileHashtag: 32,
  score: 999,
});

export const MATCH_RECEIPT_FORMATS = Object.freeze([
  { value: "1v1", label: "1대1" },
  { value: "2v2", label: "2대2" },
  { value: "3v3", label: "3대3" },
  { value: "3x3", label: "3x3" },
  { value: "5v5", label: "5대5" },
]);

export const MATCH_RECEIPT_NATURES = Object.freeze([
  { value: "friendly", label: "FRIENDLY" },
  { value: "competitive", label: "COMPETITIVE" },
  { value: "revenge", label: "REVENGE" },
  { value: "semifinal", label: "SEMIFINAL" },
  { value: "final", label: "FINAL" },
]);

export const MATCH_RECEIPT_CANVAS_SIZES = Object.freeze({
  story: Object.freeze({ width: 1080, height: 1920, label: "Story 1080×1920" }),
  feed: Object.freeze({ width: 1080, height: 1350, label: "Feed 1080×1350" }),
});

export const MATCH_RECEIPT_PHOTO_ASPECT = 1080 / 885;
const MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS = Object.freeze({ x: 0, y: 82 });

export function getMatchReceiptRotationCoverScale(rotation, aspect = MATCH_RECEIPT_PHOTO_ASPECT) {
  const radians = Math.abs(Number(rotation) || 0) * Math.PI / 180;
  const safeAspect = Math.max(0.01, Number(aspect) || MATCH_RECEIPT_PHOTO_ASPECT);
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return Math.max(cosine + sine / safeAspect, cosine + sine * safeAspect);
}

export function getMatchReceiptPhotoStyle(value, aspect = MATCH_RECEIPT_PHOTO_ASPECT, options = {}) {
  const draft = normalizeMatchReceiptDraft(value);
  const photoX = options.defaultPhoto ? MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS.x : draft.photoX;
  const photoY = options.defaultPhoto ? MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS.y : draft.photoY;
  const panRange = Math.max(0, draft.photoZoom - 1) * 50;
  return {
    "--receipt-photo-position-x": `${50 - photoX / 2}%`,
    "--receipt-photo-position-y": `${50 - photoY / 2}%`,
    "--receipt-photo-shift-x": `${photoX / 100 * panRange}%`,
    "--receipt-photo-shift-y": `${photoY / 100 * panRange}%`,
    "--receipt-photo-scale": getMatchReceiptRotationCoverScale(draft.photoRotation, aspect) * draft.photoZoom,
    "--receipt-photo-rotation": `${draft.photoRotation}deg`,
  };
}

export function getMatchReceiptTeamNameScale(value) {
  const length = Array.from(String(value ?? "").trim()).length;
  if (length > 20) return 0.68;
  if (length > 16) return 0.78;
  if (length > 12) return 0.88;
  return 1;
}

const DEFAULT_COLORS = Object.freeze({ home: "#f05a46", away: "#27354d" });
const TIER_EMBLEMS = Object.freeze({
  Rookie: "/assets/tier-emblems/tier-rookie-v5.webp",
  Bronze: "/assets/tier-emblems/tier-bronze-v5.webp",
  Silver: "/assets/tier-emblems/tier-silver-v5.webp",
  Gold: "/assets/tier-emblems/tier-gold-v5.webp",
  Platinum: "/assets/tier-emblems/tier-platinum-v5.webp",
  Diamond: "/assets/tier-emblems/tier-diamond-v5.webp",
  Master: "/assets/tier-emblems/tier-master-v5.webp",
  Legend: "/assets/tier-emblems/tier-legend-v5.webp",
});
const TIER_OUTLINE_EMBLEMS = Object.freeze({
  Rookie: "/assets/tier-emblems/tier-rookie-outline-v1.png",
  Bronze: "/assets/tier-emblems/tier-bronze-outline-v1.png",
  Silver: "/assets/tier-emblems/tier-silver-outline-v1.png",
  Gold: "/assets/tier-emblems/tier-gold-outline-v1.png",
  Platinum: "/assets/tier-emblems/tier-platinum-outline-v1.png",
  Diamond: "/assets/tier-emblems/tier-diamond-outline-v1.png",
  Master: "/assets/tier-emblems/tier-master-outline-v1.png",
  Legend: "/assets/tier-emblems/tier-legend-outline-v1.png",
});
const MATCH_RECEIPT_NEUTRAL_TEAM_MARK_URLS = Object.freeze({
  home: assetUrl("/assets/tier-emblems/tier-neutral-home-outline-v5.png"),
  away: assetUrl("/assets/tier-emblems/tier-neutral-away-outline-v5.png"),
});
const MATCH_RECEIPT_PAPER_URL = assetUrl("/assets/match-receipt-paper-torn-v1.png");
const MATCH_RECEIPT_PAPER_GRAIN_URL = assetUrl("/assets/match-receipt-paper-grain-v1.png");
const MATCH_RECEIPT_SCORE_DIGITS_URL = assetUrl("/assets/match-receipt-score-digits-v3.png");
const MATCH_RECEIPT_SCORE_GLYPH_COUNT = 11;

function todayInKorea() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trimEnd();
}

function clampNumber(value, minimum, maximum, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function cleanScore(value) {
  return Math.round(clampNumber(value, 0, MATCH_RECEIPT_LIMITS.score));
}

function cleanOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanOptionalScore(value) {
  const number = cleanOptionalNumber(value);
  return number === null ? null : Math.round(clampNumber(number, 0, MATCH_RECEIPT_LIMITS.score));
}

const MATCH_RECEIPT_PERIOD_LABELS = new Set(["1Q", "2Q", "3Q", "4Q", "1H", "2H", "REG", "OT"]);

function cleanReceiptPeriodScores(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((item) => {
    const label = String(item?.label ?? "").trim().toUpperCase();
    if (!MATCH_RECEIPT_PERIOD_LABELS.has(label) || seen.has(label)) return [];
    const scoreA = cleanOptionalScore(item?.scoreA);
    const scoreB = cleanOptionalScore(item?.scoreB);
    if (scoreA === null || scoreB === null) return [];
    seen.add(label);
    return [{ label, scoreA, scoreB }];
  }).slice(0, 5);
}

function cleanColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? "")) ? String(value).toLowerCase() : fallback;
}

export function createMatchReceiptSerialSeed() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function cleanSerialSeed(value) {
  const seed = cleanText(value, MATCH_RECEIPT_LIMITS.serialSeed);
  return /^[A-Za-z0-9:_-]{8,96}$/.test(seed) ? seed : createMatchReceiptSerialSeed();
}

export function createDefaultMatchReceiptDraft() {
  return {
    serialSeed: createMatchReceiptSerialSeed(),
    homeTeam: "",
    awayTeam: "",
    homeScore: 0,
    awayScore: 0,
    playedOn: todayInKorea(),
    venue: "",
    address: "",
    originalAddress: "",
    format: "3v3",
    matchNature: "competitive",
    homeColor: DEFAULT_COLORS.home,
    awayColor: DEFAULT_COLORS.away,
    comment: "",
    tournamentName: "",
    periodScores: [],
    q1Home: null,
    q1Away: null,
    q2Home: null,
    q2Away: null,
    q3Home: null,
    q3Away: null,
    q4Home: null,
    q4Away: null,
    otHome: null,
    otAway: null,
    homeEmblemKey: "",
    awayEmblemKey: "",
    homeUseLineArt: false,
    awayUseLineArt: false,
    photoZoom: 1,
    photoX: 0,
    photoY: 0,
    photoRotation: 0,
    homeMmr: null,
    awayMmr: null,
    personalMmr: null,
    profileHashtag: "",
    personalPoints: null,
    personalRebounds: null,
    personalStatsEligible: false,
    hasCanonicalTeamMatch: false,
    verified: false,
  };
}

export function normalizeMatchReceiptDraft(value = {}) {
  const format = MATCH_RECEIPT_FORMATS.some((item) => item.value === value.format) ? value.format : "3v3";
  const matchNature = MATCH_RECEIPT_NATURES.some((item) => item.value === value.matchNature)
    ? value.matchNature
    : "competitive";
  return {
    serialSeed: cleanSerialSeed(value.serialSeed),
    homeTeam: cleanText(value.homeTeam, MATCH_RECEIPT_LIMITS.teamName),
    awayTeam: cleanText(value.awayTeam, MATCH_RECEIPT_LIMITS.teamName),
    homeScore: cleanScore(value.homeScore),
    awayScore: cleanScore(value.awayScore),
    playedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(value.playedOn ?? "")) ? String(value.playedOn) : todayInKorea(),
    venue: cleanText(value.venue, MATCH_RECEIPT_LIMITS.venue),
    address: cleanText(value.address, MATCH_RECEIPT_LIMITS.address),
    originalAddress: cleanText(value.originalAddress, MATCH_RECEIPT_LIMITS.originalAddress),
    format,
    matchNature,
    homeColor: cleanColor(value.homeColor, DEFAULT_COLORS.home),
    awayColor: cleanColor(value.awayColor, DEFAULT_COLORS.away),
    comment: cleanText(value.comment, MATCH_RECEIPT_LIMITS.comment),
    tournamentName: cleanText(value.tournamentName, MATCH_RECEIPT_LIMITS.tournamentName),
    periodScores: cleanReceiptPeriodScores(value.periodScores),
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
    homeEmblemKey: cleanText(value.homeEmblemKey, 256),
    awayEmblemKey: cleanText(value.awayEmblemKey, 256),
    homeUseLineArt: Boolean(value.homeUseLineArt),
    awayUseLineArt: Boolean(value.awayUseLineArt),
    photoZoom: clampNumber(value.photoZoom, 1, 3, 1),
    photoX: clampNumber(value.photoX, -100, 100),
    photoY: clampNumber(value.photoY, -100, 100),
    photoRotation: ((clampNumber(value.photoRotation, -10_000, 10_000) + 180) % 360 + 360) % 360 - 180,
    homeMmr: cleanOptionalNumber(value.homeMmr),
    awayMmr: cleanOptionalNumber(value.awayMmr),
    personalMmr: cleanOptionalNumber(value.personalMmr),
    profileHashtag: cleanText(value.profileHashtag, MATCH_RECEIPT_LIMITS.profileHashtag),
    personalPoints: cleanOptionalNumber(value.personalPoints),
    personalRebounds: cleanOptionalNumber(value.personalRebounds),
    personalStatsEligible: Boolean(value.personalStatsEligible),
    hasCanonicalTeamMatch: Boolean(value.hasCanonicalTeamMatch),
    verified: Boolean(value.verified),
  };
}

function inferMatchReceiptNature(match = {}, tournament = null) {
  if (MATCH_RECEIPT_NATURES.some(({ value }) => value === match.matchNature)) return match.matchNature;
  if (match.tournamentFormat === "tournament" || tournament?.format === "tournament") {
    const bracketSize = Number(tournament?.bracket?.bracketSize ?? 0);
    const totalRounds = bracketSize > 1 ? Math.ceil(Math.log2(bracketSize)) : 0;
    const round = Number(match.tournamentRound ?? 0);
    if (totalRounds && round === totalRounds) return "final";
    if (totalRounds > 1 && round === totalRounds - 1) return "semifinal";
  }
  const source = `${match.title ?? ""} ${match.roundName ?? ""} ${match.stage ?? ""}`.toLowerCase();
  if (/semi[ -]?final|준결승/.test(source)) return "semifinal";
  if (/\bfinal\b|결승/.test(source)) return "final";
  if (/revenge|리벤지/.test(source)) return "revenge";
  if (match.matchPurpose === "friendly" || match.rules?.matchPurpose === "friendly") return "friendly";
  return "competitive";
}

function getMatchReceiptDraftStorage(storage) {
  if (storage) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

export function saveMatchReceiptDraft(value, storage) {
  const target = getMatchReceiptDraftStorage(storage);
  if (!target) return false;
  try {
    target.setItem(MATCH_RECEIPT_DRAFT_STORAGE_KEY, JSON.stringify({
      version: MATCH_RECEIPT_DRAFT_VERSION,
      savedAt: Date.now(),
      draft: normalizeMatchReceiptDraft(value),
    }));
    return true;
  } catch {
    return false;
  }
}

export function loadMatchReceiptDraft(storage) {
  const target = getMatchReceiptDraftStorage(storage);
  if (!target) return null;
  try {
    const value = JSON.parse(target.getItem(MATCH_RECEIPT_DRAFT_STORAGE_KEY) || "null");
    const savedAt = Number(value?.savedAt);
    if (![1, 2, MATCH_RECEIPT_DRAFT_VERSION].includes(value?.version) || !Number.isFinite(savedAt) || Date.now() - savedAt > MATCH_RECEIPT_DRAFT_TTL_MS) {
      if (value) target.removeItem(MATCH_RECEIPT_DRAFT_STORAGE_KEY);
      return null;
    }
    return normalizeMatchReceiptDraft(value.draft);
  } catch {
    target.removeItem(MATCH_RECEIPT_DRAFT_STORAGE_KEY);
    return null;
  }
}

export function clearMatchReceiptDraft(storage) {
  const target = getMatchReceiptDraftStorage(storage);
  if (!target) return false;
  try {
    target.removeItem(MATCH_RECEIPT_DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function openPhotoDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PHOTO_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function usePhotoStore(mode, callback) {
  const database = await openPhotoDatabase();
  if (!database) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(PHOTO_STORE_NAME, mode);
      const request = callback(transaction.objectStore(PHOTO_STORE_NAME));
      request.onsuccess = () => resolve(request.result ?? true);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function saveMatchReceiptPhoto(blob) {
  if (!(blob instanceof Blob)) return false;
  await usePhotoStore("readwrite", (store) => store.put({ blob, savedAt: Date.now() }, PHOTO_KEY));
  return true;
}

export async function loadMatchReceiptPhoto() {
  try {
    const value = await usePhotoStore("readonly", (store) => store.get(PHOTO_KEY));
    if (!value?.blob) return null;
    if (Date.now() - Number(value.savedAt ?? 0) > MATCH_RECEIPT_DRAFT_TTL_MS) {
      await clearMatchReceiptPhoto();
      return null;
    }
    return value.blob;
  } catch {
    return null;
  }
}

export async function clearMatchReceiptPhoto() {
  try {
    await usePhotoStore("readwrite", (store) => store.delete(PHOTO_KEY));
    return true;
  } catch {
    return false;
  }
}

function canvasToBlob(canvas, type = "image/jpeg", quality = 0.92) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (
    blob ? resolve(blob) : reject(new Error("match_receipt_photo_failed"))
  ), type, quality));
}

export async function normalizeMatchReceiptPhotoFile(file) {
  if (!(file instanceof Blob) || !String(file.type).startsWith("image/")) throw new Error("match_receipt_photo_type");
  if (file.size > MATCH_RECEIPT_PHOTO_MAX_BYTES) throw new Error("match_receipt_photo_size");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const maximumSide = 4096;
  const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvasToBlob(canvas, "image/jpeg", 0.92);
}

export function validateMatchReceiptDraft(value) {
  const draft = normalizeMatchReceiptDraft(value);
  const errors = {};
  if (!draft.homeTeam.trim()) errors.homeTeam = "TEAM A 이름을 입력해 주세요.";
  if (!draft.awayTeam.trim()) errors.awayTeam = "TEAM B 이름을 입력해 주세요.";
  if (!draft.venue.trim() && !draft.address.trim()) {
    errors.venue = "경기 장소를 선택하거나 짧은 장소를 입력해 주세요.";
  }
  return { draft, errors, valid: Object.keys(errors).length === 0 };
}

export function renewMatchReceiptDraft(value) {
  return normalizeMatchReceiptDraft({
    ...normalizeMatchReceiptDraft(value),
    serialSeed: createMatchReceiptSerialSeed(),
  });
}

export function getMatchReceiptCreateDraft(value) {
  const draft = normalizeMatchReceiptDraft(value);
  return {
    recordType: RECORD_TYPES.personalRecord,
    recordEntryMode: "quick",
    visibility: "private",
    mode: draft.format === "3x3" ? "3v3" : draft.format,
    ruleSet: draft.format === "3x3" ? "fiba_3x3" : "standard",
    scheduledDate: draft.playedOn,
    soloTeamAName: draft.homeTeam,
    soloTeamBName: draft.awayTeam,
    soloScoreFor: draft.homeScore,
    soloScoreAgainst: draft.awayScore,
    courtId: "",
    ...(draft.venue ? { court: draft.venue } : {}),
    ...(draft.comment ? { memo: draft.comment } : {}),
  };
}

export function canCreatePublicMatchReceiptSnapshot(match = {}) {
  return isPubliclyReadableConfirmedMatch(match);
}

export function getMatchReceiptSideTeamId(match = {}, side = "") {
  const summary = match?.rules?.recordSummary ?? {};
  return match?.[side]?.teamId
    ?? match?.[`${side}Id`]
    ?? summary?.[`${side}TeamId`]
    ?? summary?.[`${side}Id`]
    ?? "";
}

export function getMatchReceiptDraftFromMatch(match = {}, style = {}, court = null) {
  const summary = match.rules?.recordSummary ?? {};
  const currentUserId = String(style.currentUserId ?? "");
  const playerStats = match.result?.playerStats?.[currentUserId] ?? {};
  const verified = canCreatePublicMatchReceiptSnapshot(match) && !isPersonalRecordMatch(match);
  const personalStatsEligible = match.status === "confirmed" && (
    hasVerifiedPlayerStats(match, currentUserId)
    || (isPersonalRecordMatch(match) && match.createdBy === currentUserId)
  );
  return normalizeMatchReceiptDraft({
    serialSeed: style.serialSeed,
    homeTeam: match.teamA?.name || summary.teamAName || "",
    awayTeam: match.teamB?.name || summary.teamBName || "",
    homeScore: match.result?.scoreA ?? match.teamA?.score ?? 0,
    awayScore: match.result?.scoreB ?? match.teamB?.score ?? 0,
    playedOn: String(match.scheduledDate ?? "").slice(0, 10),
    format: getMatchFormatLabel(match.mode, match.rules),
    matchNature: inferMatchReceiptNature(match, style.tournament),
    venue: court?.name ?? (match.court && match.court !== "미정" ? match.court : ""),
    address: style.address ?? "",
    originalAddress: court?.address ?? style.originalAddress ?? "",
    comment: style.comment ?? "",
    tournamentName: style.tournamentName || style.tournament?.name || style.tournament?.title || "",
    periodScores: Array.isArray(match.result?.periodScores) ? match.result.periodScores : [],
    q1Home: style.q1Home,
    q1Away: style.q1Away,
    q2Home: style.q2Home,
    q2Away: style.q2Away,
    q3Home: style.q3Home,
    q3Away: style.q3Away,
    q4Home: style.q4Home,
    q4Away: style.q4Away,
    otHome: style.otHome,
    otAway: style.otAway,
    homeEmblemKey: style.homeTeamRecord?.receiptEmblemKey ?? "",
    awayEmblemKey: style.awayTeamRecord?.receiptEmblemKey ?? "",
    homeUseLineArt: Boolean(style.homeUseLineArt),
    awayUseLineArt: Boolean(style.awayUseLineArt),
    homeColor: style.homeColor,
    awayColor: style.awayColor,
    photoZoom: style.photoZoom,
    photoX: style.photoX,
    photoY: style.photoY,
    photoRotation: style.photoRotation,
    homeMmr: style.homeMmr ?? match.teamA?.mmr,
    awayMmr: style.awayMmr ?? match.teamB?.mmr,
    personalMmr: style.personalMmr,
    profileHashtag: style.profileHashtag,
    personalPoints: personalStatsEligible ? playerStats.points : null,
    personalRebounds: personalStatsEligible ? playerStats.rebounds : null,
    personalStatsEligible,
    hasCanonicalTeamMatch: Boolean(
      getMatchReceiptSideTeamId(match, "teamA")
      && getMatchReceiptSideTeamId(match, "teamB")
    ),
    verified,
  });
}

export function getMatchReceiptOutcome(value) {
  const draft = normalizeMatchReceiptDraft(value);
  if (draft.homeScore === draft.awayScore) return { key: "draw", label: "DRAW" };
  const winner = draft.homeScore > draft.awayScore
    ? { key: "home", name: draft.homeTeam || "TEAM A" }
    : { key: "away", name: draft.awayTeam || "TEAM B" };
  return { key: winner.key, label: `${winner.name} WIN` };
}

export function getMatchReceiptCanvasSize(preset = "story") {
  return MATCH_RECEIPT_CANVAS_SIZES[preset] ?? MATCH_RECEIPT_CANVAS_SIZES.story;
}

export function getMatchReceiptFileName(value, preset = "story") {
  const draft = normalizeMatchReceiptDraft(value);
  return `boxtier-match-receipt-${draft.playedOn.replaceAll("-", "")}-${preset}.png`;
}

export function getMatchReceiptFormatLabel(format) {
  return MATCH_RECEIPT_FORMATS.find(({ value }) => value === format)?.value ?? "3v3";
}

export function getMatchReceiptNatureLabel(matchNature) {
  return MATCH_RECEIPT_NATURES.find((item) => item.value === matchNature)?.label ?? "COMPETITIVE";
}

function receiptHashtag(draft) {
  const input = draft.serialSeed;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `#BT-${(hash >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

function getTierVisual(mmr) {
  if (!Number.isFinite(mmr)) return null;
  const tier = getTier(mmr);
  const division = getTierDivisionNumber(mmr);
  return {
    label: `${tier.name}${division ? ` ${division}` : ""}`.toUpperCase(),
    src: assetUrl(TIER_EMBLEMS[tier.name] ?? TIER_EMBLEMS.Rookie),
    outlineSrc: assetUrl(TIER_OUTLINE_EMBLEMS[tier.name] ?? TIER_OUTLINE_EMBLEMS.Rookie),
  };
}

export function createMatchReceiptViewModel(value, options = {}) {
  const draft = normalizeMatchReceiptDraft(value);
  const hasPersonalStats = draft.personalStatsEligible
    && (draft.personalPoints !== null || draft.personalRebounds !== null);
  const personalTier = getTierVisual(draft.personalMmr);
  const showPersonalTierIdentity = options.showPersonalTierIdentity !== false
    && Boolean(personalTier && draft.profileHashtag);
  return {
    ...draft,
    outcome: getMatchReceiptOutcome(draft),
    serial: receiptHashtag(draft),
    locationLabel: draft.address || draft.venue,
    matchUrl: String(options.matchUrl ?? ""),
    logoUrl: BOXTIER_LOGO_URL,
    wordmarkUrl: BOXTIER_LETTER_DARK_URL,
    defaultPhotoUrl: assetUrl("/assets/rankball-record-create-night-v5.webp"),
    paperUrl: MATCH_RECEIPT_PAPER_URL,
    paperGrainUrl: MATCH_RECEIPT_PAPER_GRAIN_URL,
    scoreDigitsUrl: MATCH_RECEIPT_SCORE_DIGITS_URL,
    neutralTeamMarkUrls: MATCH_RECEIPT_NEUTRAL_TEAM_MARK_URLS,
    teamEmblemUrls: {
      home: draft.homeUseLineArt && draft.homeEmblemKey ? assetUrl(`/${draft.homeEmblemKey.replace(/^\/+/, "")}`) : "",
      away: draft.awayUseLineArt && draft.awayEmblemKey ? assetUrl(`/${draft.awayEmblemKey.replace(/^\/+/, "")}`) : "",
    },
    periodScores: draft.periodScores.length
      ? draft.periodScores.map(({ label, scoreA, scoreB }) => [label, scoreA, scoreB])
      : [
          ["1Q", draft.q1Home, draft.q1Away],
          ["2Q", draft.q2Home, draft.q2Away],
          ["3Q", draft.q3Home, draft.q3Away],
          ["4Q", draft.q4Home, draft.q4Away],
          ["OT", draft.otHome, draft.otAway],
        ].filter(([, home, away]) => home !== null || away !== null),
    homeTier: getTierVisual(draft.homeMmr),
    awayTier: getTierVisual(draft.awayMmr),
    personalTier: showPersonalTierIdentity ? personalTier : null,
    profileHashtag: showPersonalTierIdentity ? draft.profileHashtag : "",
    showPersonalTierIdentity,
    matchNatureLabel: getMatchReceiptNatureLabel(draft.matchNature),
    hasPersonalStats,
    showTeamTierEmblems: draft.verified && draft.hasCanonicalTeamMatch,
  };
}

function getCanvasImageSources(source) {
  if (source instanceof Blob) return [{ url: URL.createObjectURL(source), temporary: true }];
  const primary = String(source ?? "");
  const sources = [{ url: primary, temporary: false }];
  const origin = globalThis.location?.origin ?? "";
  if (!origin) return sources;
  try {
    const parsed = new URL(primary, origin);
    if (parsed.origin !== origin && parsed.pathname.startsWith("/assets/")) {
      sources.push({ url: `${origin}${parsed.pathname}${parsed.search}`, temporary: false });
    }
  } catch {
    // Invalid image URLs fail through the regular image error path.
  }
  return sources;
}

function loadCanvasImage(source) {
  const sources = getCanvasImageSources(source);
  return new Promise((resolve, reject) => {
    let index = 0;
    function tryNext() {
      const sourceItem = sources[index];
      index += 1;
      if (!sourceItem?.url) {
        reject(new Error("match_receipt_image_failed"));
        return;
      }
      const image = new Image();
      if (!sourceItem.url.startsWith("blob:")) image.crossOrigin = "anonymous";
      image.onload = () => {
        if (sourceItem.temporary) URL.revokeObjectURL(sourceItem.url);
        resolve(image);
      };
      image.onerror = () => {
        if (sourceItem.temporary) URL.revokeObjectURL(sourceItem.url);
        tryNext();
      };
      image.src = sourceItem.url;
    }
    tryNext();
  });
}

function drawCoverPhoto(ctx, image, rect, draft, options = {}) {
  const rotation = draft.photoRotation * Math.PI / 180;
  const cover = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const width = image.naturalWidth * cover;
  const height = image.naturalHeight * cover;
  const photoX = options.defaultPhoto ? MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS.x : draft.photoX;
  const photoY = options.defaultPhoto ? MATCH_RECEIPT_DEFAULT_PHOTO_FOCUS.y : draft.photoY;
  const positionX = (100 - photoX) / 200;
  const positionY = (100 - photoY) / 200;
  const foregroundScale = options.defaultPhoto ? 0.92 : 1;
  const foregroundWidth = width * foregroundScale;
  const foregroundHeight = height * foregroundScale;
  const frame = document.createElement("canvas");
  frame.width = rect.width;
  frame.height = rect.height;
  const frameCtx = frame.getContext("2d");
  if (!frameCtx) throw new Error("match_receipt_canvas_unavailable");
  if (options.defaultPhoto) {
    const backdropScale = 1.08;
    const backdropWidth = width * backdropScale;
    const backdropHeight = height * backdropScale;
    frameCtx.filter = "blur(16px) brightness(0.62) contrast(1.08) saturate(0.92)";
    frameCtx.drawImage(
      image,
      -(backdropWidth - rect.width) * positionX,
      -(backdropHeight - rect.height) * positionY,
      backdropWidth,
      backdropHeight,
    );
  }
  frameCtx.filter = "brightness(0.78) contrast(1.08) saturate(0.92)";
  frameCtx.drawImage(
    image,
    -(foregroundWidth - rect.width) * positionX,
    -(foregroundHeight - rect.height) * positionY,
    foregroundWidth,
    foregroundHeight,
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  const panRange = Math.max(0, draft.photoZoom - 1) / 2;
  const shiftX = rect.width * panRange * photoX / 100;
  const shiftY = rect.height * panRange * photoY / 100;
  ctx.translate(rect.x + rect.width / 2 + shiftX, rect.y + rect.height / 2 + shiftY);
  ctx.rotate(rotation);
  const scale = getMatchReceiptRotationCoverScale(draft.photoRotation, rect.width / rect.height) * draft.photoZoom;
  ctx.scale(scale, scale);
  ctx.drawImage(frame, -rect.width / 2, -rect.height / 2);
  ctx.restore();
}

function createCanvasPaperPattern(ctx, paperGrain) {
  const texture = document.createElement("canvas");
  texture.width = 256;
  texture.height = 256;
  const textureCtx = texture.getContext("2d");
  if (!textureCtx) return "#f1e8db";
  textureCtx.drawImage(
    paperGrain,
    0,
    0,
    paperGrain.naturalWidth,
    paperGrain.naturalHeight,
    0,
    0,
    texture.width,
    texture.height,
  );
  return ctx.createPattern(texture, "repeat") || "#f1e8db";
}

function drawCanvasPaperGrain(ctx, paperGrain, rect, options = {}) {
  if (!paperGrain) return;
  let source = paperGrain;
  if (options.fadeIn) {
    const layer = document.createElement("canvas");
    layer.width = Math.ceil(rect.width);
    layer.height = Math.ceil(rect.height);
    const layerContext = layer.getContext("2d");
    if (layerContext) {
      layerContext.drawImage(paperGrain, 0, 0, layer.width, layer.height);
      layerContext.globalCompositeOperation = "destination-in";
      const fade = layerContext.createLinearGradient(0, 0, 0, layer.height * options.fadeIn);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(1, "rgba(0,0,0,1)");
      layerContext.fillStyle = fade;
      layerContext.fillRect(0, 0, layer.width, layer.height);
      source = layer;
    }
  }
  ctx.save();
  ctx.globalAlpha = options.alpha ?? 0.2;
  ctx.globalCompositeOperation = options.blend ?? "soft-light";
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawCanvasScoreDigits(ctx, atlas, value, centerX, top, height, maxWidth) {
  const digits = Array.from(String(value));
  const cellWidth = atlas.naturalWidth / MATCH_RECEIPT_SCORE_GLYPH_COUNT;
  const cellHeight = atlas.naturalHeight;
  const naturalDigitWidth = height * cellWidth / cellHeight;
  const naturalGap = height * 0.005;
  const naturalWidth = digits.length * naturalDigitWidth + Math.max(0, digits.length - 1) * naturalGap;
  const scale = Math.min(1, maxWidth / naturalWidth);
  const digitWidth = naturalDigitWidth * scale;
  const digitHeight = height * scale;
  const gap = naturalGap * scale;
  let x = centerX - (digits.length * digitWidth + Math.max(0, digits.length - 1) * gap) / 2;

  digits.forEach((digit) => {
    const index = Number(digit);
    ctx.drawImage(
      atlas,
      index * cellWidth,
      0,
      cellWidth,
      cellHeight,
      x,
      top + (height - digitHeight) / 2,
      digitWidth,
      digitHeight,
    );
    x += digitWidth + gap;
  });
}

function drawCanvasScoreColon(ctx, atlas, centerX, top, height) {
  const cellWidth = atlas.naturalWidth / MATCH_RECEIPT_SCORE_GLYPH_COUNT;
  ctx.drawImage(
    atlas,
    10 * cellWidth,
    0,
    cellWidth,
    atlas.naturalHeight,
    centerX - height * cellWidth / atlas.naturalHeight / 2,
    top,
    height * cellWidth / atlas.naturalHeight,
    height,
  );
}

function wrapCanvasText(ctx, text, maxWidth, maxLines = 2) {
  const characters = Array.from(String(text || "").trim());
  const lines = [];
  let line = "";

  for (let index = 0; index < characters.length; index += 1) {
    const next = line + characters[index];
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line.trim());
      line = characters[index].trimStart();
      if (lines.length === maxLines - 1) {
        const remainder = Array.from((line + characters.slice(index + 1).join("")).trim());
        while (remainder.length > 1 && ctx.measureText(`${remainder.join("")}…`).width > maxWidth) remainder.pop();
        line = `${remainder.join("").trimEnd()}…`;
        break;
      }
    } else {
      line = next;
    }
  }
  if (line) lines.push(line.trim());
  return lines.slice(0, maxLines);
}

function drawQrBrandBadge(ctx, x, y, scale, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = MATCH_RECEIPT_QR_ACCENT;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 0.8);
  ctx.fill();
  ctx.strokeStyle = "#fff3df";
  ctx.lineWidth = 0.58;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(1.7, 1.3);
  ctx.lineTo(1.7, 3.7);
  ctx.moveTo(1.7, 1.3);
  ctx.lineTo(2.5, 1.3);
  ctx.bezierCurveTo(3.02, 1.3, 3.3, 1.52, 3.3, 1.9);
  ctx.bezierCurveTo(3.3, 2.28, 3.02, 2.5, 2.5, 2.5);
  ctx.lineTo(1.7, 2.5);
  ctx.moveTo(1.7, 2.5);
  ctx.lineTo(2.58, 2.5);
  ctx.bezierCurveTo(3.14, 2.5, 3.45, 2.72, 3.45, 3.1);
  ctx.bezierCurveTo(3.45, 3.48, 3.14, 3.7, 2.58, 3.7);
  ctx.lineTo(1.7, 3.7);
  ctx.stroke();
  ctx.restore();
}

function drawQrCode(ctx, value, x, y, size) {
  const matrix = createQrMatrix(value);
  const quietZone = 4;
  const scale = Math.max(1, Math.floor(size / (matrix.length + quietZone * 2)));
  const actualSize = (matrix.length + quietZone * 2) * scale;
  const badgeClearSize = 5;
  const badgeSize = 5;
  const badgeStart = Math.floor((matrix.length - badgeClearSize) / 2);
  ctx.fillStyle = "#111111";
  matrix.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    const isBadgeModule = rowIndex >= badgeStart && rowIndex < badgeStart + badgeClearSize
      && columnIndex >= badgeStart && columnIndex < badgeStart + badgeClearSize;
    if (!cell || isBadgeModule) return;
    const moduleX = x + (columnIndex + quietZone) * scale;
    const moduleY = y + (rowIndex + quietZone) * scale;
    ctx.beginPath();
    ctx.roundRect(moduleX + scale * 0.03, moduleY + scale * 0.03, scale * 0.94, scale * 0.94, scale * 0.18);
    ctx.fill();
  }));
  ctx.fillStyle = MATCH_RECEIPT_QR_ACCENT;
  [
    [2, 2],
    [matrix.length - 5, 2],
    [2, matrix.length - 5],
  ].forEach(([columnIndex, rowIndex]) => {
    ctx.beginPath();
    ctx.roundRect(
      x + (columnIndex + quietZone) * scale,
      y + (rowIndex + quietZone) * scale,
      scale * 3,
      scale * 3,
      scale * 0.5,
    );
    ctx.fill();
  });
  const badgeX = x + (badgeStart + quietZone) * scale;
  const badgeY = y + (badgeStart + quietZone) * scale;
  drawQrBrandBadge(ctx, badgeX, badgeY, scale, badgeSize);
  return actualSize;
}

function drawCanvasMapPin(ctx, centerX, topY, size) {
  const half = size / 2;
  const centerY = topY + size * 0.37;
  ctx.save();
  ctx.strokeStyle = "#d4582b";
  ctx.lineWidth = Math.max(3, size * 0.08);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(centerX, topY + size);
  ctx.bezierCurveTo(centerX - half * 0.18, topY + size * 0.78, centerX - half * 0.72, topY + size * 0.62, centerX - half * 0.72, centerY);
  ctx.bezierCurveTo(centerX - half * 0.72, topY + size * 0.15, centerX - half * 0.36, topY, centerX, topY);
  ctx.bezierCurveTo(centerX + half * 0.36, topY, centerX + half * 0.72, topY + size * 0.15, centerX + half * 0.72, centerY);
  ctx.bezierCurveTo(centerX + half * 0.72, topY + size * 0.62, centerX + half * 0.18, topY + size * 0.78, centerX, topY + size);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, size * 0.12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

async function renderMatchReceiptCanvas(value, preset = "story", options = {}) {
  if (typeof document === "undefined") throw new Error("match_receipt_canvas_unavailable");
  if (preset === "feed") {
    const story = await renderMatchReceiptCanvas(value, "story", options);
    const { width, height } = getMatchReceiptCanvasSize("feed");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("match_receipt_canvas_unavailable");
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, width, height);
    const targetHeight = height;
    const targetWidth = targetHeight * story.width / story.height;
    const targetX = (width - targetWidth) / 2;
    ctx.drawImage(story, targetX, 0, targetWidth, targetHeight);
    return canvas;
  }
  const model = createMatchReceiptViewModel(value, options);
  const { width, height } = getMatchReceiptCanvasSize(preset);
  const compact = preset === "feed";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("match_receipt_canvas_unavailable");
  await document.fonts?.ready;
  if (document.fonts?.load) {
    await Promise.all([
      document.fonts.load('900 270px "Bebas Neue"'),
      document.fonts.load('900 58px "Black Han Sans"'),
    ]);
  }

  const photoHeight = compact ? 610 : 885;
  const receiptTop = compact ? 1010 : 1504;
  const photoPromise = loadCanvasImage(options.photoBlob || model.defaultPhotoUrl)
    .catch((error) => (options.photoBlob ? loadCanvasImage(model.defaultPhotoUrl) : Promise.reject(error)));
  const [photo, wordmark, homeTier, awayTier, homeNeutralTeamMark, awayNeutralTeamMark, personalTier, paper, paperGrain, scoreDigits, homeLineArtUrl, awayLineArtUrl] = await Promise.all([
    photoPromise,
    loadCanvasImage(model.wordmarkUrl).catch(() => null),
    model.showTeamTierEmblems && model.homeTier ? loadCanvasImage(model.homeTier.outlineSrc).catch(() => null) : null,
    model.showTeamTierEmblems && model.awayTier ? loadCanvasImage(model.awayTier.outlineSrc).catch(() => null) : null,
    loadCanvasImage(model.neutralTeamMarkUrls.home).catch(() => null),
    loadCanvasImage(model.neutralTeamMarkUrls.away).catch(() => null),
    model.personalTier ? loadCanvasImage(model.personalTier.outlineSrc).catch(() => null) : null,
    loadCanvasImage(model.paperUrl),
    loadCanvasImage(model.paperGrainUrl),
    loadCanvasImage(model.scoreDigitsUrl),
    options.teamLineArtUrls?.home || createMatchReceiptLineArt(model.teamEmblemUrls.home),
    options.teamLineArtUrls?.away || createMatchReceiptLineArt(model.teamEmblemUrls.away),
  ]);
  const [homeLineArt, awayLineArt] = await Promise.all([
    homeLineArtUrl ? loadCanvasImage(homeLineArtUrl).catch(() => null) : null,
    awayLineArtUrl ? loadCanvasImage(awayLineArtUrl).catch(() => null) : null,
  ]);
  const paperTextPattern = createCanvasPaperPattern(ctx, paperGrain);

  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, width, height);
  drawCoverPhoto(ctx, photo, { x: 0, y: 0, width, height: photoHeight }, model, { defaultPhoto: !options.photoBlob });

  const blurredPhoto = document.createElement("canvas");
  blurredPhoto.width = width;
  blurredPhoto.height = photoHeight;
  const blurredPhotoContext = blurredPhoto.getContext("2d");
  if (blurredPhotoContext) {
    blurredPhotoContext.filter = "blur(18px)";
    blurredPhotoContext.drawImage(canvas, 0, 0, width, photoHeight, 0, 0, width, photoHeight);
    blurredPhotoContext.filter = "none";
    blurredPhotoContext.globalCompositeOperation = "destination-in";
    const blurFade = blurredPhotoContext.createLinearGradient(0, photoHeight * 0.42, 0, photoHeight);
    blurFade.addColorStop(0, "rgba(0,0,0,0)");
    blurFade.addColorStop(0.24, "rgba(0,0,0,0.18)");
    blurFade.addColorStop(0.68, "rgba(0,0,0,0.72)");
    blurFade.addColorStop(1, "rgba(0,0,0,1)");
    blurredPhotoContext.fillStyle = blurFade;
    blurredPhotoContext.fillRect(0, photoHeight * 0.42, width, photoHeight * 0.58);
    ctx.drawImage(blurredPhoto, 0, 0);
  }

  const photoFade = ctx.createLinearGradient(0, photoHeight * 0.42, 0, photoHeight);
  photoFade.addColorStop(0, "rgba(12,12,12,0)");
  photoFade.addColorStop(0.3, "rgba(12,12,12,.12)");
  photoFade.addColorStop(0.68, "rgba(12,12,12,.58)");
  photoFade.addColorStop(0.92, "rgba(12,12,12,.92)");
  photoFade.addColorStop(1, "#111111");
  ctx.fillStyle = photoFade;
  ctx.fillRect(0, photoHeight * 0.42, width, photoHeight * 0.58);
  drawCanvasPaperGrain(ctx, paperGrain, {
    x: 0,
    y: height * 0.35,
    width,
    height: receiptTop - height * 0.35,
  }, { alpha: 0.2, fadeIn: 0.24 });

  ctx.fillStyle = "#f05a2a";
  ctx.textAlign = "left";
  if (wordmark) {
    const wordmarkScale = Math.min(124 / wordmark.naturalWidth, 32 / wordmark.naturalHeight);
    ctx.save();
    ctx.filter = "brightness(0) saturate(100%) invert(47%) sepia(93%) saturate(2858%) hue-rotate(346deg) brightness(96%) contrast(93%)";
    ctx.drawImage(wordmark, 44, 48, wordmark.naturalWidth * wordmarkScale, wordmark.naturalHeight * wordmarkScale);
    ctx.restore();
  } else {
    ctx.font = '900 27px "Arial Black", Impact, sans-serif';
    ctx.fillText("BOXTIER", 44, 79);
  }
  ctx.fillStyle = "#f05a2a";
  ctx.textAlign = "right";
  ctx.font = '900 25px "KBO Dia Gothic", sans-serif';
  ctx.fillText(model.serial, width - 48, 80);
  if (model.showPersonalTierIdentity) {
    ctx.globalAlpha = 0.82;
    ctx.font = '900 18px "KBO Dia Gothic", sans-serif';
    ctx.fillText(model.profileHashtag, width - 48, 106);
    ctx.globalAlpha = 1;
  }

  const verifiedY = compact ? 440 : 780;
  ctx.strokeStyle = "#f05a2a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(175, verifiedY);
  ctx.lineTo(370, verifiedY);
  ctx.moveTo(710, verifiedY);
  ctx.lineTo(905, verifiedY);
  ctx.stroke();
  ctx.fillStyle = "#f05a2a";
  ctx.textAlign = "center";
  ctx.font = '900 30px "Bebas Neue", sans-serif';
  ctx.letterSpacing = "1px";
  ctx.fillText(model.verified ? "★  BOXTIER VERIFIED  ★" : "★  MATCH RECEIPT  ★", width / 2, verifiedY + 11);
  ctx.letterSpacing = "0px";

  const columns = [270, 810];
  const teams = [
    { name: model.homeTeam || "TEAM A", tier: model.homeTier, image: homeLineArt || homeTier || homeNeutralTeamMark, custom: Boolean(homeLineArt) },
    { name: model.awayTeam || "TEAM B", tier: model.awayTier, image: awayLineArt || awayTier || awayNeutralTeamMark, custom: Boolean(awayLineArt) },
  ];
  const teamWatermarkSize = compact ? 450 : 600;
  const teamWatermarkY = compact ? 510 : 810;
  teams.forEach((team, index) => {
    if (!team.image) return;
    ctx.save();
    ctx.globalAlpha = MATCH_RECEIPT_TEAM_WATERMARK_OPACITY;
    ctx.filter = "grayscale(1) brightness(0) invert(1)";
    const centerX = index ? width - 72 : 72;
    ctx.drawImage(team.image, centerX - teamWatermarkSize / 2, teamWatermarkY, teamWatermarkSize, teamWatermarkSize);
    ctx.restore();
  });

  const scoreTop = verifiedY + 70;
  const scoreDigitHeight = compact ? 154 : 278;
  const scoreBaseline = compact ? scoreTop + 132 : 1163;
  drawCanvasScoreDigits(ctx, scoreDigits, model.homeScore, columns[0], scoreBaseline - scoreDigitHeight, scoreDigitHeight, 430);
  drawCanvasScoreDigits(ctx, scoreDigits, model.awayScore, columns[1], scoreBaseline - scoreDigitHeight, scoreDigitHeight, 430);
  drawCanvasScoreColon(ctx, scoreDigits, width / 2, scoreBaseline - scoreDigitHeight, scoreDigitHeight);
  ctx.fillStyle = "#f05a2a";
  ctx.font = `900 ${compact ? 31 : 36}px "Bebas Neue", sans-serif`;
  ctx.letterSpacing = compact ? "0.8px" : "1.2px";
  ctx.fillText(model.matchNatureLabel, width / 2, scoreTop + (compact ? 7 : 17));
  ctx.letterSpacing = "0px";

  const teamTop = compact ? 779 : 1192;
  const teamFontSize = compact ? 40 : 52;
  const teamTierY = compact ? 838 : 1311;
  const teamTierSize = compact ? 116 : 140;
  const teamLabelY = compact ? 982 : 1474;
  teams.forEach((team, index) => {
    const scaledTeamFontSize = teamFontSize * getMatchReceiptTeamNameScale(team.name);
    ctx.textAlign = "center";
    ctx.font = `900 ${scaledTeamFontSize}px "Black Han Sans", "KBO Dia Gothic", sans-serif`;
    ctx.fillStyle = paperTextPattern;
    const teamLines = wrapCanvasText(ctx, team.name, 430).slice(0, 2);
    const teamLineHeight = scaledTeamFontSize * 1.04;
    const teamTextTop = teamTop + (2 - teamLines.length) * teamLineHeight / 2;
    teamLines.forEach((line, lineIndex) => {
      ctx.save();
      ctx.translate(columns[index], 0);
      ctx.scale(0.92, 1);
      ctx.fillText(line, 0, teamTextTop + scaledTeamFontSize + lineIndex * teamLineHeight);
      ctx.restore();
    });
    if (team.image) {
      ctx.save();
      ctx.globalAlpha = model.showTeamTierEmblems && team.tier ? 0.82 : 0.76;
      ctx.drawImage(team.image, columns[index] - teamTierSize / 2, teamTierY, teamTierSize, teamTierSize);
      ctx.restore();
    }
    if (!team.custom && model.showTeamTierEmblems && team.tier) {
      ctx.fillStyle = "#c69a4b";
      ctx.font = `900 ${compact ? 14 : 15}px "KBO Dia Gothic", sans-serif`;
      ctx.fillText(`TEAM TIER · ${team.tier.label}`, columns[index], teamLabelY);
    }
  });
  const hasGameDetail = Boolean(model.tournamentName || model.periodScores.length);
  if (hasGameDetail) {
    const centerTop = compact ? 900 : 1350;
    ctx.textAlign = "center";
    ctx.fillStyle = "#d6a522";
    ctx.font = `900 ${compact ? 13 : 16}px "KBO Dia Gothic", sans-serif`;
    if (model.tournamentName) ctx.fillText(model.tournamentName, width / 2, centerTop);
    ctx.fillStyle = "#d7c8b5";
    ctx.font = `800 ${compact ? 12 : 15}px "KBO Dia Gothic", sans-serif`;
    model.periodScores.forEach(([label, home, away], index) => {
      const y = centerTop + (model.tournamentName ? 28 : 0) + index * (compact ? 22 : 27);
      ctx.fillText(`${label}  ${home ?? "-"} : ${away ?? "-"}`, width / 2, y);
    });
  } else {
    ctx.strokeStyle = "rgba(240,90,42,.7)";
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(width / 2, compact ? 805 : teamTop);
    ctx.lineTo(width / 2, receiptTop - 38);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.drawImage(paper, 0, receiptTop, width, height - receiptTop - (compact ? 26 : 34));
  ctx.restore();
  const footerY = receiptTop + (compact ? 78 : 66);
  const footerLeftDivider = compact ? 386 : 409;
  const footerRightDivider = compact ? 690 : 708;
  const footerLeftX = compact ? 220 : 236;
  const footerMiddleX = compact ? 540 : 558;
  const footerRightX = compact ? 850 : 862;
  const footerMiddleDividerOffset = compact ? 126 : 177;
  const footerDateOffset = compact ? 174 : 244;
  const footerCommentOffset = footerDateOffset;
  const footerTierLabelOffset = footerDateOffset + (compact ? 36 : 42);
  const hasSingleGameInfoMeta = !model.hasPersonalStats
    && Boolean(model.comment) !== Boolean(personalTier);

  ctx.strokeStyle = "rgba(195,74,37,.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.moveTo(footerLeftDivider, footerY - (compact ? 4 : 26));
  ctx.lineTo(footerLeftDivider, height - 58);
  ctx.moveTo(footerRightDivider, footerY - (compact ? 4 : 26));
  ctx.lineTo(footerRightDivider, height - 58);
  ctx.moveTo(compact ? 70 : 80, footerY + (compact ? 126 : 177));
  ctx.lineTo(compact ? 362 : 380, footerY + (compact ? 126 : 177));
  ctx.moveTo(compact ? 420 : 445, footerY + footerMiddleDividerOffset);
  ctx.lineTo(compact ? 660 : 680, footerY + footerMiddleDividerOffset);
  ctx.stroke();
  ctx.setLineDash([]);

  drawCanvasMapPin(ctx, footerLeftX, footerY + (compact ? -5 : 18), compact ? 34 : 50);

  ctx.fillStyle = "#151515";
  ctx.textAlign = "center";
  ctx.font = `900 ${compact ? 22 : 25}px "KBO Dia Gothic", sans-serif`;
  const locationLines = wrapCanvasText(ctx, model.locationLabel || "경기 장소", compact ? 292 : 310, 3);
  const locationLineHeight = compact ? 23 : 32;
  const locationStartY = footerY + (compact ? 58 : 112) - (locationLines.length - 1) * locationLineHeight / 2;
  locationLines.forEach((line, index) => ctx.fillText(line, footerLeftX, locationStartY + index * locationLineHeight, 320));
  ctx.fillStyle = "#d4582b";
  ctx.font = '900 27px "KBO Dia Gothic", sans-serif';
  ctx.fillText(model.playedOn.replaceAll("-", "."), footerLeftX, footerY + footerDateOffset);

  if (personalTier) {
    const tierSize = compact ? 150 : 192;
    ctx.save();
    ctx.globalAlpha = 0.64;
    ctx.drawImage(personalTier, footerMiddleX - tierSize / 2, footerY - 16, tierSize, tierSize);
    ctx.restore();
  }

  ctx.fillStyle = "#d4582b";
  ctx.font = '900 25px "KBO Dia Gothic", sans-serif';
  const gameTitleOffset = compact ? 10 : 30;
  ctx.fillText(model.hasPersonalStats ? "MY GAME" : "GAME INFO", footerMiddleX, footerY + gameTitleOffset);

  if (model.hasPersonalStats) {
    ctx.fillStyle = "#151515";
    ctx.font = '900 62px "KBO Dia Gothic", sans-serif';
    ctx.fillText(`${model.personalPoints ?? 0}`, compact ? 480 : 505, footerY + (compact ? 78 : 132));
    ctx.fillText(`${model.personalRebounds ?? 0}`, compact ? 600 : 620, footerY + (compact ? 78 : 132));
    ctx.font = '900 20px "KBO Dia Gothic", sans-serif';
    ctx.fillText("PTS", compact ? 480 : 505, footerY + (compact ? 110 : 166));
    ctx.fillText("REB", compact ? 600 : 620, footerY + (compact ? 110 : 166));
    ctx.strokeStyle = "rgba(195,74,37,.7)";
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(footerMiddleX, footerY + (compact ? 30 : 70));
    ctx.lineTo(footerMiddleX, footerY + (compact ? 116 : 180));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#151515";
    ctx.font = '900 18px "KBO Dia Gothic", sans-serif';
  } else {
    ctx.fillStyle = "#151515";
    ctx.font = `900 ${compact ? 36 : 42}px "Bebas Neue", "KBO Dia Gothic", sans-serif`;
    ctx.fillText(getMatchReceiptFormatLabel(model.format), footerMiddleX, footerY + (compact ? 64 : 96), 260);
    ctx.fillStyle = "#71451f";
    ctx.font = '900 18px "KBO Dia Gothic", sans-serif';
    ctx.fillText(model.matchNatureLabel, footerMiddleX, footerY + (compact ? 101 : 132), 260);
  }

  if (model.comment) {
    ctx.fillStyle = "#151515";
    ctx.font = '900 22px "KBO Dia Gothic", sans-serif';
    ctx.fillText(model.comment, footerMiddleX, footerY + footerCommentOffset, 260);
  }

  if (personalTier) {
    ctx.fillStyle = "#71451f";
    ctx.font = `900 ${compact ? 17 : 20}px "KBO Dia Gothic", sans-serif`;
    ctx.fillText(`MY TIER · ${model.personalTier.label}`, footerMiddleX, footerY + (hasSingleGameInfoMeta ? footerDateOffset : footerTierLabelOffset), 250);
  }

  if (model.matchUrl) {
    const qrSize = compact ? 216 : 270;
    ctx.fillStyle = "#d4582b";
    ctx.font = '900 22px "KBO Dia Gothic", sans-serif';
    ctx.fillText("경기 기록 보기", footerRightX, footerY + gameTitleOffset);
    drawQrCode(ctx, model.matchUrl, footerRightX - qrSize / 2, footerY + (compact ? 6 : 28), qrSize);
  } else {
    ctx.fillStyle = "#d4582b";
    ctx.font = '900 23px "KBO Dia Gothic", sans-serif';
    ctx.fillText("boxtier.kr", footerRightX, footerY + 76);
  }

  return canvas;
}

export async function renderMatchReceiptPng(value, preset = "story", options = {}) {
  const canvas = await renderMatchReceiptCanvas(value, preset, options);
  return canvasToBlob(canvas, "image/png");
}

export function trackMatchReceiptEvent(name, detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("boxtier:analytics", { detail: { event: name, ...detail } }));
}
