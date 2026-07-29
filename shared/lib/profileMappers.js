import {
  DEFAULT_PLAYER_RATINGS,
  TEST_PROFILE_AGE_GROUP,
  TEST_PROFILE_AGE_GROUP_SEASON,
  TEST_PROFILE_BIRTH_YEAR,
  TEST_PROFILE_SETUP_AT,
} from "./constants.js";
import { getUserHashtag, toHashtag } from "./handles.js";
import { nullableText } from "./rowUtils.js";

function makeDefaultRatings() {
  return {
    integrated: DEFAULT_PLAYER_RATINGS.integrated,
    modes: { ...DEFAULT_PLAYER_RATINGS.modes },
    placement: {
      ...DEFAULT_PLAYER_RATINGS.placement,
      modeCounts: { ...DEFAULT_PLAYER_RATINGS.placement.modeCounts },
    },
  };
}

export function normalizeRatings(ratings = {}) {
  const defaults = makeDefaultRatings();
  const integrated = Number(ratings?.integrated);
  const hasLegacyRatings = Boolean(
    ratings
    && typeof ratings === "object"
    && (
      Object.prototype.hasOwnProperty.call(ratings, "integrated")
      || Object.prototype.hasOwnProperty.call(ratings, "modes")
    ),
  );
  return {
    integrated: Number.isFinite(integrated) ? integrated : defaults.integrated,
    modes: { ...defaults.modes, ...(ratings?.modes && typeof ratings.modes === "object" ? ratings.modes : {}) },
    placement: ratings?.placement && typeof ratings.placement === "object"
      ? {
        ...defaults.placement,
        ...ratings.placement,
        modeCounts: ratings.placement.modeCounts && typeof ratings.placement.modeCounts === "object"
          ? { ...ratings.placement.modeCounts }
          : {},
      }
      : hasLegacyRatings ? null : defaults.placement,
  };
}

export const getProfileRegionSnapshot = (regionSido, regionDistrict, fallbackRegion) =>
  nullableText([regionSido, regionDistrict].filter(Boolean).join(" ")) ?? nullableText(fallbackRegion);

export const getUserIdentityHashtag = (user = {}) => getUserHashtag(user);

function getProfileShellId(authUserId = "") {
  const safeId = String(authUserId || "pending").replace(/[^a-zA-Z0-9]/g, "").slice(0, 18) || "pending";
  return `p_${safeId}`;
}

export function createProfileShell(authUserId = "", email = "") {
  const fallbackName = String(email || "").split("@")[0] || "?좉퇋 ?좎닔";
  return {
    id: getProfileShellId(authUserId),
    name: fallbackName,
    handle: "",
    hashtag: "",
    position: "PG",
    region: null,
    regionSido: null,
    regionDistrict: null,
    school: "",
    company: "",
    club: "",
    affiliationId: null,
    affiliationName: "",
    affiliationMemberCount: 0,
    affiliationUpdatedAt: null,
    trustScore: 80,
    streak: 0,
    avatarColor: "#58d2c0",
    avatarKey: null,
    avatarSource: "initial",
    avatarIconKey: null,
    avatarUpdatedAt: null,
    avatarUploadedAt: null,
    avatarUploadCount: 0,
    avatarBackgroundEnabled: true,
    avatarBorderEnabled: false,
    avatarBorderColor: "#58d2c0",
    discordAvatarUrl: null,
    authUserId: authUserId || null,
    birthYear: null,
    ageGroup: "open",
    ageGroupCheckedSeason: null,
    onboardingComplete: false,
    profileVersion: 0,
    handleLockedAt: null,
    birthYearLockedAt: null,
    nameUpdatedAt: null,
    discordConnection: null,
    discordUserId: null,
    ratings: makeDefaultRatings(),
  };
}

export function fromRemoteProfile(row) {
  const hashtag = toHashtag(row.hashtag ?? row.handle ?? row.id, row.id);
  const isTestProfile = Boolean(row.test_login_id);
  const testSetupAt = row.updated_at ?? row.created_at ?? TEST_PROFILE_SETUP_AT;
  return {
    id: row.id,
    name: row.name,
    handle: hashtag,
    position: row.position,
    region: row.region,
    school: row.school,
    company: row.company,
    club: row.club,
    affiliationId: row.affiliation_id ?? null,
    affiliationName: row.affiliation?.name ?? row.affiliation_name ?? "",
    affiliationMemberCount: Number(row.affiliation?.member_count ?? row.affiliation_member_count ?? 0),
    affiliationUpdatedAt: row.affiliation_updated_at ?? null,
    trustScore: row.trust_score ?? 80,
    streak: row.streak ?? 0,
    avatarColor: row.avatar_color,
    avatarKey: row.avatar_key ?? null,
    avatarSource: row.avatar_source ?? (row.discord_avatar_url || row.discord_connection?.avatarUrl ? "discord" : "initial"),
    avatarIconKey: row.avatar_icon_key ?? null,
    avatarUpdatedAt: row.avatar_updated_at ?? null,
    avatarUploadedAt: row.avatar_uploaded_at ?? null,
    avatarUploadCount: Number(row.avatar_upload_count ?? 0),
    avatarBackgroundEnabled: row.avatar_background_enabled !== false,
    avatarBorderEnabled: row.avatar_border_enabled === true,
    avatarBorderColor: row.avatar_border_color ?? row.avatar_color ?? "#58d2c0",
    discordAvatarUrl: row.discord_avatar_url ?? row.discord_connection?.avatarUrl ?? null,
    testLoginId: row.test_login_id,
    authUserId: row.auth_user_id ?? null,
    hashtag,
    birthYear: row.birth_year ?? (isTestProfile ? TEST_PROFILE_BIRTH_YEAR : null),
    ageGroup: row.age_group ?? (isTestProfile ? TEST_PROFILE_AGE_GROUP : null),
    ageGroupCheckedSeason: row.age_group_checked_season ?? (isTestProfile ? TEST_PROFILE_AGE_GROUP_SEASON : null),
    regionSido: row.region_sido ?? null,
    regionDistrict: row.region_district ?? null,
    onboardingComplete: Boolean(row.onboarding_complete || isTestProfile),
    profileVersion: row.profile_version ?? 0,
    handleLockedAt: row.handle_locked_at ?? (isTestProfile ? testSetupAt : null),
    birthYearLockedAt: row.birth_year_locked_at ?? null,
    nameUpdatedAt: row.name_updated_at ?? null,
    discordConnection: row.discord_connection ?? null,
    discordUserId: row.discord_user_id ?? row.discord_connection?.userId ?? null,
    representativeTeamId: row.app_settings?.representativeTeamId ?? "",
    ratings: normalizeRatings({
      ...(row.ratings ?? {}),
      placement: row.ratings?.placement ?? (
        Number.isFinite(Number(row.placement_match_count))
          ? { matchCount: Number(row.placement_match_count) }
          : undefined
      ),
    }),
  };
}

export function fromTeamMemberProfile(row = {}, options = {}) {
  const profile = fromRemoteProfile(row);
  return {
    id: profile.id,
    name: profile.name,
    handle: profile.handle,
    position: profile.position,
    ...(options.includeRegion ? { region: profile.region } : {}),
    trustScore: profile.trustScore,
    avatarColor: profile.avatarColor,
    avatarKey: profile.avatarKey,
    avatarSource: profile.avatarSource,
    avatarIconKey: profile.avatarIconKey,
    avatarUpdatedAt: profile.avatarUpdatedAt,
    avatarBackgroundEnabled: profile.avatarBackgroundEnabled,
    avatarBorderEnabled: profile.avatarBorderEnabled,
    avatarBorderColor: profile.avatarBorderColor,
    discordAvatarUrl: profile.discordAvatarUrl,
    hashtag: profile.hashtag,
    ageGroup: profile.ageGroup,
    ageGroupCheckedSeason: profile.ageGroupCheckedSeason,
    onboardingComplete: profile.onboardingComplete,
    ratings: profile.ratings,
  };
}

export function getRemoteAppSettings(profile = {}) {
  const settings = profile?.app_settings && typeof profile.app_settings === "object" && !Array.isArray(profile.app_settings)
    ? profile.app_settings
    : {};
  const theme = settings.theme === "light" ? "light" : settings.theme === "dark" ? "dark" : null;
  const privacy = settings.privacy && typeof settings.privacy === "object" && !Array.isArray(settings.privacy) ? settings.privacy : null;
  const representativeTeamId = typeof settings.representativeTeamId === "string" ? settings.representativeTeamId.trim() : "";
  const notificationChannels = settings.notificationChannels && typeof settings.notificationChannels === "object" && !Array.isArray(settings.notificationChannels)
    ? settings.notificationChannels
    : null;
  const showHomeGuideCard = typeof settings.showHomeGuideCard === "boolean" ? settings.showHomeGuideCard : null;
  return {
    ...(theme ? { theme } : {}),
    ...(privacy ? { privacy } : {}),
    ...(representativeTeamId ? { representativeTeamId } : {}),
    ...(notificationChannels ? { notificationChannels } : {}),
    ...(showHomeGuideCard !== null ? { showHomeGuideCard } : {}),
  };
}
