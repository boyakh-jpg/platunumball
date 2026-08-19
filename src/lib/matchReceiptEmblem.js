const CACHE = new Map();
const SIZE = 256;
const GOLD = [214, 165, 34];
const CROP_EDGE_GUARD = 5;
const EMBLEM_CONTENT_WIDTH = 210;
const EMBLEM_CONTENT_HEIGHT = 230;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function colorDistance(data, offset, color) {
  return Math.hypot(data[offset] - color[0], data[offset + 1] - color[1], data[offset + 2] - color[2]);
}

async function convert(url) {
  if (!url || typeof document === "undefined") return "";
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "";
    const scale = Math.min(SIZE / image.naturalWidth, SIZE / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
    const source = context.getImageData(0, 0, SIZE, SIZE);
    const corners = [[2, 2], [SIZE - 3, 2], [2, SIZE - 3], [SIZE - 3, SIZE - 3]];
    const background = corners.reduce((sum, [x, y]) => {
      const offset = (y * SIZE + x) * 4;
      sum[0] += source.data[offset];
      sum[1] += source.data[offset + 1];
      sum[2] += source.data[offset + 2];
      sum[3] += source.data[offset + 3];
      return sum;
    }, [0, 0, 0, 0]).map((value) => value / corners.length);
    const transparentBackground = background[3] < 80;
    const foreground = new Uint8Array(SIZE * SIZE);
    let foregroundCount = 0;
    let minX = SIZE;
    let minY = SIZE;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const pixel = y * SIZE + x;
        const offset = pixel * 4;
        const alpha = source.data[offset + 3];
        const isForeground = alpha > 28 && (transparentBackground || colorDistance(source.data, offset, background) > 42);
        if (!isForeground) continue;
        foreground[pixel] = 1;
        foregroundCount += 1;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    const foregroundRatio = foregroundCount / foreground.length;
    if (foregroundRatio < 0.015 || foregroundRatio > 0.82 || maxX - minX < 36 || maxY - minY < 36) return "";

    const output = context.createImageData(SIZE, SIZE);
    let edgeCount = 0;
    let outputMinX = SIZE;
    let outputMinY = SIZE;
    let outputMaxX = 0;
    let outputMaxY = 0;
    const cropCenter = (SIZE - 1) / 2;
    const cropEdgeRadius = SIZE / 2 - CROP_EDGE_GUARD;
    for (let y = 1; y < SIZE - 1; y += 1) {
      for (let x = 1; x < SIZE - 1; x += 1) {
        const pixel = y * SIZE + x;
        if (!foreground[pixel]) continue;
        const offset = pixel * 4;
        const neighbors = [pixel - 1, pixel + 1, pixel - SIZE, pixel + SIZE];
        const isCropEdge = Math.hypot(x - cropCenter, y - cropCenter) >= cropEdgeRadius;
        const boundary = !isCropEdge && neighbors.some((neighbor) => !foreground[neighbor]);
        const detail = neighbors.some((neighbor) => {
          if (!foreground[neighbor]) return false;
          return colorDistance(source.data, neighbor * 4, [source.data[offset], source.data[offset + 1], source.data[offset + 2]]) > 58;
        });
        if (!boundary && !detail) continue;
        edgeCount += 1;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const targetX = x + dx;
            const targetY = y + dy;
            const target = (targetY * SIZE + targetX) * 4;
            output.data[target] = GOLD[0];
            output.data[target + 1] = GOLD[1];
            output.data[target + 2] = GOLD[2];
            output.data[target + 3] = Math.max(output.data[target + 3], dx || dy ? 105 : 235);
            outputMinX = Math.min(outputMinX, targetX);
            outputMinY = Math.min(outputMinY, targetY);
            outputMaxX = Math.max(outputMaxX, targetX);
            outputMaxY = Math.max(outputMaxY, targetY);
          }
        }
      }
    }
    const edgeRatio = edgeCount / foreground.length;
    if (edgeRatio < 0.004 || edgeRatio > 0.3) return "";
    context.clearRect(0, 0, SIZE, SIZE);
    context.putImageData(output, 0, 0);
    const outputWidth = outputMaxX - outputMinX + 1;
    const outputHeight = outputMaxY - outputMinY + 1;
    const normalizedScale = Math.min(EMBLEM_CONTENT_WIDTH / outputWidth, EMBLEM_CONTENT_HEIGHT / outputHeight);
    const normalizedWidth = outputWidth * normalizedScale;
    const normalizedHeight = outputHeight * normalizedScale;
    const normalizedCanvas = document.createElement("canvas");
    normalizedCanvas.width = SIZE;
    normalizedCanvas.height = SIZE;
    const normalizedContext = normalizedCanvas.getContext("2d");
    if (!normalizedContext) return canvas.toDataURL("image/png");
    normalizedContext.drawImage(
      canvas,
      outputMinX,
      outputMinY,
      outputWidth,
      outputHeight,
      (SIZE - normalizedWidth) / 2,
      (SIZE - normalizedHeight) / 2,
      normalizedWidth,
      normalizedHeight,
    );
    return normalizedCanvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export function createMatchReceiptLineArt(url) {
  const key = String(url || "");
  if (!CACHE.has(key)) CACHE.set(key, convert(key));
  return CACHE.get(key);
}
