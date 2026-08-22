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
import { deleteReceiptEmblemKeys, uploadDraftReceiptEmblem } from "./_emblemStorage.js";

const EXTERNAL_RECEIPT_BODY_MAX_BYTES = 320 * 1024;
const EXTERNAL_RECEIPT_STRING_MAX_LENGTH = 140_000;

export async function handleCreateReceipt(request, response, options = {}) {
  if (!allowRequestMethod(request, response, ["POST"])) return;

  const uploadEmblem = options.uploadEmblem ?? uploadDraftReceiptEmblem;
  const deleteEmblemKeys = options.deleteEmblemKeys ?? deleteReceiptEmblemKeys;
  const uploadedEmblemKeys = [];
  let draftStored = false;
  try {
    const body = await readJsonBody(request, {
      maxBytes: EXTERNAL_RECEIPT_BODY_MAX_BYTES,
      maxStringLength: EXTERNAL_RECEIPT_STRING_MAX_LENGTH,
    });
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
    const emblemKeys = {};
    for (const side of ["home", "away"]) {
      const emblem = parsed.emblems[side];
      if (!emblem) continue;
      emblemKeys[side] = await uploadEmblem({
        publicId: capability.publicId,
        side,
        imageBase64: emblem.imageBase64,
      });
      uploadedEmblemKeys.push(emblemKeys[side]);
    }
    const payload = {
      ...sanitizeReceiptDraftPayload(parsed.draft),
      ...(emblemKeys.home ? { homeGuestEmblemKey: emblemKeys.home, homeUseLineArt: true } : {}),
      ...(emblemKeys.away ? { awayGuestEmblemKey: emblemKeys.away, awayUseLineArt: true } : {}),
    };
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
    draftStored = true;

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
    if (!draftStored && uploadedEmblemKeys.length > 0) {
      await deleteEmblemKeys(uploadedEmblemKeys).catch(() => {});
    }
    if (error?.statusCode) return sendJson(response, error.statusCode, { error: error.code ?? error.message });
    console.warn("External receipt creation failed.", error.message);
    return sendJson(response, 500, { error: "receipt_create_failed" });
  }
}

export default function handler(request, response) {
  return handleCreateReceipt(request, response);
}
