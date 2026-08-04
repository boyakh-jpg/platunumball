import { createHash } from "node:crypto";
import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { getProfileIcon } from "../../../shared/lib/profileIcons.js";
import { isEmblemHexColor } from "../../../shared/lib/emblemPolicy.js";
import { refreshProfileIconAchievements } from "../_profileIconAchievements.js";
import {
  decodeBase64Image,
  deleteR2Object,
  getR2Config,
  uploadR2Webp,
  validateWebpImage,
} from "../_r2ImageStorage.js";

const MAX_REQUEST_BYTES = 320 * 1024;
const MAX_UPLOAD_BYTES = 160 * 1024;
const MAX_IMAGE_DIMENSION = 384;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{2,128}$/;

function reject(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  throw error;
}

async function loadProfile(context) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("id,avatar_key,avatar_source,avatar_icon_key,avatar_color,avatar_updated_at,avatar_uploaded_at,avatar_upload_count,avatar_background_enabled,avatar_border_enabled,avatar_border_color,discord_connection,discord_avatar_url")
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

async function commitProfileIcon(context, avatarIconKey) {
  const { data, error } = await context.supabase.rpc("rankball_select_profile_icon", {
    p_actor_profile_id: context.profileId,
    p_icon_key: avatarIconKey,
  });
  if (!error) return data ?? { ok: true, profileId: context.profileId, avatarIconKey, avatarSource: "icon" };

  const mapped = new Error(error.message || "profile_icon_update_failed");
  mapped.statusCode = error.code === "P0002" ? 404 : 400;
  throw mapped;
}

async function commitProfileIconSettings(context, payload) {
  const { data, error } = await context.supabase.rpc("rankball_save_profile_icon_settings", {
    p_actor_profile_id: context.profileId,
    p_avatar_source: payload.avatarSource,
    p_avatar_icon_key: payload.avatarIconKey,
    p_avatar_color: payload.avatarColor,
    p_background_enabled: payload.avatarBackgroundEnabled,
    p_border_enabled: payload.avatarBorderEnabled,
    p_border_color: payload.avatarBorderColor,
  });
  if (!error) return data ?? { ok: true, profileId: context.profileId };

  const mapped = new Error(error.message || "profile_icon_settings_failed");
  mapped.statusCode = error.code === "P0002" ? 404 : 400;
  throw mapped;
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const contentLength = Number(request.headers["content-length"] || 0);
    if (contentLength > MAX_REQUEST_BYTES) reject(413, "profile_emblem_request_too_large");

    const context = await getAuthenticatedContext(request);
    const body = await readJsonBody(request);
    const action = String(body.action || "upload").trim();
    if (!new Set(["source", "style", "icon", "settings"]).has(action)) reject(410, "profile_emblem_image_disabled");
    if (!PROFILE_ID_PATTERN.test(context.profileId)) reject(400, "invalid_profile_id");

    const profile = await loadProfile(context);
    const previousAvatarKey = profile.avatar_key || null;

    if (action === "settings") {
      const avatarSource = String(body.avatarSource || "initial").trim();
      const avatarIconKey = String(body.avatarIconKey || "").trim();
      const avatarColor = String(body.avatarColor || "").trim();
      const avatarBorderColor = String(body.avatarBorderColor || "").trim();
      if (!new Set(["initial", "discord", "icon"]).has(avatarSource)) reject(400, "invalid_profile_emblem_source");
      if (!isEmblemHexColor(avatarColor) || !isEmblemHexColor(avatarBorderColor)) reject(400, "invalid_emblem_color");

      const achievements = await refreshProfileIconAchievements(context.supabase, context.profileId);
      if (avatarSource === "icon" && (!getProfileIcon(avatarIconKey) || !achievements.unlockedIconKeys.includes(avatarIconKey))) {
        reject(400, "profile_icon_unavailable");
      }
      const result = await commitProfileIconSettings(context, {
        avatarSource,
        avatarIconKey,
        avatarColor,
        avatarBackgroundEnabled: body.avatarBackgroundEnabled !== false,
        avatarBorderEnabled: body.avatarBorderEnabled === true,
        avatarBorderColor,
      });
      sendJson(response, 200, { ...result, unlockedIconKeys: achievements.unlockedIconKeys });
      return;
    }

    if (action === "icon") {
      const avatarIconKey = String(body.avatarIconKey || "").trim();
      const achievements = await refreshProfileIconAchievements(context.supabase, context.profileId);
      if (!getProfileIcon(avatarIconKey) || !achievements.unlockedIconKeys.includes(avatarIconKey)) reject(400, "profile_icon_unavailable");
      sendJson(response, 200, await commitProfileIcon(context, avatarIconKey));
      return;
    }

    if (action === "style") {
      const avatarColor = String(body.avatarColor || "").trim();
      const avatarBorderColor = String(body.avatarBorderColor || "").trim();
      if (!isEmblemHexColor(avatarColor) || !isEmblemHexColor(avatarBorderColor)) reject(400, "invalid_emblem_color");
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
      if (!new Set(["initial", "discord"]).has(avatarSource)) reject(400, "invalid_profile_emblem_source");
      const result = await commitProfile(context, profile, { action, avatarSource, avatarKey: previousAvatarKey });
      sendJson(response, 200, result);
      return;
    }

    const bytes = decodeBase64Image(body.imageBase64, { maxBytes: MAX_UPLOAD_BYTES, errorPrefix: "profile_emblem" });
    validateWebpImage(bytes, { maxDimension: MAX_IMAGE_DIMENSION, errorPrefix: "profile_emblem", safeContainer: true });
    const config = getR2Config();
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const avatarKey = `profile-emblems/${context.profileId}/${digest}.webp`;
    await uploadR2Webp(config, avatarKey, bytes, "profile emblem");

    let result;
    try {
      result = await commitProfile(context, profile, { action, avatarKey, avatarSource: "upload" });
    } catch (error) {
      if (avatarKey !== previousAvatarKey) await deleteR2Object(config, avatarKey, "profile emblem").catch(() => null);
      throw error;
    }

    let storageCleanupPending = false;
    if (previousAvatarKey && previousAvatarKey !== avatarKey) {
      try {
        await deleteR2Object(config, previousAvatarKey, "profile emblem");
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
