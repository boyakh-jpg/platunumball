const MIN_BEARER_TOKEN_LENGTH = 16;
const MAX_BEARER_TOKEN_LENGTH = 8_192;

const SENSITIVE_QUERY_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "bearer",
  "clientsecret",
  "cookie",
  "credential",
  "idtoken",
  "jwt",
  "password",
  "refreshtoken",
  "secret",
  "servicerole",
  "servicerolekey",
  "session",
  "signature",
  "token",
]);

function normalizeQueryKey(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getAuthorizationHeader(request = {}) {
  const value = typeof request.headers?.get === "function"
    ? request.headers.get("authorization")
    : request.headers?.authorization ?? request.headers?.Authorization ?? "";
  return Array.isArray(value) ? value : String(value || "");
}

export function parseBearerAuthorization(request = {}) {
  const header = getAuthorizationHeader(request);
  if (Array.isArray(header)) return { token: "", error: "invalid_bearer_token" };
  if (!header) return { token: "", error: "missing_bearer_token" };
  if (header.length > MAX_BEARER_TOKEN_LENGTH + 16 || header !== header.trim()) {
    return { token: "", error: "invalid_bearer_token" };
  }

  const match = header.match(/^Bearer ([^\s,\u0000-\u001f\u007f]+)$/i);
  const token = match?.[1] ?? "";
  if (token.length < MIN_BEARER_TOKEN_LENGTH || token.length > MAX_BEARER_TOKEN_LENGTH) {
    return { token: "", error: "invalid_bearer_token" };
  }
  return { token, error: "" };
}

export function getStrictBearerToken(request = {}) {
  return parseBearerAuthorization(request).token;
}

export function findSensitiveQueryKey(query = {}, allowedKeys = []) {
  const allowed = new Set(allowedKeys.map((key) => String(key).toLowerCase()));
  return Object.keys(query).find((key) => {
    if (allowed.has(String(key).toLowerCase())) return false;
    const normalizedKey = normalizeQueryKey(key);
    return SENSITIVE_QUERY_KEYS.has(normalizedKey)
      || /(?:token|secret|password|credential|signature|cookie|authorization|bearer|apikey)$/u.test(normalizedKey);
  }) ?? "";
}

export function setApiSecurityHeaders(response) {
  response.setHeader?.("Cache-Control", "no-store");
  response.setHeader?.("Pragma", "no-cache");
  response.setHeader?.("Referrer-Policy", "no-referrer");
  response.setHeader?.("X-Content-Type-Options", "nosniff");
  response.setHeader?.("Vary", "Authorization");
}

function sendSecurityError(response, statusCode, error, extraHeaders = {}) {
  setApiSecurityHeaders(response);
  Object.entries(extraHeaders).forEach(([key, value]) => response.setHeader?.(key, value));
  response.status(statusCode).json({ error });
}

export function enforceApiRouteSecurity(request, response, route = {}) {
  setApiSecurityHeaders(response);

  const allowedMethods = Array.isArray(route.methods) ? route.methods : [];
  const method = String(request.method || "GET").toUpperCase();
  if (!allowedMethods.includes(method)) {
    sendSecurityError(response, 405, "method_not_allowed", { Allow: allowedMethods.join(", ") });
    return false;
  }

  const allowedSensitiveQueryKeys = route.allowedSensitiveQueryKeysByMethod?.[method] ?? [];
  if (findSensitiveQueryKey(request.query ?? {}, allowedSensitiveQueryKeys)) {
    sendSecurityError(response, 400, "credentials_not_allowed_in_url");
    return false;
  }

  if (["user", "admin", "internal"].includes(route.auth)) {
    const bearer = parseBearerAuthorization(request);
    if (bearer.error) {
      sendSecurityError(response, 401, bearer.error, { "WWW-Authenticate": "Bearer" });
      return false;
    }
  }

  return true;
}
