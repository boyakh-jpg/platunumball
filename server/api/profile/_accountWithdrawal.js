import { createHash } from "node:crypto";

export function getAccountWithdrawalIdentity(authUser = {}) {
  const googleIdentity = (authUser.identities ?? []).find((identity) => identity?.provider === "google");
  const provider = googleIdentity ? "google" : String(authUser.app_metadata?.provider || "auth");
  const subject = googleIdentity?.identity_data?.sub
    || googleIdentity?.identity_id
    || authUser.email?.trim().toLowerCase()
    || authUser.id;
  if (!subject) throw new Error("account_identity_missing");
  return createHash("sha256").update(`boxtier-withdrawal:v1:${provider}:${subject}`).digest("hex");
}

export async function assertAccountRejoinAllowed(supabase, authUser) {
  const identityHash = getAccountWithdrawalIdentity(authUser);
  const { data, error } = await supabase
    .from("account_withdrawals")
    .select("blocked_until")
    .eq("identity_hash", identityHash)
    .gt("blocked_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  if (!data?.blocked_until) return;
  const blocked = new Error("account_rejoin_blocked");
  blocked.statusCode = 403;
  blocked.blockedUntil = data.blocked_until;
  throw blocked;
}
