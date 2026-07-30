import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { getPublicAppWebUrl } from "../_publicAppUrl.js";
import { fromRemoteNotification } from "../../../shared/lib/remotePayloadMappers.js";
import { isDiscordNotificationEnabled } from "../../../shared/lib/settingsMappers.js";
import { getBlockedUserIds, getNotificationActorId, getNotificationTargetPath } from "../../../shared/lib/notifications.js";
import {
  DISCORD_NOTIFICATION_BODY_MAX_LENGTH,
  DISCORD_NOTIFICATION_ID_MAX_LENGTH,
  DISCORD_NOTIFICATION_TITLE_MAX_LENGTH,
  DISCORD_NOTIFICATION_URL_MAX_LENGTH,
  DISCORD_PROFILE_ID_MAX_LENGTH,
  getDiscordInviteCustomId,
} from "../../../shared/lib/discordProtocol.js";

const MAX_DELIVERIES = 100;
const ALLOWED_EVENTS = new Set(["match", "approval", "report"]);

function trimText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeDeliveries(deliveries) {
  if (!Array.isArray(deliveries)) return [];
  return deliveries
    .filter((delivery) => delivery && typeof delivery === "object" && !Array.isArray(delivery))
    .slice(0, MAX_DELIVERIES);
}

function getDiscordUserId(profile = {}) {
  if (profile.discord_user_id) return String(profile.discord_user_id);
  const connection = profile.discord_connection;
  if (connection && typeof connection === "object" && connection.status === "linked" && connection.userId) {
    return String(connection.userId);
  }
  return "";
}

function getNotificationEvent(notification = {}) {
  const explicitEvent = notification.discordEvent || notification.eventType || notification.type;
  if (ALLOWED_EVENTS.has(explicitEvent)) return explicitEvent;
  if (notification.reportId || notification.tone === "report" || notification.type === "report_action") return "report";
  if (notification.tone === "orange") return "approval";
  return "match";
}

function getNotificationWebPath(notification = {}) {
  const explicitPath = trimText(notification.webPath, DISCORD_NOTIFICATION_URL_MAX_LENGTH);
  return getNotificationTargetPath({
    ...notification,
    webPath: explicitPath.startsWith("/app/") ? explicitPath : "",
  });
}

function getNotificationActions(notification = {}) {
  if (!notification.recruitingPostId || !notification.invitationId) return [];
  return [
    { id: "accept", label: "수락", style: "primary", customId: getDiscordInviteCustomId("accept", notification.recruitingPostId, notification.invitationId) },
    { id: "decline", label: "거절", style: "secondary", customId: getDiscordInviteCustomId("decline", notification.recruitingPostId, notification.invitationId) },
  ];
}

function getNotificationSendAt(notification = {}, queuedAt) {
  const raw = notification.sendAt ?? notification.dueAt ?? notification.payload?.sendAt ?? notification.payload?.dueAt;
  const time = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : queuedAt;
}

function toDeliveryRow(notification, profileId, discordUserId, queuedAt) {
  const notificationId = trimText(notification.id, DISCORD_NOTIFICATION_ID_MAX_LENGTH);
  if (!notificationId || notification.readAt) return null;
  const id = `discord-${profileId}-${notificationId}`;
  const event = getNotificationEvent(notification);
  const sendAt = getNotificationSendAt(notification, queuedAt);
  const webPath = getNotificationWebPath(notification);

  const payload = {
    id,
    notificationId,
    targetUserId: profileId,
    discordUserId,
    event,
    title: trimText(notification.title, DISCORD_NOTIFICATION_TITLE_MAX_LENGTH),
    body: trimText(notification.body, DISCORD_NOTIFICATION_BODY_MAX_LENGTH),
    webPath,
    webUrl: getPublicAppWebUrl(webPath),
    actions: getNotificationActions(notification),
    fromUserId: trimText(getNotificationActorId(notification), DISCORD_PROFILE_ID_MAX_LENGTH),
    status: "queued",
    queuedAt,
    sendAt,
  };

  return {
    id,
    notification_id: notificationId,
    target_user_id: profileId,
    discord_user_id: discordUserId,
    event,
    status: "queued",
    payload,
    queued_at: queuedAt,
    send_at: sendAt,
    created_at: queuedAt,
    updated_at: new Date().toISOString(),
  };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const context = await getAuthenticatedContext(request);
    const body = await readJsonBody(request);
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("id, discord_user_id, discord_connection, app_settings")
      .eq("id", context.profileId)
      .maybeSingle();

    if (profileError) throw profileError;
    const discordUserId = getDiscordUserId(profile);
    if (!discordUserId) {
      sendJson(response, 200, { ok: true, count: 0 });
      return;
    }

    const blockedUserIdSet = new Set(getBlockedUserIds(profile.app_settings));
    const requestedNotificationIds = [...new Set(normalizeDeliveries(body.deliveries)
      .map((delivery) => trimText(delivery.notificationId, DISCORD_NOTIFICATION_ID_MAX_LENGTH))
      .filter(Boolean))];
    if (!requestedNotificationIds.length) {
      sendJson(response, 200, { ok: true, count: 0 });
      return;
    }

    const { data: notificationRows, error: notificationError } = await context.supabase
      .from("notifications")
      .select("id,user_id,target_user_id,title,body,tone,type,match_id,recruiting_post_id,invitation_id,discord_event,read_at,payload,created_at,updated_at")
      .in("id", requestedNotificationIds)
      .or(`user_id.eq.${context.profileId},target_user_id.eq.${context.profileId}`);
    if (notificationError) throw notificationError;

    const queuedAt = new Date().toISOString();
    const rows = (notificationRows ?? [])
      .map(fromRemoteNotification)
      .filter((notification) => notification.targetUserId === context.profileId)
      .filter((notification) => isDiscordNotificationEnabled(profile.app_settings, getNotificationEvent(notification)))
      .filter((notification) => !blockedUserIdSet.has(getNotificationActorId(notification)))
      .map((notification) => toDeliveryRow(notification, context.profileId, discordUserId, queuedAt))
      .filter(Boolean);

    if (!rows.length) {
      sendJson(response, 200, { ok: true, count: 0 });
      return;
    }

    const { error } = await context.supabase
      .from("discord_notification_deliveries")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });

    if (error) throw error;

    sendJson(response, 200, { ok: true, count: rows.length });
  } catch (error) {
    console.error("Discord delivery sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "discord_delivery_sync_failed" });
  }
}
