import {
  allowRequestMethod,
  bearerTokenMatches,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";
import { parseExternalReceiptInput } from "./_createInput.js";
import { MATCH_RECEIPT_RENDER_PRESETS, renderMatchReceiptPng } from "./_pngRenderer.js";

const BODY_MAX_BYTES = 320 * 1024;
const STRING_MAX_LENGTH = 140_000;
const MAX_ACTIVE_RENDERS = 2;
let activeRenders = 0;

function assertAccess(request, secret) {
  if (!secret) {
    const error = new Error("receipt_render_not_configured");
    error.statusCode = 503;
    throw error;
  }
  if (!bearerTokenMatches(request, secret)) {
    const error = new Error("invalid_receipt_render_api_key");
    error.statusCode = 401;
    throw error;
  }
}

function getPreset(value) {
  const preset = String(value ?? MATCH_RECEIPT_RENDER_PRESETS.story).trim();
  return Object.values(MATCH_RECEIPT_RENDER_PRESETS).includes(preset) ? preset : "";
}

export async function handleRenderReceipt(request, response, options = {}) {
  if (!allowRequestMethod(request, response, ["POST"])) return;
  let acquired = false;
  try {
    if (options.authorize) options.authorize();
    else assertAccess(request, options.secret ?? process.env.MATCH_RECEIPT_RENDER_API_KEY ?? "");
    if (activeRenders >= MAX_ACTIVE_RENDERS) {
      response.setHeader("Retry-After", "2");
      return sendJson(response, 429, { error: "receipt_render_busy" });
    }
    const body = await readJsonBody(request, {
      maxBytes: BODY_MAX_BYTES,
      maxStringLength: STRING_MAX_LENGTH,
    });
    const preset = getPreset(body.preset);
    if (!preset) return sendJson(response, 422, { error: "receipt_input_invalid", fields: [{ field: "preset", code: "unsupported_preset" }] });
    const parsed = parseExternalReceiptInput(body, { allowPreparedEmblems: true });
    if (parsed.issues.length > 0) {
      return sendJson(response, 422, { error: "receipt_input_invalid", fields: parsed.issues });
    }

    activeRenders += 1;
    acquired = true;
    const png = await (options.render ?? renderMatchReceiptPng)({
      draft: parsed.draft,
      emblems: parsed.emblems,
      preset,
    });
    response.statusCode = 200;
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Length", String(png.length));
    response.setHeader("Content-Disposition", 'inline; filename="boxtier-match-receipt.png"');
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    return response.end(png);
  } catch (error) {
    if (error?.statusCode) return sendJson(response, error.statusCode, { error: error.code ?? error.message });
    console.warn("Receipt PNG render failed.", error.message);
    return sendJson(response, 500, { error: "receipt_render_failed" });
  } finally {
    if (acquired) activeRenders = Math.max(0, activeRenders - 1);
  }
}

export default function handler(request, response) {
  return handleRenderReceipt(request, response, {
    authorize: () => assertAccess(request, process.env.MATCH_RECEIPT_RENDER_API_KEY ?? ""),
  });
}
