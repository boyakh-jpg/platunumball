function isBackdropPixel(data, pixel, color, alphaThreshold, maxDistanceSquared) {
  const offset = pixel * 4;
  if (data[offset + 3] < alphaThreshold) return false;

  const red = data[offset] - color.red;
  const green = data[offset + 1] - color.green;
  const blue = data[offset + 2] - color.blue;
  return red * red + green * green + blue * blue <= maxDistanceSquared;
}

export function createEdgeConnectedBackdropMask(
  data,
  width,
  height,
  color,
  { alphaThreshold = 1, maxDistance = 0 } = {},
) {
  const pixelCount = width * height;
  const mask = new Uint8Array(pixelCount);
  if (!pixelCount) return mask;

  const queue = new Int32Array(pixelCount);
  const maxDistanceSquared = maxDistance * maxDistance;
  let head = 0;
  let tail = 0;

  const enqueue = (pixel) => {
    if (
      pixel < 0
      || pixel >= pixelCount
      || mask[pixel]
      || !isBackdropPixel(data, pixel, color, alphaThreshold, maxDistanceSquared)
    ) return;
    mask[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % width;
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (pixel >= width) enqueue(pixel - width);
    if (pixel + width < pixelCount) enqueue(pixel + width);
  }

  return mask;
}
