import { DISCORD_API_BASE_URL } from "../../shared/lib/discordProtocol.js";

export function getDiscordBotAuthorization(value = process.env.DISCORD_BOT_TOKEN || "") {
  const token = String(value || "").trim();
  if (!token) return "";
  return /^Bot\s+/i.test(token) ? token : `Bot ${token}`;
}

export async function fetchDiscordApi(
  path,
  options = {},
  {
    authorization = getDiscordBotAuthorization(),
    emptyBody = null,
  } = {},
) {
  if (!authorization) {
    throw new Error("discord_bot_token_not_configured");
  }

  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    ...options,
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
  return body ?? emptyBody;
}
