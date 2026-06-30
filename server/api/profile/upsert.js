import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const DEFAULT_RATINGS = { integrated: 1200, modes: { "1v1": 1200, "2v2": 1200, "3v3": 1200, "5v5": 1200 } };
const EXISTING_PROFILE_COLUMNS = "id,auth_user_id,name,handle,hashtag,birth_year,age_group,age_group_checked_season,region_sido,region_district,onboarding_complete,profile_version,handle_locked_at,birth_year_locked_at,name_updated_at,region,position,avatar_color,trust_score,ratings,school,company,club,streak,discord_connection,test_login_id";

function makeProfileId(authUserId = "") {
  const safeId = String(authUserId || "pending").replace(/[^a-zA-Z0-9]/g, "").slice(0, 18) || "pending";
  return `p_${safeId}`;
}

function normalizeHashtag(value = "", fallback = "") {
  const raw = String(value || fallback || "").trim().replace(/^[@#]+/, "");
  return raw ? `#${raw.toLowerCase().replace(/[^a-z0-9가-힣_-]/gi, "").slice(0, 20)}` : "";
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

function getRequestedDiscordConnection(profile = {}, existing = {}) {
  if (!Object.prototype.hasOwnProperty.call(profile, "discordConnection")) {
    return existing?.discord_connection ?? null;
  }
  if (!profile.discordConnection) return null;
  if (typeof profile.discordConnection !== "object") return existing?.discord_connection ?? null;
  const userId = String(getDiscordUserId(profile.discordConnection) || "").trim();
  if (!userId || profile.discordConnection.status !== "linked") return existing?.discord_connection ?? null;
  return {
    provider: "discord",
    status: "linked",
    userId,
    username: String(profile.discordConnection.username || "").trim().slice(0, 80),
    globalName: String(profile.discordConnection.globalName || profile.discordConnection.username || "").trim().slice(0, 80),
    avatarUrl: String(profile.discordConnection.avatarUrl || "").trim().slice(0, 500),
    linkedAt: profile.discordConnection.linkedAt || new Date().toISOString(),
    source: "discord",
  };
}

function getLockedRatings(existing = {}) {
  return existing?.ratings ?? DEFAULT_RATINGS;
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

function getRequestedRegion(profile = {}, existing = {}) {
  const regionSido = normalizeOptionalText(profile.regionSido) ?? normalizeOptionalText(existing?.region_sido);
  const regionDistrict = normalizeOptionalText(profile.regionDistrict) ?? normalizeOptionalText(existing?.region_district);
  const inferredRegion = normalizeOptionalText([regionSido, regionDistrict].filter(Boolean).join(" "));
  const region = normalizeOptionalText(profile.region) ?? normalizeOptionalText(existing?.region) ?? inferredRegion;
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

function buildProfileRow({ existing, profile, authUser, authUserId, isTestAccount }) {
  const now = new Date().toISOString();
  const existingLockedHandle = existing?.handle_locked_at || existing?.hashtag_locked_at;
  const requestedHashtag = normalizeHashtag(profile.hashtag ?? profile.handle);
  const nextHashtag = existingLockedHandle ? existing.hashtag ?? existing.handle ?? "" : requestedHashtag;
  const requestedBirthYear = normalizeBirthYear(profile.birthYear);
  const hasLockedBirthYear = Boolean(existing?.birth_year_locked_at && existing?.birth_year);
  const nextBirthYear = hasLockedBirthYear ? existing.birth_year : requestedBirthYear;
  const requestedName = String(profile.name ?? existing?.name ?? authUser.email?.split("@")[0] ?? "신규 선수").trim().slice(0, 20);
  const nextName = existing && requestedName !== existing.name && !canChangeName(existing) ? existing.name : requestedName;
  const discordConnection = getRequestedDiscordConnection(profile, existing);
  const requestedRegion = getRequestedRegion(profile, existing);

  if (profile.onboardingComplete && !existingLockedHandle && !nextHashtag) {
    const error = new Error("hashtag_required");
    error.statusCode = 400;
    throw error;
  }

  const row = {
    id: existing?.id ?? makeProfileId(authUserId),
    auth_user_id: isTestAccount ? existing?.auth_user_id ?? null : authUserId,
    name: nextName,
    handle: nextHashtag || existing?.handle || "",
    hashtag: nextHashtag || existing?.hashtag || null,
    birth_year: nextBirthYear,
    age_group: profile.ageGroup ?? existing?.age_group ?? "open",
    age_group_checked_season: profile.ageGroupCheckedSeason ?? existing?.age_group_checked_season ?? null,
    region_sido: requestedRegion.regionSido,
    region_district: requestedRegion.regionDistrict,
    onboarding_complete: Boolean(profile.onboardingComplete ?? existing?.onboarding_complete ?? false),
    profile_version: Number(profile.profileVersion ?? existing?.profile_version ?? 1),
    handle_locked_at: existingLockedHandle ?? (nextHashtag ? profile.handleLockedAt ?? now : null),
    birth_year_locked_at: hasLockedBirthYear ? existing.birth_year_locked_at : (nextBirthYear ? profile.birthYearLockedAt ?? now : null),
    name_updated_at: nextName !== existing?.name ? profile.nameUpdatedAt ?? now : existing?.name_updated_at ?? null,
    region: requestedRegion.region,
    position: profile.position ?? existing?.position ?? "PG",
    avatar_color: profile.avatarColor ?? existing?.avatar_color ?? "#58d2c0",
    trust_score: getLockedTrustScore(existing),
    ratings: getLockedRatings(existing),
    school: profile.school ?? existing?.school ?? "",
    company: profile.company ?? existing?.company ?? "",
    club: profile.club ?? existing?.club ?? "",
    streak: getLockedStreak(existing),
    discord_connection: discordConnection,
    discord_user_id: getDiscordUserId(discordConnection),
    updated_at: now,
  };

  if (isTestAccount) row.test_login_id = existing?.test_login_id ?? profile.testLoginId ?? null;

  return row;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const body = await readJsonBody(request);
    const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
    const existingQuery = context.profileId
      ? context.supabase.from("profiles").select(EXISTING_PROFILE_COLUMNS).eq("id", context.profileId)
      : context.supabase.from("profiles").select(EXISTING_PROFILE_COLUMNS).eq("auth_user_id", context.authUserId);
    const { data: existing, error: selectError } = await existingQuery.maybeSingle();

    if (selectError) throw selectError;

    const row = buildProfileRow({
      existing,
      profile,
      authUser: context.authUser,
      authUserId: context.authUserId,
      isTestAccount: context.isTestAccount,
    });
    await assertDiscordUserAvailable(context, row.discord_user_id, row.id);

    const query = existing?.id
      ? context.supabase.from("profiles").update(row).eq("id", existing.id)
      : context.supabase.from("profiles").insert(row);
    const { data, error } = await query.select("id, auth_user_id, updated_at").single();

    if (error) throw error;

    sendJson(response, 200, { ok: true, profile: data });
  } catch (error) {
    console.error("Profile upsert failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "profile_upsert_failed" });
  }
}
