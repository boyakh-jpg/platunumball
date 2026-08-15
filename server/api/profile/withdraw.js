import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { authContextCache, authUserCache } from "../_supabaseAuth.js";
import { getAccountWithdrawalIdentities } from "./_accountWithdrawal.js";
import { COMMUNITY_POST_IMAGE_BUCKET } from "../../../shared/lib/communityPolicy.js";

function isMissingLinkedWithdrawalRpc(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  return code === "PGRST202"
    || /rankball_withdraw_linked_account.+(?:not found|schema cache)/i.test(message);
}

async function withdrawProfile(context, identityHashes) {
  const linkedWithdrawal = await context.supabase.rpc("rankball_withdraw_linked_account", {
    p_profile_id: context.profileId,
    p_auth_user_id: context.authUserId,
    p_identity_hashes: identityHashes,
  });
  if (!linkedWithdrawal.error) return linkedWithdrawal.data;
  if (!isMissingLinkedWithdrawalRpc(linkedWithdrawal.error)) throw linkedWithdrawal.error;
  if (identityHashes.length !== 1) throw new Error("account_withdrawal_migration_required");

  const legacyWithdrawal = await context.supabase.rpc("rankball_withdraw_account", {
    p_profile_id: context.profileId,
    p_auth_user_id: context.authUserId,
    p_identity_hash: identityHashes[0],
  });
  if (legacyWithdrawal.error) throw legacyWithdrawal.error;
  return legacyWithdrawal.data;
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    if (body.confirmation !== "탈퇴") {
      return sendJson(response, 400, { error: "account_withdrawal_confirmation_required" });
    }
    const context = await getAuthenticatedContext(request, {
      freshAuth: true,
      profileSelect: "id,auth_user_id,test_login_id",
    });
    if (context.profile?.test_login_id) {
      return sendJson(response, 403, { error: "test_account_withdrawal_forbidden" });
    }

    const { data: communityImages, error: communityImageError } = await context.supabase
      .from("community_posts")
      .select("image_path")
      .eq("author_id", context.profileId)
      .not("image_path", "is", null);
    if (communityImageError) throw communityImageError;

    const identityHashes = getAccountWithdrawalIdentities(context.authUser);
    const data = await withdrawProfile(context, identityHashes);

    const communityImagePaths = (communityImages ?? []).map((row) => row.image_path).filter(Boolean);
    if (communityImagePaths.length) {
      const { error: cleanupError } = await context.supabase.storage.from(COMMUNITY_POST_IMAGE_BUCKET).remove(communityImagePaths);
      if (cleanupError) console.error("Withdrawn community photo cleanup failed.", cleanupError);
    }

    const { error: deleteAuthError } = await context.supabase.auth.admin.deleteUser(context.authUserId);
    if (deleteAuthError) console.error("Withdrawn auth user cleanup failed.", deleteAuthError);
    authUserCache.clear();
    authContextCache.clear();
    sendJson(response, 200, { ok: true, blockedUntil: data?.blockedUntil ?? null });
  } catch (error) {
    console.error("Account withdrawal failed.", error);
    const code = String(error.message || "account_withdrawal_failed");
    const captainBlocked = code.includes("account_withdrawal_team_captain");
    sendJson(response, captainBlocked ? 409 : (error.statusCode || 500), {
      error: captainBlocked ? "account_withdrawal_team_captain" : code,
    });
  }
}
