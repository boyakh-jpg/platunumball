import crypto from "node:crypto";
import {
  DISCORD_OAUTH_PROOF_TTL_MS,
  DISCORD_OAUTH_STATE_TTL_MS,
  isDiscordOAuthState,
  isDiscordSnowflake,
} from "../../../src/lib/discordProtocol.js";

const CLOCK_SKEW_MS = 30_000;
const MAX_SIGNED_TOKEN_LENGTH = 4_096;

function getProofSecret() {
  const secret = String(process.env.DISCORD_OAUTH_PROOF_SECRET || process.env.DISCORD_CLIENT_SECRET || "").trim();
  if (!secret) throw new Error("discord_oauth_proof_secret_missing");
  return secret;
}

function getStateHash(state = "") {
  return crypto.createHash("sha256").update(String(state)).digest("base64url");
}

function signPayload(payload = {}) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", getProofSecret()).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifySignedPayload(token = "", expectedKind = "", maxTtlMs = 0) {
  const rawToken = String(token || "");
  if (!rawToken || rawToken.length > MAX_SIGNED_TOKEN_LENGTH) return null;
  const [encodedPayload, encodedSignature, extra] = rawToken.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;

  let expectedSignature;
  let receivedSignature;
  try {
    expectedSignature = crypto.createHmac("sha256", getProofSecret()).update(encodedPayload).digest();
    receivedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
  if (receivedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(receivedSignature, expectedSignature)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const now = Date.now();
  const issuedAt = Number(payload?.issuedAt);
  const expiresAt = Number(payload?.expiresAt);
  if (
    payload?.version !== 1
    || payload?.kind !== expectedKind
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || issuedAt > now + CLOCK_SKEW_MS
    || now > expiresAt
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > maxTtlMs
  ) return null;
  return payload;
}

export function createDiscordOAuthStateTicket(appProfileId = "") {
  const profileId = String(appProfileId || "").trim();
  if (!profileId || profileId.length > 128) throw new Error("discord_oauth_profile_missing");
  const state = crypto.randomBytes(32).toString("base64url");
  const issuedAt = Date.now();
  return {
    state,
    ticket: signPayload({
      version: 1,
      kind: "state",
      appProfileId: profileId,
      stateHash: getStateHash(state),
      issuedAt,
      expiresAt: issuedAt + DISCORD_OAUTH_STATE_TTL_MS,
    }),
  };
}

export function verifyDiscordOAuthStateTicket(ticket = "", state = "") {
  if (!isDiscordOAuthState(state)) return null;
  const payload = verifySignedPayload(ticket, "state", DISCORD_OAUTH_STATE_TTL_MS);
  if (!payload || payload.stateHash !== getStateHash(state)) return null;
  const appProfileId = String(payload.appProfileId || "").trim();
  return appProfileId && appProfileId.length <= 128 ? { appProfileId } : null;
}

export function createDiscordOAuthProof(discordUser = {}, state = "", appProfileId = "") {
  const profileId = String(appProfileId || "").trim();
  if (!profileId) throw new Error("discord_oauth_profile_missing");
  if (!isDiscordOAuthState(state)) throw new Error("discord_oauth_state_invalid");
  if (!isDiscordSnowflake(discordUser.id)) throw new Error("discord_oauth_identity_invalid");
  const issuedAt = Date.now();
  return signPayload({
    version: 1,
    kind: "identity",
    appProfileId: profileId,
    discordUserId: String(discordUser.id),
    username: String(discordUser.username || "").slice(0, 80),
    globalName: String(discordUser.global_name || discordUser.username || "").slice(0, 80),
    avatar: String(discordUser.avatar || "").slice(0, 160),
    discriminator: String(discordUser.discriminator || "").slice(0, 8),
    stateHash: getStateHash(state),
    issuedAt,
    expiresAt: issuedAt + DISCORD_OAUTH_PROOF_TTL_MS,
  });
}

export function verifyDiscordOAuthProof(token = "", options = {}) {
  const payload = verifySignedPayload(token, "identity", DISCORD_OAUTH_PROOF_TTL_MS);
  if (!payload || !isDiscordSnowflake(payload.discordUserId)) return null;
  const expectedProfileId = String(options.expectedProfileId || "");
  if (expectedProfileId && String(payload.appProfileId || "") !== expectedProfileId) {
    const error = new Error("discord_oauth_profile_mismatch");
    error.statusCode = 403;
    throw error;
  }
  if (options.expectedState && payload.stateHash !== getStateHash(options.expectedState)) return null;
  return {
    id: String(payload.discordUserId),
    username: String(payload.username || ""),
    global_name: String(payload.globalName || payload.username || ""),
    avatar: String(payload.avatar || ""),
    discriminator: String(payload.discriminator || ""),
  };
}
