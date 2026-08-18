import { allowRequestMethod, attachNotificationActors, attachNotificationTargetState, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { fromRemoteNotification } from "../../../shared/lib/remotePayloadMappers.js";
import { NOTIFICATION_COLUMNS, PROFILE_ME_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { compareNotificationsNewestFirst, dedupeNotifications, isNotificationDisplayable, isNotificationVisibleToUser } from "../../../shared/lib/notifications.js";

const DEFAULT_NOTIFICATION_LIMIT = 20;
const MAX_NOTIFICATION_LIMIT = 20;

function getNotificationLimit(value) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_NOTIFICATION_LIMIT;
  return Math.min(MAX_NOTIFICATION_LIMIT, Math.floor(limit));
}

export function encodeNotificationCursor(notification) {
  if (!notification?.created_at || !notification?.id) return null;
  return Buffer.from(JSON.stringify({ createdAt: notification.created_at, id: notification.id })).toString("base64url");
}

export function decodeNotificationCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const createdAt = new Date(parsed.createdAt).toISOString();
    const id = String(parsed.id ?? "");
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { profileSelect: PROFILE_ME_COLUMNS });
    const now = new Date().toISOString();
    const limit = getNotificationLimit(body.limit);
    const cursor = decodeNotificationCursor(body.cursor);
    let query = context.supabase
      .from("notifications")
      .select(NOTIFICATION_COLUMNS)
      .or(`user_id.eq.${context.profileId},target_user_id.eq.${context.profileId}`)
      .lte("due_at", now)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const [{ data, error }, { count: unreadCount, error: unreadCountError }] = await Promise.all([
      query.limit(limit + 1),
      context.supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .or(`user_id.eq.${context.profileId},target_user_id.eq.${context.profileId}`)
        .is("read_at", null)
        .lte("due_at", now),
    ]);
    if (error) throw error;
    if (unreadCountError) throw unreadCountError;

    const pageRows = (data ?? []).slice(0, limit);
    const notificationsWithActors = await attachNotificationActors(context.supabase, pageRows.map(fromRemoteNotification));
    const notifications = dedupeNotifications((await attachNotificationTargetState(context.supabase, notificationsWithActors))
      .filter((notification) => isNotificationVisibleToUser(notification, context.profileId, {
        blockedUserIds: context.profile?.app_settings?.blockedUserIds,
      }))
      .filter((notification) => isNotificationDisplayable(notification)))
      .sort(compareNotificationsNewestFirst);

    sendJson(response, 200, {
      ok: true,
      notifications,
      unreadCount: unreadCount ?? 0,
      hasMore: (data ?? []).length > limit,
      nextCursor: (data ?? []).length > limit ? encodeNotificationCursor(pageRows.at(-1)) : null,
    });
  } catch (error) {
    console.error("Notification list failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "notification_list_failed" });
  }
}
