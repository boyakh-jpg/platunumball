import { isDiscordSnowflake } from "../../../shared/lib/discordProtocol.js";
import { BRAND_NAME } from "../../../shared/lib/brand.js";
import {
  fromRoomChatMessageRow as mapRoomChatMessageRow,
  sanitizeRoomChatBody,
} from "../../../shared/lib/roomChat.js";
import {
  fetchDiscordApi,
  getDiscordBotAuthorization,
} from "../../lib/discordHttp.js";
import { isMissingTable } from "../_supabaseAdmin.js";

const DISCORD_CHAT_TIMEOUT_MS = Math.max(500, Math.min(10000, Number(process.env.DISCORD_CHAT_SYNC_TIMEOUT_MS || 2500)));

function getDiscordChatDryRun(path = "") {
  if (process.env.DISCORD_CHAT_SYNC_DRY_RUN !== "1") return null;
  const channelMatch = /^\/channels\/([^/]+)\/messages$/.exec(String(path || ""));
  return {
    id: process.env.DISCORD_CHAT_SYNC_DRY_RUN_MESSAGE_ID || "1783000000000000001",
    channel_id: channelMatch?.[1] ? decodeURIComponent(channelMatch[1]) : "",
    dryRun: true,
  };
}

export { isDiscordSnowflake, sanitizeRoomChatBody };

export function fromRoomChatMessageRow(row = {}) {
  return mapRoomChatMessageRow(row, { fallbackCreatedAt: new Date().toISOString() });
}

async function discordFetch(path, options = {}) {
  const dryRun = getDiscordChatDryRun(path);
  if (dryRun) return dryRun;

  const authorization = getDiscordBotAuthorization();
  if (!authorization) return { skipped: "discord_bot_token_not_configured" };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DISCORD_CHAT_TIMEOUT_MS);
  try {
    return await fetchDiscordApi(
      path,
      { ...options, signal: controller.signal },
      { authorization, emptyBody: {} },
    );
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
  if (!safeProfileId) return BRAND_NAME;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,name,handle")
    .eq("id", safeProfileId)
    .maybeSingle();
  if (error) throw error;
  return String(data?.name || data?.handle || BRAND_NAME).trim().slice(0, 32) || BRAND_NAME;
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
      content: `[${BRAND_NAME}] ${author}: ${text}`.slice(0, 1900),
      allowed_mentions: { parse: [] },
    }),
  });
  if (result?.skipped) return { sent: false, skipped: result.skipped };
  return {
    sent: true,
    discordMessageId: result?.id ?? null,
    discordChannelId: result?.channel_id ?? targetId,
    dryRun: Boolean(result?.dryRun),
  };
}
