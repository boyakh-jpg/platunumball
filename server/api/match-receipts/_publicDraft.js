import { canCreatePublicMatchReceiptSnapshot } from "../../../src/lib/matchReceipt.js";
import {
  getLegacyCanonicalReceiptMatchId,
  getReceiptRequestHash,
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
