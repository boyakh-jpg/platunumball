export const ROOM_CHAT_MESSAGE_MAX_LENGTH = 60;
export const ROOM_CHAT_HISTORY_LIMIT = 30;
export const ROOM_CHAT_CLIENT_CACHE_LIMIT = 50;
export const ROOM_CHAT_POLL_BATCH_LIMIT = 20;
export const ROOM_CHAT_POLL_INTERVAL_MS = 3_000;
export const ROOM_CHAT_SEND_COOLDOWN_MS = 3_000;
export const ROOM_CHAT_REPEAT_BLOCK_MS = 30_000;
export const ROOM_CHAT_OPTIMISTIC_MATCH_WINDOW_MS = 30_000;
export const ROOM_CHAT_RATE_WINDOW_MS = 60_000;
export const ROOM_CHAT_RATE_LIMIT = 6;
export const ROOM_CHAT_MESSAGE_COLUMNS = "id,room_type,room_id,user_id,body,created_at,message_seq";

export function normalizeRoomChatBody(value = "") {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

export function sanitizeRoomChatBody(value = "") {
  return normalizeRoomChatBody(value).slice(0, ROOM_CHAT_MESSAGE_MAX_LENGTH);
}

export function fromRoomChatMessageRow(row = {}, options = {}) {
  return {
    id: String(row.id ?? ""),
    messageSeq: Number(row.messageSeq ?? row.message_seq ?? 0),
    userId: row.userId ?? row.user_id ?? "",
    body: String(row.body ?? "").slice(0, ROOM_CHAT_MESSAGE_MAX_LENGTH),
    createdAt: row.createdAt ?? row.created_at ?? options.fallbackCreatedAt ?? "",
  };
}

export function clampRoomChatHistoryLimit(value = ROOM_CHAT_HISTORY_LIMIT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return ROOM_CHAT_HISTORY_LIMIT;
  return Math.max(1, Math.min(ROOM_CHAT_HISTORY_LIMIT, Math.floor(numeric)));
}
