import { allowRequestMethod, attachNotificationActors, attachNotificationTargetState, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { fromRemoteNotification } from "../../../shared/lib/remotePayloadMappers.js";
import { NOTIFICATION_COLUMNS, PROFILE_ME_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { compareNotificationsNewestFirst, dedupeNotifications, isNotificationDisplayable, isNotificationVisibleToUser } from "../../../shared/lib/notifications.js";

const DEFAULT_NOTIFICATION_LIMIT = 80;
const MAX_NOTIFICATION_LIMIT = 100;

function getNotificationLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_NOTIFICATION_LIMIT;
  return Math.min(MAX_NOTIFICATION_LIMIT, Math.floor(limit));
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { profileSelect: PROFILE_ME_COLUMNS });
    const now = new Date().toISOString();
    const { data, error } = await context.supabase
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .or(`user_id.eq.${context.profileId},target_user_id.eq.${context.profileId}`)
      .lte("due_at", now)
      .order("created_at", { ascending: false })
      .limit(getNotificationLimit(body.limit));
    if (error) throw error;

    const notificationsWithActors = await attachNotificationActors(context.supabase, (data ?? []).map(fromRemoteNotification));
    const notifications = dedupeNotifications((await attachNotificationTargetState(context.supabase, notificationsWithActors))
      .filter((notification) => isNotificationVisibleToUser(notification, context.profileId, {
        blockedUserIds: context.profile?.app_settings?.blockedUserIds,
      }))
      .filter((notification) => isNotificationDisplayable(notification)))
      .sort(compareNotificationsNewestFirst);

    sendJson(response, 200, { ok: true, notifications });
  } catch (error) {
    console.error("Notification list failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "notification_list_failed" });
  }
}
