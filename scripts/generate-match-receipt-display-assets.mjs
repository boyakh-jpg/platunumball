import { resolve } from "node:path";
import sharp from "sharp";

const CELL_WIDTH = 64;
const CELL_HEIGHT = 112;
const GLYPHS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg", ":"];
const SEGMENTS = {
  a: [[14, 11], [19, 7], [48, 7], [52, 11], [47, 16], [19, 16]],
  b: [[50, 13], [55, 17], [53, 48], [48, 53], [44, 48], [46, 19]],
  c: [[48, 59], [53, 64], [50, 95], [45, 100], [41, 95], [44, 64]],
  d: [[13, 101], [18, 96], [44, 96], [48, 101], [43, 106], [17, 106]],
  e: [[10, 59], [15, 64], [13, 95], [9, 100], [5, 95], [8, 64]],
  f: [[13, 13], [18, 18], [16, 48], [11, 53], [7, 48], [9, 18]],
  g: [[13, 55], [18, 50], [45, 50], [49, 55], [44, 60], [18, 60]],
};
const COLORS = [[200, 120, 66], [205, 173, 145]];
const GLOW_RADIUS = 2;
const width = CELL_WIDTH * GLYPHS.length;
const height = CELL_HEIGHT * COLORS.length;
const pixels = Buffer.alloc(width * height * 4);

function blendPixel(x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  const previousAlpha = pixels[offset + 3] / 255;
  const nextAlpha = alpha + previousAlpha * (1 - alpha);
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[offset + channel] = Math.round((color[channel] * alpha + pixels[offset + channel] * previousAlpha * (1 - alpha)) / Math.max(nextAlpha, 0.001));
  }
  pixels[offset + 3] = Math.round(nextAlpha * 255);
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    if ((currentY > y) !== (previousY > y) && x < (previousX - currentX) * (y - currentY) / (previousY - currentY) + currentX) inside = !inside;
  }
  return inside;
}

function distanceToSegment(x, y, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const projection = Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (start[0] + projection * dx), y - (start[1] + projection * dy));
}

function distanceToPolygon(x, y, polygon) {
  let distance = Number.POSITIVE_INFINITY;
  polygon.forEach((point, index) => {
    distance = Math.min(distance, distanceToSegment(x, y, point, polygon[(index + 1) % polygon.length]));
  });
  return distance;
}

function drawPolygon(glyphIndex, row, polygon, color) {
  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    for (let x = 0; x < CELL_WIDTH; x += 1) {
      const sampleX = x + 0.5;
      const sampleY = y + 0.5;
      const inside = pointInPolygon(sampleX, sampleY, polygon);
      const distance = inside ? 0 : distanceToPolygon(sampleX, sampleY, polygon);
      if (!inside && distance > GLOW_RADIUS) continue;
      const alpha = inside ? 0.9 : Math.max(0, 1 - distance / GLOW_RADIUS) * 0.18;
      blendPixel(glyphIndex * CELL_WIDTH + x, row * CELL_HEIGHT + y, color, alpha);
    }
  }
}

COLORS.forEach((color, row) => {
  GLYPHS.forEach((glyph, glyphIndex) => {
    if (glyph === ":") {
      drawPolygon(glyphIndex, row, [[27, 38], [32, 33], [37, 38], [32, 43]], color);
      drawPolygon(glyphIndex, row, [[27, 75], [32, 70], [37, 75], [32, 80]], color);
      return;
    }
    Array.from(glyph).forEach((segment) => drawPolygon(glyphIndex, row, SEGMENTS[segment], color));
  });
});

await sharp(pixels, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9, palette: true })
  .toFile(resolve("public/assets/match-receipt-scoreboard-digits-v1.png"));

await sharp(resolve("public/assets/boxtier_letter_dark.png"))
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toFile(resolve("public/assets/match-receipt-wordmark-v1.png"));
