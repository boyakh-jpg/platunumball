import { sendJson } from "../_supabaseAdmin.js";
import { readTemporaryReceiptPng, verifyTemporaryReceiptDownload } from "./_temporaryPngStorage.js";

export async function handleTemporaryReceiptDownload(request, response, options = {}) {
  try {
    const verified = (options.verify ?? verifyTemporaryReceiptDownload)({
      id: request.query?.id,
      expires: request.query?.expires,
      signature: request.query?.signature,
    }, options);
    const png = await (options.readPng ?? readTemporaryReceiptPng)(verified.id);
    response.statusCode = 200;
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Length", String(png.length));
    response.setHeader("Content-Disposition", 'attachment; filename="boxtier-receipt.png"');
    response.setHeader("Cache-Control", "private, no-store, max-age=0");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return response.end(png);
  } catch (error) {
    if (error?.statusCode === 404) return sendJson(response, 404, { error: "receipt_png_not_found" });
    console.warn("Temporary receipt download failed.", error?.message);
    return sendJson(response, 500, { error: "receipt_png_download_failed" });
  }
}

export default function handler(request, response) {
  return handleTemporaryReceiptDownload(request, response);
}
