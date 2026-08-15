import { getSupabaseAdminClient } from "../_supabaseAuth.js";
import { allowRequestMethod, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  getReceiptCapabilityCookie,
  getReceiptRequestHash,
  receiptCapabilityMatches,
} from "./_draftSecurity.js";
import {
  deleteDraftReceiptEmblem,
  getSafeDraftReceiptEmblems,
  MATCH_RECEIPT_EMBLEM_FIELDS,
  uploadDraftReceiptEmblem,
} from "./_emblemStorage.js";

const PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function deleteUploadWhenUnreferenced(supabase, publicId, side, key) {
  if (!key) return;
  const { data } = await supabase
    .from("match_receipt_drafts")
    .select("payload")
    .eq("public_id", publicId)
    .maybeSingle();
  if (getSafeDraftReceiptEmblems(data?.payload, publicId)[side] === key) return;
  await deleteDraftReceiptEmblem({ publicId, side, key });
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["POST", "DELETE"])) return;
  const body = await readJsonBody(request, { maxBytes: 150_000, maxStringLength: 140_000 });
  const publicId = String(body.publicId ?? "").trim();
  const side = body.side === "home" || body.side === "away" ? body.side : "";
  if (!PUBLIC_ID_PATTERN.test(publicId) || !side) return sendJson(response, 400, { error: "receipt_emblem_target_invalid" });

  const supabase = getSupabaseAdminClient();
  const { data: allowed, error: rateError } = await supabase.rpc("consume_match_receipt_draft_quota", {
    p_request_hash: getReceiptRequestHash(request),
  });
  if (rateError) throw rateError;
  if (!allowed) return sendJson(response, 429, { error: "receipt_draft_rate_limited" });

  const { data: existing, error } = await supabase
    .from("match_receipt_drafts")
    .select("id,public_id,capability_hash,payload,expires_at,claimed_at,updated_at")
    .eq("public_id", publicId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  const capability = existing && getReceiptCapabilityCookie(request, existing.public_id);
  if (!existing || existing.claimed_at || !capability
    || capability.publicId !== existing.public_id
    || !receiptCapabilityMatches(capability.secret, existing.capability_hash)) {
    return sendJson(response, 403, { error: "receipt_capability_required" });
  }

  const field = MATCH_RECEIPT_EMBLEM_FIELDS[side];
  const current = getSafeDraftReceiptEmblems(existing.payload, publicId)[side];
  let nextKey = "";
  const deleting = request.method === "DELETE" || body.action === "delete";
  if (!deleting) {
    nextKey = await uploadDraftReceiptEmblem({
      publicId,
      side,
      imageBase64: body.imageBase64,
      previousKey: current,
    });
  }
  const payload = { ...existing.payload, [field]: nextKey };
  let updated;
  try {
    const result = await supabase
      .from("match_receipt_drafts")
      .update({ payload, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("updated_at", existing.updated_at)
      .is("claimed_at", null)
      .select("id")
      .maybeSingle();
    if (result.error) throw result.error;
    updated = result.data;
  } catch (updateError) {
    if (nextKey && nextKey !== current) {
      await deleteUploadWhenUnreferenced(supabase, publicId, side, nextKey).catch(() => {});
    }
    throw updateError;
  }
  if (!updated) {
    if (nextKey && nextKey !== current) {
      await deleteUploadWhenUnreferenced(supabase, publicId, side, nextKey).catch(() => {});
    }
    return sendJson(response, 409, { error: "receipt_emblem_stale" });
  }
  if (!deleting && current && current !== nextKey) {
    await deleteDraftReceiptEmblem({ publicId, side, key: current }).catch((cleanupError) => {
      console.error("Match receipt emblem replacement cleanup failed.", cleanupError);
    });
  }
  if (deleting && current) {
    await deleteDraftReceiptEmblem({ publicId, side, key: current }).catch((cleanupError) => {
      console.error("Match receipt emblem deletion cleanup failed.", cleanupError);
    });
  }
  response.setHeader("Cache-Control", "private, no-store");
  return sendJson(response, 200, { publicId, side, key: nextKey });
}
