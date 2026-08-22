import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

function bundledAsset(url) {
  return fileURLToPath(url);
}

const FONT_FILES = Object.freeze([
  [bundledAsset(new URL("../../../public/assets/fonts/PretendardVariable.woff2", import.meta.url)), "Pretendard Variable"],
  [bundledAsset(new URL("../../../public/assets/fonts/KBO-Dia-Gothic_bold.woff", import.meta.url)), "KBO Dia Gothic"],
  [bundledAsset(new URL("../../../public/assets/fonts/KBLJump-EB-Condensed.woff2", import.meta.url)), "KBL Jump Condensed"],
  [bundledAsset(new URL("../../../public/assets/fonts/BoxTier-Sports-Latin.ttf", import.meta.url)), "BoxTier Sports Display"],
  [bundledAsset(new URL("../../../public/assets/fonts/IBMPlexMono-Regular.woff2", import.meta.url)), "IBM Plex Mono"],
  [bundledAsset(new URL("../../../public/assets/fonts/IBMPlexMono-Bold.woff2", import.meta.url)), "IBM Plex Mono"],
  [bundledAsset(new URL("../../../public/assets/fonts/NeoDunggeunmo.woff2", import.meta.url)), "NeoDunggeunmo"],
  [bundledAsset(new URL("../../../public/assets/fonts/BebasNeue-Regular.ttf", import.meta.url)), "Bebas Neue"],
  [bundledAsset(new URL("../../../public/assets/fonts/Anton-Regular.ttf", import.meta.url)), "Anton"],
  [bundledAsset(new URL("../../../public/assets/fonts/BlackHanSans-Regular.ttf", import.meta.url)), "Black Han Sans"],
]);
const IMAGE_FILES = new Map([
  ["/assets/match-receipt-paper-torn-v1.png", bundledAsset(new URL("../../../public/assets/match-receipt-paper-torn-v1.png", import.meta.url))],
  ["/assets/match-receipt-paper-grain-v1.png", bundledAsset(new URL("../../../public/assets/match-receipt-paper-grain-v1.png", import.meta.url))],
  ["/assets/match-receipt-score-digits-v3.png", bundledAsset(new URL("../../../public/assets/match-receipt-score-digits-v3.png", import.meta.url))],
  ["/assets/match-receipt-scoreboard-digits-v2.png", bundledAsset(new URL("../../../public/assets/match-receipt-scoreboard-digits-v2.png", import.meta.url))],
  ["/assets/match-receipt-wordmark-v1.png", bundledAsset(new URL("../../../public/assets/match-receipt-wordmark-v1.png", import.meta.url))],
  ["/assets/rankball-record-create-night-v10.webp", bundledAsset(new URL("../../../public/assets/rankball-record-create-night-v10.webp", import.meta.url))],
  ["/assets/tier-emblems/tier-neutral-home-outline-v5.png", bundledAsset(new URL("../../../public/assets/tier-emblems/tier-neutral-home-outline-v5.png", import.meta.url))],
  ["/assets/tier-emblems/tier-neutral-away-outline-v5.png", bundledAsset(new URL("../../../public/assets/tier-emblems/tier-neutral-away-outline-v5.png", import.meta.url))],
  ["/assets/thermal-receipt/charcoal-background-2048.png", bundledAsset(new URL("../../../public/assets/thermal-receipt/charcoal-background-2048.png", import.meta.url))],
  ["/assets/thermal-receipt/thermal-paper-texture-2048.png", bundledAsset(new URL("../../../public/assets/thermal-receipt/thermal-paper-texture-2048.png", import.meta.url))],
  ["/assets/thermal-receipt/thermal-ink-mask-body-2048.png", bundledAsset(new URL("../../../public/assets/thermal-receipt/thermal-ink-mask-body-2048.png", import.meta.url))],
  ["/assets/thermal-receipt/thermal-ink-mask-team-2048.png", bundledAsset(new URL("../../../public/assets/thermal-receipt/thermal-ink-mask-team-2048.png", import.meta.url))],
  ["/assets/thermal-receipt/thermal-ink-mask-heavy-2048.png", bundledAsset(new URL("../../../public/assets/thermal-receipt/thermal-ink-mask-heavy-2048.png", import.meta.url))],
  ["/assets/thermal-receipt/thermal-ink-mask-photo-2048.png", bundledAsset(new URL("../../../public/assets/thermal-receipt/thermal-ink-mask-photo-2048.png", import.meta.url))],
  ["/assets/thermal-receipt/serration-edge-796x16.svg", bundledAsset(new URL("../../../public/assets/thermal-receipt/serration-edge-796x16.svg", import.meta.url))],
]);
let fontsReady = false;

function resolveImageSource(source) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) return source;
  if (source instanceof Blob) return source.arrayBuffer().then((value) => Buffer.from(value));
  const value = String(source ?? "");
  if (value.startsWith("data:")) return value;
  if (value.startsWith("file:")) return fileURLToPath(value);
  try {
    const url = new URL(value, "https://boxtier.local");
    if (IMAGE_FILES.has(url.pathname)) return IMAGE_FILES.get(url.pathname);
  } catch {
    // Keep the original source so the image loader returns its canonical error.
  }
  return value;
}

function registerFonts() {
  if (fontsReady) return;
  for (const [filePath, family] of FONT_FILES) {
    if (!GlobalFonts.registerFromPath(filePath, family)) {
      throw new Error(`receipt_font_registration_failed:${filePath}`);
    }
  }
  fontsReady = true;
}

export const nodeReceiptCanvasRuntime = Object.freeze({
  createCanvas,
  async loadImage(source) {
    return loadImage(await resolveImageSource(source));
  },
  async prepareFonts() {
    registerFonts();
  },
});
