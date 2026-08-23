import {
  allowRequestMethod,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";
import { parseExternalReceiptInput } from "./_createInput.js";
import { createPublicReceiptDraft } from "./_publicDraft.js";

export async function handleCreateReceipt(request, response, options = {}) {
  if (!allowRequestMethod(request, response, ["POST"])) return;

  try {
    const body = await readJsonBody(request, { maxBytes: 16_384, maxStringLength: 1_000 });
    const parsed = parseExternalReceiptInput(body);
    if (parsed.issues.length > 0) {
      return sendJson(response, 422, { error: "receipt_input_invalid", fields: parsed.issues });
    }

    const result = await createPublicReceiptDraft(parsed.draft, {
      request,
      supabase: options.supabase,
    });
    response.setHeader("Cache-Control", "no-store");
    return sendJson(response, 201, result);
  } catch (error) {
    if (error?.statusCode) {
      if (error.code === "receipt_draft_rate_limited") response.setHeader("Retry-After", "3600");
      return sendJson(response, error.statusCode, { error: error.code });
    }
    console.warn("External receipt creation failed.", error.message);
    return sendJson(response, 500, { error: "receipt_create_failed" });
  }
}

export default function handler(request, response) {
  return handleCreateReceipt(request, response);
}
