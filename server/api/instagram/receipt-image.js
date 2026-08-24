import { getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";
import { readTemporaryReceiptPng } from "../match-receipts/_temporaryPngStorage.js";
import sharp from "sharp";

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const INSTAGRAM_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export async function fitInstagramReceiptPng(png, sharpImpl = sharp) {
  if (png.length <= INSTAGRAM_IMAGE_MAX_BYTES) return png;
  const compressed = await sharpImpl(png).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  if (compressed.length <= INSTAGRAM_IMAGE_MAX_BYTES) return compressed;
  const resized = await sharpImpl(compressed).resize({ width: 900, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true, quality: 85 }).toBuffer();
  if (resized.length > INSTAGRAM_IMAGE_MAX_BYTES) throw new Error("instagram_receipt_image_too_large");
  return resized;
}

export async function handleInstagramReceiptImage(request, response, options = {}) {
  try {
    const publicId = String(request.query?.id ?? "");
    if (!PUBLIC_ID_PATTERN.test(publicId)) return sendJson(response, 404, { error: "receipt_image_not_found" });
    const supabase = options.supabase ?? getSupabaseAdminClient();
    const { data, error } = await supabase.from("instagram_receipt_bot_render_jobs")
      .select("expires_at").eq("public_id", publicId).maybeSingle();
    if (error) throw error;
    if (!data || new Date(data.expires_at).getTime() <= Date.now()) return sendJson(response, 404, { error: "receipt_image_not_found" });
    const png = await (options.readPng ?? readTemporaryReceiptPng)(publicId);
    response.statusCode = 200;
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Length", String(png.length));
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return response.end(png);
  } catch (error) {
    console.warn("Instagram receipt image failed.", error.message);
    if (error.statusCode === 404) return sendJson(response, 404, { error: "receipt_image_not_found" });
    return sendJson(response, 500, { error: "receipt_image_failed" });
  }
}

export default function handler(request, response) {
  return handleInstagramReceiptImage(request, response);
}
