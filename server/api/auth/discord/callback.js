import {
  DISCORD_CURRENT_USER_URL,
  DISCORD_TOKEN_URL,
  isDiscordOAuthState,
} from "../../../../shared/lib/discordProtocol.js";
import { getPublicAppUrl } from "../../_publicAppUrl.js";
import { allowRequestMethod } from "../../_supabaseAdmin.js";
import { setApiSecurityHeaders } from "../../_requestSecurity.js";
import {
  DISCORD_OAUTH_STATE_COOKIE,
  clearDiscordOAuthStateCookie,
  readCookie,
  setDiscordOAuthProofCookies,
} from "../_discordOAuthCookies.js";
import {
  createDiscordOAuthProof,
  verifyDiscordOAuthStateTicket,
} from "../_discordOAuthProof.js";

function redirectToSettingsDiscord(request, response, params = {}) {
  const baseUrl = getPublicAppUrl(request);
  if (!baseUrl) {
    setApiSecurityHeaders(response);
    response.status(500).json({ error: "public_app_url_not_configured" });
    return;
  }
  const url = new URL("/app/settings/discord", baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  setApiSecurityHeaders(response);
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
  if (!tokenResponse.ok) throw new Error(`token_exchange_failed:${tokenResponse.status}`);
  return tokenResponse.json();
}

async function fetchDiscordUser(accessToken) {
  const userResponse = await fetch(DISCORD_CURRENT_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) throw new Error(`user_fetch_failed:${userResponse.status}`);
  return userResponse.json();
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["GET"])) return;

  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  const providerError = typeof request.query.error === "string" ? request.query.error : "";
  const stateTicket = readCookie(request, DISCORD_OAUTH_STATE_COOKIE);

  try {
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_REDIRECT_URI) {
      clearDiscordOAuthStateCookie(request, response);
      redirectToSettingsDiscord(request, response, { discordError: "discord_oauth_not_configured" });
      return;
    }
    if (providerError) {
      clearDiscordOAuthStateCookie(request, response);
      redirectToSettingsDiscord(request, response, { discordError: "discord_oauth_cancelled" });
      return;
    }
    if (!code || code.length > 2_048 || !isDiscordOAuthState(state)) {
      clearDiscordOAuthStateCookie(request, response);
      redirectToSettingsDiscord(request, response, { discordError: "missing_oauth_params" });
      return;
    }

    const stateContext = verifyDiscordOAuthStateTicket(stateTicket, state);
    if (!stateContext) {
      clearDiscordOAuthStateCookie(request, response);
      redirectToSettingsDiscord(request, response, { discordError: "state_mismatch" });
      return;
    }

    const token = await exchangeCodeForToken(code);
    const discordUser = await fetchDiscordUser(token.access_token);
    const proof = createDiscordOAuthProof(discordUser, state, stateContext.appProfileId);
    setDiscordOAuthProofCookies(request, response, proof);
    redirectToSettingsDiscord(request, response, { discord: "pending" });
  } catch (error) {
    console.error("Discord OAuth callback failed.", error);
    clearDiscordOAuthStateCookie(request, response);
    redirectToSettingsDiscord(request, response, { discordError: "discord_oauth_failed" });
  }
}
