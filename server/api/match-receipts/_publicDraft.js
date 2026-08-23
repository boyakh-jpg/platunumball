import { getSupabaseAdminClient } from "../_supabaseAdmin.js";
import { canCreatePublicMatchReceiptSnapshot } from "../../../src/lib/matchReceipt.js";
import {
  createReceiptCapability,
  getLegacyCanonicalReceiptMatchId,
  getReceiptRequestHash,
  hashReceiptCapability,
  projectPublicReceiptDraft,
  sanitizeReceiptDraftPayload,
} from "./_draftSecurity.js";

export async function consumePublicReceiptReadQuota(supabase, request) {
  const { data: allowed, error } = await supabase.rpc("consume_match_receipt_draft_read_quota", {
    p_request_hash: getReceiptRequestHash(request),
  });
  if (error) throw error;
  return allowed === true;
}

export async function canExposeStoredReceiptDraft(supabase, payload) {
  const sourceMatchId = getLegacyCanonicalReceiptMatchId(payload);
  if (!sourceMatchId) return true;
  const { data, error } = await supabase
    .from("matches")
    .select("id,status,visibility,rules")
    .eq("id", sourceMatchId)
    .maybeSingle();
  if (error) throw error;
  return canCreatePublicMatchReceiptSnapshot(data);
}

function receiptDraftError(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export async function createPublicReceiptDraft(draft, options = {}) {
  const request = options.request;
  const supabase = options.supabase ?? getSupabaseAdminClient();
  if (options.enforceQuota !== false) {
    const { data: allowed, error: rateError } = await supabase.rpc("consume_match_receipt_draft_quota", {
      p_request_hash: getReceiptRequestHash(request),
    });
    if (rateError) throw rateError;
    if (!allowed) throw receiptDraftError("receipt_draft_rate_limited", 429);
  }

  const capability = createReceiptCapability();
  const payload = sanitizeReceiptDraftPayload(draft);
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
  return {
    object: "match_receipt",
    publicId: data.public_id,
    publicCode,
    expiresAt: data.expires_at,
    receiptPath: `/app/receipt?code=${encodeURIComponent(publicCode)}`,
    apiPath: `/api/match-receipts/public?code=${encodeURIComponent(publicCode)}`,
    receipt: projectPublicReceiptDraft(payload, { publicId: data.public_id, publicCode }),
  };
}
