import { getDiscordCdnAvatarUrl, isDiscordOAuthState } from "../../../../shared/lib/discordProtocol.js";
import { getAuthenticatedContext, readJsonBody, sendJson } from "../../_supabaseAdmin.js";
import {
  DISCORD_OAUTH_PROOF_COOKIE,
  clearDiscordOAuthProofCookie,
  readCookie,
} from "../_discordOAuthCookies.js";
import { verifyDiscordOAuthProof } from "../_discordOAuthProof.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const context = await getAuthenticatedContext(request);
    const body = await readJsonBody(request);
    const state = String(body.state || "");
    const proof = readCookie(request, DISCORD_OAUTH_PROOF_COOKIE);
    clearDiscordOAuthProofCookie(request, response);
    if (!isDiscordOAuthState(state) || !proof) {
      sendJson(response, 400, { error: "discord_oauth_proof_required" });
      return;
    }

    const discordUser = verifyDiscordOAuthProof(proof, {
      expectedProfileId: context.profileId,
      expectedState: state,
    });
    if (!discordUser) {
      sendJson(response, 400, { error: "discord_oauth_proof_invalid" });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      profileId: context.profileId,
      connection: {
        provider: "discord",
        status: "linked",
        userId: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name || discordUser.username,
        avatarUrl: getDiscordCdnAvatarUrl(discordUser),
        linkedAt: new Date().toISOString(),
        source: "discord",
        oauthProof: proof,
      },
    });
  } catch (error) {
    clearDiscordOAuthProofCookie(request, response);
    console.error("Discord OAuth completion failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "discord_oauth_completion_failed" });
  }
}
