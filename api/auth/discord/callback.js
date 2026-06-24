const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_ME_URL = "https://discord.com/api/users/@me";

function getAppUrl(request) {
  const configuredUrl = String(process.env.VITE_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (configuredUrl) return configuredUrl;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const protocol = request.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

function encodeBase64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getDiscordAvatarUrl(user) {
  if (!user?.id) return "";
  if (!user.avatar) {
    const fallbackIndex = Number(user.discriminator ?? 0) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${Number.isFinite(fallbackIndex) ? fallbackIndex : 0}.png`;
  }
  const extension = String(user.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

function redirectToProfile(request, response, params) {
  const url = new URL("/app/profile", getAppUrl(request));
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  response.writeHead(302, { Location: url.toString() });
  response.end();
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
  });

  const credentials = Buffer.from(`${process.env.DISCORD_CLIENT_ID}:${process.env.DISCORD_CLIENT_SECRET}`).toString("base64");
  const tokenResponse = await fetch(DISCORD_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!tokenResponse.ok) {
    throw new Error(`token_exchange_failed:${tokenResponse.status}`);
  }
  return tokenResponse.json();
}

async function fetchDiscordUser(accessToken) {
  const userResponse = await fetch(DISCORD_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userResponse.ok) {
    throw new Error(`user_fetch_failed:${userResponse.status}`);
  }
  return userResponse.json();
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_REDIRECT_URI) {
    redirectToProfile(request, response, { discordError: "discord_oauth_not_configured", discordState: state });
    return;
  }
  if (!code || !state) {
    redirectToProfile(request, response, { discordError: "missing_oauth_params", discordState: state });
    return;
  }

  try {
    const token = await exchangeCodeForToken(code);
    const discordUser = await fetchDiscordUser(token.access_token);
    const connection = {
      provider: "discord",
      status: "linked",
      userId: discordUser.id,
      username: discordUser.username,
      globalName: discordUser.global_name || discordUser.username,
      avatarUrl: getDiscordAvatarUrl(discordUser),
      linkedAt: new Date().toISOString(),
      source: "discord",
    };

    redirectToProfile(request, response, {
      discord: "linked",
      discordState: state,
      discordConnection: encodeBase64UrlJson(connection),
    });
  } catch (error) {
    console.error("Discord OAuth callback failed.", error);
    redirectToProfile(request, response, { discordError: "discord_oauth_failed", discordState: state });
  }
}
