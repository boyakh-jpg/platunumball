import { assetUrl } from "./assets.js";
import { createQrMatrix } from "./qrCode.js";
import {
  createThermalRandom,
  getThermalReceiptLayout,
  getThermalScoreSlotLayout,
  sanitizeMatchReceiptComment,
  suggestReceiptShortName,
  THERMAL_PRINT_ROLES,
} from "../../shared/lib/thermalReceipt.js";

const PAPER = "#eeeae1";
const INK = "#151515";
const LATIN_FONT = '"Anton"';
const DATA_FONT = '"Pretendard Variable"';
const DIGIT_ATLAS_PATH = "/assets/match-receipt-score-digits-v3.png";
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
  const remote = assetUrl(path);
  const image = await loadImage(remote);
  return image || (remote !== path ? loadImage(path) : null);
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

function fillMaskedPanel(ctx, box, role = "heavy") {
  const layer = createCanvas(Math.ceil(box.width), Math.ceil(box.height));
  const layerCtx = layer.getContext("2d");
  layerCtx.fillStyle = INK;
  layerCtx.fillRect(0, 0, layer.width, layer.height);
  applyPrintMask(layer, ctx.__thermalMasks?.[role], `${ctx.__thermalSeed}|${box.x}|${box.y}`, role);
  ctx.drawImage(layer, box.x, box.y);
}

function fitText(ctx, text, maxWidth, start, minimum, font = DATA_FONT) {
  let size = start;
  do {
    ctx.font = `800 ${size}px ${font}`;
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
    ]),
    away: uniqueSources([
      options.teamLineArtUrls?.away,
      model.teamEmblemUrls?.away,
      model.neutralTeamMarkUrls?.away,
    ]),
  };
}

async function loadFirstImage(sources) {
  for (const source of sources) {
    const image = await loadImage(source);
    if (image) return image;
  }
  return null;
}

function splitThermalText(text, maxWidth, size, font = DATA_FONT, weight = 800) {
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
  const font = options.font || DATA_FONT;
  const weight = options.weight || 800;
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

function drawPaper(ctx, layout, seed, textures) {
  const random = createThermalRandom(seed);
  ctx.fillStyle = "#292927";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  drawImageCover(ctx, textures.background, 0, 0, ctx.canvas.width, ctx.canvas.height);
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
  const zoom = Math.max(1, Number(draft.photoZoom) || 1);
  const cover = Math.max(source.width / image.naturalWidth, source.height / image.naturalHeight) * zoom;
  const width = image.naturalWidth * cover;
  const height = image.naturalHeight * cover;
  const panX = (Number(draft.photoX) || 0) / 100 * Math.max(0, width - source.width) / 2;
  const panY = (Number(draft.photoY) || 0) / 100 * Math.max(0, height - source.height) / 2;
  ctx.save();
  ctx.translate(source.width / 2, source.height / 2);
  ctx.rotate((Number(draft.photoRotation) || 0) * Math.PI / 180);
  ctx.drawImage(image, -width / 2 - panX, -height / 2 - panY, width, height);
  ctx.restore();
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
  drawThermalText(ctx, "BOXTIER", center, layout.brand.y + 70, { size: 76, font: LATIN_FONT, align: "center", maxWidth: 500, dotScale: 2 });
  drawThermalText(ctx, "BASKETBALL  GAME RECEIPT", center, layout.brand.y + 122, { size: 25, align: "center", maxWidth: 520 });
  drawThermalText(ctx, `MATCH NO. ${serial.replace(/^#?BT-?/i, "").slice(-3).padStart(3, "0")}`, center, layout.brand.y + 156, { size: 23, align: "center", maxWidth: 400 });
  drawRule(ctx, layout.content.x, layout.brand.y + layout.brand.height - 4, layout.content.width);
}

function drawEmblem(ctx, image, x, y, name) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 82, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke();
  if (image) {
    ctx.clip();
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
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, x - 84, y - 84, 168, 168);
  } else {
    drawThermalText(ctx, String(name || "?").trim().slice(0, 1), x, y, { size: 86, font: LATIN_FONT, align: "center", maxWidth: 120, dotScale: 2 });
  }
  ctx.restore();
}

function drawTeams(ctx, model, layout, emblems) {
  const y = layout.teams.y + 82;
  const left = layout.teams.x + 126;
  const right = layout.teams.x + layout.teams.width - 126;
  drawEmblem(ctx, emblems.home, left, y, model.homeTeam);
  drawEmblem(ctx, emblems.away, right, y, model.awayTeam);
  drawThermalText(ctx, "VS", layout.teams.x + layout.teams.width / 2, y, { size: 42, font: LATIN_FONT, align: "center", maxWidth: 80, dotScale: 2 });
  [[model.homeTeam || "Team A", left], [model.awayTeam || "Team B", right]].forEach(([name, x]) => {
    const size = fitText(ctx, name, 286, 46, 30);
    drawThermalText(ctx, name, x, layout.teams.y + 188, { size, align: "center", maxWidth: 300, dotScale: 2, printRole: "team" });
  });
}

function drawAtlasScore(ctx, atlas, score, slotX, centerY, slotWidth, tone = PAPER, digitHeight = 158) {
  const metrics = getThermalScoreSlotLayout(score, { slotWidth, digitHeight });
  const mask = createCanvas(Math.ceil(metrics.totalWidth), Math.ceil(metrics.height));
  const maskCtx = mask.getContext("2d");
  maskCtx.imageSmoothingEnabled = false;
  const cellWidth = atlas ? atlas.naturalWidth / 11 : 0;
  Array.from(metrics.score).forEach((digit, index) => {
    const x = index * (metrics.glyphWidth + metrics.gap);
    if (atlas) maskCtx.drawImage(atlas, Number(digit) * cellWidth, 0, cellWidth, atlas.naturalHeight, x, 0, metrics.glyphWidth, metrics.height);
    else drawThermalText(maskCtx, digit, x, metrics.height / 2, { size: metrics.height, font: LATIN_FONT, maxWidth: metrics.glyphWidth });
  });
  maskCtx.globalCompositeOperation = "source-in";
  maskCtx.fillStyle = tone;
  maskCtx.fillRect(0, 0, mask.width, mask.height);
  ctx.drawImage(mask, slotX + metrics.x, centerY - metrics.height / 2);
}

function drawAtlasColon(ctx, atlas, slotX, centerY, slotWidth, height, tone = PAPER) {
  if (!atlas) {
    drawThermalText(ctx, ":", slotX + slotWidth / 2, centerY, {
      size: height,
      font: LATIN_FONT,
      align: "center",
      maxWidth: slotWidth,
      dotScale: 2,
      color: tone,
    });
    return;
  }
  const cellWidth = atlas.naturalWidth / 11;
  const sourceIndex = 10;
  const targetWidth = Math.min(slotWidth, height * cellWidth / atlas.naturalHeight);
  const mask = createCanvas(Math.ceil(targetWidth), Math.ceil(height));
  const maskCtx = mask.getContext("2d");
  maskCtx.imageSmoothingEnabled = false;
  maskCtx.drawImage(
    atlas,
    sourceIndex * cellWidth,
    0,
    cellWidth,
    atlas.naturalHeight,
    0,
    0,
    targetWidth,
    height,
  );
  maskCtx.globalCompositeOperation = "source-in";
  maskCtx.fillStyle = tone;
  maskCtx.fillRect(0, 0, mask.width, mask.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mask, slotX + (slotWidth - targetWidth) / 2, centerY - height / 2);
  ctx.restore();
}

function drawScore(ctx, model, layout, atlas) {
  const box = layout.score;
  fillMaskedPanel(ctx, box);
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 3;
  ctx.strokeRect(box.x + 9, box.y + 9, box.width - 18, box.height - 18);
  const centerY = box.y + box.height / 2;
  drawAtlasScore(ctx, atlas, model.homeScore, box.x, centerY, 284);
  drawAtlasColon(ctx, atlas, box.x + 316, centerY, 52, 132);
  drawAtlasScore(ctx, atlas, model.awayScore, box.x + 400, centerY, 284);
}

function drawInfo(ctx, model, layout) {
  const center = layout.info.x + layout.info.width / 2;
  const playedOn = String(model.playedOn || "").replaceAll("-", ".");
  const periodCount = Array.isArray(model.periodScores) && model.periodScores.length ? model.periodScores.length : 4;
  drawThermalText(ctx, "FINAL", center, layout.info.finalBaseline, { size: 38, font: LATIN_FONT, align: "center", maxWidth: 220, dotScale: 1, printRole: "team" });
  drawThermalText(ctx, `${playedOn} · ${model.playedTime || ""}`, center, layout.info.dateBaseline, { size: 24, align: "center", maxWidth: 520 });
  const venue = model.venue || model.address || "VENUE";
  let venueSize = 26;
  const measuringContext = createCanvas(1, 1).getContext("2d");
  measuringContext.font = `800 ${venueSize}px ${DATA_FONT}`;
  const shouldWrapVenue = measuringContext.measureText(venue).width > 620;
  if (shouldWrapVenue) venueSize = 20;
  let venueLines = shouldWrapVenue ? splitThermalText(venue, 620, venueSize) : [venue];
  while (shouldWrapVenue && venueLines.length < 2 && venueSize > 20) {
    venueSize -= 2;
    venueLines = splitThermalText(venue, 620, venueSize);
  }
  const venueStartY = venueLines.length > 1 ? layout.info.wrappedVenueBaseline : layout.info.venueBaseline;
  venueLines.slice(0, 2).forEach((line, index) => drawThermalText(ctx, line, center, venueStartY + index * layout.info.venueLineGap, {
    size: venueSize,
    align: "center",
    maxWidth: 620,
  }));
  drawThermalText(ctx, `${String(model.format || "5v5").toUpperCase()} · ${periodCount} QUARTERS${model.refereeAssigned ? " · REFEREE" : ""}`, center, layout.info.summaryBaseline, { size: 22, align: "center", maxWidth: 620 });
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
  const shortNames = [model.homeReceiptShortName || suggestReceiptShortName(model.homeTeam) || "A", model.awayReceiptShortName || suggestReceiptShortName(model.awayTeam) || "B"];
  [0, 1].forEach((side) => {
    const rowY = layout.periods.y + 82 + side * 38;
    drawThermalText(ctx, shortNames[side], x, rowY, { size: 24, maxWidth: 150 });
    rows.forEach((row, index) => drawThermalText(ctx, row[side + 1] ?? "-", x + 214 + index * colWidth, rowY, { size: 22, align: "center", maxWidth: 70 }));
    drawThermalText(ctx, side ? model.awayScore : model.homeScore, x + layout.periods.width, rowY, { size: 23, align: "right", maxWidth: 90 });
  });
  drawRule(ctx, x, layout.periods.y + 146, layout.periods.width, true);
}

function drawResult(ctx, model, layout, atlas) {
  const box = layout.result;
  fillMaskedPanel(ctx, box);
  const shortHome = model.homeReceiptShortName || suggestReceiptShortName(model.homeTeam) || "A";
  const shortAway = model.awayReceiptShortName || suggestReceiptShortName(model.awayTeam) || "B";
  drawThermalText(ctx, shortHome, box.x + 22, box.y + 28, { size: 25, maxWidth: 220, color: PAPER });
  drawThermalText(ctx, shortAway, box.x + box.width - 22, box.y + 28, { size: 25, align: "right", maxWidth: 220, color: PAPER });
  ctx.fillStyle = PAPER;
  ctx.fillRect(box.x + 20, box.y + 47, box.width - 40, 1);
  const scoreY = box.y + 101;
  drawAtlasScore(ctx, atlas, model.homeScore, box.x + 20, scoreY, 180, PAPER, 92);
  drawAtlasColon(ctx, atlas, box.x + 202, scoreY, 34, 68);
  drawAtlasScore(ctx, atlas, model.awayScore, box.x + 238, scoreY, 180, PAPER, 92);
  const isTie = Number(model.homeScore) === Number(model.awayScore);
  const winner = Number(model.homeScore) > Number(model.awayScore) ? model.homeTeam : model.awayTeam;
  const outcome = isTie
    ? (model.receiptLocale === "en" ? "DRAW" : "무승부")
    : `${model.receiptLocale === "en" ? "WIN" : "승리"}  ${winner}`;
  drawThermalText(ctx, outcome, box.x + 22, box.y + 169, { size: 24, maxWidth: box.width - 44, color: PAPER });
  if (layout.hasComment) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(box.x + 22, box.y + 191, box.width - 44, 1);
    drawThermalText(ctx, `${model.receiptLocale === "en" ? "NOTE" : "한줄평"}  ${model.receiptComment}`, box.x + 22, box.y + 216, { size: 21, maxWidth: box.width - 44, color: PAPER });
  }
}

function drawQr(ctx, value, x, y, size) {
  if (!value) return;
  const matrix = createQrMatrix(value);
  const quiet = 4;
  const cells = matrix.length + quiet * 2;
  const moduleSize = Math.floor(size / cells);
  const actual = moduleSize * cells;
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, actual, actual);
  ctx.fillStyle = INK;
  matrix.forEach((row, rowIndex) => row.forEach((dark, columnIndex) => {
    if (dark) ctx.fillRect(x + (columnIndex + quiet) * moduleSize, y + (rowIndex + quiet) * moduleSize, moduleSize, moduleSize);
  }));
}

function drawFooter(ctx, model, layout) {
  const x = layout.footer.x;
  const y = layout.footer.y;
  const url = model.matchUrl || "https://boxtier.kr";
  const matchId = model.officialMatchId || String(model.serial || "BT-000").replace(/^#/, "");
  drawThermalText(ctx, `${model.receiptLocale === "en" ? "PLAYERS" : "참가 인원"}                ${Number(model.playerCount) || 0}`, x, y + 26, { size: 22, maxWidth: 390 });
  drawRule(ctx, x, y + 44, 390, true);
  drawThermalText(ctx, `GAME ID   ${matchId}`, x, y + 72, { size: 21, maxWidth: 390 });
  drawRule(ctx, x, y + 90, 390, true);
  drawThermalText(ctx, `${model.verified ? "VERIFIED   YES" : "SELF-REPORTED"}`, x, y + 118, { size: 21, maxWidth: 390 });
  drawRule(ctx, x, y + 136, 390, true);
  drawThermalText(ctx, "boxtier.kr", x, y + 174, { size: 23, maxWidth: 240 });
  drawThermalText(ctx, "KEEP YOUR GAME.", x, y + 196, { size: 17, maxWidth: 240 });
  drawThermalText(ctx, "SCAN MATCH", x + layout.footer.width - 92, y + 20, { size: 20, align: "center", maxWidth: 190 });
  drawQr(ctx, url, x + layout.footer.width - 184, y + 34, 184);
}

function normalizeThermalData(value, options) {
  const model = options.viewModel || value;
  const periodScores = Array.isArray(model.periodScores) ? model.periodScores : [];
  const sharedComment = sanitizeMatchReceiptComment(model.comment || model.receiptComment);
  return {
    ...model,
    comment: sharedComment,
    receiptComment: sharedComment,
    homeReceiptShortName: model.homeReceiptShortName || suggestReceiptShortName(model.homeTeam),
    awayReceiptShortName: model.awayReceiptShortName || suggestReceiptShortName(model.awayTeam),
    matchUrl: String(options.matchUrl || model.matchUrl || ""),
    periodScores,
  };
}

export async function renderThermalReceiptCanvas(value, preset = "story", options = {}) {
  await document.fonts?.ready;
  await Promise.all([
    document.fonts?.load?.(`48px ${LATIN_FONT}`),
    document.fonts?.load?.(`24px ${DATA_FONT}`),
  ]);
  const model = normalizeThermalData(value, options);
  const renderSeed = model.serialSeed || model.serial || "thermal";
  const emblemSources = resolveThermalReceiptEmblemSources(model, options);
  const [photo, atlas, homeEmblem, awayEmblem, background, paper, bodyMask, teamMask, heavyMask, photoMask, edge] = await Promise.all([
    model.includePhoto ? loadImage(options.photoBlob || options.photoUrl) : null,
    loadAssetImage(DIGIT_ATLAS_PATH),
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
  drawPaper(ctx, layout, renderSeed, { background, paper, edge });
  drawBrand(ctx, model, layout);
  drawPhoto(ctx, photo, layout, model);
  drawTeams(ctx, model, layout, { home: homeEmblem, away: awayEmblem });
  drawScore(ctx, model, layout, atlas);
  drawInfo(ctx, model, layout);
  drawPeriods(ctx, model, layout);
  drawResult(ctx, model, layout, atlas);
  drawFooter(ctx, model, layout);
  if (preset === "story") return base;
  const size = preset === "feed" ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 };
  const output = createCanvas(size.width, size.height);
  const outputCtx = output.getContext("2d");
  outputCtx.fillStyle = "#292927";
  outputCtx.fillRect(0, 0, size.width, size.height);
  const sourceY = layout.paper.y - 28;
  const sourceHeight = layout.paper.height + 56;
  const scale = Math.min(size.width / 1080, size.height / sourceHeight);
  const drawWidth = 1080 * scale;
  const drawHeight = sourceHeight * scale;
  outputCtx.drawImage(base, 0, sourceY, 1080, sourceHeight, (size.width - drawWidth) / 2, (size.height - drawHeight) / 2, drawWidth, drawHeight);
  return output;
}
