import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const SOURCE_FILE = resolve(ROOT, "public/assets/match-receipt-score-digits-source-v1.png");
const OUTPUT_FILE = resolve(ROOT, "public/assets/match-receipt-score-digits-v1.png");
const SOURCE_COLUMNS = 5;
const SOURCE_ROWS = 2;
const CELL_WIDTH = 196;
const CELL_HEIGHT = 400;
const DIGIT_WIDTH = 176;
const DIGIT_HEIGHT = 372;

const { data: source, info } = await sharp(SOURCE_FILE)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const keyed = Buffer.alloc(info.width * info.height * 4);
for (let sourceOffset = 0, keyedOffset = 0; sourceOffset < source.length; sourceOffset += 3, keyedOffset += 4) {
  const red = source[sourceOffset];
  const green = source[sourceOffset + 1];
  const blue = source[sourceOffset + 2];
  const greenExcess = green - Math.max(red, blue);
  const keyStrength = Math.max(0, Math.min(1, (greenExcess - 10) / 70));

  keyed[keyedOffset] = red;
  keyed[keyedOffset + 1] = keyStrength > 0 ? Math.min(green, Math.max(red, blue)) : green;
  keyed[keyedOffset + 2] = blue;
  keyed[keyedOffset + 3] = Math.round(255 * (1 - keyStrength));
}

const transparentSource = await sharp(keyed, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .png()
  .toBuffer();

const glyphs = await Promise.all(
  Array.from({ length: 10 }, async (_, digit) => {
    const column = digit % SOURCE_COLUMNS;
    const row = Math.floor(digit / SOURCE_COLUMNS);
    const left = Math.round((column * info.width) / SOURCE_COLUMNS);
    const top = Math.round((row * info.height) / SOURCE_ROWS);
    const right = Math.round(((column + 1) * info.width) / SOURCE_COLUMNS);
    const bottom = Math.round(((row + 1) * info.height) / SOURCE_ROWS);
    const cell = await sharp(transparentSource)
      .extract({ left, top, width: right - left, height: bottom - top })
      .png()
      .toBuffer();
    const rendered = await sharp(cell)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
      .resize(DIGIT_WIDTH, DIGIT_HEIGHT, {
        fit: "contain",
        withoutEnlargement: true,
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
await mkdir(dirname(OUTPUT_FILE), { recursive: true });
await sharp({
  create: {
    width: atlasWidth,
    height: CELL_HEIGHT,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite(glyphs)
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT_FILE);

console.log(`Generated ${OUTPUT_FILE} (${atlasWidth}x${CELL_HEIGHT})`);
