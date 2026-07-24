const RAW_ASSET_BASE_URL = (
  import.meta.env.VITE_ASSET_BASE_URL ||
  import.meta.env.VITE_PUBLIC_ASSET_BASE_URL ||
  ""
).trim();

function getAssetBaseUrl() {
  return RAW_ASSET_BASE_URL.replace(/\/+$/, "");
}

export function assetUrl(path = "") {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "").replace(/^\/+/, "")}`;
  const baseUrl = getAssetBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export const BOXTIER_LOGO_URL = assetUrl("/assets/boxtier_logo.png");
export const BOXTIER_LETTER_DARK_URL = assetUrl("/assets/boxtier_letter_dark.png");
export const BOXTIER_LETTER_LIGHT_URL = assetUrl("/assets/boxtier_letter_light.png");

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
  --bg-court: ${cssUrl("/assets/rankball-court-hero-v2.webp")};
  --bg-home-court: ${cssUrl("/assets/rankball-court-hero-v3.webp")};
  --bg-action: ${cssUrl("/assets/main-night-v3.webp")};
  --bg-create: ${cssUrl("/assets/rankball-create-match-night-v2.webp")};
  --bg-profile: ${cssUrl("/assets/rankball-profile-night-v2.webp")};
  --bg-hoop: ${cssUrl("/assets/rankball-hoop-night.webp")};
  --bg-ball: ${cssUrl("/assets/rankball-ball-night.webp")};
  --bg-recruiting: ${cssUrl("/assets/court-ball-night.webp")};
  --bg-recorder: ${cssUrl("/assets/rankball-recorder-night-v2.webp")};
  --bg-settings: ${cssUrl("/assets/rankball-settings-night.webp")};
  --bg-record-create: ${cssUrl("/assets/rankball-record-create-night.webp")};
  --bg-teams: ${cssUrl("/assets/rankball-teams-night-v2.webp")};
  --bg-rankings: ${cssUrl("/assets/rankball-rankings-night-v2.webp")};
}

html[data-theme="light"] {
  --bg-court: ${cssUrl("/assets/rankball-court-hero-day-v2.webp")};
  --bg-home-court: ${cssUrl("/assets/rankball-court-hero-day-v3.webp")};
  --bg-action: ${cssUrl("/assets/main-day-v3.webp")};
  --bg-create: ${cssUrl("/assets/rankball-create-match-day-v2.webp")};
  --bg-profile: ${cssUrl("/assets/rankball-profile-day-v2.webp")};
  --bg-hoop: ${cssUrl("/assets/rankball-hoop-day.webp")};
  --bg-ball: ${cssUrl("/assets/rankball-ball-day.webp")};
  --bg-recruiting: ${cssUrl("/assets/court-ball-day.webp")};
  --bg-recorder: ${cssUrl("/assets/rankball-recorder-day-v2.webp")};
  --bg-settings: ${cssUrl("/assets/rankball-settings-day.webp")};
  --bg-record-create: ${cssUrl("/assets/rankball-record-create-day.webp")};
  --bg-teams: ${cssUrl("/assets/rankball-teams-day-v2.webp")};
  --bg-rankings: ${cssUrl("/assets/rankball-rankings-day-v2.webp")};
}
`;
  document.head.appendChild(style);
}
