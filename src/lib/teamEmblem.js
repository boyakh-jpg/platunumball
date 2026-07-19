export const TEAM_EMBLEM_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
export const TEAM_EMBLEM_UPLOAD_MAX_BYTES = 300 * 1024;
export const TEAM_EMBLEM_MAX_DIMENSION = 512;

const ACCEPTED_TEAM_EMBLEM_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function createImageLoadError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close?.(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(createImageLoadError("team_emblem_decode_failed"));
      element.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToWebp(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/webp", quality);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(createImageLoadError("team_emblem_read_failed"));
    reader.readAsDataURL(blob);
  });
}

function drawContainedSquare(source, sourceWidth, sourceHeight, dimension) {
  const canvas = document.createElement("canvas");
  canvas.width = dimension;
  canvas.height = dimension;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw createImageLoadError("team_emblem_canvas_unavailable");

  context.clearRect(0, 0, dimension, dimension);
  const available = dimension * 0.92;
  const scale = Math.min(available / sourceWidth, available / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, Math.round((dimension - width) / 2), Math.round((dimension - height) / 2), width, height);
  return canvas;
}

export async function prepareTeamEmblemUpload(file) {
  if (!(file instanceof Blob)) throw createImageLoadError("team_emblem_file_required");
  if (!ACCEPTED_TEAM_EMBLEM_TYPES.has(String(file.type || "").toLowerCase())) {
    throw createImageLoadError("team_emblem_type_not_supported");
  }
  if (!file.size || file.size > TEAM_EMBLEM_SOURCE_MAX_BYTES) {
    throw createImageLoadError("team_emblem_source_too_large");
  }

  let decoded;
  try {
    decoded = await decodeImage(file);
  } catch (error) {
    if (error?.code) throw error;
    throw createImageLoadError("team_emblem_decode_failed");
  }

  try {
    if (!decoded.width || !decoded.height) throw createImageLoadError("team_emblem_invalid_dimensions");
    const initialDimension = Math.min(TEAM_EMBLEM_MAX_DIMENSION, Math.max(decoded.width, decoded.height));
    const dimensions = [...new Set([
      initialDimension,
      Math.min(initialDimension, 448),
      Math.min(initialDimension, 384),
      Math.min(initialDimension, 320),
      Math.min(initialDimension, 256),
    ].map((value) => Math.max(1, Math.round(value))))];
    const qualities = [0.86, 0.76, 0.66, 0.56];

    for (const dimension of dimensions) {
      const canvas = drawContainedSquare(decoded.source, decoded.width, decoded.height, dimension);
      for (const quality of qualities) {
        const blob = await canvasToWebp(canvas, quality);
        if (!blob) throw createImageLoadError("team_emblem_webp_unavailable");
        if (blob.size <= TEAM_EMBLEM_UPLOAD_MAX_BYTES) {
          return {
            imageBase64: await blobToBase64(blob),
            byteSize: blob.size,
            sourceByteSize: file.size,
            width: dimension,
            height: dimension,
          };
        }
      }
    }
  } finally {
    decoded.dispose();
  }

  throw createImageLoadError("team_emblem_too_large_after_resize");
}

export function getTeamEmblemErrorMessage(code = "") {
  const messages = {
    team_emblem_file_required: "이미지 파일을 선택해야 합니다.",
    team_emblem_type_not_supported: "JPG, PNG, WebP, AVIF 이미지만 사용할 수 있습니다.",
    team_emblem_source_too_large: "원본 이미지는 12MB 이하여야 합니다.",
    team_emblem_decode_failed: "이미지를 읽을 수 없습니다.",
    team_emblem_invalid_dimensions: "이미지 크기를 확인할 수 없습니다.",
    team_emblem_invalid_payload: "변환된 이미지 데이터가 올바르지 않습니다.",
    team_emblem_request_too_large: "업로드 요청이 너무 큽니다.",
    team_emblem_too_large: "변환된 이미지는 300KB 이하여야 합니다.",
    team_emblem_webp_required: "WebP 이미지로 변환한 뒤 업로드해야 합니다.",
    team_emblem_canvas_unavailable: "이 브라우저에서는 이미지 변환을 사용할 수 없습니다.",
    team_emblem_webp_unavailable: "이 브라우저에서는 WebP 변환을 사용할 수 없습니다.",
    team_emblem_read_failed: "변환된 이미지를 읽지 못했습니다.",
    team_emblem_too_large_after_resize: "이미지를 300KB 이하로 줄이지 못했습니다.",
    team_emblem_permission_denied: "팀 주장만 엠블럼을 변경할 수 있습니다.",
    team_emblem_conflict: "다른 변경이 먼저 저장됐습니다. 다시 시도하세요.",
    cloudflare_r2_not_configured: "Cloudflare 저장소가 설정되지 않았습니다.",
    cloudflare_r2_upload_failed: "Cloudflare 업로드에 실패했습니다.",
    cloudflare_r2_delete_failed: "기존 엠블럼 정리에 실패했습니다.",
  };
  return messages[String(code || "")] ?? "팀 엠블럼을 저장하지 못했습니다.";
}
