import { getSupabaseAdminClient } from "../_supabaseAuth.js";
import { readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  createReceiptCapability,
  getReceiptRequestHash,
  hashReceiptCapability,
  sanitizeReceiptDraftPayload,
  setReceiptCapabilityCookie,
} from "./_draftSecurity.js";

function getPublicId(request) {
  return String(request.query?.publicId ?? "").trim();
}

export default async function handler(request, response) {
  const supabase = getSupabaseAdminClient();

  if (request.method === "GET") {
    const publicId = getPublicId(request);
    if (!publicId) return sendJson(response, 400, { error: "receipt_public_id_required" });
    const { data, error } = await supabase
      .from("match_receipt_drafts")
      .select("public_id,payload,expires_at,claimed_at")
      .eq("public_id", publicId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    if (!data) return sendJson(response, 404, { error: "receipt_draft_not_found" });
    response.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return sendJson(response, 200, {
      publicId: data.public_id,
      draft: sanitizeReceiptDraftPayload(data.payload),
      expiresAt: data.expires_at,
      claimed: Boolean(data.claimed_at),
    });
  }

  const body = await readJsonBody(request, { maxBytes: 16_384, maxStringLength: 1_000 });
  const payload = sanitizeReceiptDraftPayload(body.draft);
  if (!payload.homeTeam || !payload.awayTeam) return sendJson(response, 400, { error: "receipt_draft_invalid" });

  const { data: allowed, error: rateError } = await supabase.rpc("consume_match_receipt_draft_quota", {
    p_request_hash: getReceiptRequestHash(request),
  });
  if (rateError) throw rateError;
  if (!allowed) return sendJson(response, 429, { error: "receipt_draft_rate_limited" });

  const capability = createReceiptCapability();
  const { data, error } = await supabase
    .from("match_receipt_drafts")
    .insert({
      public_id: capability.publicId,
      capability_hash: hashReceiptCapability(capability.secret),
      payload,
    })
    .select("public_id,expires_at")
    .single();
  if (error) throw error;

  setReceiptCapabilityCookie(response, capability);
  return sendJson(response, 201, { publicId: data.public_id, expiresAt: data.expires_at });
}
