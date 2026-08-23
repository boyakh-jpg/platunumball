import { getSupabaseUrl } from "./_supabaseAuth.js";
import { getPublicAppUrl } from "./_publicAppUrl.js";

export function getMcpProtectedResourceMetadata(request = null) {
  const appUrl = getPublicAppUrl(request);
  const supabaseUrl = String(getSupabaseUrl() || "").replace(/\/$/u, "");
  if (!appUrl || !supabaseUrl) throw new Error("oauth_metadata_not_configured");
  return {
    resource: `${appUrl}/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    scopes_supported: ["profile"],
    bearer_methods_supported: ["header"],
  };
}

export default function oauthProtectedResourceHandler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "method_not_allowed" });
    return;
  }
  try {
    response.setHeader("Cache-Control", "public, max-age=300");
    response.status(200).json(getMcpProtectedResourceMetadata(request));
  } catch (error) {
    console.error("[oauth] protected resource metadata failed", error);
    response.setHeader("Cache-Control", "no-store");
    response.status(503).json({ error: "oauth_metadata_not_configured" });
  }
}
