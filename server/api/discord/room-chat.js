import { getBearerToken, getSupabaseAdminClient, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { ROOM_CHAT_MESSAGE_COLUMNS } from "../../../src/lib/roomChat.js";
import {
  fromRoomChatMessageRow,
  getRoomDiscordLinkByTarget,
  isDiscordSnowflake,
  sanitizeRoomChatBody,
} from "./_roomChatBridge.js";

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function getBridgeSecret() {
  return process.env.DISCORD_CHAT_BRIDGE_SECRET || process.env.CRON_SECRET || "";
}

function assertBridgeAccess(request) {
  const secret = getBridgeSecret();
  if (!secret || getBearerToken(request) !== secret) reject(401, "invalid_discord_chat_bridge_secret");
}

function readSnowflake(value = "", label = "discord_id", required = true) {
  const text = String(value || "").trim();
  if (!text && !required) return "";
  if (!isDiscordSnowflake(text)) reject(400, `invalid_${label}`);
  return text;
}

async function getProfileByDiscordUserId(supabase, discordUserId = "") {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,discord_user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function assertProfileCanUseRoomChat(supabase, roomId = "", profileId = "") {
  const { data, error } = await supabase.rpc("rankball_can_access_recruiting_room_chat", {
    p_post_id: roomId,
    p_profile_id: profileId,
  });
  if (error) throw error;
  if (!data) reject(403, "discord_chat_profile_not_in_room");
}

function isDuplicateExternalMessage(error = {}) {
  return error?.code === "23505" || String(error?.message ?? "").includes("room_chat_messages_discord_message_unique_idx");
}

async function persistDiscordChatMessage(supabase, link = {}, profile = {}, body = {}) {
  const text = sanitizeRoomChatBody(body.body ?? body.content ?? body.message);
  if (!text) reject(400, "empty_chat_message");
  if (text.includes("\n") || text.includes("\r")) reject(400, "single_line_chat_required");

  const messageId = readSnowflake(body.messageId ?? body.discordMessageId ?? body.id, "discord_message_id");
  const incomingChannelId = readSnowflake(body.channelId ?? body.discordChannelId, "discord_channel_id");
  const incomingThreadId = readSnowflake(body.threadId ?? body.discordThreadId, "discord_thread_id", false);
  const channelId = readSnowflake(link.discord_channel_id || incomingChannelId, "discord_channel_id");
  const threadId = readSnowflake(link.discord_thread_id || incomingThreadId, "discord_thread_id", false);

  let duplicateQuery = supabase
    .from("room_chat_messages")
    .select("id")
    .eq("source", "discord")
    .eq("external_message_id", messageId)
    .eq("external_channel_id", channelId);
  duplicateQuery = threadId ? duplicateQuery.eq("external_thread_id", threadId) : duplicateQuery.is("external_thread_id", null);
  const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate?.id) return { ok: true, duplicate: true, roomId: link.room_id };

  const { data, error } = await supabase
    .from("room_chat_messages")
    .insert({
      room_type: link.room_type,
      room_id: link.room_id,
      user_id: profile.id,
      body: text,
      source: "discord",
      external_message_id: messageId,
      external_channel_id: channelId,
      external_thread_id: threadId || null,
      metadata: {
        discordUserId: String(body.discordUserId || "").trim(),
        discordUsername: String(body.username || body.discordUsername || "").trim().slice(0, 80),
        incomingChannelId,
        incomingThreadId: incomingThreadId || null,
      },
    })
    .select(ROOM_CHAT_MESSAGE_COLUMNS)
    .single();
  if (error) {
    if (isDuplicateExternalMessage(error)) {
      return { ok: true, duplicate: true, roomId: link.room_id };
    }
    throw error;
  }
  return {
    ok: true,
    roomId: link.room_id,
    message: fromRoomChatMessageRow(data),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    assertBridgeAccess(request);
    const body = await readJsonBody(request);
    if (body.authorBot === true || body.bot === true || body.webhookId) {
      sendJson(response, 200, { ok: true, skipped: "bot_or_webhook_message" });
      return;
    }

    const discordUserId = readSnowflake(body.discordUserId ?? body.authorId ?? body.userId, "discord_user_id");
    const channelId = readSnowflake(body.channelId ?? body.discordChannelId, "discord_channel_id");
    const threadId = readSnowflake(body.threadId ?? body.discordThreadId, "discord_thread_id", false);

    const supabase = getSupabaseAdminClient();
    const link = await getRoomDiscordLinkByTarget(supabase, { channelId, threadId });
    if (!link) reject(404, "discord_room_link_not_found");

    const profile = await getProfileByDiscordUserId(supabase, discordUserId);
    if (!profile?.id) reject(403, "discord_profile_not_linked");
    await assertProfileCanUseRoomChat(supabase, link.room_id, profile.id);

    const result = await persistDiscordChatMessage(supabase, link, profile, {
      ...body,
      discordUserId,
      channelId,
      threadId,
    });
    sendJson(response, 200, result);
  } catch (error) {
    console.error("Discord room chat bridge failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "discord_room_chat_failed" });
  }
}
