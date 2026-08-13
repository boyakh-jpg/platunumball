import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const FONT_FILE = resolve(ROOT, "public/assets/fonts/Anton-Regular.ttf");
const PAPER_FILE = resolve(ROOT, "public/assets/match-receipt-paper-grain-v1.png");
const OUTPUT_FILE = resolve(ROOT, "public/assets/match-receipt-score-digits-v1.png");
const CELL_WIDTH = 196;
const CELL_HEIGHT = 400;
const DIGIT_WIDTH = 176;
const DIGIT_HEIGHT = 372;

const glyphs = await Promise.all(
  Array.from({ length: 10 }, async (_, digit) => {
    const rendered = await sharp({
      text: {
        text: String(digit),
        font: "Anton 330",
        fontfile: FONT_FILE,
        rgba: true,
        dpi: 144,
      },
    })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(DIGIT_WIDTH, DIGIT_HEIGHT, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    return {
      input: rendered,
      left: digit * CELL_WIDTH + Math.round((CELL_WIDTH - DIGIT_WIDTH) / 2),
      top: Math.round((CELL_HEIGHT - DIGIT_HEIGHT) / 2),
    };
  }),
);

const atlasWidth = CELL_WIDTH * 10;
const mask = await sharp({
  create: {
    width: atlasWidth,
    height: CELL_HEIGHT,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(glyphs)
  .png()
  .toBuffer();

await mkdir(dirname(OUTPUT_FILE), { recursive: true });
await sharp(PAPER_FILE)
  .resize(atlasWidth, CELL_HEIGHT, { fit: "cover" })
  .modulate({ brightness: 1.02, saturation: 0.72 })
  .ensureAlpha()
  .composite([{ input: mask, blend: "dest-in" }])
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT_FILE);

console.log(`Generated ${OUTPUT_FILE} (${atlasWidth}x${CELL_HEIGHT})`);
