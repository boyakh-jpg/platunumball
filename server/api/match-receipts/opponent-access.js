import { setApiSecurityHeaders } from "../_requestSecurity.js";
import { allowRequestMethod, getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";
import {
  receiptCapabilityMatches,
  setOpponentReceiptCapabilityCookie,
} from "./_draftSecurity.js";

const RECEIPT_PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["GET"])) return;

  const publicId = String(request.query?.draft ?? "").trim();
  const token = String(request.query?.token ?? "").trim();
  if (!RECEIPT_PUBLIC_ID_PATTERN.test(publicId) || !RECEIPT_TOKEN_PATTERN.test(token)) {
    return sendJson(response, 400, { error: "receipt_opponent_invite_invalid" });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("match_receipt_drafts")
    .select("public_id,opponent_capability_hash,payload,expires_at")
    .eq("public_id", publicId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data || data.payload?._canonicalReceipt === true
    || !receiptCapabilityMatches(token, data.opponent_capability_hash)) {
    return sendJson(response, 404, { error: "receipt_opponent_invite_not_found" });
  }

  setOpponentReceiptCapabilityCookie(response, { publicId, secret: token });
  setApiSecurityHeaders(response);
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Location", `/app/receipt?draft=${encodeURIComponent(publicId)}&respond=1`);
  response.statusCode = 302;
  return response.end();
}
