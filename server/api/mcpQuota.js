import { getSupabaseAdminClient } from "./_supabaseAuth.js";
import { getReceiptPrincipalHash, getReceiptRequestHash } from "./match-receipts/_draftSecurity.js";

export async function consumeMcpReceiptGenerationQuota(request, options = {}) {
  const client = options.client ?? getSupabaseAdminClient();
  const bucketHash = options.principal
    ? getReceiptPrincipalHash(options.principal)
    : getReceiptRequestHash(request);
  const { data, error } = await client.rpc("consume_mcp_receipt_generation_quota", {
    p_request_hash: bucketHash,
  });
  if (error) throw error;
  return data === true;
}
