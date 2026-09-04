import { getAuthenticatedContext } from "../_supabaseAuth.js";
import { allowRequestMethod, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  getOpponentReceiptCapabilityCookie,
  getReceiptCapabilityCookie,
  projectReceiptVerification,
  receiptCapabilityMatches,
} from "./_draftSecurity.js";

const RECEIPT_PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPPONENT_RESPONSES = new Set(["accepted", "disputed"]);

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["POST"])) return;

  const context = await getAuthenticatedContext(request, { freshAuth: true });
  const body = await readJsonBody(request, { maxBytes: 2_048, maxStringLength: 64 });
  const publicId = String(body.publicId ?? "").trim();
  const nextResponse = String(body.response ?? "").trim();
  if (!RECEIPT_PUBLIC_ID_PATTERN.test(publicId) || !OPPONENT_RESPONSES.has(nextResponse)) {
    return sendJson(response, 400, { error: "receipt_opponent_response_invalid" });
  }

  const { data, error } = await context.supabase
    .from("match_receipt_drafts")
    .select("id,public_id,created_by,capability_hash,opponent_capability_hash,opponent_response,opponent_responded_by,opponent_responded_at,payload,expires_at")
    .eq("public_id", publicId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data || data.payload?._canonicalReceipt === true) {
    return sendJson(response, 404, { error: "receipt_opponent_response_not_found" });
  }

  const opponentCapability = getOpponentReceiptCapabilityCookie(request, publicId);
  const ownerCapability = getReceiptCapabilityCookie(request, publicId);
  const isOwner = String(data.created_by ?? "") === String(context.profileId)
    || (ownerCapability?.publicId === publicId
      && receiptCapabilityMatches(ownerCapability.secret, data.capability_hash));
  if (isOwner) return sendJson(response, 403, { error: "receipt_owner_cannot_respond" });
  if (opponentCapability?.publicId !== publicId
    || !receiptCapabilityMatches(opponentCapability.secret, data.opponent_capability_hash)) {
    return sendJson(response, 403, { error: "receipt_opponent_capability_required" });
  }

  if (data.opponent_response) {
    if (data.opponent_response === nextResponse
      && String(data.opponent_responded_by) === String(context.profileId)) {
      return sendJson(response, 200, { verification: projectReceiptVerification(data) });
    }
    return sendJson(response, 409, { error: "receipt_opponent_response_already_set" });
  }

  const respondedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await context.supabase
    .from("match_receipt_drafts")
    .update({
      opponent_response: nextResponse,
      opponent_responded_by: context.profileId,
      opponent_responded_at: respondedAt,
      updated_at: respondedAt,
    })
    .eq("id", data.id)
    .is("opponent_response", null)
    .select("opponent_response,opponent_responded_at,payload")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) return sendJson(response, 409, { error: "receipt_opponent_response_already_set" });

  response.setHeader("Cache-Control", "private, no-store");
  return sendJson(response, 200, { verification: projectReceiptVerification(updated) });
}
