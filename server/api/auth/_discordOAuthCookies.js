import { DISCORD_OAUTH_PROOF_TTL_MS, DISCORD_OAUTH_STATE_TTL_MS } from "../../../src/lib/discordProtocol.js";

export const DISCORD_OAUTH_STATE_COOKIE = "rankball_discord_oauth_state";
export const DISCORD_OAUTH_PROOF_COOKIE = "rankball_discord_oauth_proof";
export const DISCORD_OAUTH_STATE_COOKIE_PATH = "/api/auth/discord/callback";
export const DISCORD_OAUTH_PROOF_COOKIE_PATH = "/api/auth/discord/complete";

function isSecureRequest(request = {}) {
  const forwardedProtocol = String(request.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return forwardedProtocol === "https" || Boolean(process.env.VERCEL_ENV || process.env.VERCEL);
}

function serializeCookie(request, name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(String(value || ""))}`,
    `Path=${options.path || "/"}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(Number(options.maxAgeSeconds) || 0))}`,
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(request = {}, name = "") {
  const cookieHeader = String(request.headers?.cookie || "");
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function setDiscordOAuthStateCookie(request, response, ticket) {
  response.setHeader("Set-Cookie", serializeCookie(request, DISCORD_OAUTH_STATE_COOKIE, ticket, {
    path: DISCORD_OAUTH_STATE_COOKIE_PATH,
    maxAgeSeconds: Math.ceil(DISCORD_OAUTH_STATE_TTL_MS / 1000),
  }));
}

export function setDiscordOAuthProofCookies(request, response, proof) {
  response.setHeader("Set-Cookie", [
    serializeCookie(request, DISCORD_OAUTH_STATE_COOKIE, "", {
      path: DISCORD_OAUTH_STATE_COOKIE_PATH,
      maxAgeSeconds: 0,
    }),
    serializeCookie(request, DISCORD_OAUTH_PROOF_COOKIE, proof, {
      path: DISCORD_OAUTH_PROOF_COOKIE_PATH,
      maxAgeSeconds: Math.ceil(DISCORD_OAUTH_PROOF_TTL_MS / 1000),
    }),
  ]);
}

export function clearDiscordOAuthStateCookie(request, response) {
  response.setHeader("Set-Cookie", serializeCookie(request, DISCORD_OAUTH_STATE_COOKIE, "", {
    path: DISCORD_OAUTH_STATE_COOKIE_PATH,
    maxAgeSeconds: 0,
  }));
}

export function clearDiscordOAuthProofCookie(request, response) {
  response.setHeader("Set-Cookie", serializeCookie(request, DISCORD_OAUTH_PROOF_COOKIE, "", {
    path: DISCORD_OAUTH_PROOF_COOKIE_PATH,
    maxAgeSeconds: 0,
  }));
}
