import {
  TEAM_EMBLEM_MAX_DIMENSION,
  TEAM_EMBLEM_UPLOAD_MAX_BYTES,
} from "../../../shared/lib/teamEmblem.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";

export const MCP_RECEIPT_EMBLEM_SOURCE_MAX_BYTES = 3 * 1024 * 1024;
export const MCP_RECEIPT_EMBLEM_MAX_BASE64_LENGTH = Math.ceil(MCP_RECEIPT_EMBLEM_SOURCE_MAX_BYTES / 3) * 4;

const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp"]);
const MAX_INPUT_PIXELS = 20_000_000;
const WEBP_QUALITIES = [88, 76, 64, 52, 40];
const DOWNLOAD_TIMEOUT_MS = 8_000;
const FOREGROUND_ALPHA_THRESHOLD = 36;
const EMBLEM_SAFE_RADIUS = Math.floor(TEAM_EMBLEM_MAX_DIMENSION * 13 / 30);
const D_THERMAL_TONES = Object.freeze([18, 70, 124, 176]);
const BACKDROP_COLOR_DISTANCE = 64;
const BACKDROP_BOUNDARY_SHARE = 0.52;
const BACKDROP_MIN_SOLIDITY = 0.65;
const BACKDROP_MIN_CANVAS_FILL = 0.82;
const BACKDROP_MIN_CANVAS_SPAN = 0.9;
const BACKDROP_MIN_REMAINDER = 64;

function emblemError(field, code) {
  const error = new Error(code);
  error.field = field;
  error.code = code;
  return error;
}

function decodeRawBase64(value, field) {
  const input = String(value ?? "").trim();
  const bytes = Buffer.from(input, "base64");
  if (
    !bytes.length
    || bytes.length > MCP_RECEIPT_EMBLEM_SOURCE_MAX_BYTES
    || bytes.toString("base64").replace(/=+$/u, "") !== input.replace(/=+$/u, "")
  ) {
    throw emblemError(field, "emblem_invalid_base64");
  }
  return bytes;
}

function isPrivateAddress(address) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
    return normalized === "::" || normalized === "::1"
      || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/u.test(normalized);
  }
  const octets = address.split(".").map(Number);
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] >= 224;
}

async function publicLookup(hostname, options, callback) {
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    const publicAddresses = addresses.filter(({ address }) => isIP(address) && !isPrivateAddress(address));
    if (publicAddresses.length === 0) throw new Error("private_download_host");
    const family = Number(options?.family || 0);
    const matches = family ? publicAddresses.filter((entry) => entry.family === family) : publicAddresses;
    const selected = matches.length > 0 ? matches : publicAddresses;
    if (options?.all) callback(null, selected);
    else callback(null, selected[0].address, selected[0].family);
  } catch (error) {
    callback(error);
  }
}

export async function downloadReceiptEmblem(downloadUrl, field) {
  let url;
  try {
    url = new URL(downloadUrl);
  } catch {
    throw emblemError(field, "emblem_download_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.href.length > 4_096) {
    throw emblemError(field, "emblem_download_url_invalid");
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      lookup: publicLookup,
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: { accept: "image/jpeg,image/png,image/webp" },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(emblemError(field, "emblem_download_failed"));
        return;
      }
      const declaredLength = Number(response.headers["content-length"] || 0);
      if (declaredLength > MCP_RECEIPT_EMBLEM_SOURCE_MAX_BYTES) {
        response.destroy();
        reject(emblemError(field, "emblem_image_too_large"));
        return;
      }
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > MCP_RECEIPT_EMBLEM_SOURCE_MAX_BYTES) {
          response.destroy(emblemError(field, "emblem_image_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", (error) => reject(error?.field ? error : emblemError(field, "emblem_download_failed")));
    });
    request.on("timeout", () => request.destroy(emblemError(field, "emblem_download_timeout")));
    request.on("error", (error) => reject(error?.field ? error : emblemError(field, "emblem_download_failed")));
  });
}

function inspectForeground(data, info, field) {
  let alphaTotal = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha < FOREGROUND_ALPHA_THRESHOLD) continue;
      alphaTotal += alpha;
      weightedX += (x + 0.5) * alpha;
      weightedY += (y + 0.5) * alpha;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!alphaTotal || maxX < minX || maxY < minY) throw emblemError(field, "emblem_image_empty");

  const centerX = weightedX / alphaTotal;
  const centerY = weightedY / alphaTotal;
  let radius = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < FOREGROUND_ALPHA_THRESHOLD) continue;
      radius = Math.max(radius, Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY));
    }
  }
  return { centerX, centerY, minX, minY, maxX, maxY, radius };
}

function inspectAlphaShape(data, info) {
  let count = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < FOREGROUND_ALPHA_THRESHOLD) continue;
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!count) return { count: 0, width: 0, height: 0, solidity: 0 };
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  return { count, minX, minY, maxX, maxY, width, height, solidity: count / (width * height) };
}

function colorDistanceSquared(data, index, color) {
  const red = data[index] - color.red;
  const green = data[index + 1] - color.green;
  const blue = data[index + 2] - color.blue;
  return red * red + green * green + blue * blue;
}

function findBackdropColor(data, info) {
  const buckets = new Map();
  let boundaryCount = 0;
  const boundaryPixels = [];
  const addBoundaryPixel = (x, y) => {
    const pixel = y * info.width + x;
    const index = pixel * 4;
    if (data[index + 3] < FOREGROUND_ALPHA_THRESHOLD) return;
    const neighbors = [pixel - 1, pixel + 1, pixel - info.width, pixel + info.width];
    const isBoundary = x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1
      || neighbors.some((neighbor) => data[neighbor * 4 + 3] < FOREGROUND_ALPHA_THRESHOLD);
    if (!isBoundary) return;
    boundaryCount += 1;
    boundaryPixels.push(index);
    const key = `${data[index] >> 4}:${data[index + 1] >> 4}:${data[index + 2] >> 4}`;
    const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += data[index];
    bucket.green += data[index + 1];
    bucket.blue += data[index + 2];
    buckets.set(key, bucket);
  };
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) addBoundaryPixel(x, y);
  }
  if (!boundaryCount || !buckets.size) return null;
  const dominant = [...buckets.values()].sort((left, right) => right.count - left.count)[0];
  const color = {
    red: dominant.red / dominant.count,
    green: dominant.green / dominant.count,
    blue: dominant.blue / dominant.count,
  };
  let matching = 0;
  const maxDistance = BACKDROP_COLOR_DISTANCE * BACKDROP_COLOR_DISTANCE;
  for (const index of boundaryPixels) {
    if (colorDistanceSquared(data, index, color) <= maxDistance) matching += 1;
  }
  return matching / boundaryCount >= BACKDROP_BOUNDARY_SHARE ? color : null;
}

function removeFlatBackdrop(data, info, field) {
  const cleaned = Buffer.from(data);
  const initial = inspectAlphaShape(cleaned, info);
  const totalPixels = info.width * info.height;
  const fillsCanvas = initial.count / totalPixels >= BACKDROP_MIN_CANVAS_FILL
    || (
      initial.width / info.width >= BACKDROP_MIN_CANVAS_SPAN
      && initial.height / info.height >= BACKDROP_MIN_CANVAS_SPAN
      && initial.solidity >= BACKDROP_MIN_SOLIDITY
    );
  if (!fillsCanvas) return cleaned;

  let removedBackdrop = false;
  for (let pass = 0; pass < 2; pass += 1) {
    const shape = inspectAlphaShape(cleaned, info);
    if (!shape.count || shape.solidity < BACKDROP_MIN_SOLIDITY) break;
    const color = findBackdropColor(cleaned, info);
    if (!color) {
      if (!removedBackdrop) throw emblemError(field, "emblem_background_not_removable");
      break;
    }
    const maxDistance = BACKDROP_COLOR_DISTANCE * BACKDROP_COLOR_DISTANCE;
    const matches = [];
    for (let index = 0; index < cleaned.length; index += 4) {
      if (
        cleaned[index + 3] >= FOREGROUND_ALPHA_THRESHOLD
        && colorDistanceSquared(cleaned, index, color) <= maxDistance
      ) matches.push(index);
    }
    if (shape.count - matches.length < BACKDROP_MIN_REMAINDER) {
      if (!removedBackdrop) throw emblemError(field, "emblem_background_not_removable");
      break;
    }
    for (const index of matches) {
      cleaned[index] = 0;
      cleaned[index + 1] = 0;
      cleaned[index + 2] = 0;
      cleaned[index + 3] = 0;
    }
    removedBackdrop = true;
  }
  return cleaned;
}

async function centerForeground(sharp, source, field) {
  const decoded = await source
    .clone()
    .rotate()
    .resize(TEAM_EMBLEM_MAX_DIMENSION * 2, TEAM_EMBLEM_MAX_DIMENSION * 2, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cleaned = removeFlatBackdrop(decoded.data, decoded.info, field);
  const foreground = inspectForeground(cleaned, decoded.info, field);
  const cropWidth = foreground.maxX - foreground.minX + 1;
  const cropHeight = foreground.maxY - foreground.minY + 1;
  const crop = await sharp(cleaned, { raw: decoded.info })
    .extract({ left: foreground.minX, top: foreground.minY, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer();
  const half = Math.max(1, Math.ceil(foreground.radius));
  const squareSize = half * 2 + 1;
  const relativeCenterX = foreground.centerX - foreground.minX;
  const relativeCenterY = foreground.centerY - foreground.minY;
  const left = Math.round(half + 0.5 - relativeCenterX);
  const top = Math.round(half + 0.5 - relativeCenterY);
  const diameter = EMBLEM_SAFE_RADIUS * 2;
  const centered = await sharp({
    create: {
      width: squareSize,
      height: squareSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: crop, left, top }])
    .png()
    .toBuffer();
  return sharp(centered)
    .resize(diameter, diameter, { fit: "fill" })
    .extend({
      top: (TEAM_EMBLEM_MAX_DIMENSION - diameter) / 2,
      bottom: (TEAM_EMBLEM_MAX_DIMENSION - diameter) / 2,
      left: (TEAM_EMBLEM_MAX_DIMENSION - diameter) / 2,
      right: (TEAM_EMBLEM_MAX_DIMENSION - diameter) / 2,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
}

async function applyDThermalTones(sharp, source) {
  const { data, info } = await source.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const luminances = [];
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < FOREGROUND_ALPHA_THRESHOLD) continue;
    luminances.push(data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722);
  }
  luminances.sort((a, b) => a - b);
  const threshold = (ratio) => luminances[Math.min(luminances.length - 1, Math.floor(luminances.length * ratio))];
  const thresholds = [threshold(0.27), threshold(0.54), threshold(0.78)];
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < FOREGROUND_ALPHA_THRESHOLD) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      continue;
    }
    const luminance = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    const toneIndex = thresholds.findIndex((value) => luminance <= value);
    const tone = D_THERMAL_TONES[toneIndex < 0 ? D_THERMAL_TONES.length - 1 : toneIndex];
    data[index] = tone;
    data[index + 1] = tone;
    data[index + 2] = tone;
    data[index + 3] = 255;
  }
  return sharp(data, { raw: info });
}

async function normalizeReceiptEmblem(emblem, field, downloadFile, style) {
  if (!emblem) return null;
  const bytes = emblem.downloadUrl
    ? await downloadFile(emblem.downloadUrl, field)
    : decodeRawBase64(emblem.imageBase64, field);
  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    throw emblemError(field, "emblem_processing_unavailable");
  }

  try {
    const source = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_INPUT_PIXELS });
    const metadata = await source.metadata();
    if (
      !SUPPORTED_FORMATS.has(metadata.format)
      || !metadata.width
      || !metadata.height
      || Number(metadata.pages || 1) !== 1
    ) {
      throw emblemError(field, "emblem_image_invalid");
    }

    const centered = await centerForeground(sharp, source, field);
    const thermal = style === "classic-thermal";
    const prepared = thermal ? await applyDThermalTones(sharp, centered) : centered;
    const encoders = thermal
      ? [{ lossless: true, effort: 4 }, ...WEBP_QUALITIES.map((quality) => ({ quality, alphaQuality: 100, effort: 4 }))]
      : WEBP_QUALITIES.map((quality) => ({ quality, alphaQuality: 100, effort: 4 }));
    for (const encoder of encoders) {
      const normalized = await prepared.clone().webp(encoder).toBuffer();
      if (normalized.length <= TEAM_EMBLEM_UPLOAD_MAX_BYTES) {
        return { imageBase64: normalized.toString("base64"), mimeType: "image/webp" };
      }
    }
    throw emblemError(field, "emblem_image_too_complex");
  } catch (error) {
    if (error?.field && error?.code) throw error;
    throw emblemError(field, "emblem_image_invalid");
  }
}

export async function prepareReceiptEmblems(emblems = {}, {
  downloadFile = downloadReceiptEmblem,
  style = "boxtier-score",
} = {}) {
  const [home, away] = await Promise.all([
    normalizeReceiptEmblem(emblems.home, "homeEmblem", downloadFile, style),
    normalizeReceiptEmblem(emblems.away, "awayEmblem", downloadFile, style),
  ]);
  return { home, away };
}
