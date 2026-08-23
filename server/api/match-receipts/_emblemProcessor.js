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

async function normalizeReceiptEmblem(emblem, field, downloadFile) {
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

    for (const quality of WEBP_QUALITIES) {
      const normalized = await source
        .clone()
        .rotate()
        .resize(TEAM_EMBLEM_MAX_DIMENSION, TEAM_EMBLEM_MAX_DIMENSION, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality, alphaQuality: 100, effort: 4 })
        .toBuffer();
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

export async function prepareReceiptEmblems(emblems = {}, { downloadFile = downloadReceiptEmblem } = {}) {
  const [home, away] = await Promise.all([
    normalizeReceiptEmblem(emblems.home, "homeEmblem", downloadFile),
    normalizeReceiptEmblem(emblems.away, "awayEmblem", downloadFile),
  ]);
  return { home, away };
}
