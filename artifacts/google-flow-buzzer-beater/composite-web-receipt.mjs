import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const artifactDir = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(artifactDir, "assets");
const receiptPath = join(assetsDir, "ref-receipt-buzzer-beater-issued-story.png");

const frames = [
  {
    background: "07-start-receipt-airborne-actual.png",
    output: "07-start-receipt-airborne-web.png",
    corners: [
      [342, 568],
      [692, 647],
      [590, 1400],
      [194, 1310],
    ],
  },
  {
    background: "07-mid-receipt-floor-actual.png",
    output: "07-mid-receipt-floor-web.png",
    corners: [
      [341, 797],
      [698, 804],
      [830, 1600],
      [78, 1542],
    ],
  },
  {
    background: "07-end-receipt-zoom-actual.png",
    output: "07-end-receipt-zoom-web.png",
    corners: [
      [134, 79],
      [810, 78],
      [866, 1559],
      [72, 1548],
    ],
  },
];

function solveLinearSystem(coefficients, values) {
  const rows = coefficients.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < rows.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];

    const divisor = rows[column][column];
    for (let index = column; index <= rows.length; index += 1) rows[column][index] /= divisor;

    for (let row = 0; row < rows.length; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = column; index <= rows.length; index += 1) {
        rows[row][index] -= factor * rows[column][index];
      }
    }
  }

  return rows.map((row) => row.at(-1));
}

function homography(from, to) {
  const coefficients = [];
  const values = [];

  for (let index = 0; index < 4; index += 1) {
    const [x, y] = from[index];
    const [u, v] = to[index];
    coefficients.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    coefficients.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }

  return solveLinearSystem(coefficients, values);
}

function pointInsideQuad(x, y, corners) {
  let direction = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const [x1, y1] = corners[index];
    const [x2, y2] = corners[(index + 1) % corners.length];
    const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (Math.abs(cross) < 0.001) continue;
    const sign = Math.sign(cross);
    if (direction === 0) direction = sign;
    else if (direction !== sign) return false;
  }
  return true;
}

function sampleBilinear(data, width, height, x, y) {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const xWeight = x - x0;
  const yWeight = y - y0;
  const output = [0, 0, 0, 0];

  for (let channel = 0; channel < 4; channel += 1) {
    const top = data[(y0 * width + x0) * 4 + channel] * (1 - xWeight)
      + data[(y0 * width + x1) * 4 + channel] * xWeight;
    const bottom = data[(y1 * width + x0) * 4 + channel] * (1 - xWeight)
      + data[(y1 * width + x1) * 4 + channel] * xWeight;
    output[channel] = top * (1 - yWeight) + bottom * yWeight;
  }

  return output;
}

function compositeReceipt(ctx, receipt, corners) {
  const receiptCanvas = createCanvas(receipt.width, receipt.height);
  const receiptContext = receiptCanvas.getContext("2d");
  receiptContext.drawImage(receipt, 0, 0);
  const receiptPixels = receiptContext.getImageData(0, 0, receipt.width, receipt.height).data;
  const output = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const transform = homography(corners, [
    [0, 0],
    [receipt.width - 1, 0],
    [receipt.width - 1, receipt.height - 1],
    [0, receipt.height - 1],
  ]);
  const minX = Math.max(0, Math.floor(Math.min(...corners.map(([x]) => x))));
  const maxX = Math.min(ctx.canvas.width - 1, Math.ceil(Math.max(...corners.map(([x]) => x))));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map(([, y]) => y))));
  const maxY = Math.min(ctx.canvas.height - 1, Math.ceil(Math.max(...corners.map(([, y]) => y))));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!pointInsideQuad(x + 0.5, y + 0.5, corners)) continue;
      const denominator = transform[6] * (x + 0.5) + transform[7] * (y + 0.5) + 1;
      const sourceX = (transform[0] * (x + 0.5) + transform[1] * (y + 0.5) + transform[2]) / denominator;
      const sourceY = (transform[3] * (x + 0.5) + transform[4] * (y + 0.5) + transform[5]) / denominator;
      if (sourceX < 0 || sourceX >= receipt.width || sourceY < 0 || sourceY >= receipt.height) continue;

      const [red, green, blue, alphaValue] = sampleBilinear(
        receiptPixels,
        receipt.width,
        receipt.height,
        sourceX,
        sourceY,
      );
      const alpha = alphaValue / 255;
      const outputIndex = (y * ctx.canvas.width + x) * 4;
      output.data[outputIndex] = red * alpha + output.data[outputIndex] * (1 - alpha);
      output.data[outputIndex + 1] = green * alpha + output.data[outputIndex + 1] * (1 - alpha);
      output.data[outputIndex + 2] = blue * alpha + output.data[outputIndex + 2] * (1 - alpha);
    }
  }

  ctx.putImageData(output, 0, 0);
}

await mkdir(assetsDir, { recursive: true });
const receipt = await loadImage(receiptPath);

for (const frame of frames) {
  const background = await loadImage(join(assetsDir, frame.background));
  const canvas = createCanvas(background.width, background.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(background, 0, 0);
  compositeReceipt(ctx, receipt, frame.corners);
  await writeFile(join(assetsDir, frame.output), canvas.toBuffer("image/png"));
}
