import { getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";
import { parseExternalReceiptInput } from "../match-receipts/_createInput.js";
import { MATCH_RECEIPT_RENDER_PRESETS, renderMatchReceiptPng } from "../match-receipts/_pngRenderer.js";

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export async function handleInstagramReceiptImage(request, response, options = {}) {
  try {
    const publicId = String(request.query?.id ?? "");
    if (!PUBLIC_ID_PATTERN.test(publicId)) return sendJson(response, 404, { error: "receipt_image_not_found" });
    const supabase = options.supabase ?? getSupabaseAdminClient();
    const { data, error } = await supabase.from("instagram_receipt_bot_render_jobs")
      .select("receipt_input,preset,expires_at").eq("public_id", publicId).maybeSingle();
    if (error) throw error;
    if (!data || new Date(data.expires_at).getTime() <= Date.now()) return sendJson(response, 404, { error: "receipt_image_not_found" });
    if (!Object.values(MATCH_RECEIPT_RENDER_PRESETS).includes(data.preset)) throw new Error("invalid_render_job");
    const parsed = parseExternalReceiptInput(data.receipt_input);
    if (parsed.issues.length) throw new Error("invalid_render_job");
    const png = await (options.render ?? renderMatchReceiptPng)({ draft: parsed.draft, emblems: parsed.emblems, preset: data.preset });
    response.statusCode = 200;
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Length", String(png.length));
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return response.end(png);
  } catch (error) {
    console.warn("Instagram receipt image failed.", error.message);
    return sendJson(response, 500, { error: "receipt_image_failed" });
  }
}

export default function handler(request, response) {
  return handleInstagramReceiptImage(request, response);
}
