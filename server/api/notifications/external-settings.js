import { allowRequestMethod, getAuthenticatedContext, getSupabaseAdminClient, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES,
  normalizeKakaoOpenProfileUrl,
  normalizeNotificationDeliveryPreferences,
} from "../../../shared/lib/externalNotifications.js";

const MAX_ENDPOINT_LENGTH = 4096;
const MAX_KEY_LENGTH = 512;

function toClientSettings(preference = {}, contact = {}, subscriptionCount = 0) {
  return {
    preferences: normalizeNotificationDeliveryPreferences({
      mode: preference.external_mode,
      gameRecruiting: preference.game_recruiting_enabled,
      team: preference.team_enabled,
      recordTier: preference.record_tier_enabled,
      service: preference.service_enabled,
    }),
    contact: {
      enabled: contact.enabled === true,
      kakaoEnabled: contact.kakao_enabled === true,
      kakaoOpenProfileUrl: String(contact.kakao_open_profile_url ?? ""),
    },
    pushSubscriptionCount: Number(subscriptionCount) || 0,
  };
}

function validateSubscription(value = {}) {
  const endpoint = String(value.endpoint ?? "").trim();
  const p256dh = String(value.keys?.p256dh ?? "").trim();
  const auth = String(value.keys?.auth ?? "").trim();
  let endpointUrl;
  try { endpointUrl = new URL(endpoint); } catch { endpointUrl = null; }
  if (!endpointUrl || endpointUrl.protocol !== "https:" || endpoint.length > MAX_ENDPOINT_LENGTH) return null;
  if (!p256dh || !auth || p256dh.length > MAX_KEY_LENGTH || auth.length > MAX_KEY_LENGTH) return null;
  return { endpoint, p256dh, auth };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;
  try {
    const body = await readJsonBody(request, { maxBytes: 20_000, maxStringLength: MAX_ENDPOINT_LENGTH });
    const context = await getAuthenticatedContext(request);
    const admin = getSupabaseAdminClient();
    const operation = String(body.operation ?? "load");

    if (operation === "load") {
      const [preferenceResult, contactResult, subscriptionResult] = await Promise.all([
        context.supabase.from("notification_delivery_preferences").select("external_mode,game_recruiting_enabled,team_enabled,record_tier_enabled,service_enabled").eq("profile_id", context.profileId).maybeSingle(),
        context.supabase.from("external_contact_preferences").select("enabled,kakao_enabled,kakao_open_profile_url").eq("profile_id", context.profileId).maybeSingle(),
        admin.from("web_push_subscriptions").select("id", { count: "exact", head: true }).eq("profile_id", context.profileId).eq("enabled", true),
      ]);
      if (preferenceResult.error) throw preferenceResult.error;
      if (contactResult.error) throw contactResult.error;
      if (subscriptionResult.error) throw subscriptionResult.error;
      sendJson(response, 200, { ok: true, ...toClientSettings(preferenceResult.data, contactResult.data, subscriptionResult.count) });
      return;
    }

    if (operation === "save") {
      const preferences = normalizeNotificationDeliveryPreferences(body.preferences ?? DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES);
      const contactEnabled = body.contact?.enabled === true;
      const kakaoEnabled = contactEnabled && body.contact?.kakaoEnabled === true;
      const rawKakaoUrl = String(body.contact?.kakaoOpenProfileUrl ?? "").trim();
      const kakaoOpenProfileUrl = normalizeKakaoOpenProfileUrl(rawKakaoUrl);
      if (kakaoEnabled && !kakaoOpenProfileUrl) {
        sendJson(response, 400, { error: "invalid_kakao_open_profile_url" });
        return;
      }
      const now = new Date().toISOString();
      const [preferenceResult, contactResult] = await Promise.all([
        context.supabase.from("notification_delivery_preferences").upsert({
          profile_id: context.profileId,
          external_mode: preferences.mode,
          game_recruiting_enabled: preferences.gameRecruiting,
          team_enabled: preferences.team,
          record_tier_enabled: preferences.recordTier,
          service_enabled: preferences.service,
          updated_at: now,
        }, { onConflict: "profile_id" }),
        context.supabase.from("external_contact_preferences").upsert({
          profile_id: context.profileId,
          enabled: contactEnabled,
          kakao_enabled: kakaoEnabled,
          kakao_open_profile_url: kakaoOpenProfileUrl || null,
          updated_at: now,
        }, { onConflict: "profile_id" }),
      ]);
      if (preferenceResult.error) throw preferenceResult.error;
      if (contactResult.error) throw contactResult.error;
      sendJson(response, 200, { ok: true, preferences, contact: { enabled: contactEnabled, kakaoEnabled, kakaoOpenProfileUrl } });
      return;
    }

    if (operation === "subscribe") {
      const subscription = validateSubscription(body.subscription);
      if (!subscription) {
        sendJson(response, 400, { error: "invalid_push_subscription" });
        return;
      }
      const { data: existing, error: existingError } = await admin
        .from("web_push_subscriptions").select("profile_id").eq("endpoint", subscription.endpoint).maybeSingle();
      if (existingError) throw existingError;
      if (existing?.profile_id && existing.profile_id !== context.profileId) {
        sendJson(response, 409, { error: "push_subscription_owner_conflict" });
        return;
      }
      const now = new Date().toISOString();
      const { error } = await admin.from("web_push_subscriptions").upsert({
        profile_id: context.profileId,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth_secret: subscription.auth,
        user_agent: String(request.headers?.["user-agent"] ?? "").slice(0, 500) || null,
        enabled: true,
        failure_count: 0,
        last_failure: null,
        last_seen_at: now,
        updated_at: now,
      }, { onConflict: "endpoint" });
      if (error) throw error;
      sendJson(response, 200, { ok: true });
      return;
    }

    if (operation === "unsubscribe") {
      const endpoint = String(body.endpoint ?? "").trim();
      if (!endpoint || endpoint.length > MAX_ENDPOINT_LENGTH) {
        sendJson(response, 400, { error: "invalid_push_endpoint" });
        return;
      }
      const { error } = await admin.from("web_push_subscriptions")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("profile_id", context.profileId).eq("endpoint", endpoint);
      if (error) throw error;
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 400, { error: "invalid_operation" });
  } catch (error) {
    console.error("External notification settings failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "external_notification_settings_failed" });
  }
}
