const DEFAULT_R2_BUCKET = "rankball";
const WEBP_CONTENT_TYPE = "image/webp";
const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const PRIVATE_IMAGE_CACHE_CONTROL = "private, no-store";

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

export function getPrivateR2Config() {
  const config = getR2Config();
  const bucket = String(process.env.CLOUDFLARE_R2_PRIVATE_BUCKET || "").trim();
  if (!bucket) throw httpError(503, "cloudflare_private_r2_not_configured");
  return { ...config, bucket };
}

function getObjectApiUrl(config, objectKey) {
  const encodedKey = String(objectKey || "").split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/r2/buckets/${encodeURIComponent(config.bucket)}/objects/${encodedKey}`;
}

function getBucketApiUrl(config) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/r2/buckets`;
}

async function readCloudflareError(response) {
  const payload = await response.json().catch(() => null);
  return payload?.errors?.[0]?.message || payload?.messages?.[0] || `status_${response.status}`;
}

export async function uploadR2Webp(config, objectKey, bytes, contextLabel = "image") {
  return uploadR2WebpWithCache(config, objectKey, bytes, IMMUTABLE_ASSET_CACHE_CONTROL, contextLabel);
}

export async function uploadPrivateR2Webp(config, objectKey, bytes, contextLabel = "private image") {
  return uploadR2WebpWithCache(config, objectKey, bytes, PRIVATE_IMAGE_CACHE_CONTROL, contextLabel, true);
}

async function createR2Bucket(config, contextLabel) {
  const response = await fetch(getBucketApiUrl(config), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: config.bucket }),
  });
  if (!response.ok) console.error(`Cloudflare R2 ${contextLabel} bucket creation failed.`, await readCloudflareError(response));
}

async function uploadR2WebpWithCache(config, objectKey, bytes, cacheControl, contextLabel, createBucketIfMissing = false) {
  const upload = () => fetch(getObjectApiUrl(config, objectKey), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Cache-Control": cacheControl,
      "Content-Type": WEBP_CONTENT_TYPE,
    },
    body: bytes,
  });
  let response = await upload();
  if (response.status === 404 && createBucketIfMissing) {
    await createR2Bucket(config, contextLabel);
    response = await upload();
  }
  if (!response.ok) {
    console.error(`Cloudflare R2 ${contextLabel} upload failed.`, await readCloudflareError(response));
    const message = [401, 403].includes(response.status)
      ? "cloudflare_r2_access_denied"
      : response.status === 404 ? "cloudflare_r2_bucket_not_found" : "cloudflare_r2_upload_failed";
    throw httpError(503, message);
  }
}

export async function readR2Object(config, objectKey, contextLabel = "image") {
  const response = await fetch(getObjectApiUrl(config, objectKey), {
    headers: { Authorization: `Bearer ${config.apiToken}` },
  });
  if (!response.ok) {
    console.error(`Cloudflare R2 ${contextLabel} read failed.`, await readCloudflareError(response));
    throw httpError(response.status === 404 ? 404 : 503, response.status === 404 ? "cloudflare_r2_object_not_found" : "cloudflare_r2_read_failed");
  }
  return Buffer.from(await response.arrayBuffer());
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

export function validateSafeWebpContainer(bytes, errorPrefix = "image") {
  if (
    bytes.length < 30
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WEBP"
    || bytes.readUInt32LE(4) + 8 !== bytes.length
  ) throw httpError(400, `${errorPrefix}_invalid_container`);

  const chunks = [];
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw httpError(400, `${errorPrefix}_invalid_container`);
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    const paddedEnd = end + (size % 2);
    if (end > bytes.length || paddedEnd > bytes.length || (size % 2 && bytes[end] !== 0)) {
      throw httpError(400, `${errorPrefix}_invalid_container`);
    }
    if (!["VP8X", "ALPH", "VP8 ", "VP8L"].includes(type)) {
      throw httpError(400, `${errorPrefix}_unsafe_chunk`);
    }
    chunks.push({ type, size });
    offset = paddedEnd;
  }

  const types = chunks.map((chunk) => chunk.type);
  const imageChunks = types.filter((type) => type === "VP8 " || type === "VP8L");
  const validSimple = chunks.length === 1 && imageChunks.length === 1;
  const validExtended = types[0] === "VP8X"
    && chunks[0].size === 10
    && imageChunks.length === 1
    && types.filter((type) => type === "VP8X").length === 1
    && types.filter((type) => type === "ALPH").length <= 1
    && (!types.includes("ALPH") || (types.includes("VP8 ") && types.indexOf("ALPH") < types.indexOf("VP8 ")));
  if (!validSimple && !validExtended) throw httpError(400, `${errorPrefix}_invalid_container`);
  return chunks;
}

export function validateWebpImage(bytes, options = {}) {
  const maxDimension = Number(options.maxDimension);
  const errorPrefix = String(options.errorPrefix || "image");
  if (options.safeContainer === true) validateSafeWebpContainer(bytes, errorPrefix);
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

export async function normalizeWebpUpload(bytes, options = {}) {
  const maxBytes = Number(options.maxBytes);
  const maxDimension = Number(options.maxDimension);
  const errorPrefix = String(options.errorPrefix || "image");
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error("invalid_image_max_bytes");
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) throw new Error("invalid_image_max_dimension");
  if (!bytes?.length || bytes.length > maxBytes) throw httpError(400, `${errorPrefix}_too_large`);

  const isWebp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (isWebp) {
    try {
      return {
        bytes,
        dimensions: validateWebpImage(bytes, { maxDimension, errorPrefix, safeContainer: true }),
      };
    } catch (error) {
      if (options.canonicalizeWebp !== true) throw error;
    }
  }

  const isJpeg = bytes.length >= 4
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff
    && bytes[bytes.length - 1] === 0xd9;
  if (!isWebp && !isJpeg) throw httpError(400, `${errorPrefix}_webp_required`);

  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    throw httpError(503, `${errorPrefix}_conversion_unavailable`);
  }

  try {
    const image = sharp(bytes, {
      failOn: isWebp ? "error" : "warning",
      limitInputPixels: maxDimension * maxDimension,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== (isWebp ? "webp" : "jpeg")
      || !metadata.width
      || !metadata.height
      || metadata.width > maxDimension
      || metadata.height > maxDimension
      || Number(metadata.pages || 1) !== 1
    ) throw httpError(400, `${errorPrefix}_invalid_dimensions`);
    const normalized = await image.rotate().webp({ quality: 76, effort: 4 }).toBuffer();
    if (!normalized.length || normalized.length > maxBytes) throw httpError(400, `${errorPrefix}_too_large`);
    return {
      bytes: normalized,
      dimensions: validateWebpImage(normalized, { maxDimension, errorPrefix, safeContainer: true }),
    };
  } catch (error) {
    if (error?.statusCode) throw error;
    throw httpError(400, `${errorPrefix}_invalid_payload`);
  }
}
