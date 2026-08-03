import {
  COURT_REQUEST_PHOTO_MAX_BYTES,
  COURT_REQUEST_PHOTO_MAX_DIMENSION,
  COURT_REQUEST_PHOTO_MAX,
  COURT_REQUEST_PHOTO_TARGET_BYTES,
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
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function prepareCourtRequestPhoto(file) {
  if (!(file instanceof Blob)) throw imageError("court_photo_file_required");
  const extension = String(file.name || "").split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_TYPES.has(String(file.type || "").toLowerCase()) && !ACCEPTED_EXTENSIONS.has(extension)) {
    throw imageError("court_photo_type_not_supported");
  }

  let decoded;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw imageError("court_photo_decode_failed");
  }

  try {
    if (!decoded.width || !decoded.height) throw imageError("court_photo_invalid_dimensions");
    const sourceLongEdge = Math.max(decoded.width, decoded.height);
    const dimensions = [...new Set([1280, 1152, 1024, 896, 768, 640]
      .map((value) => Math.min(sourceLongEdge, value))
      .map((value) => Math.max(1, Math.round(value))))];
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
        if (!blob) throw imageError("court_photo_webp_unavailable");
        if (blob.size <= COURT_REQUEST_PHOTO_TARGET_BYTES) {
          const imageBase64 = await blobToBase64(blob);
          return {
            imageBase64,
            previewUrl: `data:image/webp;base64,${imageBase64}`,
            byteSize: blob.size,
            width,
            height,
          };
        }
      }
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
    court_photo_canvas_unavailable: "이 브라우저에서는 사진 변환을 사용할 수 없습니다.",
    court_photo_webp_unavailable: "이 브라우저에서는 WebP 변환을 사용할 수 없습니다.",
    court_photo_read_failed: "변환된 사진을 읽지 못했습니다.",
    court_photo_too_large_after_resize: "사진을 자동 최적화하지 못했습니다. 다른 사진을 선택해 주세요.",
    court_photo_invalid_output: "사진 자동 최적화 결과가 올바르지 않습니다.",
  }[code] ?? "사진을 처리하지 못했습니다.";
}
