import { RECORD_TYPES } from "./constants.js";
import { isPersonalRecordMatch } from "../../shared/lib/matchRecordTypes.js";
import { assetUrl, BOXTIER_LETTER_DARK_URL, BOXTIER_LOGO_URL } from "./assets.js";
import { createQrMatrix } from "./qrCode.js";
import { getTier, getTierDivisionNumber } from "./tier.js";

export const MATCH_RECEIPT_DRAFT_STORAGE_KEY = "boxtier.match-receipt.draft.v1";
export const MATCH_RECEIPT_CREATE_RETURN_TO = "/app/create?intent=record&source=receipt";
export const MATCH_RECEIPT_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const MATCH_RECEIPT_DRAFT_VERSION = 2;
const MATCH_RECEIPT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const PHOTO_DB_NAME = "boxtier-match-receipt";
const PHOTO_STORE_NAME = "photos";
const PHOTO_KEY = "current";

export const MATCH_RECEIPT_LIMITS = Object.freeze({
  serialSeed: 96,
  teamName: 24,
  venue: 36,
  address: 48,
  originalAddress: 96,
  comment: 12,
  score: 999,
});

export const MATCH_RECEIPT_FORMATS = Object.freeze([
  { value: "3v3", label: "3대3" },
  { value: "5v5", label: "5대5" },
  { value: "other", label: "기타" },
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
const MATCH_RECEIPT_SCORE_DIGITS_URL = assetUrl("/assets/match-receipt-score-digits-v2.png");

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
    photoZoom: 1,
    photoX: 0,
    photoY: 0,
    photoRotation: 0,
    homeMmr: null,
    awayMmr: null,
    personalMmr: null,
    personalPoints: null,
    personalRebounds: null,
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
    photoZoom: clampNumber(value.photoZoom, 1, 3, 1),
    photoX: clampNumber(value.photoX, -100, 100),
    photoY: clampNumber(value.photoY, -100, 100),
    photoRotation: ((clampNumber(value.photoRotation, -10_000, 10_000) + 180) % 360 + 360) % 360 - 180,
    homeMmr: cleanOptionalNumber(value.homeMmr),
    awayMmr: cleanOptionalNumber(value.awayMmr),
    personalMmr: cleanOptionalNumber(value.personalMmr),
    personalPoints: cleanOptionalNumber(value.personalPoints),
    personalRebounds: cleanOptionalNumber(value.personalRebounds),
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
    if (![1, MATCH_RECEIPT_DRAFT_VERSION].includes(value?.version) || !Number.isFinite(savedAt) || Date.now() - savedAt > MATCH_RECEIPT_DRAFT_TTL_MS) {
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
  if (!draft.homeTeam.trim()) errors.homeTeam = "홈팀 이름을 입력해 주세요.";
  if (!draft.awayTeam.trim()) errors.awayTeam = "원정팀 이름을 입력해 주세요.";
  if (!draft.venue.trim()) errors.venue = "경기 장소를 입력해 주세요.";
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
    ...(draft.format === "3v3" || draft.format === "5v5" ? { mode: draft.format } : {}),
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
  const visibility = match?.visibility ?? match?.rules?.visibility;
  return match?.status === "confirmed"
    && visibility === "public"
    && !isPersonalRecordMatch(match);
}

export function getMatchReceiptDraftFromMatch(match = {}, style = {}, court = null) {
  const summary = match.rules?.recordSummary ?? {};
  const playerStats = match.result?.playerStats?.[style.currentUserId] ?? {};
  const verified = canCreatePublicMatchReceiptSnapshot(match);
  return normalizeMatchReceiptDraft({
    serialSeed: style.serialSeed,
    homeTeam: match.teamA?.name || summary.teamAName || "",
    awayTeam: match.teamB?.name || summary.teamBName || "",
    homeScore: match.result?.scoreA ?? match.teamA?.score ?? 0,
    awayScore: match.result?.scoreB ?? match.teamB?.score ?? 0,
    playedOn: String(match.scheduledDate ?? "").slice(0, 10),
    format: MATCH_RECEIPT_FORMATS.some(({ value }) => value === match.mode) ? match.mode : "other",
    matchNature: inferMatchReceiptNature(match, style.tournament),
    venue: court?.name ?? (match.court && match.court !== "미정" ? match.court : ""),
    address: style.address ?? "",
    originalAddress: court?.address ?? style.originalAddress ?? "",
    comment: style.comment ?? "",
    homeColor: style.homeColor,
    awayColor: style.awayColor,
    photoZoom: style.photoZoom,
    photoX: style.photoX,
    photoY: style.photoY,
    photoRotation: style.photoRotation,
    homeMmr: style.homeMmr ?? match.teamA?.mmr,
    awayMmr: style.awayMmr ?? match.teamB?.mmr,
    personalMmr: style.personalMmr,
    personalPoints: verified ? playerStats.points : null,
    personalRebounds: verified ? playerStats.rebounds : null,
    hasCanonicalTeamMatch: Boolean(
      (match.teamA?.teamId ?? match.teamAId)
      && (match.teamB?.teamId ?? match.teamBId)
    ),
    verified,
  });
}

export function getMatchReceiptOutcome(value) {
  const draft = normalizeMatchReceiptDraft(value);
  if (draft.homeScore === draft.awayScore) return { key: "draw", label: "DRAW" };
  const winner = draft.homeScore > draft.awayScore
    ? { key: "home", name: draft.homeTeam || "HOME TEAM" }
    : { key: "away", name: draft.awayTeam || "AWAY TEAM" };
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
  if (format === "3v3") return "3v3";
  if (format === "5v5") return "5v5";
  return "OTHER";
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
  const hasPersonalStats = draft.verified && (draft.personalPoints !== null || draft.personalRebounds !== null);
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
    homeTier: getTierVisual(draft.homeMmr),
    awayTier: getTierVisual(draft.awayMmr),
    personalTier: getTierVisual(draft.personalMmr),
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
  const cellWidth = atlas.naturalWidth / 10;
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

function drawQrCode(ctx, value, x, y, size) {
  const matrix = createQrMatrix(value);
  const quietZone = 4;
  const scale = Math.max(1, Math.floor(size / (matrix.length + quietZone * 2)));
  const actualSize = (matrix.length + quietZone * 2) * scale;
  ctx.fillStyle = "#111111";
  matrix.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    if (!cell) return;
    const moduleX = x + (columnIndex + quietZone) * scale;
    const moduleY = y + (rowIndex + quietZone) * scale;
    ctx.beginPath();
    ctx.roundRect(moduleX + scale * 0.03, moduleY + scale * 0.03, scale * 0.94, scale * 0.94, scale * 0.18);
    ctx.fill();
  }));
  ctx.fillStyle = "#d4582b";
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
  const badgeSize = actualSize * 0.14;
  const badgeInset = badgeSize * 0.14;
  const badgeX = x + (actualSize - badgeSize) / 2;
  const badgeY = y + (actualSize - badgeSize) / 2;
  ctx.fillStyle = "#f1e8db";
  ctx.fillRect(badgeX, badgeY, badgeSize, badgeSize);
  ctx.fillStyle = "#d4582b";
  ctx.fillRect(
    badgeX + badgeInset,
    badgeY + badgeInset,
    badgeSize - badgeInset * 2,
    badgeSize - badgeInset * 2,
  );
  ctx.fillStyle = "#f1e8db";
  ctx.font = `900 ${badgeSize * 0.58}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("B", x + actualSize / 2, y + actualSize / 2 + badgeSize * 0.04);
  ctx.textBaseline = "alphabetic";
  return actualSize;
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
  const [photo, wordmark, homeTier, awayTier, homeNeutralTeamMark, awayNeutralTeamMark, personalTier, paper, paperGrain, scoreDigits] = await Promise.all([
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
    { name: model.homeTeam || "HOME TEAM", tier: model.homeTier, image: homeTier || homeNeutralTeamMark },
    { name: model.awayTeam || "AWAY TEAM", tier: model.awayTier, image: awayTier || awayNeutralTeamMark },
  ];
  const teamWatermarkSize = compact ? 450 : 600;
  const teamWatermarkY = compact ? 510 : 810;
  teams.forEach((team, index) => {
    if (!team.image) return;
    ctx.save();
    ctx.globalAlpha = model.showTeamTierEmblems && team.tier ? 0.24 : 0.2;
    ctx.filter = "grayscale(1) sepia(.55) brightness(.48)";
    const centerX = index ? width - 72 : 72;
    ctx.drawImage(team.image, centerX - teamWatermarkSize / 2, teamWatermarkY, teamWatermarkSize, teamWatermarkSize);
    ctx.restore();
  });

  const scoreTop = verifiedY + 70;
  const scoreDigitHeight = compact ? 154 : 278;
  const scoreBaseline = compact ? scoreTop + 132 : 1163;
  drawCanvasScoreDigits(ctx, scoreDigits, model.homeScore, columns[0], scoreBaseline - scoreDigitHeight, scoreDigitHeight, 430);
  drawCanvasScoreDigits(ctx, scoreDigits, model.awayScore, columns[1], scoreBaseline - scoreDigitHeight, scoreDigitHeight, 430);
  ctx.save();
  ctx.fillStyle = paperTextPattern;
  ctx.font = `900 ${scoreDigitHeight}px "Anton", "Bebas Neue", sans-serif`;
  ctx.fillText(":", width / 2, scoreBaseline);
  ctx.restore();
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
    if (model.showTeamTierEmblems && team.tier) {
      ctx.fillStyle = "#c69a4b";
      ctx.font = `900 ${compact ? 14 : 15}px "KBO Dia Gothic", sans-serif`;
      ctx.fillText(`TEAM TIER · ${team.tier.label}`, columns[index], teamLabelY);
    }
  });
  ctx.strokeStyle = "rgba(240,90,42,.7)";
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.moveTo(width / 2, compact ? 805 : teamTop);
  ctx.lineTo(width / 2, receiptTop - 38);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.drawImage(paper, 28, receiptTop, width - 56, height - receiptTop - (compact ? 26 : 34));
  ctx.restore();
  drawCanvasPaperGrain(ctx, paperGrain, {
    x: 40,
    y: receiptTop + 20,
    width: width - 80,
    height: height - receiptTop - (compact ? 45 : 55),
  }, { alpha: 0.24, blend: "multiply" });
  const footerY = receiptTop + (compact ? 78 : 66);
  const footerLeftDivider = compact ? 386 : 414;
  const footerRightDivider = compact ? 690 : 711;
  const footerMiddleX = compact ? 540 : 562;
  const footerRightX = compact ? 850 : 876;

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
  ctx.moveTo(compact ? 420 : 445, footerY + (compact ? 137 : 209));
  ctx.lineTo(compact ? 660 : 680, footerY + (compact ? 137 : 209));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#d4582b";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(220, footerY + (compact ? 12 : 28), 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#d4582b";
  ctx.beginPath();
  ctx.arc(220, footerY + (compact ? 12 : 28), 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#151515";
  ctx.textAlign = "center";
  ctx.font = '900 25px "KBO Dia Gothic", sans-serif';
  const locationLines = wrapCanvasText(ctx, model.locationLabel || "경기 장소", 320, 3);
  const locationLineHeight = compact ? 28 : 34;
  const locationStartY = footerY + (compact ? 54 : 76) - (locationLines.length - 1) * locationLineHeight / 2;
  locationLines.forEach((line, index) => ctx.fillText(line, 220, locationStartY + index * locationLineHeight, 320));
  ctx.font = '900 27px "KBO Dia Gothic", sans-serif';
  ctx.fillText(model.playedOn.replaceAll("-", "."), 220, footerY + (compact ? 174 : 255));

  if (personalTier) {
    const tierSize = compact ? 158 : 208;
    ctx.save();
    ctx.globalAlpha = 0.64;
    ctx.drawImage(personalTier, footerMiddleX - tierSize / 2, footerY - 12, tierSize, tierSize);
    ctx.restore();
  }

  ctx.fillStyle = "#d4582b";
  ctx.font = '900 25px "KBO Dia Gothic", sans-serif';
  ctx.fillText(model.hasPersonalStats ? "MY GAME" : "GAME INFO", footerMiddleX, footerY + (compact ? 10 : 30));

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
    if (model.comment) ctx.fillText(model.comment, footerMiddleX, footerY + (compact ? 176 : 278), 260);
  } else {
    ctx.fillStyle = "#151515";
    ctx.font = `900 ${compact ? 36 : 42}px "Bebas Neue", "KBO Dia Gothic", sans-serif`;
    ctx.fillText(getMatchReceiptFormatLabel(model.format), footerMiddleX, footerY + (compact ? 64 : 104), 260);
    ctx.fillStyle = "#71451f";
    ctx.font = '900 18px "KBO Dia Gothic", sans-serif';
    ctx.fillText(model.matchNatureLabel, footerMiddleX, footerY + (compact ? 101 : 150), 260);
  }

  if (!model.hasPersonalStats && model.comment) {
    ctx.fillStyle = "#151515";
    ctx.font = '900 18px "KBO Dia Gothic", sans-serif';
    ctx.fillText(model.comment, footerMiddleX, footerY + (compact ? 176 : 278), 260);
  }

  if (personalTier) {
    ctx.fillStyle = "#71451f";
    ctx.font = `900 ${compact ? 17 : 20}px "KBO Dia Gothic", sans-serif`;
    ctx.fillText(`MY TIER · ${model.personalTier.label}`, footerMiddleX, footerY + (compact ? 153 : 225), 250);
  }

  if (model.matchUrl) {
    const qrSize = compact ? 176 : 218;
    ctx.fillStyle = "#d4582b";
    ctx.font = '900 22px "KBO Dia Gothic", sans-serif';
    ctx.fillText("경기 기록 보기", footerRightX, footerY + (compact ? 6 : 30));
    drawQrCode(ctx, model.matchUrl, footerRightX - qrSize / 2, footerY + (compact ? 24 : 54), qrSize);
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
