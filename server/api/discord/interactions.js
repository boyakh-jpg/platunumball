import crypto from "node:crypto";
import { getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";
import { loadAuthoritativeState } from "../_authoritativeState.js";
import {
  DISCORD_INVITE_ACTION_PREFIX as INVITE_PREFIX,
  DISCORD_TOURNAMENT_ACTION_PREFIX as TOURNAMENT_PREFIX,
} from "../../../src/lib/discordProtocol.js";
import { getPublicAppWebUrl } from "../_publicAppUrl.js";

const INTERACTION_PING = 1;
const INTERACTION_COMPONENT = 3;
const RESPONSE_PONG = 1;
const RESPONSE_MESSAGE = 4;
const EPHEMERAL = 64;
const COMPONENT_CUSTOM_ID_MAX = 100;
const SAFE_ENTITY_ID_PATTERN = /^[A-Za-z0-9_.-]{1,120}$/;

function reject(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
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
      content: String(content || "RankBall에서 다시 확인하세요.").slice(0, 1900),
      flags: EPHEMERAL,
    },
  });
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeDecodeId(value = "", label = "id") {
  const raw = String(value || "").trim();
  if (!raw || raw.length > COMPONENT_CUSTOM_ID_MAX) reject(400, `invalid_${label}`);
  let decoded = "";
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    reject(400, `invalid_${label}`);
  }
  if (!SAFE_ENTITY_ID_PATTERN.test(decoded)) reject(400, `invalid_${label}`);
  return decoded;
}

function parseInviteAction(customId = "") {
  const rawCustomId = String(customId || "").trim();
  if (!rawCustomId || rawCustomId.length > COMPONENT_CUSTOM_ID_MAX) reject(400, "invalid_discord_action");
  const parts = rawCustomId.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== INVITE_PREFIX) {
    reject(400, "unsupported_discord_action");
  }
  const action = parts[2] === "accept" ? "acceptRecruitingInvitation" : parts[2] === "decline" ? "declineRecruitingInvitation" : "";
  if (!action) reject(400, "unsupported_discord_action");
  return {
    action,
    postId: safeDecodeId(parts[3], "post_id"),
    invitationId: safeDecodeId(parts[4], "invitation_id"),
  };
}

function parseTournamentAction(customId = "") {
  const rawCustomId = String(customId || "").trim();
  if (!rawCustomId || rawCustomId.length > COMPONENT_CUSTOM_ID_MAX) reject(400, "invalid_discord_action");
  const parts = rawCustomId.split(":");
  if (parts.length !== 3 || `${parts[0]}:${parts[1]}` !== TOURNAMENT_PREFIX) {
    reject(400, "unsupported_discord_action");
  }
  return safeDecodeId(parts[2], "tournament_id");
}

function getTournamentUrl(request, tournamentId) {
  const path = `/app/tournaments/${encodeURIComponent(tournamentId)}`;
  return getPublicAppWebUrl(path, request);
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

function getRoomState(post = {}) {
  const roomState = post.roomState ?? post.room_state;
  return roomState && typeof roomState === "object" ? roomState : {};
}

function getInviteDecisionState(state = {}, operation = {}, profileId = "") {
  const post = toArray(state.recruitingPosts).find((item) => item?.id === operation.postId) ?? null;
  if (!post) return { stale: true, reason: "missing_post" };
  if (post.status && post.status !== "open") return { post, stale: true, reason: "closed_post" };

  const invitation = toArray(getRoomState(post).invitations).find((item) => item?.id === operation.invitationId) ?? null;
  if (!invitation) return { post, stale: true, reason: "missing_invitation" };
  if (invitation.targetUserId !== profileId) reject(403, "discord_invite_not_for_user");
  if (String(invitation.status ?? "pending") !== "pending") {
    return { post, invitation, stale: true, reason: "processed_invitation" };
  }
  return { post, invitation, stale: false };
}

function getInviteResultMessage(operation = {}) {
  return operation.action === "acceptRecruitingInvitation"
    ? "초대를 수락했습니다. RankBall에서 방 상태를 확인하세요."
    : "초대를 거절했습니다.";
}

function getStaleInviteMessage(decision = {}) {
  if (decision.reason === "closed_post") return "이미 닫힌 방입니다. RankBall에서 최신 상태를 확인하세요.";
  return "이미 처리됐거나 만료된 초대입니다. RankBall에서 최신 상태를 확인하세요.";
}

async function handleInviteAction(interaction) {
  const component = interaction.data?.custom_id ? interaction.data : null;
  const operation = parseInviteAction(component?.custom_id);

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
  const decision = getInviteDecisionState(state, operation, profile.id);
  if (decision.stale) return getStaleInviteMessage(decision);

  const { error } = await supabase.rpc("rankball_recruiting_management_action", {
    p_actor_profile_id: profile.id,
    p_operation: operation,
  });
  if (error) {
    if (["P0002", "23514"].includes(error.code)) return getStaleInviteMessage({ reason: "processed_invitation" });
    if (error.code === "42501") reject(403, "discord_invite_not_for_user");
    throw error;
  }

  return getInviteResultMessage(operation);
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

    const customId = String(interaction.data?.custom_id || "").trim();
    if (customId.startsWith(`${TOURNAMENT_PREFIX}:`)) {
      sendInteractionMessage(response, getTournamentUrl(request, parseTournamentAction(customId)));
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
    if (statusCode === 409 && error.details?.message) {
      sendInteractionMessage(response, `${error.details.message} RankBall에서 다시 확인하세요.`);
      return;
    }
    sendInteractionMessage(response, "처리하지 못했습니다. RankBall에서 다시 확인하세요.");
  }
}
