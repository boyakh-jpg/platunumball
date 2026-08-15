import { createHash } from "node:crypto";

function hashWithdrawalIdentity(provider, subject) {
  return createHash("sha256").update(`boxtier-withdrawal:v1:${provider}:${subject}`).digest("hex");
}

export function getAccountWithdrawalIdentities(authUser = {}) {
  const identities = (authUser.identities ?? []).flatMap((identity) => {
    const provider = String(identity?.provider || "").trim();
    const subject = String(identity?.identity_data?.sub || identity?.identity_id || "").trim();
    return provider && subject ? [hashWithdrawalIdentity(provider, subject)] : [];
  });
  if (identities.length) return [...new Set(identities)].sort();

  const provider = String(authUser.app_metadata?.provider || "auth").trim();
  const subject = authUser.email?.trim().toLowerCase() || authUser.id;
  if (!subject) throw new Error("account_identity_missing");
  return [hashWithdrawalIdentity(provider, subject)];
}

export function getAccountWithdrawalIdentity(authUser = {}) {
  return getAccountWithdrawalIdentities(authUser)[0];
}

export async function assertAccountRejoinAllowed(supabase, authUser) {
  const identityHashes = getAccountWithdrawalIdentities(authUser);
  const { data, error } = await supabase
    .from("account_withdrawals")
    .select("blocked_until")
    .in("identity_hash", identityHashes)
    .gt("blocked_until", new Date().toISOString())
    .order("blocked_until", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.blocked_until) return;
  const blocked = new Error("account_rejoin_blocked");
  blocked.statusCode = 403;
  blocked.blockedUntil = data.blocked_until;
  throw blocked;
}
