import crypto from "node:crypto";
import { getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";
import {
  applyAuthoritativeRecruitingOperation,
  loadAuthoritativeState,
} from "../_authoritativeState.js";
import { persistRecruitingPostSnapshot } from "../recruiting/sync-post.js";

const INVITE_PREFIX = "rankball:invite";
const INTERACTION_PING = 1;
const INTERACTION_COMPONENT = 3;
const RESPONSE_PONG = 1;
const RESPONSE_MESSAGE = 4;
const EPHEMERAL = 64;

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

async function readRawBody(request) {
  if (Buffer.isBuffer(request.body)) return request.body.toString("utf8");
  if (typeof request.body === "string") return request.body;
  if (request.body && typeof request.body === "object") return JSON.stringify(request.body);

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function getHeader(request, name) {
  return request.headers[name] || request.headers[name.toLowerCase()] || request.headers[name.toUpperCase()] || "";
}

function getDiscordPublicKey() {
  const value = String(process.env.DISCORD_PUBLIC_KEY || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) reject(500, "discord_public_key_not_configured");
  return value;
}

function verifyDiscordSignature(request, rawBody) {
  const signature = String(getHeader(request, "x-signature-ed25519") || "").trim();
  const timestamp = String(getHeader(request, "x-signature-timestamp") || "").trim();
  if (!/^[a-f0-9]{128}$/i.test(signature) || !timestamp) reject(401, "invalid_discord_signature");

  const publicKey = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(getDiscordPublicKey(), "hex"),
  ]);
  const key = crypto.createPublicKey({ key: publicKey, format: "der", type: "spki" });
  const verified = crypto.verify(
    null,
    Buffer.from(`${timestamp}${rawBody}`, "utf8"),
    key,
    Buffer.from(signature, "hex"),
  );
  if (!verified) reject(401, "invalid_discord_signature");
}

function sendInteractionMessage(response, content) {
  sendJson(response, 200, {
    type: RESPONSE_MESSAGE,
    data: {
      content,
      flags: EPHEMERAL,
    },
  });
}

function parseInviteAction(customId = "") {
  const parts = String(customId).split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== INVITE_PREFIX) {
    reject(400, "unsupported_discord_action");
  }
  const action = parts[2] === "accept" ? "acceptRecruitingInvitation" : parts[2] === "decline" ? "declineRecruitingInvitation" : "";
  if (!action) reject(400, "unsupported_discord_action");
  return {
    action,
    postId: decodeURIComponent(parts[3] || ""),
    invitationId: decodeURIComponent(parts[4] || ""),
  };
}

function getInteractionDiscordUserId(interaction = {}) {
  return String(interaction.member?.user?.id || interaction.user?.id || "").trim();
}

async function getProfileByDiscordUserId(supabase, discordUserId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, discord_user_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function handleInviteAction(interaction) {
  const component = interaction.data?.custom_id ? interaction.data : null;
  const operation = parseInviteAction(component?.custom_id);
  if (!operation.postId || !operation.invitationId) reject(400, "invalid_invite_action");

  const discordUserId = getInteractionDiscordUserId(interaction);
  if (!discordUserId) reject(401, "missing_discord_user");

  const supabase = getSupabaseAdminClient();
  const profile = await getProfileByDiscordUserId(supabase, discordUserId);
  if (!profile?.id) reject(403, "discord_profile_not_linked");

  const context = {
    supabase,
    profileId: profile.id,
    authUserId: `discord:${discordUserId}`,
    authUser: { id: `discord:${discordUserId}` },
  };
  const state = await loadAuthoritativeState(context, { operation });
  const result = applyAuthoritativeRecruitingOperation(state, operation);
  await persistRecruitingPostSnapshot(context, {
    post: result.post,
    notifications: result.notifications,
    action: operation.action,
    body: operation,
    expectedUpdatedAt: result.baseUpdatedAt ?? null,
  });

  return operation.action === "acceptRecruitingInvitation"
    ? "초대를 수락했습니다. RankBall에서 방 상태를 확인하세요."
    : "초대를 거절했습니다.";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const rawBody = await readRawBody(request);
    verifyDiscordSignature(request, rawBody);
    const interaction = rawBody ? JSON.parse(rawBody) : {};

    if (interaction.type === INTERACTION_PING) {
      sendJson(response, 200, { type: RESPONSE_PONG });
      return;
    }

    if (interaction.type !== INTERACTION_COMPONENT) {
      sendInteractionMessage(response, "지원하지 않는 Discord 액션입니다.");
      return;
    }

    const message = await handleInviteAction(interaction);
    sendInteractionMessage(response, message);
  } catch (error) {
    console.error("Discord interaction failed.", error);
    const statusCode = error.statusCode || 500;
    if (statusCode === 401) {
      sendJson(response, 401, { error: error.message || "invalid_discord_signature" });
      return;
    }
    if (statusCode >= 500) {
      sendJson(response, statusCode, { error: error.message || "discord_interaction_failed" });
      return;
    }
    sendInteractionMessage(response, "처리하지 못했습니다. RankBall에서 다시 확인하세요.");
  }
}
