import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { authContextCache, authUserCache } from "../_supabaseAuth.js";
import { getAccountWithdrawalIdentity } from "./_accountWithdrawal.js";

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

    const { data, error } = await context.supabase.rpc("rankball_withdraw_account", {
      p_profile_id: context.profileId,
      p_auth_user_id: context.authUserId,
      p_identity_hash: getAccountWithdrawalIdentity(context.authUser),
    });
    if (error) throw error;

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
