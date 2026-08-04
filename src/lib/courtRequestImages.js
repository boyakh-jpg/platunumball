import {
  COURT_REQUEST_PHOTO_MAX_BYTES,
  COURT_REQUEST_PHOTO_MAX_DIMENSION,
  COURT_REQUEST_PHOTO_MAX,
  COURT_REQUEST_PHOTO_MIN_SOURCE_DIMENSION,
  COURT_REQUEST_PHOTO_TARGET_BYTES,
  getCourtPhotoPixelQualityError,
} from "../../shared/lib/courtRequestImagePolicy.js";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]);
const ACCEPTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "heic", "heif"]);

function imageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canvasToWebp(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(imageError("court_photo_read_failed"));
    reader.readAsDataURL(blob);
  });
}

async function readCourtPhotoMetadata(file) {
  let gps;
  let parse;
  try {
    ({ gps, parse } = await import("exifr/dist/lite.esm.mjs"));
  } catch {
    return { latitude: null, longitude: null, capturedAt: null };
  }
  const [coordinates, exif] = await Promise.all([
    gps(file).catch(() => null),
    parse(file, { exif: { pick: ["DateTimeOriginal"] }, ifd0: false, gps: false }).catch(() => null),
  ]);
  const latitude = Number(coordinates?.latitude);
  const longitude = Number(coordinates?.longitude);
  const hasCoordinates = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90
    && Math.abs(longitude) <= 180;
  const capturedMs = exif?.DateTimeOriginal instanceof Date
    ? exif.DateTimeOriginal.getTime()
    : Date.parse(String(exif?.DateTimeOriginal || ""));
  return {
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    capturedAt: Number.isFinite(capturedMs) ? new Date(capturedMs).toISOString() : null,
  };
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // Safari can expose createImageBitmap while rejecting HEIC files that <img> can decode.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    image.src = url;
    await loaded;
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function getSourceQualityError(source, width, height) {
  const scale = 96 / Math.max(width, height);
  const sampleWidth = Math.max(2, Math.round(width * scale));
  const sampleHeight = Math.max(2, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) return "court_photo_quality_unavailable";
  context.drawImage(source, 0, 0, sampleWidth, sampleHeight);
  return getCourtPhotoPixelQualityError(context.getImageData(0, 0, sampleWidth, sampleHeight).data, sampleWidth, sampleHeight);
}

export async function prepareCourtRequestPhoto(file) {
  if (!(file instanceof Blob)) throw imageError("court_photo_file_required");
  const extension = String(file.name || "").split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_TYPES.has(String(file.type || "").toLowerCase()) && !ACCEPTED_EXTENSIONS.has(extension)) {
    throw imageError("court_photo_type_not_supported");
  }

  const metadataPromise = readCourtPhotoMetadata(file);
  let decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw imageError("court_photo_decode_failed");
  }

  try {
    if (!decoded.width || !decoded.height) throw imageError("court_photo_invalid_dimensions");
    if (Math.min(decoded.width, decoded.height) < COURT_REQUEST_PHOTO_MIN_SOURCE_DIMENSION) {
      throw imageError("court_photo_resolution_too_low");
    }
    const qualityError = getSourceQualityError(decoded.source, decoded.width, decoded.height);
    if (qualityError) throw imageError(qualityError);
    const sourceLongEdge = Math.max(decoded.width, decoded.height);
    const dimensions = [...new Set([1280, 1152, 1024, 896, 768, 640]
      .map((value) => Math.min(sourceLongEdge, value))
      .map((value) => Math.max(1, Math.round(value))))];
    let fallback = null;
    for (const longEdge of dimensions) {
      const scale = longEdge / sourceLongEdge;
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw imageError("court_photo_canvas_unavailable");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.source, 0, 0, width, height);
      for (const quality of [0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.36]) {
        const blob = await canvasToWebp(canvas, quality);
        if (!blob || blob.type !== "image/webp") throw imageError("court_photo_webp_unavailable");
        if (blob.size <= COURT_REQUEST_PHOTO_MAX_BYTES && (!fallback || blob.size < fallback.blob.size)) {
          fallback = { blob, width, height };
        }
        if (blob.size <= COURT_REQUEST_PHOTO_TARGET_BYTES) {
          const imageBase64 = await blobToBase64(blob);
          return {
            imageBase64,
            previewUrl: `data:image/webp;base64,${imageBase64}`,
            byteSize: blob.size,
            width,
            height,
            metadata: await metadataPromise,
          };
        }
      }
    }
    if (fallback) {
      const imageBase64 = await blobToBase64(fallback.blob);
      return {
        imageBase64,
        previewUrl: `data:image/webp;base64,${imageBase64}`,
        byteSize: fallback.blob.size,
        width: fallback.width,
        height: fallback.height,
        metadata: await metadataPromise,
      };
    }
  } finally {
    decoded.dispose();
  }
  throw imageError("court_photo_too_large_after_resize");
}

export async function prepareCourtRequestPhotos(files = []) {
  const selected = Array.from(files);
  if (selected.length > COURT_REQUEST_PHOTO_MAX) throw imageError("court_photo_count_invalid");
  const photos = [];
  for (const file of selected) photos.push(await prepareCourtRequestPhoto(file));
  if (photos.some((photo) => photo.byteSize > COURT_REQUEST_PHOTO_MAX_BYTES || Math.max(photo.width, photo.height) > COURT_REQUEST_PHOTO_MAX_DIMENSION)) {
    throw imageError("court_photo_invalid_output");
  }
  return photos;
}

export function getCourtRequestPhotoErrorMessage(code = "") {
  return {
    court_photo_file_required: "사진을 선택해 주세요.",
    court_photo_count_invalid: "현장 사진은 최대 4장까지 선택할 수 있습니다.",
    court_photo_type_not_supported: "JPG, PNG, WebP, AVIF, HEIC 사진만 사용할 수 있습니다.",
    court_photo_decode_failed: "사진을 읽지 못했습니다. 다른 사진을 선택해 주세요.",
    court_photo_invalid_dimensions: "사진 크기를 확인하지 못했습니다.",
    court_photo_resolution_too_low: "사진 해상도가 낮습니다. 휴대폰 기본 카메라로 다시 촬영해 주세요.",
    court_photo_too_dark: "사진이 너무 어둡습니다. 구장과 골대가 보이도록 다시 촬영해 주세요.",
    court_photo_too_bright: "사진이 너무 밝습니다. 빛을 등지고 다시 촬영해 주세요.",
    court_photo_too_blurry: "사진이 흐리거나 초점이 맞지 않습니다. 휴대폰을 고정하고 다시 촬영해 주세요.",
    court_photo_quality_unavailable: "사진 화질을 확인하지 못했습니다. 다시 촬영해 주세요.",
    court_photo_quality_too_low: "사진 품질이 낮아 AI 판정을 시작하지 않았습니다. 다시 촬영해 주세요.",
    court_photo_invalid_container: "올바른 카메라 사진이 아닙니다. 다시 촬영해 주세요.",
    court_photo_unsafe_chunk: "안전하게 처리할 수 없는 사진입니다. 다시 촬영해 주세요.",
    court_photo_canvas_unavailable: "이 브라우저에서는 사진 변환을 사용할 수 없습니다.",
    court_photo_webp_unavailable: "이 브라우저에서는 WebP 변환을 사용할 수 없습니다.",
    court_photo_read_failed: "변환된 사진을 읽지 못했습니다.",
    court_photo_too_large_after_resize: "사진을 자동 최적화하지 못했습니다. 다른 사진을 선택해 주세요.",
    court_photo_invalid_output: "사진 자동 최적화 결과가 올바르지 않습니다.",
  }[code] ?? "사진을 처리하지 못했습니다.";
}
