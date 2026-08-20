const OAUTH_SEARCH_KEYS = ["code", "error", "error_code", "error_description"];
const OAUTH_CALLBACK_MARKER = "authCallback";
const OAUTH_HASH_TRIGGER_KEYS = [
  "access_token",
  "refresh_token",
  "error",
  "error_code",
  "error_description",
];
const OAUTH_HASH_KEYS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "provider_token",
  "provider_refresh_token",
  "type",
  "error",
  "error_code",
  "error_description",
];

function firstParam(params, keys) {
  return keys.map((key) => params.get(key)).find(Boolean) ?? "";
}

export function getOAuthCallbackState(href, origin = "https://boxtier.local") {
  try {
    const sourceUrl = new URL(href, origin);
    const url = new URL(sourceUrl);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const hasMarkedSearchCallback = url.searchParams.get(OAUTH_CALLBACK_MARKER) === "1";
    const hasLegacySearchCallback = url.pathname !== "/app/receipt"
      && OAUTH_SEARCH_KEYS.some((key) => url.searchParams.has(key));
    const hasSearchCallback = hasMarkedSearchCallback || hasLegacySearchCallback;
    const hasHashCallback = OAUTH_HASH_TRIGGER_KEYS.some((key) => hashParams.has(key));
    const hasCallback = hasSearchCallback || hasHashCallback;

    if (hasSearchCallback) {
      url.searchParams.delete(OAUTH_CALLBACK_MARKER);
      OAUTH_SEARCH_KEYS.forEach((key) => url.searchParams.delete(key));
    }
    if (hasHashCallback) {
      OAUTH_HASH_KEYS.forEach((key) => hashParams.delete(key));
      const nextHash = hashParams.toString();
      url.hash = nextHash ? `#${nextHash}` : "";
    }

    return {
      hasCallback,
      code: hasSearchCallback ? sourceUrl.searchParams.get("code") ?? "" : "",
      error: firstParam(sourceUrl.searchParams, ["error_description", "error_code", "error"])
        || firstParam(new URLSearchParams(sourceUrl.hash.replace(/^#/, "")), ["error_description", "error_code", "error"]),
      pathname: url.pathname,
      cleanedPath: `${url.pathname}${url.search}${url.hash}`,
    };
  } catch {
    return {
      hasCallback: false,
      code: "",
      error: "",
      pathname: "/",
      cleanedPath: "/",
    };
  }
}

export function getOAuthCallbackRedirectUrl(origin, redirectPath) {
  const url = new URL("/login", origin);
  url.searchParams.set(OAUTH_CALLBACK_MARKER, "1");
  url.searchParams.set("redirect", redirectPath);
  return url.toString();
}
