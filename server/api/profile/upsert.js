import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { verifyDiscordOAuthProof } from "../auth/_discordOAuthProof.js";
import { loadCurrentProfileState, PROFILE_ME_COLUMNS } from "./me.js";
import { DEFAULT_PLAYER_RATINGS } from "../../../shared/lib/matchConstants.js";
import { getAgeGroupByBirthYear } from "../../../shared/lib/profileSetup.js";
import { getDiscordCdnAvatarUrl } from "../../../shared/lib/discordProtocol.js";

const EXISTING_PROFILE_COLUMNS = "id,auth_user_id,name,handle,hashtag,birth_year,age_group,age_group_checked_season,region_sido,region_district,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,region,position,avatar_color,avatar_source,avatar_updated_at,trust_score,ratings,school,company,club,streak,discord_connection,discord_user_id,discord_avatar_url,test_login_id";

function makeProfileId(authUserId = "") {
  const safeId = String(authUserId || "pending").replace(/[^a-zA-Z0-9]/g, "").slice(0, 18) || "pending";
  return `p_${safeId}`;
}

function normalizeHashtag(value = "", fallback = "") {
  const raw = String(value || fallback || "")
    .trim()
    .replace(/^[@#]+/, "")
    .normalize("NFKC")
    .toLowerCase();
  const slug = raw.replace(/[^\p{L}\p{N}_-]+/gu, "").slice(0, 20);
  return slug ? `#${slug}` : "";
}

function normalizeBirthYear(value) {
  const year = Number(value);
  const currentYear = new Date().getFullYear();
  return Number.isInteger(year) && year >= 1900 && year <= currentYear ? year : null;
}

function canChangeName(existing = {}) {
  if (!existing.onboarding_complete || !existing.name_updated_at) return true;
  const nextDate = new Date(existing.name_updated_at);
  if (Number.isNaN(nextDate.getTime())) return true;
  nextDate.setMonth(nextDate.getMonth() + 1);
  return nextDate <= new Date();
}

function getDiscordUserId(connection) {
  return connection && typeof connection === "object" ? connection.userId ?? connection.id ?? null : null;
}

function getDiscordOAuthProof(profile = {}) {
  return String(
    profile.discordOAuthProof?.token
      ?? profile.discordConnection?.oauthProof
      ?? "",
  ).trim();
}

async function getRequestedDiscordConnection(profile = {}, existing = {}) {
  if (!Object.prototype.hasOwnProperty.call(profile, "discordConnection")) {
    return existing?.discord_connection ?? null;
  }
  if (!profile.discordConnection) return null;
  if (typeof profile.discordConnection !== "object") return existing?.discord_connection ?? null;
  const userId = String(getDiscordUserId(profile.discordConnection) || "").trim();
  if (profile.discordConnection.status !== "linked") return existing?.discord_connection ?? null;
  if (!existing?.id) {
    const error = new Error("discord_oauth_profile_required");
    error.statusCode = 403;
    throw error;
  }

  const existingUserId = String(getDiscordUserId(existing?.discord_connection) || existing?.discord_user_id || "").trim();
  if (userId && existingUserId && userId === existingUserId) return existing.discord_connection;

  const proofToken = getDiscordOAuthProof(profile);
  const discordUser = verifyDiscordOAuthProof(proofToken, { expectedProfileId: existing?.id });
  if (!discordUser) {
    const error = new Error("discord_oauth_proof_required");
    error.statusCode = 400;
    throw error;
  }
  const verifiedUserId = String(discordUser.id);
  if (userId && userId !== verifiedUserId) {
    const error = new Error("discord_oauth_identity_mismatch");
    error.statusCode = 400;
    throw error;
  }

  return {
    provider: "discord",
    status: "linked",
    userId: verifiedUserId,
    username: String(discordUser.username || "").trim().slice(0, 80),
    globalName: String(discordUser.global_name || discordUser.username || "").trim().slice(0, 80),
    avatarUrl: getDiscordCdnAvatarUrl(discordUser),
    linkedAt: new Date().toISOString(),
    source: "discord",
  };
}

function getLockedRatings(existing = {}) {
  return existing?.ratings ?? DEFAULT_PLAYER_RATINGS;
}

function getLockedTrustScore(existing = {}) {
  return Number(existing?.trust_score ?? 80);
}

function getLockedStreak(existing = {}) {
  return Number(existing?.streak ?? 0);
}

function normalizeOptionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function getRegionSnapshot(regionSido, regionDistrict, fallbackRegion) {
  const structuredRegion = normalizeOptionalText([regionSido, regionDistrict].filter(Boolean).join(" "));
  return structuredRegion ?? normalizeOptionalText(fallbackRegion);
}

function getRequestedRegion(profile = {}, existing = {}) {
  const regionSido = normalizeOptionalText(profile.regionSido) ?? normalizeOptionalText(existing?.region_sido);
  const regionDistrict = normalizeOptionalText(profile.regionDistrict) ?? normalizeOptionalText(existing?.region_district);
  const region = getRegionSnapshot(regionSido, regionDistrict, profile.region ?? existing?.region);
  return { regionSido, regionDistrict, region };
}

async function assertDiscordUserAvailable(context, discordUserId = "", profileId = "") {
  if (!discordUserId) return;
  const { data, error } = await context.supabase
    .from("profiles")
    .select("id")
    .eq("discord_user_id", discordUserId)
    .neq("id", profileId)
    .maybeSingle();
  if (error) throw error;
  if (data?.id) {
    const duplicateError = new Error("discord_user_already_linked");
    duplicateError.statusCode = 409;
    throw duplicateError;
  }
}

async function buildProfileRow({ existing, profile, authUser, authUserId }) {
  const now = new Date().toISOString();
  const existingLockedHandle = existing?.handle_locked_at || existing?.hashtag_locked_at;
  const existingHashtag = normalizeHashtag(existing?.hashtag ?? existing?.handle);
  const requestedHashtag = normalizeHashtag(profile.hashtag ?? profile.handle);
  const nextHashtag = existingLockedHandle ? existingHashtag : requestedHashtag || existingHashtag;
  const requestedBirthYear = normalizeBirthYear(profile.birthYear);
  const hasLockedBirthYear = Boolean(existing?.birth_year_locked_at && existing?.birth_year);
  const nextBirthYear = hasLockedBirthYear ? existing.birth_year : requestedBirthYear;
  const nextAgeGroup = getAgeGroupByBirthYear(nextBirthYear);
  const requestedName = String(profile.name ?? existing?.name ?? authUser.email?.split("@")[0] ?? "신규 선수").trim().slice(0, 20);
  const nextName = existing && requestedName !== existing.name && !canChangeName(existing) ? existing.name : requestedName;
  const discordConnection = await getRequestedDiscordConnection(profile, existing);
  const requestedRegion = getRequestedRegion(profile, existing);

  if (profile.onboardingComplete && !nextHashtag) {
    const error = new Error("hashtag_required");
    error.statusCode = 400;
    throw error;
  }
  if (profile.onboardingComplete && (!nextBirthYear || !profile.ageGroupCheckedSeason)) {
    const error = new Error("profile_setup_required");
    error.statusCode = 400;
    throw error;
  }

  const row = {
    id: existing?.id ?? makeProfileId(authUserId),
    auth_user_id: authUserId,
    name: nextName,
    handle: nextHashtag,
    hashtag: nextHashtag || null,
    birth_year: nextBirthYear,
    age_group: nextAgeGroup ?? existing?.age_group ?? "open",
    age_group_checked_season: profile.ageGroupCheckedSeason ?? existing?.age_group_checked_season ?? null,
    region_sido: requestedRegion.regionSido,
    region_district: requestedRegion.regionDistrict,
    onboarding_complete: Boolean(existing?.onboarding_complete || profile.onboardingComplete),
    profile_version: Number(profile.profileVersion ?? existing?.profile_version ?? 1),
    handle_locked_at: existingLockedHandle ?? (nextHashtag ? now : null),
    birth_year_locked_at: hasLockedBirthYear ? existing.birth_year_locked_at : (nextBirthYear ? now : null),
    name_updated_at: nextName !== existing?.name ? now : existing?.name_updated_at ?? null,
    region: requestedRegion.region,
    position: profile.position ?? existing?.position ?? "PG",
    avatar_color: profile.avatarColor ?? existing?.avatar_color ?? "#58d2c0",
    avatar_source: !discordConnection && existing?.avatar_source === "discord" ? "initial" : existing?.avatar_source ?? "initial",
    avatar_updated_at: !discordConnection && existing?.avatar_source === "discord" ? now : existing?.avatar_updated_at ?? null,
    trust_score: getLockedTrustScore(existing),
    ratings: getLockedRatings(existing),
    school: profile.school ?? existing?.school ?? "",
    company: profile.company ?? existing?.company ?? "",
    club: profile.club ?? existing?.club ?? "",
    streak: getLockedStreak(existing),
    discord_connection: discordConnection,
    discord_user_id: getDiscordUserId(discordConnection),
    discord_avatar_url: discordConnection?.avatarUrl || null,
    updated_at: now,
  };

  return row;
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const body = await readJsonBody(request);
    const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
    const existingQuery = context.profileId
      ? context.supabase.from("profiles").select(EXISTING_PROFILE_COLUMNS).eq("id", context.profileId)
      : context.supabase.from("profiles").select(EXISTING_PROFILE_COLUMNS).eq("auth_user_id", context.authUserId);
    const { data: existing, error: selectError } = await existingQuery.maybeSingle();

    if (selectError) throw selectError;

    const row = await buildProfileRow({
      existing,
      profile,
      authUser: context.authUser,
      authUserId: context.authUserId,
    });
    await assertDiscordUserAvailable(context, row.discord_user_id, row.id);

    const query = existing?.id
      ? context.supabase.from("profiles").update(row).eq("id", existing.id)
      : context.supabase.from("profiles").insert(row);
    const { data, error } = await query.select("id, auth_user_id, updated_at").single();

    if (error) throw error;

    const { data: updatedProfile, error: profileError } = await context.supabase
      .from("profiles")
      .select(PROFILE_ME_COLUMNS)
      .eq("id", data.id)
      .single();
    if (profileError) throw profileError;

    const profileState = await loadCurrentProfileState({
      ...context,
      profileId: updatedProfile.id,
      profile: updatedProfile,
    });

    sendJson(response, 200, { ok: true, profile: data, ...profileState });
  } catch (error) {
    console.error("Profile upsert failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "profile_upsert_failed" });
  }
}
