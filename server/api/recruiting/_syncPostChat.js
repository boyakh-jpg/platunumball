import { ROOM_CHAT_MESSAGE_COLUMNS, ROOM_CHAT_MESSAGE_MAX_LENGTH, fromRoomChatMessageRow, normalizeRoomChatBody } from "../../../shared/lib/roomChat.js";
import { syncRoomChatMessageToDiscord } from "../discord/_roomChatBridge.js";
import { assertSafeUserText } from "../../../shared/lib/inputSecurity.js";

import { reject } from "./_syncPostCommon.js";
import { fromRecruitingApplicationRows } from "./_syncPostProjection.js";
import { canSyncRecruitingAction } from "./_syncPostPolicy.js";

function isMissingRoomChatMessages(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || message.includes("room_chat_messages");
}

async function loadRecruitingChatPermissionSnapshot(context, postId = "") {
  const safePostId = String(postId ?? "").trim();
  if (!safePostId) reject(400, "missing_recruiting_post");
  const { data: existingPost, error: existingError } = await context.supabase
    .from("recruiting_posts")
    .select("id, status, confirmed_at, visibility, player_id, player_ids, referee_id, room_state")
    .eq("id", safePostId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existingPost) reject(404, "recruiting_post_not_found");
  const { data: existingApplications, error: applicationsError } = await context.supabase
    .from("recruiting_applications")
    .select("kind,team_id,player_id,side,status,reserve,position,player_ids,source_team_id,source_entry_id,created_at,updated_at")
    .eq("post_id", safePostId);
  if (applicationsError) throw applicationsError;
  return {
    ...existingPost,
    ownerId: existingPost.room_state?.ownerId,
    playerId: existingPost.player_id,
    playerIds: existingPost.player_ids,
    refereeId: existingPost.referee_id,
    roomState: existingPost.room_state,
    applicants: fromRecruitingApplicationRows(existingApplications),
  };
}

export async function persistRecruitingRoomChatMessage(context, operation = {}) {
  const postId = String(operation.postId ?? "").trim();
  const text = normalizeRoomChatBody(operation.body);
  if (!postId) reject(400, "missing_recruiting_post");
  if (!text) reject(400, "empty_chat_message");
  if (text.includes("\n") || text.includes("\r")) reject(400, "single_line_chat_required");
  if (text.length > ROOM_CHAT_MESSAGE_MAX_LENGTH) reject(400, "chat_message_too_long");
  assertSafeUserText(text, { maxLength: ROOM_CHAT_MESSAGE_MAX_LENGTH, path: "$body.operation.body" });
  const existingPostSnapshot = await loadRecruitingChatPermissionSnapshot(context, postId);
  if (!canSyncRecruitingAction(context.profileId, existingPostSnapshot, existingPostSnapshot, "sendRecruitingChat", { action: "sendRecruitingChat", body: text, postId })) {
    reject(403, "recruiting_sync_permission_denied");
  }
  const { data, error } = await context.supabase
    .from("room_chat_messages")
    .insert({
      room_type: "recruiting",
      room_id: postId,
      user_id: context.profileId,
      body: text,
    })
    .select(ROOM_CHAT_MESSAGE_COLUMNS)
    .single();
  if (error) {
    if (isMissingRoomChatMessages(error)) return null;
    throw error;
  }
  let discordChatSync = null;
  try {
    discordChatSync = await syncRoomChatMessageToDiscord(context.supabase, {
      roomType: "recruiting",
      roomId: postId,
      userId: context.profileId,
      body: text,
    });
  } catch (discordChatError) {
    discordChatSync = { sent: false, error: discordChatError.message || "discord_room_chat_sync_failed" };
    console.error("Recruiting Discord room chat sync failed.", discordChatError);
  }

  return {
    ok: true,
    postId,
    message: fromRoomChatMessageRow(data, { fallbackCreatedAt: new Date().toISOString() }),
    discordChatSync,
  };
}
