import path from "node:path";
import { fileURLToPath } from "node:url";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const FONT_ROOT = path.join(PUBLIC_ROOT, "assets", "fonts");
const FONT_FILES = Object.freeze([
  ["PretendardVariable.woff2", "Pretendard Variable"],
  ["KBO-Dia-Gothic_bold.woff", "KBO Dia Gothic"],
  ["KBLJump-EB-Condensed.woff2", "KBL Jump Condensed"],
  ["BoxTier-Sports-Latin.ttf", "BoxTier Sports Display"],
  ["IBMPlexMono-Regular.woff2", "IBM Plex Mono"],
  ["IBMPlexMono-Bold.woff2", "IBM Plex Mono"],
  ["NeoDunggeunmo.woff2", "NeoDunggeunmo"],
  ["BebasNeue-Regular.ttf", "Bebas Neue"],
  ["Anton-Regular.ttf", "Anton"],
  ["BlackHanSans-Regular.ttf", "Black Han Sans"],
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
    if (url.pathname.startsWith("/assets/")) return path.join(PUBLIC_ROOT, ...url.pathname.split("/").filter(Boolean));
  } catch {
    // Keep the original source so the image loader returns its canonical error.
  }
  return value;
}

function registerFonts() {
  if (fontsReady) return;
  for (const [file, family] of FONT_FILES) {
    if (!GlobalFonts.registerFromPath(path.join(FONT_ROOT, file), family)) {
      throw new Error(`receipt_font_registration_failed:${file}`);
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
