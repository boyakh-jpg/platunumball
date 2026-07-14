import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedDirectoryStateFromClient } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

const PROFILE_PRIVACY_KEYS = ["regionRanking", "teamHistory", "statSummary"];
const PROFILE_PRIVACY_BATCH_SIZE = 200;

export function toPublicProfilePrivacy(appSettings = {}) {
  const privacy = appSettings?.privacy && typeof appSettings.privacy === "object" && !Array.isArray(appSettings.privacy)
    ? appSettings.privacy
    : {};
  return Object.fromEntries(PROFILE_PRIVACY_KEYS.map((key) => [key, privacy[key] !== false]));
}

export function mapDirectoryProfilePrivacy(users = [], profileRows = [], currentProfileId = "", currentPrivacy = {}) {
  const profileById = new Map(profileRows.filter((row) => row?.id).map((row) => [row.id, row]));
  return users.map((user) => {
    const {
      app_settings: _appSettings,
      appSettings: _appSettingsCamel,
      privacy: _privacy,
      ...publicUser
    } = user;
    const profile = profileById.get(user.id);
    const privacy = profile
      ? toPublicProfilePrivacy(profile.app_settings)
      : user.id === currentProfileId
        ? toPublicProfilePrivacy({ privacy: currentPrivacy })
        : Object.fromEntries(PROFILE_PRIVACY_KEYS.map((key) => [key, false]));
    return { ...publicUser, privacy };
  });
}

async function loadProfilePrivacyRows(supabase, users = []) {
  const profileIds = [...new Set(users.map((user) => String(user?.id ?? "").trim()).filter(Boolean))];
  const rows = [];
  for (let index = 0; index < profileIds.length; index += PROFILE_PRIVACY_BATCH_SIZE) {
    const batch = profileIds.slice(index, index + PROFILE_PRIVACY_BATCH_SIZE);
    const { data, error } = await supabase.from("profiles").select("id,app_settings").in("id", batch);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const adminLevel = context.profileId ? await getAdminLevel(context) : 0;
    const normalized = await loadNormalizedDirectoryStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        isAdmin: adminLevel >= 30,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const filteredState = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const profileRows = await loadProfilePrivacyRows(context.supabase, filteredState.users);
    const state = {
      ...filteredState,
      users: mapDirectoryProfilePrivacy(
        filteredState.users,
        profileRows,
        profileId,
        filteredState.settings?.privacy,
      ),
    };

    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        matches: [],
        recruitingPosts: [],
        tournaments: [],
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "directory_load_failed" });
  }
}
