export const TEAM_EMBLEM_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
export const TEAM_EMBLEM_UPLOAD_MAX_BYTES = 160 * 1024;
export const TEAM_EMBLEM_MAX_DIMENSION = 384;

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

function normalizeCrop(crop = {}) {
  const zoom = Number(crop.zoom);
  const x = Number(crop.x);
  const y = Number(crop.y);
  return {
    zoom: Math.min(3, Math.max(0.5, Number.isFinite(zoom) ? zoom : 1)),
    x: Math.min(100, Math.max(0, Number.isFinite(x) ? x : 50)),
    y: Math.min(100, Math.max(0, Number.isFinite(y) ? y : 50)),
  };
}

export function drawEmblemCrop(canvas, source, sourceWidth, sourceHeight, crop = {}, dimension = TEAM_EMBLEM_MAX_DIMENSION) {
  canvas.width = dimension;
  canvas.height = dimension;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw createImageLoadError("team_emblem_canvas_unavailable");

  context.clearRect(0, 0, dimension, dimension);
  const normalized = normalizeCrop(crop);
  const coverScale = dimension / Math.min(sourceWidth, sourceHeight);
  const scale = coverScale * normalized.zoom;
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);
  const x = width >= dimension
    ? -(width - dimension) * (normalized.x / 100)
    : (dimension - width) * (normalized.x / 100);
  const y = height >= dimension
    ? -(height - dimension) * (normalized.y / 100)
    : (dimension - height) * (normalized.y / 100);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, x, y, width, height);
  return canvas;
}

export async function prepareTeamEmblemUpload(file, crop = {}) {
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
      Math.min(initialDimension, 352),
      Math.min(initialDimension, 320),
      Math.min(initialDimension, 256),
      Math.min(initialDimension, 224),
    ].map((value) => Math.max(1, Math.round(value))))];
    const qualities = [0.82, 0.72, 0.62, 0.52];

    for (const dimension of dimensions) {
      const canvas = document.createElement("canvas");
      drawEmblemCrop(canvas, decoded.source, decoded.width, decoded.height, crop, dimension);
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
    profile_emblem_file_required: "이미지 파일을 선택해야 합니다.",
    team_emblem_type_not_supported: "JPG, PNG, WebP, AVIF 이미지만 사용할 수 있습니다.",
    team_emblem_source_too_large: "원본 이미지는 12MB 이하여야 합니다.",
    team_emblem_decode_failed: "이미지를 읽을 수 없습니다.",
    team_emblem_invalid_dimensions: "이미지 크기를 확인할 수 없습니다.",
    profile_emblem_invalid_dimensions: "이미지 크기를 확인할 수 없습니다.",
    team_emblem_invalid_payload: "변환된 이미지 데이터가 올바르지 않습니다.",
    profile_emblem_invalid_payload: "변환된 이미지 데이터가 올바르지 않습니다.",
    team_emblem_request_too_large: "업로드 요청이 너무 큽니다.",
    team_emblem_too_large: "이미지를 더 작게 최적화해야 합니다.",
    profile_emblem_too_large: "이미지를 더 작게 최적화해야 합니다.",
    team_emblem_webp_required: "WebP 이미지로 변환한 뒤 업로드해야 합니다.",
    profile_emblem_webp_required: "WebP 이미지로 변환한 뒤 업로드해야 합니다.",
    team_emblem_canvas_unavailable: "이 브라우저에서는 이미지 변환을 사용할 수 없습니다.",
    team_emblem_webp_unavailable: "이 브라우저에서는 WebP 변환을 사용할 수 없습니다.",
    team_emblem_read_failed: "변환된 이미지를 읽지 못했습니다.",
    team_emblem_too_large_after_resize: "이미지를 충분히 최적화하지 못했습니다.",
    team_emblem_permission_denied: "팀 주장만 엠블럼을 변경할 수 있습니다.",
    team_emblem_conflict: "다른 변경이 먼저 저장됐습니다. 다시 시도하세요.",
    team_emblem_cooldown: "교체 제한 기간입니다. 표시된 날짜 이후 다시 시도하세요.",
    profile_emblem_cooldown: "교체 제한 기간입니다. 표시된 날짜 이후 다시 시도하세요.",
    discord_avatar_unavailable: "Discord 연동 이미지가 없습니다.",
    invalid_emblem_color: "엠블럼 색상을 확인하세요.",
    cloudflare_r2_not_configured: "Cloudflare 저장소가 설정되지 않았습니다.",
    cloudflare_r2_upload_failed: "Cloudflare 업로드에 실패했습니다.",
    cloudflare_r2_delete_failed: "기존 엠블럼 정리에 실패했습니다.",
  };
  return messages[String(code || "")] ?? "엠블럼을 저장하지 못했습니다.";
}
