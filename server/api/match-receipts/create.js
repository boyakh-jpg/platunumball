import {
  allowRequestMethod,
  getSupabaseAdminClient,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";
import {
  createReceiptCapability,
  getReceiptRequestHash,
  hashReceiptCapability,
  projectPublicReceiptDraft,
  sanitizeReceiptDraftPayload,
} from "./_draftSecurity.js";
import { parseExternalReceiptInput } from "./_createInput.js";

export async function handleCreateReceipt(request, response, options = {}) {
  if (!allowRequestMethod(request, response, ["POST"])) return;

  try {
    const body = await readJsonBody(request, { maxBytes: 16_384, maxStringLength: 1_000 });
    const parsed = parseExternalReceiptInput(body);
    if (parsed.issues.length > 0) {
      return sendJson(response, 422, { error: "receipt_input_invalid", fields: parsed.issues });
    }

    const supabase = options.supabase ?? getSupabaseAdminClient();
    const { data: allowed, error: rateError } = await supabase.rpc("consume_match_receipt_draft_quota", {
      p_request_hash: getReceiptRequestHash(request),
    });
    if (rateError) throw rateError;
    if (!allowed) {
      response.setHeader("Retry-After", "3600");
      return sendJson(response, 429, { error: "receipt_draft_rate_limited" });
    }

    const capability = createReceiptCapability();
    const payload = sanitizeReceiptDraftPayload(parsed.draft);
    const { data, error } = await supabase
      .from("match_receipt_drafts")
      .insert({
        public_id: capability.publicId,
        capability_hash: hashReceiptCapability(capability.secret),
        payload,
      })
      .select("public_id,public_code,expires_at")
      .single();
    if (error) throw error;

    const publicCode = data.public_code;
    response.setHeader("Cache-Control", "no-store");
    return sendJson(response, 201, {
      object: "match_receipt",
      publicId: data.public_id,
      publicCode,
      expiresAt: data.expires_at,
      receiptPath: `/app/receipt?code=${encodeURIComponent(publicCode)}`,
      apiPath: `/api/match-receipts/public?code=${encodeURIComponent(publicCode)}`,
      receipt: projectPublicReceiptDraft(payload, { publicId: data.public_id, publicCode }),
    });
  } catch (error) {
    if (error?.statusCode) return sendJson(response, error.statusCode, { error: error.code });
    console.warn("External receipt creation failed.", error.message);
    return sendJson(response, 500, { error: "receipt_create_failed" });
  }
}

export default function handler(request, response) {
  return handleCreateReceipt(request, response);
}
