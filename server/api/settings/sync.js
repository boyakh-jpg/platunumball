import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

function getPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function sanitizeBooleanPatch(value, keys = []) {
  const source = getPlainObject(value);
  if (!source) return null;
  const patch = {};
  keys.forEach((key) => {
    if (typeof source[key] === "boolean") patch[key] = source[key];
  });
  return Object.keys(patch).length ? patch : null;
}

function sanitizeNotificationChannels(value) {
  const source = getPlainObject(value);
  const discord = getPlainObject(source?.discord);
  if (!discord) return null;

  const nextDiscord = {};
  if (typeof discord.enabled === "boolean") nextDiscord.enabled = discord.enabled;

  const events = sanitizeBooleanPatch(discord.events, ["match", "approval", "report"]);
  if (events) nextDiscord.events = events;

  return Object.keys(nextDiscord).length ? { discord: nextDiscord } : null;
}

function sanitizeSettingsPatch(value) {
  const source = getPlainObject(value) ?? {};
  const patch = {};

  if (source.theme === "light" || source.theme === "dark") patch.theme = source.theme;
  if (typeof source.representativeTeamId === "string") {
    patch.representativeTeamId = source.representativeTeamId.trim().slice(0, 128);
  }

  const privacy = sanitizeBooleanPatch(source.privacy, ["regionRanking", "teamHistory", "statSummary"]);
  if (privacy) patch.privacy = privacy;

  const notificationChannels = sanitizeNotificationChannels(source.notificationChannels);
  if (notificationChannels) patch.notificationChannels = notificationChannels;

  return patch;
}

function mergeSettings(current, patch) {
  const nextSettings = {
    ...current,
    ...patch,
    privacy: patch.privacy ? { ...(current.privacy ?? {}), ...patch.privacy } : current.privacy,
    notificationChannels: patch.notificationChannels ? {
      ...(current.notificationChannels ?? {}),
      ...patch.notificationChannels,
      discord: patch.notificationChannels.discord ? {
        ...(current.notificationChannels?.discord ?? {}),
        ...patch.notificationChannels.discord,
        events: patch.notificationChannels.discord.events ? {
          ...(current.notificationChannels?.discord?.events ?? {}),
          ...patch.notificationChannels.discord.events,
        } : current.notificationChannels?.discord?.events,
      } : current.notificationChannels?.discord,
    } : current.notificationChannels,
  };
  return Object.fromEntries(Object.entries(nextSettings).filter(([, value]) => value !== undefined));
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const settingsPatch = sanitizeSettingsPatch(body.settings ?? body.patch ?? {});
    if (!Object.keys(settingsPatch).length) {
      sendJson(response, 400, { error: "empty_settings_patch" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    if (settingsPatch.representativeTeamId) {
      const { data: membership, error: membershipError } = await context.supabase
        .from("team_members")
        .select("team_id")
        .eq("user_id", context.profileId)
        .eq("team_id", settingsPatch.representativeTeamId)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) {
        sendJson(response, 400, { error: "representative_team_must_be_owned" });
        return;
      }
    }

    const { data: profile, error: readError } = await context.supabase
      .from("profiles")
      .select("app_settings")
      .eq("id", context.profileId)
      .maybeSingle();

    if (readError) throw readError;

    const currentSettings = getPlainObject(profile?.app_settings) ?? {};
    const nextSettings = mergeSettings(currentSettings, settingsPatch);
    const { error: updateError } = await context.supabase
      .from("profiles")
      .update({ app_settings: nextSettings, updated_at: new Date().toISOString() })
      .eq("id", context.profileId);

    if (updateError) throw updateError;

    const discordPatch = settingsPatch.notificationChannels?.discord;
    if (discordPatch?.enabled === false || Object.values(discordPatch?.events ?? {}).includes(false)) {
      const cancelledAt = new Date().toISOString();
      let cancelQuery = context.supabase
        .from("discord_notification_deliveries")
        .update({ status: "cancelled", last_error: "discord_notification_disabled", updated_at: cancelledAt })
        .eq("target_user_id", context.profileId)
        .eq("status", "queued")
        .is("sent_at", null);
      if (discordPatch.enabled !== false) {
        const disabledEvents = Object.entries(discordPatch.events ?? {})
          .filter(([, enabled]) => enabled === false)
          .map(([event]) => event);
        if (disabledEvents.length) cancelQuery = cancelQuery.in("event", disabledEvents);
      }
      const { error: cancelError } = await cancelQuery;
      if (cancelError) throw cancelError;
    }

    sendJson(response, 200, { ok: true, settings: nextSettings });
  } catch (error) {
    console.error("Settings sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "settings_sync_failed" });
  }
}
