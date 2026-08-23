import { createHmac } from "node:crypto";
import { getRequestNetworkIdentity } from "../../lib/requestNetworkIdentity.js";

function requestError(code, statusCode = 503) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

function getViewSecret() {
  const secret = String(process.env.COMMUNITY_VIEW_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!secret) throw requestError("community_view_secret_missing");
  return secret;
}

function createDigest(value, encoding = "hex") {
  return createHmac("sha256", getViewSecret())
    .update(`boxtier:community-view:${value}`)
    .digest(encoding);
}

export function getCommunityViewDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getCommunityViewerIdentity(request, _response, profileId = "", now = new Date()) {
  const normalizedProfileId = String(profileId ?? "").trim();
  if (normalizedProfileId) {
    return {
      userId: normalizedProfileId,
      viewerKeyHash: createDigest(`profile:${normalizedProfileId}`),
      viewDate: getCommunityViewDate(now),
    };
  }

  return {
    userId: null,
    viewerKeyHash: createDigest(`anonymous-network:${getRequestNetworkIdentity(request)}`),
    viewDate: getCommunityViewDate(now),
  };
}
