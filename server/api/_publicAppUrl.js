const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const UNSAFE_PATH_PATTERN = /[\u0000-\u001f\u007f\\]/u;

function normalizeConfiguredOrigin(value = "") {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  try {
    const url = new URL(rawValue);
    const localHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password) return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function getConfiguredPublicAppUrl() {
  return normalizeConfiguredOrigin(
    process.env.VITE_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.PUBLIC_APP_URL
    || "",
  );
}

function getForwardedHostOrigin(request = {}) {
  const host = String(request.headers?.["x-forwarded-host"] || request.headers?.host || "")
    .split(",")[0]
    .trim();
  if (!host || /[\s/@\\]/u.test(host)) return "";

  try {
    const parsedHost = new URL(`https://${host}`);
    const hostname = parsedHost.hostname;
    const isLocal = LOCAL_HOSTS.has(hostname);
    const normalizeAllowedHost = (value) => {
      const rawValue = String(value || "").trim().toLowerCase();
      if (!rawValue) return "";
      try {
        return new URL(rawValue.includes("://") ? rawValue : `https://${rawValue}`).hostname.toLowerCase();
      } catch {
        return "";
      }
    };
    const allowedVercelHosts = new Set([
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ].map(normalizeAllowedHost).filter(Boolean));
    if (!isLocal && (parsedHost.port || !allowedVercelHosts.has(hostname.toLowerCase()))) return "";
    const forwardedProtocol = String(request.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase();
    const protocol = isLocal && forwardedProtocol === "http" ? "http:" : "https:";
    return `${protocol}//${parsedHost.host}`;
  } catch {
    return "";
  }
}

export function getPublicAppUrl(request = null) {
  return getConfiguredPublicAppUrl() || (request?.headers ? getForwardedHostOrigin(request) : "");
}

export function getPublicAppWebUrl(path = "", request = null) {
  const safePath = String(path || "");
  if (!/^\/(?!\/)/u.test(safePath) || UNSAFE_PATH_PATTERN.test(safePath)) return "";
  const baseUrl = getPublicAppUrl(request);
  return baseUrl ? new URL(safePath, baseUrl).toString() : safePath;
}
