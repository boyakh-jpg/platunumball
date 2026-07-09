const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_SNOWFLAKE_RE = /^\d{17,20}$/;
const DISCORD_CHAT_TIMEOUT_MS = Math.max(500, Math.min(10000, Number(process.env.DISCORD_CHAT_SYNC_TIMEOUT_MS || 2500)));

function isMissingTable(error = {}, table = "") {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || (table && message.includes(table));
}

function getDiscordBotToken() {
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!token) return "";
  return /^Bot\s+/i.test(token) ? token : `Bot ${token}`;
}

export function isDiscordSnowflake(value = "") {
  return DISCORD_SNOWFLAKE_RE.test(String(value || "").trim());
}

export function sanitizeRoomChatBody(value = "") {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 60);
}

export function fromRoomChatMessageRow(row = {}) {
  return {
    id: String(row.id ?? ""),
    messageSeq: Number(row.message_seq ?? 0),
    userId: row.user_id ?? "",
    body: String(row.body ?? "").slice(0, 60),
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

async function discordFetch(path, options = {}) {
  const authorization = getDiscordBotToken();
  if (!authorization) return { skipped: "discord_bot_token_not_configured" };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DISCORD_CHAT_TIMEOUT_MS);
  try {
    const response = await fetch(`${DISCORD_API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = body?.message || text || `discord_api_failed:${response.status}`;
      const error = new Error(`discord_api_failed:${response.status}:${path}:${message}`.slice(0, 300));
      error.statusCode = 502;
      throw error;
    }
    return body ?? {};
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getRoomDiscordLink(supabase, roomType = "recruiting", roomId = "") {
  const safeRoomId = String(roomId || "").trim();
  if (!safeRoomId) return null;
  const { data, error } = await supabase
    .from("room_discord_links")
    .select("id,room_type,room_id,discord_channel_id,discord_thread_id,enabled")
    .eq("room_type", roomType)
    .eq("room_id", safeRoomId)
    .eq("enabled", true)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error, "room_discord_links")) return null;
    throw error;
  }
  return data ?? null;
}

async function queryDiscordLinkByTarget(supabase, filters = {}) {
  let query = supabase
    .from("room_discord_links")
    .select("id,room_type,room_id,discord_channel_id,discord_thread_id,enabled")
    .eq("room_type", "recruiting")
    .eq("enabled", true);

  if (filters.threadId) {
    query = query.eq("discord_thread_id", filters.threadId);
    if (filters.channelId) query = query.eq("discord_channel_id", filters.channelId);
  } else {
    query = query.eq("discord_channel_id", filters.channelId).is("discord_thread_id", null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    if (isMissingTable(error, "room_discord_links")) return null;
    throw error;
  }
  return data ?? null;
}

export async function getRoomDiscordLinkByTarget(supabase, { channelId = "", threadId = "" } = {}) {
  const safeChannelId = String(channelId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  if (safeThreadId) {
    const threaded = await queryDiscordLinkByTarget(supabase, { channelId: safeChannelId, threadId: safeThreadId });
    if (threaded) return threaded;
  }
  if (safeChannelId) {
    const channel = await queryDiscordLinkByTarget(supabase, { channelId: safeChannelId });
    if (channel) return channel;
    return queryDiscordLinkByTarget(supabase, { threadId: safeChannelId });
  }
  return null;
}

async function getProfileLabel(supabase, profileId = "") {
  const safeProfileId = String(profileId || "").trim();
  if (!safeProfileId) return "RankBall";
  const { data, error } = await supabase
    .from("profiles")
    .select("id,name,handle")
    .eq("id", safeProfileId)
    .maybeSingle();
  if (error) throw error;
  return String(data?.name || data?.handle || "RankBall").trim().slice(0, 32) || "RankBall";
}

export async function syncRoomChatMessageToDiscord(supabase, { roomType = "recruiting", roomId = "", userId = "", body = "" } = {}) {
  const text = sanitizeRoomChatBody(body);
  if (!text) return { sent: false, skipped: "empty_chat_message" };

  const link = await getRoomDiscordLink(supabase, roomType, roomId);
  if (!link) return { sent: false, skipped: "no_discord_room_link" };

  const targetId = link.discord_thread_id || link.discord_channel_id;
  if (!isDiscordSnowflake(targetId)) return { sent: false, skipped: "invalid_discord_room_link" };

  const author = await getProfileLabel(supabase, userId);
  const result = await discordFetch(`/channels/${encodeURIComponent(targetId)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: `[RankBall] ${author}: ${text}`.slice(0, 1900),
      allowed_mentions: { parse: [] },
    }),
  });
  if (result?.skipped) return { sent: false, skipped: result.skipped };
  return {
    sent: true,
    discordMessageId: result?.id ?? null,
    discordChannelId: result?.channel_id ?? targetId,
  };
}
