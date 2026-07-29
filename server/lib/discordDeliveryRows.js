export function toQueuedDiscordDeliveryRow({
  id,
  notificationId,
  targetUserId,
  discordUserId,
  payload,
  queuedAt,
  sendAt,
  event = "match",
} = {}) {
  return {
    id,
    notification_id: notificationId,
    target_user_id: targetUserId,
    discord_user_id: discordUserId,
    event,
    status: "queued",
    payload,
    queued_at: queuedAt,
    send_at: sendAt,
    sent_at: null,
    failed_at: null,
    last_error: null,
    created_at: queuedAt,
    updated_at: queuedAt,
  };
}
