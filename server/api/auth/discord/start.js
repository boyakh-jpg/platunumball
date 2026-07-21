import { DISCORD_AUTHORIZE_URL } from "../../../../src/lib/discordProtocol.js";

function sendError(response, statusCode, message) {
  response.status(statusCode).json({ error: message });
}

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendError(response, 405, "method_not_allowed");
    return;
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  const state = typeof request.query.state === "string" ? request.query.state : "";

  if (!clientId || !redirectUri) {
    sendError(response, 500, "discord_oauth_not_configured");
    return;
  }
  if (!state) {
    sendError(response, 400, "missing_state");
    return;
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "identify",
    state,
    prompt: "consent",
  });

  response.writeHead(302, { Location: `${DISCORD_AUTHORIZE_URL}?${params.toString()}` });
  response.end();
}
