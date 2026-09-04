import { normalizeMatchPublicCode } from "../../../shared/lib/matchPublicCode.js";
import { allowRequestMethod, getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";
import { projectPublicReceiptDraft, projectReceiptVerification } from "./_draftSecurity.js";
import {
  canExposeStoredReceiptDraft,
  consumePublicReceiptReadQuota,
} from "./_publicDraft.js";

export async function handlePublicReceipt(request, response, options = {}) {
  if (!allowRequestMethod(request, response, ["GET"])) return;

  const publicCode = normalizeMatchPublicCode(request.query?.code);
  if (!publicCode) return sendJson(response, 400, { error: "receipt_public_code_invalid" });

  const supabase = options.supabase ?? getSupabaseAdminClient();
  try {
    if (!await consumePublicReceiptReadQuota(supabase, request)) {
      response.setHeader("Retry-After", "3600");
      return sendJson(response, 429, { error: "receipt_draft_rate_limited" });
    }

    const { data, error } = await supabase
      .from("match_receipt_drafts")
      .select("public_id,public_code,payload,expires_at,opponent_response,opponent_responded_at")
      .eq("public_code", publicCode)
      .gt("expires_at", new Date().toISOString())
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data || !await canExposeStoredReceiptDraft(supabase, data.payload)) {
      return sendJson(response, 404, { error: "receipt_draft_not_found" });
    }

    response.setHeader("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=60");
    return response.status(200).json({
      object: "match_receipt",
      publicId: data.public_id,
      publicCode: data.public_code,
      expiresAt: data.expires_at,
      receipt: projectPublicReceiptDraft(data.payload, {
        publicId: data.public_id,
        publicCode: data.public_code,
      }),
      verification: projectReceiptVerification(data),
    });
  } catch (error) {
    console.warn("Public receipt lookup failed.", error.message);
    return sendJson(response, 500, { error: "receipt_public_lookup_failed" });
  }
}

export default function handler(request, response) {
  return handlePublicReceipt(request, response);
}
