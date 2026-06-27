import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  DEFAULT_SETTINGS,
  createProfileShell,
  fromRemoteProfile,
  getRemoteAppSettings,
  normalizeState,
} from "../../../src/data/repository.js";

const PROFILE_ME_COLUMNS = "id,name,handle,hashtag,position,region,region_sido,region_district,school,company,club,trust_score,streak,avatar_color,test_login_id,auth_user_id,birth_year,age_group,age_group_checked_season,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,discord_connection,discord_user_id,ratings,created_at,updated_at,app_settings";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
    const profile = context.profile ?? null;
    const user = profile
      ? fromRemoteProfile(profile)
      : createProfileShell(context.authUserId, context.authUser?.email ?? "");
    const settings = {
      ...DEFAULT_SETTINGS,
      ...getRemoteAppSettings(profile),
    };
    const state = normalizeState({
      currentUserId: user.id,
      users: [user],
      settings,
    }, { includeDemo: false });

    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        matches: [],
        recruitingPosts: [],
        tournaments: [],
      },
      updatedAt: profile?.updated_at ? new Date(profile.updated_at).getTime() : 0,
      debug: body.debug === true ? { profileId: profile?.id ?? user.id } : undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "profile_me_failed" });
  }
}
