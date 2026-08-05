import {
  COMMUNITY_POST_IMAGE_MAX_BYTES,
  COMMUNITY_POST_IMAGE_MAX_DIMENSION,
  COMMUNITY_POST_IMAGE_SOURCE_MAX_BYTES,
} from "../../shared/lib/communityPolicy.js";

const ACCEPTED_TYPES = new Set(["image/avif", "image/heic", "image/heif", "image/jpeg", "image/png", "image/webp"]);
const ACCEPTED_EXTENSIONS = new Set(["avif", "heic", "heif", "jpeg", "jpg", "png", "webp"]);

function imageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
    } catch {
      // Safari may expose createImageBitmap while only <img> can decode the selected file.
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = objectUrl;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(objectUrl) };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw imageError("community_photo_decode_failed");
  }
}

function canvasToWebp(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(imageError("community_photo_read_failed"));
    reader.readAsDataURL(blob);
  });
}

export async function prepareCommunityPostImage(file) {
  if (!(file instanceof Blob)) throw imageError("community_photo_file_required");
  const extension = String(file.name || "").split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_TYPES.has(String(file.type || "").toLowerCase()) && !ACCEPTED_EXTENSIONS.has(extension)) {
    throw imageError("community_photo_type_not_supported");
  }
  if (!file.size || file.size > COMMUNITY_POST_IMAGE_SOURCE_MAX_BYTES) throw imageError("community_photo_source_too_large");

  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) throw imageError("community_photo_invalid_dimensions");
    const sourceLongEdge = Math.max(decoded.width, decoded.height);
    const longEdges = [...new Set([COMMUNITY_POST_IMAGE_MAX_DIMENSION, 1600, 1440, 1280, 1152, 1024, 896]
      .map((value) => Math.min(sourceLongEdge, value)))];
    for (const longEdge of longEdges) {
      const scale = longEdge / sourceLongEdge;
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw imageError("community_photo_canvas_unavailable");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.source, 0, 0, width, height);
      for (const quality of [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4]) {
        const blob = await canvasToWebp(canvas, quality);
        if (!blob) throw imageError("community_photo_encode_unavailable");
        if (blob.size <= COMMUNITY_POST_IMAGE_MAX_BYTES) {
          const imageBase64 = await blobToBase64(blob);
          return { imageBase64, previewUrl: `data:image/webp;base64,${imageBase64}`, imageName: file.name, byteSize: blob.size };
        }
      }
    }
  } finally {
    decoded.dispose();
  }
  throw imageError("community_photo_too_large_after_resize");
}

export function getCommunityPostImageErrorMessage(code = "") {
  return {
    community_photo_file_required: "사진을 선택해 주세요.",
    community_photo_type_not_supported: "JPG, PNG, WebP, AVIF, HEIC 사진만 사용할 수 있습니다.",
    community_photo_source_too_large: "원본 사진은 20MB 이하만 사용할 수 있습니다.",
    community_photo_decode_failed: "사진을 읽지 못했습니다. 다른 사진을 선택해 주세요.",
    community_photo_invalid_dimensions: "사진 크기를 확인하지 못했습니다.",
    community_photo_canvas_unavailable: "이 브라우저에서는 사진 변환을 사용할 수 없습니다.",
    community_photo_encode_unavailable: "이 브라우저에서는 사진 최적화를 사용할 수 없습니다.",
    community_photo_read_failed: "변환된 사진을 읽지 못했습니다.",
    community_photo_too_large_after_resize: "사진을 자동 최적화하지 못했습니다. 다른 사진을 선택해 주세요.",
  }[code] ?? "사진을 처리하지 못했습니다.";
}
