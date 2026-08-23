export const SUPPORTED_OAUTH_SCOPES = Object.freeze(["profile"]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value) {
  try {
    return new URL(String(value ?? "").trim());
  } catch {
    return null;
  }
}

export function getOAuthConsentDetails(details = {}) {
  const client = details?.client ?? {};
  const clientName = String(client.name ?? "").trim() || "이름을 확인할 수 없는 외부 앱";
  const clientId = String(client.id ?? "").trim();
  const scopes = String(details?.scope ?? "").split(/\s+/u).filter(Boolean);
  const unsupportedScopes = scopes.filter((scope) => !SUPPORTED_OAUTH_SCOPES.includes(scope));
  const redirectUri = String(details?.redirect_uri ?? "").trim();
  const redirectUrl = parseUrl(redirectUri);
  const isLoopback = redirectUrl?.protocol === "http:" && LOOPBACK_HOSTS.has(redirectUrl.hostname);
  const isSafeRedirect = redirectUrl?.protocol === "https:" || isLoopback;
  const redirectLabel = redirectUrl
    ? `${redirectUrl.protocol}//${redirectUrl.host}`
    : "확인할 수 없음";
  const canApprove = Boolean(
    clientId
    && scopes.length > 0
    && unsupportedScopes.length === 0
    && isSafeRedirect,
  );

  return {
    clientName,
    clientId,
    scopes,
    unsupportedScopes,
    redirectLabel,
    isSafeRedirect,
    canApprove,
  };
}
