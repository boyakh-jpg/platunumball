import { createHash } from "node:crypto";
import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const MAX_REQUEST_BYTES = 224 * 1024;
const MAX_UPLOAD_BYTES = 96 * 1024;
const MAX_IMAGE_DIMENSION = 320;
const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{2,128}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const TEAM_EMBLEM_TEXT_MODES = new Set(["initial", "name", "abbreviation"]);
const TEAM_EMBLEM_FONTS = new Set(["sport", "gothic", "serif", "mono"]);

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
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
    console.error("Cloudflare R2 team emblem upload failed.", await readCloudflareError(response));
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
    console.error("Cloudflare R2 team emblem delete failed.", await readCloudflareError(response));
    throw new Error("cloudflare_r2_delete_failed");
  }
}

function decodeBase64(value = "") {
  const input = String(value || "").trim();
  if (!input || input.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8) reject(400, "team_emblem_invalid_payload");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input)) reject(400, "team_emblem_invalid_payload");
  const bytes = Buffer.from(input, "base64");
  const canonical = bytes.toString("base64").replace(/=+$/, "");
  if (canonical !== input.replace(/=+$/, "")) reject(400, "team_emblem_invalid_payload");
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) reject(400, "team_emblem_too_large");
  return bytes;
}

function readWebpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    reject(400, "team_emblem_webp_required");
  }

  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
      height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)),
    };
  }
  reject(400, "team_emblem_webp_required");
}

function validateImage(bytes) {
  const dimensions = readWebpDimensions(bytes);
  if (
    dimensions.width < 1
    || dimensions.height < 1
    || dimensions.width > MAX_IMAGE_DIMENSION
    || dimensions.height > MAX_IMAGE_DIMENSION
  ) {
    reject(400, "team_emblem_invalid_dimensions");
  }
}

async function loadTeamForActor(context, teamId) {
  const [{ data: team, error: teamError }, { data: captain, error: captainError }] = await Promise.all([
    context.supabase
      .from("teams")
      .select("id,emblem_key,emblem_source,emblem_updated_at,emblem_uploaded_at,emblem_upload_count,emblem_color,emblem_border_enabled,emblem_border_color,emblem_text_mode,emblem_abbreviation,emblem_font,deleted_at")
      .eq("id", teamId)
      .is("deleted_at", null)
      .maybeSingle(),
    context.supabase
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .eq("user_id", context.profileId)
      .eq("role", "captain")
      .maybeSingle(),
  ]);
  if (teamError) throw teamError;
  if (captainError) throw captainError;
  if (!team?.id) reject(404, "team_not_found");
  if (!captain?.user_id) reject(403, "team_emblem_permission_denied");
  return team;
}

async function commitEmblem(context, teamId, emblemKey, expectedEmblemKey) {
  const { data, error } = await context.supabase.rpc("rankball_update_team_emblem", {
    p_actor_profile_id: context.profileId,
    p_team_id: teamId,
    p_emblem_key: emblemKey || null,
    p_expected_emblem_key: expectedEmblemKey || null,
  });
  if (!error) return data ?? { ok: true, teamId, emblemKey };

  const mapped = new Error(error.message || "team_emblem_update_failed");
  mapped.statusCode = error.message === "team_emblem_cooldown" ? 429 : error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400;
  mapped.nextAllowedAt = error.details || null;
  throw mapped;
}

async function commitEmblemStyle(context, teamId, payload) {
  const { data, error } = await context.supabase.rpc("rankball_update_team_emblem_design", {
    p_actor_profile_id: context.profileId,
    p_team_id: teamId,
    p_emblem_color: payload.emblemColor,
    p_border_enabled: payload.emblemBorderEnabled,
    p_border_color: payload.emblemBorderColor,
    p_text_mode: payload.emblemTextMode,
    p_abbreviation: payload.emblemAbbreviation || null,
    p_font: payload.emblemFont,
  });
  if (!error) return data ?? { ok: true, teamId };

  const mapped = new Error(error.message || "team_emblem_style_update_failed");
  mapped.statusCode = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
  throw mapped;
}

async function commitEmblemSource(context, teamId, emblemSource) {
  const { data, error } = await context.supabase.rpc("rankball_update_team_emblem_source", {
    p_actor_profile_id: context.profileId,
    p_team_id: teamId,
    p_emblem_source: emblemSource,
  });
  if (!error) return data ?? { ok: true, teamId, emblemSource };

  const mapped = new Error(error.message || "team_emblem_source_update_failed");
  mapped.statusCode = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
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
    if (contentLength > MAX_REQUEST_BYTES) reject(413, "team_emblem_request_too_large");

    const context = await getAuthenticatedContext(request);
    const body = await readJsonBody(request);
    const action = String(body.action || "upload").trim();
    const teamId = String(body.teamId || "").trim();
    if (!TEAM_ID_PATTERN.test(teamId)) reject(400, "invalid_team_id");
    if (!new Set(["upload", "remove", "source", "style"]).has(action)) reject(400, "invalid_team_emblem_action");

    const team = await loadTeamForActor(context, teamId);
    const previousEmblemKey = team.emblem_key || null;

    if (action === "style") {
      const emblemColor = String(body.emblemColor || "").trim();
      const emblemBorderColor = String(body.emblemBorderColor || "").trim();
      const emblemTextMode = String(body.emblemTextMode ?? team.emblem_text_mode ?? "initial").trim().toLowerCase();
      const emblemAbbreviation = String(body.emblemAbbreviation ?? team.emblem_abbreviation ?? "").trim().replace(/\s+/g, " ");
      const emblemFont = String(body.emblemFont ?? team.emblem_font ?? "sport").trim().toLowerCase();
      if (!COLOR_PATTERN.test(emblemColor) || !COLOR_PATTERN.test(emblemBorderColor)) reject(400, "invalid_emblem_color");
      if (!TEAM_EMBLEM_TEXT_MODES.has(emblemTextMode)) reject(400, "invalid_team_emblem_text_mode");
      if (Array.from(emblemAbbreviation).length > 8 || (emblemTextMode === "abbreviation" && !emblemAbbreviation)) {
        reject(400, "invalid_team_emblem_abbreviation");
      }
      if (!TEAM_EMBLEM_FONTS.has(emblemFont)) reject(400, "invalid_team_emblem_font");
      const result = await commitEmblemStyle(context, teamId, {
        emblemColor,
        emblemBorderEnabled: body.emblemBorderEnabled === true,
        emblemBorderColor,
        emblemTextMode,
        emblemAbbreviation,
        emblemFont,
      });
      sendJson(response, 200, result);
      return;
    }

    if (action === "source") {
      const emblemSource = String(body.emblemSource || "initial").trim();
      if (!new Set(["initial", "upload"]).has(emblemSource)) reject(400, "invalid_team_emblem_source");
      const result = await commitEmblemSource(context, teamId, emblemSource);
      sendJson(response, 200, result);
      return;
    }

    const config = getR2Config();

    if (action === "remove") {
      const result = await commitEmblem(context, teamId, null, previousEmblemKey);
      let storageCleanupPending = false;
      if (previousEmblemKey) {
        try {
          await deleteObject(config, previousEmblemKey);
        } catch {
          storageCleanupPending = true;
        }
      }
      sendJson(response, 200, { ...result, storageCleanupPending });
      return;
    }

    const bytes = decodeBase64(body.imageBase64);
    validateImage(bytes);
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const emblemKey = `team-emblems/${teamId}/${digest}.webp`;
    await uploadObject(config, emblemKey, bytes);

    let result;
    try {
      result = await commitEmblem(context, teamId, emblemKey, previousEmblemKey);
    } catch (error) {
      if (emblemKey !== previousEmblemKey) await deleteObject(config, emblemKey).catch(() => null);
      throw error;
    }

    let storageCleanupPending = false;
    if (previousEmblemKey && previousEmblemKey !== emblemKey) {
      try {
        await deleteObject(config, previousEmblemKey);
      } catch {
        storageCleanupPending = true;
      }
    }
    sendJson(response, 200, { ...result, byteSize: bytes.length, storageCleanupPending });
  } catch (error) {
    console.error("Team emblem action failed.", error.message);
    sendJson(response, error.statusCode || 500, {
      error: error.message || "team_emblem_action_failed",
      ...(error.nextAllowedAt ? { details: { nextAllowedAt: error.nextAllowedAt } } : {}),
    });
  }
}
