import { DISCORD_AUTHORIZE_URL, isDiscordSnowflake } from "../../../../src/lib/discordProtocol.js";
import { getAuthenticatedContext, sendJson } from "../../_supabaseAdmin.js";
import { setDiscordOAuthStateCookie } from "../_discordOAuthCookies.js";
import { createDiscordOAuthStateTicket } from "../_discordOAuthProof.js";

function getDiscordRedirectUri() {
  const value = String(process.env.DISCORD_REDIRECT_URI || "").trim();
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const clientId = String(process.env.DISCORD_CLIENT_ID || "").trim();
    const redirectUri = getDiscordRedirectUri();
    if (!isDiscordSnowflake(clientId) || !redirectUri) {
      sendJson(response, 500, { error: "discord_oauth_not_configured" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const { state, ticket } = createDiscordOAuthStateTicket(context.profileId);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "identify",
      state,
      prompt: "consent",
    });

    setDiscordOAuthStateCookie(request, response, ticket);
    sendJson(response, 200, {
      ok: true,
      state,
      profileId: context.profileId,
      authorizeUrl: `${DISCORD_AUTHORIZE_URL}?${params.toString()}`,
    });
  } catch (error) {
    console.error("Discord OAuth start failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "discord_oauth_start_failed" });
  }
}
