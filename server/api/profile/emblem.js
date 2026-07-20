import { createHash } from "node:crypto";
import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const MAX_REQUEST_BYTES = 320 * 1024;
const MAX_UPLOAD_BYTES = 160 * 1024;
const MAX_IMAGE_DIMENSION = 384;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{2,128}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function reject(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  throw error;
}

function getR2Config() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = String(process.env.CLOUDFLARE_R2_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const bucket = String(process.env.CLOUDFLARE_R2_BUCKET || "rankball").trim();
  if (!accountId || !apiToken || !bucket) reject(503, "cloudflare_r2_not_configured");
  return { accountId, apiToken, bucket };
}

function getObjectApiUrl(config, objectKey) {
  const encodedKey = objectKey.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/r2/buckets/${encodeURIComponent(config.bucket)}/objects/${encodedKey}`;
}

async function readCloudflareError(response) {
  const payload = await response.json().catch(() => null);
  return payload?.errors?.[0]?.message || payload?.messages?.[0] || `status_${response.status}`;
}

async function uploadObject(config, objectKey, bytes) {
  const response = await fetch(getObjectApiUrl(config, objectKey), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "image/webp",
    },
    body: bytes,
  });
  if (!response.ok) {
    console.error("Cloudflare R2 profile emblem upload failed.", await readCloudflareError(response));
    reject(503, "cloudflare_r2_upload_failed");
  }
}

async function deleteObject(config, objectKey) {
  if (!objectKey) return;
  const response = await fetch(getObjectApiUrl(config, objectKey), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${config.apiToken}` },
  });
  if (!response.ok && response.status !== 404) {
    console.error("Cloudflare R2 profile emblem delete failed.", await readCloudflareError(response));
    throw new Error("cloudflare_r2_delete_failed");
  }
}

function decodeBase64(value = "") {
  const input = String(value || "").trim();
  if (!input || input.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8) reject(400, "profile_emblem_invalid_payload");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input)) reject(400, "profile_emblem_invalid_payload");
  const bytes = Buffer.from(input, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== input.replace(/=+$/, "")) reject(400, "profile_emblem_invalid_payload");
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) reject(400, "profile_emblem_too_large");
  return bytes;
}

function readWebpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    reject(400, "profile_emblem_webp_required");
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
  reject(400, "profile_emblem_webp_required");
}

function validateImage(bytes) {
  const { width, height } = readWebpDimensions(bytes);
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    reject(400, "profile_emblem_invalid_dimensions");
  }
}

async function loadProfile(context) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("id,avatar_key,avatar_source,avatar_color,avatar_updated_at,avatar_uploaded_at,avatar_upload_count,avatar_border_enabled,avatar_border_color,discord_connection,discord_avatar_url")
    .eq("id", context.profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) reject(404, "profile_not_found");
  return data;
}

async function commitProfile(context, profile, payload) {
  const { data, error } = await context.supabase.rpc("rankball_update_profile_emblem", {
    p_actor_profile_id: context.profileId,
    p_action: payload.action,
    p_avatar_key: payload.avatarKey ?? null,
    p_avatar_source: payload.avatarSource ?? profile.avatar_source ?? "initial",
    p_avatar_color: payload.avatarColor ?? profile.avatar_color ?? "#58d2c0",
    p_border_enabled: payload.avatarBorderEnabled ?? profile.avatar_border_enabled ?? false,
    p_border_color: payload.avatarBorderColor ?? profile.avatar_border_color ?? profile.avatar_color ?? "#58d2c0",
    p_expected_avatar_key: profile.avatar_key ?? null,
  });
  if (!error) return data ?? { ok: true, profileId: context.profileId };

  const mapped = new Error(error.message || "profile_emblem_update_failed");
  mapped.statusCode = error.message === "profile_emblem_cooldown" ? 429 : error.code === "40001" ? 409 : error.code === "P0002" ? 404 : 400;
  mapped.nextAllowedAt = error.details || null;
  throw mapped;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const contentLength = Number(request.headers["content-length"] || 0);
    if (contentLength > MAX_REQUEST_BYTES) reject(413, "profile_emblem_request_too_large");

    const context = await getAuthenticatedContext(request);
    const body = await readJsonBody(request);
    const action = String(body.action || "upload").trim();
    if (action !== "style") reject(410, "profile_emblem_image_disabled");
    if (!PROFILE_ID_PATTERN.test(context.profileId)) reject(400, "invalid_profile_id");

    const profile = await loadProfile(context);
    const previousAvatarKey = profile.avatar_key || null;

    if (action === "style") {
      const avatarColor = String(body.avatarColor || "").trim();
      const avatarBorderColor = String(body.avatarBorderColor || "").trim();
      if (!COLOR_PATTERN.test(avatarColor) || !COLOR_PATTERN.test(avatarBorderColor)) reject(400, "invalid_emblem_color");
      const result = await commitProfile(context, profile, {
        action,
        avatarColor,
        avatarBorderEnabled: body.avatarBorderEnabled === true,
        avatarBorderColor,
      });
      sendJson(response, 200, result);
      return;
    }

    if (action === "source") {
      const avatarSource = String(body.avatarSource || "initial").trim();
      if (!new Set(["initial", "discord", "upload"]).has(avatarSource)) reject(400, "invalid_profile_emblem_source");
      const result = await commitProfile(context, profile, { action, avatarSource, avatarKey: previousAvatarKey });
      sendJson(response, 200, result);
      return;
    }

    const bytes = decodeBase64(body.imageBase64);
    validateImage(bytes);
    const config = getR2Config();
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const avatarKey = `profile-emblems/${context.profileId}/${digest}.webp`;
    await uploadObject(config, avatarKey, bytes);

    let result;
    try {
      result = await commitProfile(context, profile, { action, avatarKey, avatarSource: "upload" });
    } catch (error) {
      if (avatarKey !== previousAvatarKey) await deleteObject(config, avatarKey).catch(() => null);
      throw error;
    }

    let storageCleanupPending = false;
    if (previousAvatarKey && previousAvatarKey !== avatarKey) {
      try {
        await deleteObject(config, previousAvatarKey);
      } catch {
        storageCleanupPending = true;
      }
    }
    sendJson(response, 200, { ...result, byteSize: bytes.length, storageCleanupPending });
  } catch (error) {
    console.error("Profile emblem action failed.", error.message);
    sendJson(response, error.statusCode || 500, {
      error: error.message || "profile_emblem_action_failed",
      ...(error.nextAllowedAt ? { details: { nextAllowedAt: error.nextAllowedAt } } : {}),
    });
  }
}
