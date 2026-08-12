import { RECORD_TYPES } from "./constants.js";
import { createQrMatrix } from "./qrCode.js";

export const MATCH_RECEIPT_DRAFT_STORAGE_KEY = "boxtier.match-receipt.draft.v1";
export const MATCH_RECEIPT_CREATE_RETURN_TO = "/app/create?intent=record&source=receipt";
const MATCH_RECEIPT_DRAFT_VERSION = 1;
const MATCH_RECEIPT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

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

export const MATCH_RECEIPT_CANVAS_SIZES = Object.freeze({
  story: Object.freeze({ width: 1080, height: 1920, label: "Story 1080×1920" }),
  feed: Object.freeze({ width: 1080, height: 1350, label: "Feed 1080×1350" }),
});

const DEFAULT_COLORS = Object.freeze({ home: "#f05a46", away: "#27354d" });

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

function cleanScore(value) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(MATCH_RECEIPT_LIMITS.score, Math.max(0, parsed));
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
    homeColor: DEFAULT_COLORS.home,
    awayColor: DEFAULT_COLORS.away,
    comment: "",
  };
}

export function normalizeMatchReceiptDraft(value = {}) {
  const format = MATCH_RECEIPT_FORMATS.some((item) => item.value === value.format) ? value.format : "3v3";
  return {
    homeTeam: cleanText(value.homeTeam, MATCH_RECEIPT_LIMITS.teamName),
    awayTeam: cleanText(value.awayTeam, MATCH_RECEIPT_LIMITS.teamName),
    homeScore: cleanScore(value.homeScore),
    awayScore: cleanScore(value.awayScore),
    playedOn: /^\d{4}-\d{2}-\d{2}$/.test(String(value.playedOn ?? ""))
      ? String(value.playedOn)
      : todayInKorea(),
    venue: cleanText(value.venue, MATCH_RECEIPT_LIMITS.venue),
    address: cleanText(value.address, MATCH_RECEIPT_LIMITS.address),
    format,
    homeColor: cleanColor(value.homeColor, DEFAULT_COLORS.home),
    awayColor: cleanColor(value.awayColor, DEFAULT_COLORS.away),
    comment: cleanText(value.comment, MATCH_RECEIPT_LIMITS.comment),
  };
}

function getMatchReceiptDraftStorage(storage) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
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
    if (
      value?.version !== MATCH_RECEIPT_DRAFT_VERSION
      || !Number.isFinite(savedAt)
      || Date.now() - savedAt > MATCH_RECEIPT_DRAFT_TTL_MS
    ) {
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
  return normalizeMatchReceiptDraft({
    homeTeam: match.teamA?.name || summary.teamAName || "",
    awayTeam: match.teamB?.name || summary.teamBName || "",
    homeScore: match.result?.scoreA ?? match.teamA?.score ?? 0,
    awayScore: match.result?.scoreB ?? match.teamB?.score ?? 0,
    playedOn: String(match.scheduledDate ?? "").slice(0, 10),
    format: MATCH_RECEIPT_FORMATS.some(({ value }) => value === match.mode) ? match.mode : "other",
    venue: court?.name ?? (match.court && match.court !== "미정" ? match.court : ""),
    address: court?.address ?? style.address ?? "",
    comment: memo,
    homeColor: style.homeColor,
    awayColor: style.awayColor,
  });
}

export function getMatchReceiptOutcome(value) {
  const draft = normalizeMatchReceiptDraft(value);
  if (draft.homeScore === draft.awayScore) return { key: "draw", label: "DRAW" };
  return draft.homeScore > draft.awayScore
    ? { key: "home", label: "HOME WIN" }
    : { key: "away", label: "AWAY WIN" };
}

export function getMatchReceiptCanvasSize(preset = "story") {
  return MATCH_RECEIPT_CANVAS_SIZES[preset] ?? MATCH_RECEIPT_CANVAS_SIZES.story;
}

export function getMatchReceiptFileName(value, preset = "story") {
  const draft = normalizeMatchReceiptDraft(value);
  const date = draft.playedOn.replaceAll("-", "");
  return `boxtier-match-receipt-${date}-${preset}.png`;
}

export function getMatchReceiptFormatLabel(format) {
  return MATCH_RECEIPT_FORMATS.find((item) => item.value === format)?.label ?? "기타";
}

function receiptNumber(draft) {
  const input = `${draft.playedOn}|${draft.homeTeam}|${draft.awayTeam}|${draft.homeScore}|${draft.awayScore}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `GUEST-${(hash >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7)}`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth, initialSize, minSize = 34) {
  let size = initialSize;
  do {
    ctx.font = `900 ${size}px "Pretendard Variable", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  } while (size > minSize);
  return minSize;
}

function drawMetaRow(ctx, label, value, x, y, width) {
  ctx.fillStyle = "#8d8981";
  ctx.font = '800 28px "Pretendard Variable", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText(label, x, y);
  ctx.fillStyle = "#18191a";
  ctx.font = '900 31px "Pretendard Variable", sans-serif';
  ctx.textAlign = "right";
  ctx.fillText(value, x + width, y);
}

function drawQrCode(ctx, value, x, y, size) {
  const matrix = createQrMatrix(value);
  const quietZone = 4;
  const moduleCount = matrix.length + quietZone * 2;
  const scale = Math.max(1, Math.floor(size / moduleCount));
  const actualSize = moduleCount * scale;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, actualSize, actualSize);
  ctx.fillStyle = "#050505";
  matrix.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (!cell) return;
      ctx.fillRect(
        x + (columnIndex + quietZone) * scale,
        y + (rowIndex + quietZone) * scale,
        scale,
        scale,
      );
    });
  });

  return actualSize;
}

export async function renderMatchReceiptPng(value, preset = "story", options = {}) {
  if (typeof document === "undefined") throw new Error("match_receipt_canvas_unavailable");
  const draft = normalizeMatchReceiptDraft(value);
  const matchId = String(options.matchId ?? "").trim();
  const matchUrl = String(options.matchUrl ?? "").trim();
  const { width, height } = getMatchReceiptCanvasSize(preset);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("match_receipt_canvas_unavailable");
  await document.fonts?.ready;

  const compact = preset === "feed";
  const paperX = 78;
  const paperY = compact ? 70 : 170;
  const paperWidth = width - paperX * 2;
  const paperHeight = compact ? 1210 : 1580;
  const contentX = paperX + 72;
  const contentWidth = paperWidth - 144;
  const scoreY = compact ? 520 : 680;
  const outcome = getMatchReceiptOutcome(draft);

  ctx.fillStyle = "#18191a";
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, height * 0.24, 40, width / 2, height * 0.24, 720);
  glow.addColorStop(0, `${outcome.key === "away" ? draft.awayColor : draft.homeColor}55`);
  glow.addColorStop(1, "#18191a00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.42)";
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 20;
  roundedRect(ctx, paperX, paperY, paperWidth, paperHeight, 30);
  ctx.fillStyle = "#f5f1e8";
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = draft.homeColor;
  ctx.fillRect(paperX, paperY, paperWidth / 2, 14);
  ctx.fillStyle = draft.awayColor;
  ctx.fillRect(paperX + paperWidth / 2, paperY, paperWidth / 2, 14);

  ctx.fillStyle = "#18191a";
  ctx.font = '900 48px "KBO Dia Gothic", "Pretendard Variable", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("BOXTIER", contentX, paperY + 92);
  ctx.fillStyle = "#f05a46";
  ctx.font = '900 25px "Pretendard Variable", sans-serif';
  ctx.textAlign = "right";
  ctx.fillText("MATCH RECEIPT", paperX + paperWidth - 72, paperY + 76);
  ctx.fillStyle = "#8d8981";
  ctx.font = '800 20px ui-monospace, monospace';
  ctx.fillText(matchId ? `MATCH-${matchId}` : receiptNumber(draft), paperX + paperWidth - 72, paperY + 110);

  ctx.strokeStyle = "rgba(24, 25, 26, 0.23)";
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 12]);
  ctx.beginPath();
  ctx.moveTo(contentX, paperY + 150);
  ctx.lineTo(contentX + contentWidth, paperY + 150);
  ctx.stroke();
  ctx.setLineDash([]);

  const teamY = paperY + (compact ? 258 : 305);
  const teamColumnWidth = contentWidth * 0.43;
  ctx.fillStyle = "#8d8981";
  ctx.font = '900 23px "Pretendard Variable", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("HOME", contentX, teamY - 44);
  ctx.textAlign = "right";
  ctx.fillText("AWAY", contentX + contentWidth, teamY - 44);

  ctx.fillStyle = "#18191a";
  ctx.textAlign = "left";
  fitText(ctx, draft.homeTeam || "HOME TEAM", teamColumnWidth, 58);
  ctx.fillText(draft.homeTeam || "HOME TEAM", contentX, teamY);
  ctx.textAlign = "right";
  fitText(ctx, draft.awayTeam || "AWAY TEAM", teamColumnWidth, 58);
  ctx.fillText(draft.awayTeam || "AWAY TEAM", contentX + contentWidth, teamY);

  ctx.font = `900 ${compact ? 182 : 208}px "KBO Dia Gothic", "Pretendard Variable", sans-serif`;
  ctx.fillStyle = "#18191a";
  ctx.textAlign = "center";
  ctx.fillText(`${draft.homeScore} : ${draft.awayScore}`, width / 2, paperY + (compact ? 480 : 580));

  roundedRect(ctx, width / 2 - 154, scoreY, 308, 72, 36);
  ctx.fillStyle = outcome.key === "draw" ? "#18191a" : outcome.key === "away" ? draft.awayColor : draft.homeColor;
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = '900 29px ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.fillText(outcome.label, width / 2, scoreY + 47);

  const metaTop = scoreY + (compact ? 155 : 190);
  const rowGap = compact ? 74 : 88;
  drawMetaRow(ctx, "DATE", draft.playedOn.replaceAll("-", "."), contentX, metaTop, contentWidth);
  drawMetaRow(ctx, "FORMAT", getMatchReceiptFormatLabel(draft.format), contentX, metaTop + rowGap, contentWidth);
  let nextY = metaTop + rowGap * 2;
  if (draft.venue) {
    drawMetaRow(ctx, "VENUE", `⌖ ${draft.venue}`, contentX, nextY, contentWidth);
    nextY += rowGap;
  }
  if (draft.address) {
    drawMetaRow(ctx, "ADDRESS", draft.address, contentX, nextY, contentWidth);
    nextY += rowGap;
  }

  if (draft.comment) {
    ctx.strokeStyle = "rgba(24, 25, 26, 0.16)";
    ctx.beginPath();
    ctx.moveTo(contentX, nextY + 8);
    ctx.lineTo(contentX + contentWidth, nextY + 8);
    ctx.stroke();
    ctx.fillStyle = "#18191a";
    ctx.font = '900 34px "Pretendard Variable", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(`“${draft.comment}”`, width / 2, nextY + 78, contentWidth);
  }

  const footerY = paperY + paperHeight - 126;
  const qrSize = compact ? 102 : 126;
  const qrActualSize = matchUrl
    ? drawQrCode(ctx, matchUrl, contentX, footerY - qrSize / 2, qrSize)
    : 0;
  const footerTextX = matchUrl
    ? contentX + qrActualSize + (contentWidth - qrActualSize) / 2
    : width / 2;
  ctx.fillStyle = "#f05a46";
  ctx.font = '900 30px "Pretendard Variable", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("오늘 농구, 증거 남김.", footerTextX, footerY);
  ctx.fillStyle = "#8d8981";
  ctx.font = '800 22px ui-monospace, monospace';
  ctx.fillText(matchUrl ? "SCAN TO OPEN MATCH" : "PRACTICE RECEIPT · boxtier.kr", footerTextX, footerY + 48);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("match_receipt_png_failed"));
    }, "image/png");
  });
}

export function trackMatchReceiptEvent(name, detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("boxtier:analytics", {
    detail: { event: name, ...detail },
  }));
}
