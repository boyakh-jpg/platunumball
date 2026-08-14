import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const VIEWER_COOKIE_NAME = "boxtier_community_viewer";
const VIEWER_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const VIEWER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function readCookie(request, name) {
  const cookieHeader = String(request.headers?.cookie ?? request.headers?.get?.("cookie") ?? "");
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function isSecureRequest(request) {
  const forwardedProto = String(request.headers?.["x-forwarded-proto"] ?? request.headers?.get?.("x-forwarded-proto") ?? "");
  return forwardedProto.split(",")[0].trim() === "https" || Boolean(process.env.VERCEL);
}

function appendCookie(response, value) {
  const previous = response.getHeader?.("Set-Cookie");
  const next = previous ? (Array.isArray(previous) ? [...previous, value] : [previous, value]) : value;
  response.setHeader("Set-Cookie", next);
}

function signViewerId(viewerId) {
  return `${viewerId}.${createDigest(`cookie:${viewerId}`, "base64url")}`;
}

function readSignedViewerId(request) {
  const token = readCookie(request, VIEWER_COOKIE_NAME);
  const separator = token.lastIndexOf(".");
  if (separator < 0) return "";
  const viewerId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!VIEWER_ID_PATTERN.test(viewerId) || !signature) return "";
  const expected = createDigest(`cookie:${viewerId}`, "base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer) ? viewerId : "";
}

function setViewerCookie(request, response, viewerId) {
  const attributes = [
    `${VIEWER_COOKIE_NAME}=${encodeURIComponent(signViewerId(viewerId))}`,
    "Path=/api/community/posts",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${VIEWER_COOKIE_MAX_AGE}`,
  ];
  if (isSecureRequest(request)) attributes.push("Secure");
  appendCookie(response, attributes.join("; "));
}

export function getCommunityViewDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getCommunityViewerIdentity(request, response, profileId = "", now = new Date()) {
  const normalizedProfileId = String(profileId ?? "").trim();
  if (normalizedProfileId) {
    return {
      userId: normalizedProfileId,
      viewerKeyHash: createDigest(`profile:${normalizedProfileId}`),
      viewDate: getCommunityViewDate(now),
    };
  }

  let viewerId = readSignedViewerId(request);
  if (!viewerId) {
    viewerId = randomUUID();
    setViewerCookie(request, response, viewerId);
  }
  return {
    userId: null,
    viewerKeyHash: createDigest(`anonymous:${viewerId}`),
    viewDate: getCommunityViewDate(now),
  };
}
