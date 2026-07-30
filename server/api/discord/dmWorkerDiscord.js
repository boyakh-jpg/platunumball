import { getPublicAppWebUrl } from "../_publicAppUrl.js";
import {
  DISCORD_NOTIFICATION_BODY_MAX_LENGTH,
  DISCORD_NOTIFICATION_URL_MAX_LENGTH,
  isDiscordSnowflake,
} from "../../../shared/lib/discordProtocol.js";
import { BRAND_NAME } from "../../../shared/lib/brand.js";
import { fetchDiscordApi as discordFetch } from "../../lib/discordHttp.js";

export function httpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function getDiscordBotStatus() {
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  const configuredGuildIds = getConfiguredGuildIds();
  if (!token) {
    return {
      ok: false,
      tokenConfigured: false,
      configuredGuildCount: configuredGuildIds.length,
    };
  }

  const bot = await discordFetch("/users/@me", { method: "GET" });
  const guilds = await discordFetch("/users/@me/guilds", { method: "GET" });

  return {
    ok: true,
    tokenConfigured: true,
    tokenHasBotPrefix: /^Bot\s+/i.test(token),
    bot: {
      id: bot?.id ?? null,
      username: bot?.username ?? null,
      globalName: bot?.global_name ?? null,
    },
    guildCount: (guilds ?? []).length,
    configuredGuildCount: configuredGuildIds.length,
    configuredGuildIds,
  };
}

export function trimDiscordText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeDiscordUsername(value = "") {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export function getConfiguredGuildIds() {
  return String(
    process.env.DISCORD_GUILD_IDS ||
      process.env.DISCORD_GUILD_ID ||
      process.env.DISCORD_SERVER_IDS ||
      process.env.DISCORD_SERVER_ID ||
      "",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function getBotGuildIds() {
  const configuredGuildIds = getConfiguredGuildIds();
  if (configuredGuildIds.length) return configuredGuildIds;

  const guilds = await discordFetch("/users/@me/guilds", { method: "GET" });
  return (guilds ?? []).map((guild) => String(guild.id || "").trim()).filter(Boolean);
}

export function isExactDiscordUsernameMatch(user = {}, targetUsername = "") {
  const username = normalizeDiscordUsername(user.username);
  if (username && username === targetUsername) return true;
  const discriminator = String(user.discriminator || "").trim();
  const legacyUsername = discriminator && discriminator !== "0" ? `${username}#${discriminator}` : "";
  return Boolean(legacyUsername && legacyUsername === targetUsername);
}

export async function resolveDiscordUserIdByUsername(username) {
  const targetUsername = normalizeDiscordUsername(username);
  if (!targetUsername) throw httpError("missing_discord_username");
  if (isDiscordSnowflake(targetUsername)) return targetUsername;

  const guildIds = await getBotGuildIds();
  if (!guildIds.length) throw httpError("discord_bot_has_no_guilds", 404);

  const matchedUsers = new Map();
  for (const guildId of guildIds) {
    const members = await discordFetch(
      `/guilds/${encodeURIComponent(guildId)}/members/search?query=${encodeURIComponent(targetUsername)}&limit=10`,
      { method: "GET" },
    );
    for (const member of members ?? []) {
      const user = member?.user ?? {};
      if (user.id && isExactDiscordUsernameMatch(user, targetUsername)) {
        matchedUsers.set(String(user.id), user);
      }
    }
  }

  if (matchedUsers.size === 1) return [...matchedUsers.keys()][0];
  if (matchedUsers.size > 1) throw httpError("discord_username_ambiguous", 409);
  throw httpError("discord_username_not_found_in_bot_guild", 404);
}

export function getDiscordComponents(actions = []) {
  const buttons = actions
    .filter((action) => action?.customId)
    .slice(0, 5)
    .map((action) => ({
      type: 2,
      style: action.style === "primary" ? 1 : 2,
      label: trimDiscordText(action.label || action.id || "Open", 80),
      custom_id: trimDiscordText(action.customId, 100),
    }));

  return buttons.length ? [{ type: 1, components: buttons }] : [];
}

export function getDiscordWebUrl(payload = {}) {
  const rawUrl = String(payload.webUrl || payload.webPath || "").trim();
  if (!rawUrl || /^https?:\/\//i.test(rawUrl)) return rawUrl;
  return getPublicAppWebUrl(rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`);
}

export function getDiscordMessage(delivery = {}) {
  const payload = delivery.payload ?? {};
  const title = trimDiscordText(payload.title || BRAND_NAME, 120);
  const body = trimDiscordText(payload.body || "", DISCORD_NOTIFICATION_BODY_MAX_LENGTH);
  const webUrl = trimDiscordText(getDiscordWebUrl(payload), DISCORD_NOTIFICATION_URL_MAX_LENGTH);
  const content = [`**${title}**`, body, webUrl].filter(Boolean).join("\n").slice(0, 1900);
  return {
    content,
    allowed_mentions: { parse: [] },
    components: getDiscordComponents(payload.actions),
  };
}

export async function sendDiscordDm(delivery) {
  const discordUserId = String(delivery.discord_user_id ?? "").trim();
  if (!discordUserId) {
    throw new Error("missing_discord_user_id");
  }

  const channel = await discordFetch("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!channel?.id) {
    throw new Error("discord_dm_channel_not_created");
  }

  const message = await discordFetch(`/channels/${encodeURIComponent(channel.id)}/messages`, {
    method: "POST",
    body: JSON.stringify(getDiscordMessage(delivery)),
  });

  return {
    channelId: channel.id,
    messageId: message?.id ?? null,
  };
}

export async function sendTestDiscordDm(body = {}) {
  const discordUserId = String(body.discordUserId || body.discord_user_id || "").trim();
  const username = body.discordUsername || body.username || body.testUsername;
  const resolvedUserId = discordUserId || (await resolveDiscordUserIdByUsername(username));
  const now = new Date().toISOString();
  const result = await sendDiscordDm({
    discord_user_id: resolvedUserId,
    event: "test",
    payload: {
      title: trimDiscordText(body.title || `${BRAND_NAME} 테스트 DM`, 120),
      body: trimDiscordText(body.message || body.body || `${BRAND_NAME} Discord 알림 테스트입니다.`, DISCORD_NOTIFICATION_BODY_MAX_LENGTH),
      webUrl: trimDiscordText(body.webUrl || process.env.VITE_PUBLIC_APP_URL || "", DISCORD_NOTIFICATION_URL_MAX_LENGTH),
      sentAt: now,
    },
  });

  return {
    ok: true,
    test: true,
    discordUserId: resolvedUserId,
    channelId: result.channelId,
    messageId: result.messageId,
  };
}
