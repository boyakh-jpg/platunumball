import { RECORD_TYPES } from "./constants.js";
import { assetUrl, BOXTIER_LETTER_DARK_URL, BOXTIER_LOGO_URL } from "./assets.js";
import { createQrMatrix } from "./qrCode.js";
import { getTier, getTierDivision } from "./tier.js";

export const MATCH_RECEIPT_DRAFT_STORAGE_KEY = "boxtier.match-receipt.draft.v1";
export const MATCH_RECEIPT_CREATE_RETURN_TO = "/app/create?intent=record&source=receipt";
export const MATCH_RECEIPT_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const MATCH_RECEIPT_DRAFT_VERSION = 2;
const MATCH_RECEIPT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const PHOTO_DB_NAME = "boxtier-match-receipt";
const PHOTO_STORE_NAME = "photos";
const PHOTO_KEY = "current";

export const MATCH_RECEIPT_LIMITS = Object.freeze({
  teamName: 24,
  venue: 36,
  address: 48,
  comment: 60,
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

export const MATCH_RECEIPT_PHOTO_ASPECT = 1080 / 860;

export function getMatchReceiptRotationCoverScale(rotation, aspect = MATCH_RECEIPT_PHOTO_ASPECT) {
  const radians = Math.abs(Number(rotation) || 0) * Math.PI / 180;
  const safeAspect = Math.max(0.01, Number(aspect) || MATCH_RECEIPT_PHOTO_ASPECT);
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return Math.max(cosine + sine / safeAspect, cosine + sine * safeAspect);
}

export function getMatchReceiptPhotoStyle(value, aspect = MATCH_RECEIPT_PHOTO_ASPECT) {
  const draft = normalizeMatchReceiptDraft(value);
  return {
    "--receipt-photo-position-x": `${50 - draft.photoX / 2}%`,
    "--receipt-photo-position-y": `${50 - draft.photoY / 2}%`,
    "--receipt-photo-scale": getMatchReceiptRotationCoverScale(draft.photoRotation, aspect) * draft.photoZoom,
    "--receipt-photo-rotation": `${draft.photoRotation}deg`,
  };
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
const MATCH_RECEIPT_PAPER_URL = assetUrl("/assets/match-receipt-paper-torn-v1.png");

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

export function createDefaultMatchReceiptDraft() {
  return {
    homeTeam: "",
    awayTeam: "",
    homeScore: 0,
    awayScore: 0,
    playedOn: todayInKorea(),
    venue: "",
    address: "",
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
    homeTeam: cleanText(value.homeTeam, MATCH_RECEIPT_LIMITS.teamName),
    awayTeam: cleanText(value.awayTeam, MATCH_RECEIPT_LIMITS.teamName),
    homeScore: cleanScore(value.homeScore),
    awayScore: cleanScore(value.awayScore),
    playedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(value.playedOn ?? "")) ? String(value.playedOn) : todayInKorea(),
    venue: cleanText(value.venue, MATCH_RECEIPT_LIMITS.venue),
    address: cleanText(value.address, MATCH_RECEIPT_LIMITS.address),
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
  return { draft, errors, valid: Object.keys(errors).length === 0 };
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

export function getMatchReceiptDraftFromMatch(match = {}, style = {}, court = null) {
  const summary = match.rules?.recordSummary ?? {};
  const memo = match.memo === "혼자 저장한 개인 기록입니다." ? "" : match.memo;
  const playerStats = match.result?.playerStats?.[style.currentUserId] ?? {};
  const verified = match.status === "confirmed" && match.recordType !== RECORD_TYPES.personalRecord;
  return normalizeMatchReceiptDraft({
    homeTeam: match.teamA?.name || summary.teamAName || "",
    awayTeam: match.teamB?.name || summary.teamBName || "",
    homeScore: match.result?.scoreA ?? match.teamA?.score ?? 0,
    awayScore: match.result?.scoreB ?? match.teamB?.score ?? 0,
    playedOn: String(match.scheduledDate ?? "").slice(0, 10),
    format: MATCH_RECEIPT_FORMATS.some(({ value }) => value === match.mode) ? match.mode : "other",
    matchNature: inferMatchReceiptNature(match, style.tournament),
    venue: court?.name ?? (match.court && match.court !== "미정" ? match.court : ""),
    address: court?.address ?? style.address ?? "",
    comment: memo,
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
  return draft.homeScore > draft.awayScore ? { key: "home", label: "HOME WIN" } : { key: "away", label: "AWAY WIN" };
}

export function getMatchReceiptCanvasSize(preset = "story") {
  return MATCH_RECEIPT_CANVAS_SIZES[preset] ?? MATCH_RECEIPT_CANVAS_SIZES.story;
}

export function getMatchReceiptFileName(value, preset = "story") {
  const draft = normalizeMatchReceiptDraft(value);
  return `boxtier-match-receipt-${draft.playedOn.replaceAll("-", "")}-${preset}.png`;
}

export function getMatchReceiptFormatLabel(format) {
  return MATCH_RECEIPT_FORMATS.find((item) => item.value === format)?.label ?? "기타";
}

export function getMatchReceiptNatureLabel(matchNature) {
  return MATCH_RECEIPT_NATURES.find((item) => item.value === matchNature)?.label ?? "COMPETITIVE";
}

function receiptNumber(draft) {
  const input = `${draft.playedOn}|${draft.homeTeam}|${draft.awayTeam}|${draft.homeScore}|${draft.awayScore}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `BT-${draft.playedOn.replaceAll("-", "")}-${(hash >>> 0).toString(36).toUpperCase().padStart(4, "0").slice(-4)}`;
}

function getTierVisual(mmr) {
  if (!Number.isFinite(mmr)) return null;
  const tier = getTier(mmr);
  return {
    label: getTierDivision(mmr).toUpperCase(),
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
    serial: options.publicId ? `NO. ${options.publicId}` : receiptNumber(draft),
    matchUrl: String(options.matchUrl ?? ""),
    logoUrl: BOXTIER_LOGO_URL,
    wordmarkUrl: BOXTIER_LETTER_DARK_URL,
    defaultPhotoUrl: assetUrl("/assets/rankball-record-create-night-v2.webp"),
    paperUrl: MATCH_RECEIPT_PAPER_URL,
    homeTier: getTierVisual(draft.homeMmr),
    awayTier: getTierVisual(draft.awayMmr),
    personalTier: getTierVisual(draft.personalMmr),
    matchNatureLabel: getMatchReceiptNatureLabel(draft.matchNature),
    hasPersonalStats,
    showTeamTierEmblems: draft.verified && draft.hasCanonicalTeamMatch,
  };
}

function loadCanvasImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const temporaryUrl = source instanceof Blob ? URL.createObjectURL(source) : "";
    image.onload = () => {
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
      resolve(image);
    };
    image.onerror = () => {
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
      reject(new Error("match_receipt_image_failed"));
    };
    image.src = temporaryUrl || source;
  });
}

function drawCoverPhoto(ctx, image, rect, draft) {
  const rotation = draft.photoRotation * Math.PI / 180;
  const cover = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const width = image.naturalWidth * cover;
  const height = image.naturalHeight * cover;
  const positionX = (100 - draft.photoX) / 200;
  const positionY = (100 - draft.photoY) / 200;
  const frame = document.createElement("canvas");
  frame.width = rect.width;
  frame.height = rect.height;
  const frameCtx = frame.getContext("2d");
  if (!frameCtx) throw new Error("match_receipt_canvas_unavailable");
  frameCtx.filter = "brightness(0.78) contrast(1.08) saturate(0.92)";
  frameCtx.drawImage(image, -(width - rect.width) * positionX, -(height - rect.height) * positionY, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
  ctx.rotate(rotation);
  const scale = getMatchReceiptRotationCoverScale(draft.photoRotation, rect.width / rect.height) * draft.photoZoom;
  ctx.scale(scale, scale);
  ctx.drawImage(frame, -rect.width / 2, -rect.height / 2);
  ctx.restore();
}

function fitCanvasText(ctx, text, maxWidth, initialSize, minimumSize = 28) {
  let size = initialSize;
  while (size > minimumSize) {
    ctx.font = `900 ${size}px "KBO Dia Gothic", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function drawQrCode(ctx, value, x, y, size) {
  const matrix = createQrMatrix(value);
  const quietZone = 4;
  const scale = Math.max(1, Math.floor(size / (matrix.length + quietZone * 2)));
  const actualSize = (matrix.length + quietZone * 2) * scale;
  ctx.fillStyle = "#f1e8db";
  ctx.fillRect(x, y, actualSize, actualSize);
  ctx.fillStyle = "#111111";
  matrix.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    if (cell) ctx.fillRect(x + (columnIndex + quietZone) * scale, y + (rowIndex + quietZone) * scale, scale, scale);
  }));
  return actualSize;
}

export async function renderMatchReceiptPng(value, preset = "story", options = {}) {
  if (typeof document === "undefined") throw new Error("match_receipt_canvas_unavailable");
  const model = createMatchReceiptViewModel(value, options);
  const { width, height } = getMatchReceiptCanvasSize(preset);
  const compact = preset === "feed";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("match_receipt_canvas_unavailable");
  await document.fonts?.ready;

  const photoHeight = compact ? 610 : 885;
  const receiptTop = compact ? 1010 : 1500;
  const [photo, wordmark, homeTier, awayTier, personalTier, paper] = await Promise.all([
    loadCanvasImage(options.photoBlob || model.defaultPhotoUrl),
    loadCanvasImage(model.wordmarkUrl).catch(() => null),
    model.showTeamTierEmblems && model.homeTier ? loadCanvasImage(model.homeTier.outlineSrc).catch(() => null) : null,
    model.showTeamTierEmblems && model.awayTier ? loadCanvasImage(model.awayTier.outlineSrc).catch(() => null) : null,
    model.personalTier ? loadCanvasImage(model.personalTier.outlineSrc).catch(() => null) : null,
    loadCanvasImage(model.paperUrl),
  ]);

  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, width, height);
  drawCoverPhoto(ctx, photo, { x: 0, y: 0, width, height: photoHeight }, model);

  const blurredPhoto = document.createElement("canvas");
  blurredPhoto.width = width;
  blurredPhoto.height = photoHeight;
  blurredPhoto.getContext("2d")?.drawImage(canvas, 0, 0, width, photoHeight, 0, 0, width, photoHeight);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, photoHeight * 0.58, width, photoHeight * 0.42);
  ctx.clip();
  ctx.filter = "blur(14px)";
  ctx.drawImage(blurredPhoto, 0, 0);
  ctx.restore();

  const photoFade = ctx.createLinearGradient(0, photoHeight * 0.5, 0, photoHeight + 60);
  photoFade.addColorStop(0, "rgba(12,12,12,0)");
  photoFade.addColorStop(0.42, "rgba(12,12,12,.16)");
  photoFade.addColorStop(0.76, "rgba(12,12,12,.64)");
  photoFade.addColorStop(1, "#111111");
  ctx.fillStyle = photoFade;
  ctx.fillRect(0, photoHeight * 0.5, width, photoHeight * 0.6);

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
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(150, verifiedY);
  ctx.lineTo(382, verifiedY);
  ctx.moveTo(698, verifiedY);
  ctx.lineTo(930, verifiedY);
  ctx.stroke();
  ctx.fillStyle = "#f05a2a";
  ctx.textAlign = "center";
  ctx.font = '900 30px "KBO Dia Gothic", sans-serif';
  ctx.fillText(model.verified ? "★  BOXTIER VERIFIED  ★" : "★  MATCH RECEIPT  ★", width / 2, verifiedY + 11);

  const scoreTop = verifiedY + 70;
  ctx.fillStyle = "#f1e8db";
  ctx.font = `900 ${compact ? 146 : 196}px "KBO Dia Gothic", sans-serif`;
  ctx.fillText(`${model.homeScore} : ${model.awayScore}`, width / 2, scoreTop + (compact ? 145 : 190));
  ctx.fillStyle = "#f05a2a";
  ctx.font = '900 31px "KBO Dia Gothic", sans-serif';
  ctx.fillText(model.matchNatureLabel, width / 2, scoreTop + 7);

  const teamY = compact ? 825 : 1145;
  const teamTierSize = compact ? 110 : 180;
  const columns = [270, 810];
  const teams = [
    { name: model.homeTeam || "HOME TEAM", tier: model.homeTier, image: homeTier },
    { name: model.awayTeam || "AWAY TEAM", tier: model.awayTier, image: awayTier },
  ];
  teams.forEach((team, index) => {
    ctx.fillStyle = "#f1e8db";
    ctx.textAlign = "center";
    fitCanvasText(ctx, team.name, 430, compact ? 44 : 54, 28);
    ctx.fillText(team.name, columns[index], teamY);
    if (team.image) {
      ctx.drawImage(team.image, columns[index] - teamTierSize / 2, teamY + 28, teamTierSize, teamTierSize);
    }
    if (model.showTeamTierEmblems && team.tier) {
      ctx.fillStyle = "#c69a4b";
      ctx.font = '900 23px "KBO Dia Gothic", sans-serif';
      ctx.fillText(`TEAM TIER · ${team.tier.label}`, columns[index], teamY + (compact ? 165 : 235));
    }
  });
  ctx.strokeStyle = "rgba(240,90,42,.7)";
  ctx.setLineDash([4, 8]);
  ctx.beginPath();
  ctx.moveTo(width / 2, teamY - 20);
  ctx.lineTo(width / 2, receiptTop - 38);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.drawImage(paper, 28, receiptTop, width - 56, height - receiptTop - 26);
  ctx.restore();
  const footerY = receiptTop + (compact ? 78 : 54);

  ctx.strokeStyle = "rgba(195,74,37,.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.moveTo(386, footerY - 4);
  ctx.lineTo(386, height - 58);
  ctx.moveTo(690, footerY - 4);
  ctx.lineTo(690, height - 58);
  ctx.moveTo(70, footerY + 126);
  ctx.lineTo(362, footerY + 126);
  ctx.moveTo(420, footerY + 137);
  ctx.lineTo(660, footerY + 137);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#d4582b";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(220, footerY + 12, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#d4582b";
  ctx.beginPath();
  ctx.arc(220, footerY + 12, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#151515";
  ctx.textAlign = "center";
  ctx.font = '900 25px "KBO Dia Gothic", sans-serif';
  ctx.fillText(model.address || "경기 장소", 220, footerY + 64, 320);
  ctx.fillText(model.venue || "", 220, footerY + 96, 320);
  ctx.font = '900 27px "KBO Dia Gothic", sans-serif';
  ctx.fillText(model.playedOn.replaceAll("-", "."), 220, footerY + 174);

  if (personalTier) {
    const tierSize = compact ? 142 : 190;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.drawImage(personalTier, 540 - tierSize / 2, footerY - 12, tierSize, tierSize);
    ctx.restore();
  }

  if (personalTier) {
    ctx.fillStyle = "#d4582b";
    ctx.font = '900 25px "KBO Dia Gothic", sans-serif';
    ctx.fillText("MY GAME", 540, footerY + 10);
  }

  if (model.hasPersonalStats) {
    ctx.fillStyle = "#151515";
    ctx.font = '900 62px "KBO Dia Gothic", sans-serif';
    ctx.fillText(`${model.personalPoints ?? 0}`, 480, footerY + 78);
    ctx.fillText(`${model.personalRebounds ?? 0}`, 600, footerY + 78);
    ctx.font = '900 20px "KBO Dia Gothic", sans-serif';
    ctx.fillText("PTS", 480, footerY + 110);
    ctx.fillText("REB", 600, footerY + 110);
    ctx.strokeStyle = "rgba(195,74,37,.7)";
    ctx.setLineDash([3, 7]);
    ctx.beginPath();
    ctx.moveTo(540, footerY + 30);
    ctx.lineTo(540, footerY + 116);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#151515";
    ctx.font = '900 18px "KBO Dia Gothic", sans-serif';
    ctx.fillText("내 경기 기록", 540, footerY + 176);
  } else if (!personalTier) {
    ctx.fillStyle = "#d4582b";
    ctx.font = '900 25px "KBO Dia Gothic", sans-serif';
    ctx.fillText(getMatchReceiptFormatLabel(model.format), 540, footerY + 55);
    ctx.fillStyle = "#151515";
    ctx.font = '900 22px "KBO Dia Gothic", sans-serif';
    ctx.fillText(model.comment || model.outcome.label, 540, footerY + 100, 260);
  }

  if (model.matchUrl) {
    const qrSize = compact ? 160 : 190;
    ctx.fillStyle = "#d4582b";
    ctx.font = '900 22px "KBO Dia Gothic", sans-serif';
    ctx.fillText("경기 기록 보기", 850, footerY + 6);
    drawQrCode(ctx, model.matchUrl, 850 - qrSize / 2, footerY + 24, qrSize);
  } else {
    ctx.fillStyle = "#d4582b";
    ctx.font = '900 23px "KBO Dia Gothic", sans-serif';
    ctx.fillText("boxtier.kr", 850, footerY + 76);
  }

  return canvasToBlob(canvas, "image/png");
}

export function trackMatchReceiptEvent(name, detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("boxtier:analytics", { detail: { event: name, ...detail } }));
}
