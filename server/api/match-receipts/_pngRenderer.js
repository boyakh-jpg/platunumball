import { renderMatchReceiptPreviewCanvas } from "../../../src/lib/matchReceipt.js";
import { installReceiptCanvasRuntime } from "../../../src/lib/receiptCanvasRuntime.js";
import { nodeReceiptCanvasRuntime } from "./_nodeCanvasRuntime.js";

export const MATCH_RECEIPT_RENDER_PRESETS = Object.freeze({ story: "story", feed: "feed" });

installReceiptCanvasRuntime(nodeReceiptCanvasRuntime);

function emblemDataUrl(emblem) {
  if (!emblem?.imageBase64) return null;
  return `data:${emblem.mimeType || "image/webp"};base64,${emblem.imageBase64}`;
}

export async function renderMatchReceiptPng({
  draft,
  emblems = {},
  preset = MATCH_RECEIPT_RENDER_PRESETS.story,
  matchUrl = "",
}) {
  const canvas = await renderMatchReceiptPreviewCanvas(draft, preset, {
    teamLineArtUrls: {
      home: emblemDataUrl(emblems.home),
      away: emblemDataUrl(emblems.away),
    },
    matchUrl,
  });
  if (typeof canvas.toBuffer !== "function") throw new Error("match_receipt_png_encoder_unavailable");
  return canvas.toBuffer("image/png");
}
