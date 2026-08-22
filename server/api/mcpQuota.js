import { getSupabaseAdminClient } from "./_supabaseAuth.js";
import { getReceiptRequestHash } from "./match-receipts/_draftSecurity.js";

export async function consumeMcpReceiptGenerationQuota(request, options = {}) {
  const client = options.client ?? getSupabaseAdminClient();
  const { data, error } = await client.rpc("consume_mcp_receipt_generation_quota", {
    p_request_hash: getReceiptRequestHash(request),
  });
  if (error) throw error;
  return data === true;
}
