import { normalizeMatchPublicCode } from "../../shared/lib/matchPublicCode.js";
import { isPubliclyReadableConfirmedMatch } from "../../shared/lib/matchRecordTypes.js";

export async function resolveMatchPublicCode(supabase, value) {
  const publicCode = normalizeMatchPublicCode(value);
  if (!publicCode) return null;

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id,public_code,status,visibility,rules")
    .eq("public_code", publicCode)
    .maybeSingle();
  if (matchError) throw matchError;
  if (isPubliclyReadableConfirmedMatch(match)) {
    return { kind: "match", matchId: match.id, publicCode };
  }

  const { data: receipt, error: receiptError } = await supabase
    .from("match_receipt_drafts")
    .select("public_id,public_code,payload,updated_at")
    .eq("public_code", publicCode)
    .gt("expires_at", new Date().toISOString())
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (receiptError) throw receiptError;
  if (receipt?.payload?._canonicalReceipt === true) return null;
  return receipt ? { kind: "receipt", publicId: receipt.public_id, publicCode } : null;
}
