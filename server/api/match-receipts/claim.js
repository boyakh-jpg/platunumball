import { getAuthenticatedContext } from "../_supabaseAuth.js";
import { readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  getReceiptCapabilityCookie,
  receiptCapabilityMatches,
  sanitizeReceiptDraftPayload,
} from "./_draftSecurity.js";

export default async function handler(request, response) {
  const context = await getAuthenticatedContext(request);
  const body = await readJsonBody(request, { maxBytes: 4_096, maxStringLength: 256 });
  const publicId = String(body.publicId ?? "").trim();
  const capability = getReceiptCapabilityCookie(request);
  if (!publicId || capability?.publicId !== publicId) return sendJson(response, 403, { error: "receipt_capability_required" });

  const { data: current, error: loadError } = await context.supabase
    .from("match_receipt_drafts")
    .select("public_id,capability_hash,payload,expires_at,claimed_by,claimed_at")
    .eq("public_id", publicId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (loadError) throw loadError;
  if (!current) return sendJson(response, 404, { error: "receipt_draft_not_found" });
  if (!receiptCapabilityMatches(capability.secret, current.capability_hash)) return sendJson(response, 403, { error: "receipt_capability_invalid" });
  if (current.claimed_by && current.claimed_by !== context.profileId) return sendJson(response, 409, { error: "receipt_draft_already_claimed" });

  const { data, error } = current.claimed_by
    ? { data: current, error: null }
    : await context.supabase
      .from("match_receipt_drafts")
      .update({ claimed_by: context.profileId, claimed_at: new Date().toISOString() })
      .eq("public_id", publicId)
      .is("claimed_at", null)
      .select("payload,expires_at")
      .maybeSingle();
  if (error) throw error;
  if (!data) return sendJson(response, 409, { error: "receipt_draft_already_claimed" });
  return sendJson(response, 200, { publicId, draft: sanitizeReceiptDraftPayload(data.payload), expiresAt: data.expires_at });
}
