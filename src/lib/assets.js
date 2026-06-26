const RAW_ASSET_BASE_URL = (
  import.meta.env.VITE_ASSET_BASE_URL ||
  import.meta.env.VITE_PUBLIC_ASSET_BASE_URL ||
  ""
).trim();

export function getAssetBaseUrl() {
  return RAW_ASSET_BASE_URL.replace(/\/+$/, "");
}

export function assetUrl(path = "") {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "").replace(/^\/+/, "")}`;
  const baseUrl = getAssetBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function cssUrl(path) {
  return `url("${assetUrl(path).replace(/"/g, '\\"')}")`;
}

export function installRemoteAssetVariables() {
  if (typeof document === "undefined") return;
  const styleId = "rankball-remote-assets";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
:root {
  --bg-court: ${cssUrl("/assets/rankball-court-hero.webp")};
  --bg-action: ${cssUrl("/assets/main.webp")};
  --bg-profile: ${cssUrl("/assets/rankball-profile-night.webp")};
  --bg-hoop: ${cssUrl("/assets/rankball-hoop-night.webp")};
  --bg-ball: ${cssUrl("/assets/rankball-ball-night.webp")};
}

html[data-theme="light"] {
  --bg-court: ${cssUrl("/assets/rankball-court-hero-day.webp")};
  --bg-action: ${cssUrl("/assets/main-day.webp")};
  --bg-profile: ${cssUrl("/assets/rankball-action-day.webp")};
  --bg-hoop: ${cssUrl("/assets/rankball-hoop-day.webp")};
  --bg-ball: ${cssUrl("/assets/rankball-ball-day.webp")};
}
`;
  document.head.appendChild(style);
}
