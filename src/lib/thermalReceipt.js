import { assetUrl } from "./assets.js";
import { createQrMatrix } from "./qrCode.js";
import {
  createThermalRandom,
  getMatchReceiptCommentLines,
  getThermalReceiptLayout,
  getThermalScoreSlotLayout,
  sanitizeMatchReceiptComment,
  THERMAL_PRINT_ROLES,
} from "../../shared/lib/thermalReceipt.js";
import { drawReceiptCoverPhoto } from "./receiptPhotoTransform.js";

export const THERMAL_RECEIPT_PHOTO_ASPECT = 684 / 288;

const PAPER = "#eeeae1";
const INK = "#151515";
const BRAND_FONT = '"Anton"';
const DATA_FONT_FAMILY = '"IBM Plex Mono"';
const DATA_FONT = `${DATA_FONT_FAMILY}, "NeoDunggeunmo", "Pretendard Variable", monospace`;
const DATA_FONT_WEIGHT = 400;
const SCORE_FONT_WEIGHT = 700;
const TEAM_DISPLAY_FONT = '"Bebas Neue"';
const TEAM_DISPLAY_FONT_WEIGHT = 900;
const KOREAN_FONT = '"NeoDunggeunmo", "Pretendard Variable", monospace';
const PANEL_RADIUS = 14;
const QR_QUIET_MODULES = 1;
const THERMAL_ASSET_ROOT = "/assets/thermal-receipt";
const THERMAL_ASSET_PATHS = Object.freeze({
  background: `${THERMAL_ASSET_ROOT}/charcoal-background-2048.png`,
  paper: `${THERMAL_ASSET_ROOT}/thermal-paper-texture-2048.png`,
  body: `${THERMAL_ASSET_ROOT}/thermal-ink-mask-body-2048.png`,
  team: `${THERMAL_ASSET_ROOT}/thermal-ink-mask-team-2048.png`,
  heavy: `${THERMAL_ASSET_ROOT}/thermal-ink-mask-heavy-2048.png`,
  photo: `${THERMAL_ASSET_ROOT}/thermal-ink-mask-photo-2048.png`,
  edge: `${THERMAL_ASSET_ROOT}/serration-edge-796x16.svg`,
});
const FIXED_NEUTRAL_EMBLEM_PATHS = Object.freeze({
  home: "/assets/tier-emblems/tier-neutral-home-outline-v5.png",
  away: "/assets/tier-emblems/tier-neutral-away-outline-v5.png",
});
const assetImagePromiseCache = new Map();

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadImage(source) {
  if (!source) return null;
  const temporary = source instanceof Blob;
  const url = temporary ? URL.createObjectURL(source) : String(source);
  try {
    const image = new Image();
    if (!url.startsWith("blob:") && !url.startsWith("data:")) image.crossOrigin = "anonymous";
    image.src = url;
    if (image.decode) await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    return image;
  } catch {
    return null;
  } finally {
    if (temporary) URL.revokeObjectURL(url);
  }
}

async function loadAssetImage(path) {
  if (!assetImagePromiseCache.has(path)) {
    assetImagePromiseCache.set(path, (async () => {
      const remote = assetUrl(path);
      const image = await loadImage(remote);
      return image || (remote !== path ? loadImage(path) : null);
    })());
  }
  const image = await assetImagePromiseCache.get(path);
  if (!image) assetImagePromiseCache.delete(path);
  return image;
}

function drawImageCover(ctx, image, x, y, width, height) {
  if (!image) return;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2;
  const sourceY = (image.naturalHeight - sourceHeight) / 2;
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function applyPrintMask(canvas, image, seed, role = "body") {
  const config = THERMAL_PRINT_ROLES[role] || THERMAL_PRINT_ROLES.body;
  if (!image || !config.mask) return;
  const ctx = canvas.getContext("2d");
  const random = createThermalRandom(`${seed}|${role}|mask`);
  const sourceWidth = Math.min(image.naturalWidth, canvas.width);
  const sourceHeight = Math.min(image.naturalHeight, canvas.height);
  const sourceX = Math.floor(random() * Math.max(1, image.naturalWidth - sourceWidth));
  const sourceY = Math.floor(random() * Math.max(1, image.naturalHeight - sourceHeight));
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.globalAlpha = config.opacity;
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(Math.max(0, radius), width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, safeRadius);
}

function fillMaskedPanel(ctx, box, role = "heavy") {
  const layer = createCanvas(Math.ceil(box.width), Math.ceil(box.height));
  const layerCtx = layer.getContext("2d");
  layerCtx.fillStyle = INK;
  roundedRectPath(layerCtx, 0, 0, layer.width, layer.height, PANEL_RADIUS);
  layerCtx.fill();
  applyPrintMask(layer, ctx.__thermalMasks?.[role], `${ctx.__thermalSeed}|${box.x}|${box.y}`, role);
  ctx.drawImage(layer, box.x, box.y);
}

function getThermalFont(text, font) {
  if (font) return font;
  return DATA_FONT;
}

function getThermalFontWeight(font, requestedWeight) {
  if (requestedWeight) return requestedWeight;
  if (font === DATA_FONT || font === KOREAN_FONT) return DATA_FONT_WEIGHT;
  if (font === TEAM_DISPLAY_FONT) return TEAM_DISPLAY_FONT_WEIGHT;
  return 800;
}

function fitText(ctx, text, maxWidth, start, minimum, font, weight) {
  const resolvedFont = getThermalFont(text, font);
  const resolvedWeight = getThermalFontWeight(resolvedFont, weight);
  let size = start;
  do {
    ctx.font = `${resolvedWeight} ${size}px ${resolvedFont}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  } while (size >= minimum);
  return minimum;
}

export function resolveThermalReceiptEmblemSources(model = {}, options = {}) {
  const uniqueSources = (sources) => [...new Set(sources.filter(Boolean))];
  return {
    home: uniqueSources([
      options.teamLineArtUrls?.home,
      model.teamEmblemUrls?.home,
      model.neutralTeamMarkUrls?.home,
      FIXED_NEUTRAL_EMBLEM_PATHS.home,
    ]),
    away: uniqueSources([
      options.teamLineArtUrls?.away,
      model.teamEmblemUrls?.away,
      model.neutralTeamMarkUrls?.away,
      FIXED_NEUTRAL_EMBLEM_PATHS.away,
    ]),
  };
}

async function loadFirstImage(sources) {
  for (const source of sources) {
    const image = await loadImage(source);
    if (image) return { image, source };
  }
  return null;
}

function splitThermalText(text, maxWidth, size, font = DATA_FONT, weight = DATA_FONT_WEIGHT) {
  const value = String(text || "").trim();
  if (!value) return [];
  const measuringContext = createCanvas(1, 1).getContext("2d");
  measuringContext.font = `${weight} ${size}px ${font}`;
  if (measuringContext.measureText(value).width <= maxWidth) return [value];

  let best = [value];
  let bestDifference = Infinity;
  for (let index = 1; index < value.length; index += 1) {
    const left = value.slice(0, index).trimEnd();
    const right = value.slice(index).trimStart();
    if (!left || !right) continue;
    const leftWidth = measuringContext.measureText(left).width;
    const rightWidth = measuringContext.measureText(right).width;
    if (leftWidth > maxWidth || rightWidth > maxWidth) continue;
    const wordBoundary = /\s/u.test(value[index - 1]) || /\s/u.test(value[index]);
    const difference = Math.abs(leftWidth - rightWidth) - (wordBoundary ? maxWidth : 0);
    if (difference < bestDifference) {
      best = [left, right];
      bestDifference = difference;
    }
  }
  return best;
}

function drawThermalText(ctx, text, x, y, options = {}) {
  const value = String(text ?? "");
  if (!value) return;
  const size = Math.max(10, Number(options.size) || 24);
  const scale = options.dotScale || (size >= 34 ? 2 : 1);
  const font = getThermalFont(value, options.font);
  const weight = getThermalFontWeight(font, options.weight);
  const measuringContext = createCanvas(1, 1).getContext("2d");
  measuringContext.font = `${weight} ${size}px ${font}`;
  const measuredWidth = measuringContext.measureText(value).width;
  const width = Math.max(2, Math.ceil((options.maxWidth || measuredWidth + 4) / scale));
  const height = Math.ceil((size * 1.45) / scale);
  const mask = createCanvas(width, height);
  const maskCtx = mask.getContext("2d", { willReadFrequently: true });
  maskCtx.fillStyle = "#fff";
  maskCtx.textBaseline = "middle";
  maskCtx.textAlign = options.align || "left";
  maskCtx.font = `${weight} ${size / scale}px ${font}`;
  const anchor = options.align === "center" ? width / 2 : options.align === "right" ? width : 0;
  maskCtx.fillText(value, anchor, height / 2, width);
  const pixels = maskCtx.getImageData(0, 0, width, height);
  const tone = options.color === PAPER ? [238, 234, 225] : [21, 21, 21];
  for (let index = 0; index < pixels.data.length; index += 4) {
    const printed = pixels.data[index + 3] >= 96;
    const alpha = printed ? 255 : 0;
    pixels.data[index] = tone[0];
    pixels.data[index + 1] = tone[1];
    pixels.data[index + 2] = tone[2];
    pixels.data[index + 3] = alpha;
  }
  maskCtx.putImageData(pixels, 0, 0);
  const role = options.printRole || "body";
  applyPrintMask(mask, ctx.__thermalMasks?.[role], `${ctx.__thermalSeed || "thermal"}|${value}|${Math.round(x)}|${Math.round(y)}`, role);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const targetWidth = width * scale;
  const targetHeight = height * scale;
  const left = options.align === "center" ? x - targetWidth / 2 : options.align === "right" ? x - targetWidth : x;
  const top = Math.round(y - targetHeight / 2);
  ctx.globalAlpha = 0.16;
  ctx.drawImage(mask, Math.round(left) + 1, top + 1, targetWidth, targetHeight);
  ctx.globalAlpha = 1;
  ctx.drawImage(mask, Math.round(left), top, targetWidth, targetHeight);
  ctx.restore();
}

function drawRule(ctx, x, y, width, dashed = false, color = INK) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [10, 7] : []);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
  ctx.restore();
}

function paperPath(ctx, paper) {
  const tooth = 12;
  ctx.beginPath();
  ctx.moveTo(paper.x, paper.y + tooth);
  for (let x = paper.x; x <= paper.x + paper.width; x += tooth) {
    ctx.lineTo(x + tooth / 2, paper.y);
    ctx.lineTo(x + tooth, paper.y + tooth);
  }
  ctx.lineTo(paper.x + paper.width, paper.y + paper.height - tooth);
  for (let x = paper.x + paper.width; x >= paper.x; x -= tooth) {
    ctx.lineTo(x - tooth / 2, paper.y + paper.height);
    ctx.lineTo(x - tooth, paper.y + paper.height - tooth);
  }
  ctx.closePath();
}

function drawBackdrop(ctx, background) {
  ctx.fillStyle = "#292927";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawImageCover(ctx, background, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

function drawPaper(ctx, layout, seed, textures) {
  const random = createThermalRandom(seed);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.48)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 12;
  paperPath(ctx, layout.paper);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.clip();
  drawImageCover(ctx, textures.paper, layout.paper.x, layout.paper.y, layout.paper.width, layout.paper.height);
  if (textures.edge) {
    ctx.drawImage(textures.edge, layout.paper.x, layout.paper.y, layout.paper.width, 16);
    ctx.save();
    ctx.translate(layout.paper.x + layout.paper.width, layout.paper.y + layout.paper.height);
    ctx.rotate(Math.PI);
    ctx.drawImage(textures.edge, 0, 0, layout.paper.width, 16);
    ctx.restore();
  }
  for (let index = 0; index < 4200; index += 1) {
    const alpha = 0.015 + random() * 0.025;
    ctx.fillStyle = `rgba(20,18,15,${alpha})`;
    ctx.fillRect(
      layout.paper.x + random() * layout.paper.width,
      layout.paper.y + random() * layout.paper.height,
      0.5 + random() * 1.5,
      0.5 + random() * 1.5,
    );
  }
  ctx.restore();
}

function ditherPhoto(image, draft) {
  const source = createCanvas(342, 144);
  const ctx = source.getContext("2d", { willReadFrequently: true });
  drawReceiptCoverPhoto(ctx, image, { x: 0, y: 0, width: source.width, height: source.height }, draft);
  const data = ctx.getImageData(0, 0, source.width, source.height);
  const levels = [];
  for (let index = 0; index < data.data.length; index += 4) {
    levels.push(data.data[index] * 0.2126 + data.data[index + 1] * 0.7152 + data.data[index + 2] * 0.0722);
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.06)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.94)] ?? 255;
  const gray = levels.map((value) => Math.max(0, Math.min(255, (value - low) * 255 / Math.max(1, high - low))));
  const widthPx = source.width;
  for (let index = 0; index < gray.length; index += 1) {
    const oldValue = gray[index];
    const nextValue = oldValue < 135 ? 0 : 255;
    const error = oldValue - nextValue;
    gray[index] = nextValue;
    if ((index + 1) % widthPx) gray[index + 1] += error * 7 / 16;
    if (index + widthPx >= gray.length) continue;
    if (index % widthPx) gray[index + widthPx - 1] += error * 3 / 16;
    gray[index + widthPx] += error * 5 / 16;
    if ((index + 1) % widthPx) gray[index + widthPx + 1] += error / 16;
  }
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    data.data[offset] = 16;
    data.data[offset + 1] = 16;
    data.data[offset + 2] = 16;
    data.data[offset + 3] = gray[index] === 0 ? 224 : 0;
  }
  ctx.clearRect(0, 0, source.width, source.height);
  ctx.putImageData(data, 0, 0);
  return source;
}

function drawPhoto(ctx, image, layout, draft) {
  if (!image || !layout.photo) return;
  const dithered = ditherPhoto(image, draft);
  applyPrintMask(dithered, ctx.__thermalMasks?.photo, `${ctx.__thermalSeed}|photo`, "photo");
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(dithered, layout.photo.x, layout.photo.y, layout.photo.width, layout.photo.height);
  const fade = ctx.createLinearGradient(0, layout.photo.y, 0, layout.photo.y + layout.photo.height);
  fade.addColorStop(0, PAPER);
  fade.addColorStop(0.055, "rgba(238,234,225,0)");
  fade.addColorStop(0.945, "rgba(238,234,225,0)");
  fade.addColorStop(1, PAPER);
  ctx.fillStyle = fade;
  ctx.fillRect(layout.photo.x, layout.photo.y, layout.photo.width, layout.photo.height);
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = INK;
  for (let y = layout.photo.y + 8; y < layout.photo.y + layout.photo.height; y += 19) ctx.fillRect(layout.photo.x, y, layout.photo.width, 1);
  ctx.restore();
}

function drawBrand(ctx, model, layout) {
  const center = layout.content.x + layout.content.width / 2;
  const serial = String(model.serial || "BT-000");
  drawThermalText(ctx, "BOXTIER", center, layout.brand.y + 48, { size: 76, font: BRAND_FONT, align: "center", maxWidth: 500, dotScale: 2 });
  drawThermalText(ctx, "BASKETBALL  GAME RECEIPT", center, layout.brand.y + 98, { size: 25, align: "center", maxWidth: 520 });
  drawThermalText(ctx, `MATCH NO. ${serial.replace(/^#?BT-?/i, "").slice(-3).padStart(3, "0")}`, center, layout.brand.y + 130, { size: 23, align: "center", maxWidth: 400 });
  drawRule(ctx, layout.content.x, layout.brand.y + layout.brand.height - 4, layout.content.width);
}

function drawEmblem(ctx, emblem, x, y, neutralSources) {
  const layer = createCanvas(184, 184);
  const layerCtx = layer.getContext("2d");
  const image = emblem?.image;
  const isNeutral = neutralSources.has(emblem?.source);
  if (isNeutral) {
    layerCtx.fillStyle = INK;
    layerCtx.beginPath();
    layerCtx.arc(92, 92, 69, 0, Math.PI * 2);
    layerCtx.fill();
  }
  if (image) {
    const bitmap = createCanvas(168, 168);
    const bitmapCtx = bitmap.getContext("2d", { willReadFrequently: true });
    const scale = Math.min(148 / image.naturalWidth, 148 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const drawX = (168 - width) / 2;
    const drawY = (168 - height) / 2;
    bitmapCtx.drawImage(image, drawX, drawY, width, height);
    const pixels = bitmapCtx.getImageData(0, 0, 168, 168);
    const minX = Math.max(0, Math.floor(drawX));
    const maxX = Math.min(168, Math.ceil(drawX + width));
    const minY = Math.max(0, Math.floor(drawY));
    const maxY = Math.min(168, Math.ceil(drawY + height));
    let artworkPixels = 0;
    let transparentArtworkPixels = 0;
    for (let pixelY = minY; pixelY < maxY; pixelY += 1) {
      for (let pixelX = minX; pixelX < maxX; pixelX += 1) {
        artworkPixels += 1;
        if (pixels.data[(pixelY * 168 + pixelX) * 4 + 3] < 32) transparentArtworkPixels += 1;
      }
    }
    const hasTransparentArtwork = artworkPixels > 0 && transparentArtworkPixels / artworkPixels >= 0.05;
    for (let index = 0; index < pixels.data.length; index += 4) {
      const alpha = pixels.data[index + 3];
      const luminance = pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722;
      pixels.data[index] = 21;
      pixels.data[index + 1] = 21;
      pixels.data[index + 2] = 21;
      pixels.data[index + 3] = alpha >= 64 && (hasTransparentArtwork || luminance < 184) ? 255 : 0;
    }
    bitmapCtx.putImageData(pixels, 0, 0);
    layerCtx.save();
    layerCtx.beginPath();
    layerCtx.arc(92, 92, 69, 0, Math.PI * 2);
    layerCtx.clip();
    layerCtx.imageSmoothingEnabled = false;
    if (isNeutral) layerCtx.globalCompositeOperation = "destination-out";
    layerCtx.drawImage(bitmap, 8, 8, 168, 168);
    layerCtx.restore();
  }
  layerCtx.strokeStyle = INK;
  layerCtx.beginPath();
  layerCtx.arc(92, 92, 82, 0, Math.PI * 2);
  layerCtx.lineWidth = 6;
  layerCtx.stroke();
  layerCtx.beginPath();
  layerCtx.arc(92, 92, 73, 0, Math.PI * 2);
  layerCtx.lineWidth = 2;
  layerCtx.stroke();
  applyPrintMask(layer, ctx.__thermalMasks?.team, `${ctx.__thermalSeed}|emblem|${x}|${y}`, "team");
  ctx.drawImage(layer, x - 92, y - 92);
}

function drawTeams(ctx, model, layout, emblems) {
  const y = layout.teams.y + 82;
  const left = layout.teams.x + 126;
  const right = layout.teams.x + layout.teams.width - 126;
  const neutralSources = new Set([
    model.neutralTeamMarkUrls?.home,
    model.neutralTeamMarkUrls?.away,
    FIXED_NEUTRAL_EMBLEM_PATHS.home,
    FIXED_NEUTRAL_EMBLEM_PATHS.away,
  ].filter(Boolean));
  drawEmblem(ctx, emblems.home, left, y, neutralSources);
  drawEmblem(ctx, emblems.away, right, y, neutralSources);
  drawThermalText(ctx, "VS", layout.teams.x + layout.teams.width / 2, y, { size: 48, align: "center", maxWidth: 88, dotScale: 2 });
  [[model.homeTeam || "Team A", left], [model.awayTeam || "Team B", right]].forEach(([name, x]) => {
    const font = /[ㄱ-ㅎㅏ-ㅣ가-힣]/u.test(String(name)) ? KOREAN_FONT : TEAM_DISPLAY_FONT;
    const weight = getThermalFontWeight(font);
    const size = fitText(ctx, name, 286, 44, 26, font, weight);
    drawThermalText(ctx, name, x, layout.teams.y + 188, { size, font, weight, align: "center", maxWidth: 286, dotScale: 2, printRole: "team" });
  });
}

function drawAngularScore(ctx, score, slotX, centerY, slotWidth, tone = PAPER, digitHeight = 158) {
  const metrics = getThermalScoreSlotLayout(score, { slotWidth, digitHeight });
  Array.from(metrics.score).forEach((digit, index) => {
    const x = slotX + metrics.x + metrics.glyphWidth / 2 + index * (metrics.glyphWidth + metrics.gap);
    drawThermalText(ctx, digit, x, centerY + 2, {
      size: metrics.height * 1.08,
      font: DATA_FONT,
      weight: SCORE_FONT_WEIGHT,
      align: "center",
      maxWidth: metrics.glyphWidth,
      dotScale: 2,
      color: tone,
      printRole: "heavy",
    });
  });
}

function drawAngularColon(ctx, slotX, centerY, slotWidth, height, tone = PAPER) {
  drawThermalText(ctx, ":", slotX + slotWidth / 2, centerY + 2, {
    size: height * 1.08,
    font: DATA_FONT,
    weight: SCORE_FONT_WEIGHT,
    align: "center",
    maxWidth: slotWidth,
    dotScale: 2,
    color: tone,
    printRole: "heavy",
  });
}

function drawScore(ctx, model, layout) {
  const box = layout.score;
  fillMaskedPanel(ctx, box);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 3;
  roundedRectPath(ctx, box.x + 9, box.y + 9, box.width - 18, box.height - 18, 10);
  ctx.stroke();
  const centerY = box.y + box.height / 2;
  drawAngularScore(ctx, model.homeScore, box.x, centerY, 284);
  drawAngularColon(ctx, box.x + 316, centerY, 52, 158);
  drawAngularScore(ctx, model.awayScore, box.x + 400, centerY, 284);
}

function drawInfo(ctx, model, layout) {
  const center = layout.info.x + layout.info.width / 2;
  const playedOn = String(model.playedOn || "").replaceAll("-", ".");
  const periodCount = Array.isArray(model.periodScores) && model.periodScores.length ? model.periodScores.length : 4;
  const nature = model.matchNatureLabel || "COMPETITIVE";
  drawThermalText(ctx, nature, center, layout.info.y + 23, { size: fitText(ctx, nature, 360, 34, 22), align: "center", maxWidth: 360, dotScale: 2 });
  drawThermalText(ctx, `${playedOn} · ${model.playedTime || ""}`, center, layout.info.y + 58, { size: 24, align: "center", maxWidth: 520 });
  drawThermalText(ctx, model.venue || model.address || "VENUE", center, layout.info.y + 88, { size: 26, align: "center", maxWidth: 620 });
  drawThermalText(ctx, `${String(model.format || "5v5").toUpperCase()} · ${periodCount} QUARTERS${model.refereeAssigned ? " · REFEREE" : ""}`, center, layout.info.y + 118, { size: 22, align: "center", maxWidth: 620 });
}

function drawPeriods(ctx, model, layout) {
  if (!layout.periods) return;
  const rows = model.periodScores.slice(0, 5).map((row, index) => Array.isArray(row)
    ? row
    : [
      row?.label || `Q${index + 1}`,
      row?.scoreA ?? row?.home ?? row?.teamA ?? "",
      row?.scoreB ?? row?.away ?? row?.teamB ?? "",
    ]);
  const labels = rows.map(([label]) => label);
  const x = layout.periods.x;
  const colWidth = 76;
  drawRule(ctx, x, layout.periods.y, layout.periods.width, true);
  drawThermalText(ctx, "TEAM", x, layout.periods.y + 30, { size: 21, maxWidth: 130 });
  labels.forEach((label, index) => drawThermalText(ctx, label, x + 214 + index * colWidth, layout.periods.y + 30, { size: 21, align: "center", maxWidth: 70 }));
  drawThermalText(ctx, "TOTAL", x + layout.periods.width, layout.periods.y + 30, { size: 21, align: "right", maxWidth: 90 });
  drawRule(ctx, x, layout.periods.y + 50, layout.periods.width, true);
  const teamNames = [model.homeTeam || "Team A", model.awayTeam || "Team B"];
  [0, 1].forEach((side) => {
    const rowY = layout.periods.y + 82 + side * 38;
    const size = fitText(ctx, teamNames[side], 150, 24, 16);
    drawThermalText(ctx, teamNames[side], x, rowY, { size, maxWidth: 150 });
    rows.forEach((row, index) => drawThermalText(ctx, row[side + 1] ?? "-", x + 214 + index * colWidth, rowY, { size: 22, align: "center", maxWidth: 70 }));
    drawThermalText(ctx, side ? model.awayScore : model.homeScore, x + layout.periods.width, rowY, { size: 23, align: "right", maxWidth: 90 });
  });
  drawRule(ctx, x, layout.periods.y + 146, layout.periods.width, true);
}

function drawResult(ctx, model, layout) {
  const box = layout.result;
  fillMaskedPanel(ctx, box);
  const homeName = model.homeTeam || "Team A";
  const awayName = model.awayTeam || "Team B";
  drawThermalText(ctx, homeName, box.x + 22, box.y + 28, { size: fitText(ctx, homeName, 250, 25, 16), maxWidth: 250, color: PAPER });
  drawThermalText(ctx, awayName, box.x + box.width - 22, box.y + 28, { size: fitText(ctx, awayName, 250, 25, 16), align: "right", maxWidth: 250, color: PAPER });
  ctx.fillStyle = PAPER;
  ctx.fillRect(box.x + 20, box.y + 47, box.width - 40, 1);
  const scoreY = box.y + 101;
  drawAngularScore(ctx, model.homeScore, box.x + 20, scoreY, 180, PAPER, 92);
  drawAngularColon(ctx, box.x + 202, scoreY, 34, 92, PAPER);
  drawAngularScore(ctx, model.awayScore, box.x + 238, scoreY, 180, PAPER, 92);
  drawThermalText(ctx, model.outcome.label, box.x + 22, box.y + 169, { size: 24, maxWidth: box.width - 44, color: PAPER });
  if (layout.hasComment) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(box.x + 22, box.y + 198, box.width - 44, 1);
    const lines = getMatchReceiptCommentLines(model.comment);
    lines.forEach((line, index) => {
      drawThermalText(ctx, line, box.x + 22, box.y + 226 + index * 30, { size: 21, maxWidth: box.width - 44, color: PAPER });
    });
  }
}

function drawQr(ctx, value, x, y, size) {
  if (!value) return;
  const matrix = createQrMatrix(value);
  const quiet = QR_QUIET_MODULES;
  const cells = matrix.length + quiet * 2;
  const inset = 8;
  const moduleSize = Math.floor((size - inset * 2) / cells);
  const actual = moduleSize * cells;
  const qrX = x + (size - actual) / 2;
  const qrY = y + (size - actual) / 2;
  ctx.fillStyle = PAPER;
  ctx.fillRect(qrX, qrY, actual, actual);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(qrX + 1, qrY + 1, actual - 2, actual - 2);
  ctx.fillStyle = INK;
  matrix.forEach((row, rowIndex) => row.forEach((dark, columnIndex) => {
    if (dark) ctx.fillRect(qrX + (columnIndex + quiet) * moduleSize, qrY + (rowIndex + quiet) * moduleSize, moduleSize, moduleSize);
  }));
}

function drawFooter(ctx, model, layout) {
  const x = layout.footer.x;
  const y = layout.footer.y;
  const url = model.matchUrl || "https://boxtier.kr";
  const matchId = model.officialMatchId || String(model.serial || "BT-000").replace(/^#/, "");
  drawThermalText(ctx, "PLAYERS", x, y + 26, { size: 22, maxWidth: 190 });
  drawThermalText(ctx, Number(model.playerCount) || 0, x + 200, y + 26, { size: 22, align: "right", maxWidth: 70 });
  drawRule(ctx, x, y + 44, 390, true);
  drawThermalText(ctx, `GAME ID   ${matchId}`, x, y + 72, { size: 21, maxWidth: 390 });
  drawRule(ctx, x, y + 90, 390, true);
  drawThermalText(ctx, `${model.verified ? "VERIFIED   YES" : "SELF-REPORTED"}`, x, y + 118, { size: 21, maxWidth: 390 });
  drawRule(ctx, x, y + 136, 390, true);
  drawThermalText(ctx, "boxtier.kr", x, y + 174, { size: 23, maxWidth: 240 });
  drawThermalText(ctx, "KEEP YOUR GAME.", x, y + 196, { size: 17, maxWidth: 240 });
  drawThermalText(ctx, "BOXTIER", x + 342, y + 214, { size: 42, font: BRAND_FONT, align: "center", maxWidth: 250, dotScale: 2 });
  drawThermalText(ctx, "SCAN MATCH", x + layout.footer.width - 108, y + 16, { size: 20, align: "center", maxWidth: 216 });
  drawQr(ctx, url, x + layout.footer.width - 216, y + 26, 216);
}

function normalizeThermalData(value, options) {
  const model = options.viewModel || value;
  const periodScores = Array.isArray(model.periodScores) ? model.periodScores : [];
  const sharedComment = sanitizeMatchReceiptComment(model.comment || model.receiptComment);
  return {
    ...model,
    comment: sharedComment,
    receiptComment: sharedComment,
    matchUrl: String(options.matchUrl || model.matchUrl || ""),
    periodScores,
  };
}

export async function renderThermalReceiptCanvas(value, preset = "story", options = {}) {
  await Promise.all([
    document.fonts?.load?.(`800 48px ${BRAND_FONT}`),
    document.fonts?.load?.(`${DATA_FONT_WEIGHT} 24px ${DATA_FONT_FAMILY}`),
    document.fonts?.load?.(`${SCORE_FONT_WEIGHT} 158px ${DATA_FONT_FAMILY}`),
    document.fonts?.load?.(`${TEAM_DISPLAY_FONT_WEIGHT} 44px ${TEAM_DISPLAY_FONT}`),
    document.fonts?.load?.(`${DATA_FONT_WEIGHT} 24px ${KOREAN_FONT}`),
  ]);
  await document.fonts?.ready;
  const model = normalizeThermalData(value, options);
  const renderSeed = model.serialSeed || model.serial || "thermal";
  const emblemSources = resolveThermalReceiptEmblemSources(model, options);
  const [photo, homeEmblem, awayEmblem, background, paper, bodyMask, teamMask, heavyMask, photoMask, edge] = await Promise.all([
    model.includePhoto ? loadImage(options.photoBlob || options.photoUrl) : null,
    loadFirstImage(emblemSources.home),
    loadFirstImage(emblemSources.away),
    loadAssetImage(THERMAL_ASSET_PATHS.background),
    loadAssetImage(THERMAL_ASSET_PATHS.paper),
    loadAssetImage(THERMAL_ASSET_PATHS.body),
    loadAssetImage(THERMAL_ASSET_PATHS.team),
    loadAssetImage(THERMAL_ASSET_PATHS.heavy),
    loadAssetImage(THERMAL_ASSET_PATHS.photo),
    loadAssetImage(THERMAL_ASSET_PATHS.edge),
  ]);
  const hasPhoto = Boolean(model.includePhoto && photo);
  const hasPeriods = model.periodScores.length > 0;
  const hasComment = Boolean(model.receiptComment);
  const layout = getThermalReceiptLayout({ hasPhoto, hasPeriods, hasComment });
  const base = createCanvas(1080, 1920);
  const ctx = base.getContext("2d");
  ctx.__thermalSeed = renderSeed;
  ctx.__thermalMasks = { body: bodyMask, team: teamMask, heavy: heavyMask, photo: photoMask };
  drawPaper(ctx, layout, renderSeed, { paper, edge });
  drawBrand(ctx, model, layout);
  drawPhoto(ctx, photo, layout, model);
  drawTeams(ctx, model, layout, { home: homeEmblem, away: awayEmblem });
  drawScore(ctx, model, layout);
  drawInfo(ctx, model, layout);
  drawPeriods(ctx, model, layout);
  drawResult(ctx, model, layout);
  drawFooter(ctx, model, layout);
  if (preset === "story") {
    const output = createCanvas(layout.paper.width, layout.paper.height);
    output.getContext("2d").drawImage(
      base,
      layout.paper.x,
      layout.paper.y,
      layout.paper.width,
      layout.paper.height,
      0,
      0,
      layout.paper.width,
      layout.paper.height,
    );
    return output;
  }
  const size = preset === "feed" ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 };
  const output = createCanvas(size.width, size.height);
  const outputCtx = output.getContext("2d");
  drawBackdrop(outputCtx, background);
  const sourceY = layout.paper.y - 28;
  const sourceHeight = layout.paper.height + 56;
  const scale = Math.min(size.width / 1080, size.height / sourceHeight);
  const drawWidth = 1080 * scale;
  const drawHeight = sourceHeight * scale;
  outputCtx.drawImage(base, 0, sourceY, 1080, sourceHeight, (size.width - drawWidth) / 2, (size.height - drawHeight) / 2, drawWidth, drawHeight);
  return output;
}
