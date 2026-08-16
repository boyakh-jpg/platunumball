import {
  allowRequestMethod,
  getAuthenticatedContext,
  readJsonBody,
  sendJson,
} from "../_supabaseAdmin.js";
import { authContextCache, authUserCache } from "../_supabaseAuth.js";

const RELEASE_CONFIRMATION = "기존 아이디 연결";
const SUPPORTED_PROVIDER_IDS = new Set(["google", "kakao"]);

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    if (body?.confirmation !== RELEASE_CONFIRMATION) {
      return sendJson(response, 400, {
        ok: false,
        error: "identity_release_confirmation_required",
      });
    }

    const context = await getAuthenticatedContext(request, {
      freshAuth: true,
      allowMissingProfile: true,
      profileSelect: "id,auth_user_id",
    });

    if (context.profileId) {
      return sendJson(response, 409, {
        ok: false,
        error: "profile_already_exists",
      });
    }

    const identities = Array.isArray(context.authUser?.identities)
      ? context.authUser.identities.filter(Boolean)
      : [];
    const releasedProvider = identities[0]?.provider ?? "";
    if (
      identities.length !== 1
      || !SUPPORTED_PROVIDER_IDS.has(releasedProvider)
    ) {
      return sendJson(response, 409, {
        ok: false,
        error: "identity_release_not_allowed",
      });
    }

    const { error } = await context.supabase.auth.admin.deleteUser(context.authUserId);
    if (error) throw error;

    authUserCache.clear();
    authContextCache.clear();

    return sendJson(response, 200, {
      ok: true,
      releasedProvider,
    });
  } catch (error) {
    console.error("[profile/release-onboarding-identity] failed", error);
    return sendJson(response, error?.statusCode ?? 500, {
      ok: false,
      error: error?.message ?? "identity_release_failed",
    });
  }
}
