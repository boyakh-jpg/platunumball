import { createHash } from "node:crypto";
import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { isEmblemHexColor } from "../../../shared/lib/emblemPolicy.js";
import {
  TEAM_EMBLEM_MAX_DIMENSION,
  TEAM_EMBLEM_UPLOAD_MAX_BYTES,
  isTeamEmblemAbbreviation,
  isTeamEmblemFont,
  isTeamEmblemTextMode,
  normalizeTeamEmblemAbbreviation,
} from "../../../shared/lib/teamEmblem.js";
import {
  decodeBase64Image,
  deleteR2Object,
  getR2Config,
  uploadR2Webp,
  validateWebpImage,
} from "../_r2ImageStorage.js";

const MAX_REQUEST_BYTES = 224 * 1024;
const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{2,128}$/;

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export { getR2Config };

export async function deleteObject(config, objectKey) {
  return deleteR2Object(config, objectKey, "team emblem");
}

async function loadTeamForActor(context, teamId) {
  const [{ data: team, error: teamError }, { data: captain, error: captainError }] = await Promise.all([
    context.supabase
      .from("teams")
      .select("id,emblem_key,emblem_previous_key,emblem_source,emblem_updated_at,emblem_uploaded_at,emblem_upload_count,emblem_color,emblem_border_enabled,emblem_border_color,emblem_text_mode,emblem_abbreviation,emblem_font,emblem_violation_count,emblem_upload_blocked_until,emblem_moderated_at,emblem_moderation_reason,receipt_emblem_key,receipt_emblem_updated_at,deleted_at")
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
  mapped.statusCode = ["team_emblem_cooldown", "team_emblem_moderation_blocked"].includes(error.message) ? 429 : error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400;
  mapped.nextAllowedAt = error.details || null;
  throw mapped;
}

async function commitReceiptEmblem(context, teamId, emblemKey, expectedEmblemKey) {
  const { data, error } = await context.supabase.rpc("rankball_update_team_receipt_emblem", {
    p_actor_profile_id: context.profileId,
    p_team_id: teamId,
    p_emblem_key: emblemKey || null,
    p_expected_emblem_key: expectedEmblemKey || null,
  });
  if (!error) return data ?? { ok: true, teamId, receiptEmblemKey: emblemKey || null };

  const mapped = new Error(error.message || "team_receipt_emblem_update_failed");
  mapped.statusCode = error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "P0002" ? 404 : 400;
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
  mapped.statusCode = error.message === "team_emblem_moderation_blocked" ? 429 : error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400;
  mapped.nextAllowedAt = error.details || null;
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

async function restoreEmblem(context, teamId, expectedEmblemKey, expectedPreviousEmblemKey) {
  const { data, error } = await context.supabase.rpc("rankball_restore_team_emblem", {
    p_actor_profile_id: context.profileId,
    p_team_id: teamId,
    p_expected_emblem_key: expectedEmblemKey || null,
    p_expected_previous_emblem_key: expectedPreviousEmblemKey || null,
  });
  if (!error) return data ?? { ok: true, teamId };

  const mapped = new Error(error.message || "team_emblem_restore_failed");
  mapped.statusCode = error.message === "team_emblem_moderation_blocked" ? 429 : error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "P0002" ? 404 : 400;
  mapped.nextAllowedAt = error.details || null;
  throw mapped;
}

function getPublicEmblemResult(result = {}) {
  const {
    previousEmblemKey: _previousEmblemKey,
    removedEmblemKey: _removedEmblemKey,
    discardedEmblemKey: _discardedEmblemKey,
    removedReceiptEmblemKey: _removedReceiptEmblemKey,
    ...publicResult
  } = result;
  return publicResult;
}

function isTeamEmblemKeyRetained(team, objectKey, nextReceiptEmblemKey = team.receipt_emblem_key) {
  return Boolean(objectKey) && [
    team.emblem_key,
    team.emblem_previous_key,
    nextReceiptEmblemKey,
  ].filter(Boolean).includes(objectKey);
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const contentLength = Number(request.headers["content-length"] || 0);
    if (contentLength > MAX_REQUEST_BYTES) reject(413, "team_emblem_request_too_large");

    const context = await getAuthenticatedContext(request);
    const body = await readJsonBody(request);
    const action = String(body.action || "upload").trim();
    const teamId = String(body.teamId || "").trim();
    if (!TEAM_ID_PATTERN.test(teamId)) reject(400, "invalid_team_id");
    if (!new Set(["upload", "remove", "restore", "source", "status", "style", "receipt-upload", "receipt-remove"]).has(action)) reject(400, "invalid_team_emblem_action");

    const team = await loadTeamForActor(context, teamId);
    const previousEmblemKey = team.emblem_key || null;
    const retainedEmblemKey = team.emblem_previous_key || null;
    const previousReceiptEmblemKey = team.receipt_emblem_key || null;
    if (action === "upload" && team.emblem_upload_blocked_until && new Date(team.emblem_upload_blocked_until).getTime() > Date.now()) {
      const blocked = new Error("team_emblem_moderation_blocked");
      blocked.statusCode = 429;
      blocked.nextAllowedAt = team.emblem_upload_blocked_until;
      throw blocked;
    }

    if (action === "style") {
      const emblemColor = String(body.emblemColor || "").trim();
      const emblemBorderColor = String(body.emblemBorderColor || "").trim();
      const emblemTextMode = String(body.emblemTextMode ?? team.emblem_text_mode ?? "initial").trim().toLowerCase();
      const emblemAbbreviation = normalizeTeamEmblemAbbreviation(body.emblemAbbreviation ?? team.emblem_abbreviation ?? "");
      const emblemFont = String(body.emblemFont ?? team.emblem_font ?? "sport").trim().toLowerCase();
      const emblemAbbreviationIsValid = isTeamEmblemAbbreviation(emblemAbbreviation);
      if (!isEmblemHexColor(emblemColor) || !isEmblemHexColor(emblemBorderColor)) reject(400, "invalid_emblem_color");
      if (!isTeamEmblemTextMode(emblemTextMode)) reject(400, "invalid_team_emblem_text_mode");
      if ((emblemAbbreviation || emblemTextMode === "abbreviation") && !emblemAbbreviationIsValid) {
        reject(400, "invalid_team_emblem_abbreviation");
      }
      if (!isTeamEmblemFont(emblemFont)) reject(400, "invalid_team_emblem_font");
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

    if (action === "status") {
      sendJson(response, 200, { ok: true, teamId, emblemCanRestore: Boolean(retainedEmblemKey) });
      return;
    }

    if (action === "restore") {
      const result = await restoreEmblem(context, teamId, previousEmblemKey, retainedEmblemKey);
      sendJson(response, 200, getPublicEmblemResult(result));
      return;
    }

    const config = getR2Config();

    if (action === "receipt-remove") {
      const result = await commitReceiptEmblem(context, teamId, null, previousReceiptEmblemKey);
      const removedKey = result?.removedReceiptEmblemKey ?? previousReceiptEmblemKey;
      let storageCleanupPending = false;
      if (removedKey && !isTeamEmblemKeyRetained(team, removedKey, null)) {
        try {
          await deleteObject(config, removedKey);
        } catch {
          storageCleanupPending = true;
        }
      }
      sendJson(response, 200, { ...getPublicEmblemResult(result), storageCleanupPending });
      return;
    }

    if (action === "remove") {
      const result = await commitEmblem(context, teamId, null, previousEmblemKey);
      let storageCleanupPending = false;
      const cleanupKeys = [...new Set([
        result?.removedEmblemKey ?? previousEmblemKey,
        result?.discardedEmblemKey ?? retainedEmblemKey,
      ].filter(Boolean))];
      for (const cleanupKey of cleanupKeys) {
        if (cleanupKey === previousReceiptEmblemKey) continue;
        try {
          await deleteObject(config, cleanupKey);
        } catch {
          storageCleanupPending = true;
        }
      }
      sendJson(response, 200, { ...getPublicEmblemResult(result), storageCleanupPending });
      return;
    }

    const bytes = decodeBase64Image(body.imageBase64, { maxBytes: TEAM_EMBLEM_UPLOAD_MAX_BYTES, errorPrefix: "team_emblem" });
    validateWebpImage(bytes, { maxDimension: TEAM_EMBLEM_MAX_DIMENSION, errorPrefix: "team_emblem", safeContainer: true });
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const emblemKey = `team-emblems/${teamId}/${digest}.webp`;
    await uploadR2Webp(config, emblemKey, bytes, "team emblem");

    if (action === "receipt-upload") {
      let result;
      try {
        result = await commitReceiptEmblem(context, teamId, emblemKey, previousReceiptEmblemKey);
      } catch (error) {
        if (!isTeamEmblemKeyRetained(team, emblemKey)) await deleteObject(config, emblemKey).catch(() => null);
        throw error;
      }

      let storageCleanupPending = false;
      const removedKey = result?.removedReceiptEmblemKey ?? previousReceiptEmblemKey;
      if (removedKey && removedKey !== emblemKey && !isTeamEmblemKeyRetained(team, removedKey, emblemKey)) {
        try {
          await deleteObject(config, removedKey);
        } catch {
          storageCleanupPending = true;
        }
      }
      sendJson(response, 200, { ...getPublicEmblemResult(result), byteSize: bytes.length, storageCleanupPending });
      return;
    }

    let result;
    try {
      result = await commitEmblem(context, teamId, emblemKey, previousEmblemKey);
    } catch (error) {
      if (!isTeamEmblemKeyRetained(team, emblemKey)) await deleteObject(config, emblemKey).catch(() => null);
      throw error;
    }

    let storageCleanupPending = false;
    if (result?.discardedEmblemKey && result.discardedEmblemKey !== emblemKey && result.discardedEmblemKey !== previousReceiptEmblemKey) {
      try {
        await deleteObject(config, result.discardedEmblemKey);
      } catch {
        storageCleanupPending = true;
      }
    }
    sendJson(response, 200, { ...getPublicEmblemResult(result), byteSize: bytes.length, storageCleanupPending });
  } catch (error) {
    console.error("Team emblem action failed.", error.message);
    sendJson(response, error.statusCode || 500, {
      error: error.message || "team_emblem_action_failed",
      ...(error.nextAllowedAt ? { details: { nextAllowedAt: error.nextAllowedAt } } : {}),
    });
  }
}
