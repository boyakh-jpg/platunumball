export function getConfiguredPublicAppUrl() {
  return String(
    process.env.VITE_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.PUBLIC_APP_URL
    || "",
  ).trim().replace(/\/+$/, "");
}

export function getPublicAppUrl(request = null) {
  const configuredUrl = getConfiguredPublicAppUrl();
  if (configuredUrl || !request?.headers) return configuredUrl;
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
  if (!host) return "";
  const protocol = String(request.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  return `${protocol}://${host}`;
}

export function getPublicAppWebUrl(path = "", request = null) {
  const safePath = String(path || "");
  const baseUrl = getPublicAppUrl(request);
  return baseUrl ? `${baseUrl}${safePath}` : safePath;
}
