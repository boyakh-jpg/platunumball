import { MINUTE_MS } from "./constants.js";

export const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_CURRENT_USER_URL = "https://discord.com/api/users/@me";
export const DISCORD_INVITE_ACTION_PREFIX = "rankball:invite";
export const DISCORD_TOURNAMENT_ACTION_PREFIX = "rankball:tournament";
export const DISCORD_OAUTH_PROOF_TTL_MS = 5 * MINUTE_MS;
export const DISCORD_OAUTH_STATE_TTL_MS = 10 * MINUTE_MS;
export const DISCORD_OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
export const DISCORD_NOTIFICATION_ID_MAX_LENGTH = 160;
export const DISCORD_NOTIFICATION_TITLE_MAX_LENGTH = 160;
export const DISCORD_NOTIFICATION_BODY_MAX_LENGTH = 1200;
export const DISCORD_NOTIFICATION_URL_MAX_LENGTH = 500;
export const DISCORD_PROFILE_ID_MAX_LENGTH = 128;

export function isDiscordSnowflake(value = "") {
  return DISCORD_SNOWFLAKE_PATTERN.test(String(value || "").trim());
}

export function isDiscordOAuthState(value = "") {
  return DISCORD_OAUTH_STATE_PATTERN.test(String(value || ""));
}

export function getDiscordCdnAvatarUrl(user = {}, size = 128) {
  if (!user?.id) return "";
  if (!user.avatar) {
    const fallbackIndex = Number(user.discriminator ?? 0) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${Number.isFinite(fallbackIndex) ? fallbackIndex : 0}.png`;
  }
  const extension = String(user.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`;
}

export function getDiscordInviteCustomId(action, recruitingPostId, invitationId) {
  return [
    DISCORD_INVITE_ACTION_PREFIX,
    action,
    encodeURIComponent(String(recruitingPostId ?? "")),
    encodeURIComponent(String(invitationId ?? "")),
  ].join(":");
}
