const DEFAULT_R2_BUCKET = "rankball";
const WEBP_CONTENT_TYPE = "image/webp";
const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function getR2Config() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(process.env.CLOUDFLARE_R2_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const bucket = String(process.env.CLOUDFLARE_R2_BUCKET || DEFAULT_R2_BUCKET).trim();
  if (!accountId || !apiToken || !bucket) throw httpError(503, "cloudflare_r2_not_configured");
  return { accountId, apiToken, bucket };
}

function getObjectApiUrl(config, objectKey) {
  const encodedKey = String(objectKey || "").split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/r2/buckets/${encodeURIComponent(config.bucket)}/objects/${encodedKey}`;
}

async function readCloudflareError(response) {
  const payload = await response.json().catch(() => null);
  return payload?.errors?.[0]?.message || payload?.messages?.[0] || `status_${response.status}`;
}

export async function uploadR2Webp(config, objectKey, bytes, contextLabel = "image") {
  const response = await fetch(getObjectApiUrl(config, objectKey), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Cache-Control": IMMUTABLE_ASSET_CACHE_CONTROL,
      "Content-Type": WEBP_CONTENT_TYPE,
    },
    body: bytes,
  });
  if (!response.ok) {
    console.error(`Cloudflare R2 ${contextLabel} upload failed.`, await readCloudflareError(response));
    throw httpError(503, "cloudflare_r2_upload_failed");
  }
}

export async function deleteR2Object(config, objectKey, contextLabel = "image") {
  if (!objectKey) return;
  const response = await fetch(getObjectApiUrl(config, objectKey), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.apiToken}` },
  });
  if (!response.ok && response.status !== 404) {
    console.error(`Cloudflare R2 ${contextLabel} delete failed.`, await readCloudflareError(response));
    throw new Error("cloudflare_r2_delete_failed");
  }
}

export function decodeBase64Image(value = "", options = {}) {
  const maxBytes = Number(options.maxBytes);
  const errorPrefix = String(options.errorPrefix || "image");
  const input = String(value || "").trim();
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("invalid_image_max_bytes");
  if (!input || input.length > Math.ceil(maxBytes / 3) * 4 + 8) {
    throw httpError(400, `${errorPrefix}_invalid_payload`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input)) throw httpError(400, `${errorPrefix}_invalid_payload`);
  const bytes = Buffer.from(input, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== input.replace(/=+$/, "")) {
    throw httpError(400, `${errorPrefix}_invalid_payload`);
  }
  if (!bytes.length || bytes.length > maxBytes) throw httpError(400, `${errorPrefix}_too_large`);
  return bytes;
}

export function readWebpDimensions(bytes, errorPrefix = "image") {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    throw httpError(400, `${errorPrefix}_webp_required`);
  }
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
      height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)),
    };
  }
  throw httpError(400, `${errorPrefix}_webp_required`);
}

export function validateWebpImage(bytes, options = {}) {
  const maxDimension = Number(options.maxDimension);
  const errorPrefix = String(options.errorPrefix || "image");
  const dimensions = readWebpDimensions(bytes, errorPrefix);
  if (
    !Number.isFinite(maxDimension)
    || maxDimension <= 0
    || dimensions.width < 1
    || dimensions.height < 1
    || dimensions.width > maxDimension
    || dimensions.height > maxDimension
  ) {
    throw httpError(400, `${errorPrefix}_invalid_dimensions`);
  }
  return dimensions;
}
