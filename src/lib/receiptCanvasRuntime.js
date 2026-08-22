let installedRuntime = null;

export function installReceiptCanvasRuntime(runtime) {
  if (!runtime?.createCanvas || !runtime?.loadImage) throw new Error("receipt_canvas_runtime_invalid");
  if (installedRuntime && installedRuntime !== runtime) throw new Error("receipt_canvas_runtime_already_installed");
  installedRuntime = runtime;
}

export function createReceiptCanvas(width, height) {
  if (installedRuntime) return installedRuntime.createCanvas(width, height);
  if (typeof document === "undefined") throw new Error("receipt_canvas_unavailable");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function loadReceiptCanvasImage(source) {
  if (!source) return null;
  if (installedRuntime) return installedRuntime.loadImage(source);
  const temporary = typeof Blob !== "undefined" && source instanceof Blob;
  const url = temporary ? URL.createObjectURL(source) : String(source);
  try {
    const image = new Image();
    if (!url.startsWith("blob:") && !url.startsWith("data:")) image.crossOrigin = "anonymous";
    image.src = url;
    if (image.decode) await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    return image;
  } finally {
    if (temporary) URL.revokeObjectURL(url);
  }
}

export async function prepareReceiptCanvasFonts(fonts = []) {
  if (installedRuntime?.prepareFonts) return installedRuntime.prepareFonts(fonts);
  if (typeof document === "undefined") return;
  await document.fonts?.ready;
  if (document.fonts?.load) await Promise.all(fonts.map((font) => document.fonts.load(font)));
}
