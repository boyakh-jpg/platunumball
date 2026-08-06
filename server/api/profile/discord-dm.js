import { isDiscordSnowflake } from "../../../shared/lib/discordProtocol.js";
import { allowRequestMethod, getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";
import { setApiSecurityHeaders } from "../_requestSecurity.js";

const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{2,128}$/;

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["GET"])) return;

  const profileId = String(request.query?.profileId ?? "").trim();
  if (!PROFILE_ID_PATTERN.test(profileId)) {
    sendJson(response, 400, { error: "invalid_profile_id" });
    return;
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("profiles")
      .select("discord_user_id,discord_connection,withdrawn_at")
      .eq("id", profileId)
      .maybeSingle();
    if (error) throw error;

    const discordUserId = String(data?.discord_user_id ?? data?.discord_connection?.userId ?? "").trim();
    if (data?.withdrawn_at || !isDiscordSnowflake(discordUserId)) {
      sendJson(response, 404, { error: "discord_not_linked" });
      return;
    }

    setApiSecurityHeaders(response);
    response.status(302);
    response.setHeader("Location", `https://discord.com/users/${encodeURIComponent(discordUserId)}`);
    response.end();
  } catch (error) {
    console.error("Discord profile redirect failed.", error.message);
    sendJson(response, 500, { error: "discord_profile_redirect_failed" });
  }
}
