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

const BOXTIER_LOGO_FALLBACK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect x="8" y="8" width="112" height="112" rx="26" fill="#f2e7d8"/>
  <circle cx="64" cy="64" r="38" fill="#fb7a21"/>
  <path d="M31 64h66M64 26c13 13 20 26 20 38s-7 25-20 38M64 26c-13 13-20 26-20 38s7 25 20 38" fill="none" stroke="#24130d" stroke-width="6" stroke-linecap="round"/>
  <text x="64" y="76" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="900" fill="#24130d">B</text>
</svg>`;

const BOXTIER_LETTER_DARK_FALLBACK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 96">
  <text x="4" y="68" font-family="Arial, sans-serif" font-size="70" font-weight="900" letter-spacing="0" fill="#f2e7d8">box</text>
  <text x="136" y="68" font-family="Arial, sans-serif" font-size="70" font-weight="900" letter-spacing="0" fill="#fb7a21">tier</text>
</svg>`;

const BOXTIER_LETTER_LIGHT_FALLBACK_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 96">
  <text x="4" y="68" font-family="Arial, sans-serif" font-size="70" font-weight="900" letter-spacing="0" fill="#19140f">box</text>
  <text x="136" y="68" font-family="Arial, sans-serif" font-size="70" font-weight="900" letter-spacing="0" fill="#d95108">tier</text>
</svg>`;

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.trim())}`;
}

function brandAssetUrl(path, fallbackSvg) {
  return getAssetBaseUrl() ? assetUrl(path) : svgDataUrl(fallbackSvg);
}

export const BOXTIER_LOGO_URL = brandAssetUrl("/assets/boxtier_logo.png", BOXTIER_LOGO_FALLBACK_SVG);
export const BOXTIER_LETTER_DARK_URL = brandAssetUrl("/assets/boxtier_letter_dark.png", BOXTIER_LETTER_DARK_FALLBACK_SVG);
export const BOXTIER_LETTER_LIGHT_URL = brandAssetUrl("/assets/boxtier_letter_light.png", BOXTIER_LETTER_LIGHT_FALLBACK_SVG);

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
  --bg-recruiting: ${cssUrl("/assets/court-ball-night.webp")};
  --bg-recorder: ${cssUrl("/assets/NY-court-night.webp")};
}

html[data-theme="light"] {
  --bg-court: ${cssUrl("/assets/rankball-court-hero-day.webp")};
  --bg-action: ${cssUrl("/assets/main-day.webp")};
  --bg-profile: ${cssUrl("/assets/rankball-action-day.webp")};
  --bg-hoop: ${cssUrl("/assets/rankball-hoop-day.webp")};
  --bg-ball: ${cssUrl("/assets/rankball-ball-day.webp")};
  --bg-recruiting: ${cssUrl("/assets/court-ball-day.webp")};
  --bg-recorder: ${cssUrl("/assets/NY-court-day.webp")};
}
`;
  document.head.appendChild(style);
}
