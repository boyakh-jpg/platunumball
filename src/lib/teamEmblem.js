export const TEAM_EMBLEM_SOURCE_MAX_BYTES = 32 * 1024 * 1024;
export const TEAM_EMBLEM_UPLOAD_MAX_BYTES = 96 * 1024;
export const TEAM_EMBLEM_MAX_DIMENSION = 320;
export const TEAM_EMBLEM_FONT_OPTIONS = [
  ["sport", "스포츠"],
  ["gothic", "고딕"],
  ["serif", "명조"],
  ["mono", "모노"],
];
export const TEAM_EMBLEM_TEXT_MODES = Object.freeze(["initial", "name", "abbreviation"]);
export const TEAM_EMBLEM_FONT_IDS = Object.freeze(TEAM_EMBLEM_FONT_OPTIONS.map(([value]) => value));

const TEAM_EMBLEM_TEXT_MODE_SET = new Set(TEAM_EMBLEM_TEXT_MODES);
const TEAM_EMBLEM_FONT_SET = new Set(TEAM_EMBLEM_FONT_IDS);

function sliceCharacters(value, limit) {
  const characters = Array.from(String(value ?? ""));
  return characters.length > limit ? `${characters.slice(0, Math.max(1, limit - 1)).join("")}…` : characters.join("");
}

export function normalizeTeamEmblemFont(value = "sport") {
  return TEAM_EMBLEM_FONT_SET.has(value) ? value : "sport";
}

export function isTeamEmblemFont(value = "") {
  return TEAM_EMBLEM_FONT_SET.has(value);
}

export function isTeamEmblemTextMode(value = "") {
  return TEAM_EMBLEM_TEXT_MODE_SET.has(value);
}

export function normalizeTeamEmblemTextMode(value = "initial") {
  return isTeamEmblemTextMode(value) ? value : "initial";
}

function splitEvenly(value, lineCount) {
  const characters = Array.from(value);
  const lines = [];
  let cursor = 0;
  for (let index = 0; index < lineCount; index += 1) {
    const remaining = characters.length - cursor;
    const remainingLines = lineCount - index;
    const take = Math.ceil(remaining / remainingLines);
    lines.push(characters.slice(cursor, cursor + take).join("").trim());
    cursor += take;
  }
  return lines.filter(Boolean);
}

function getBalancedWordLines(words, lineCount) {
  let bestLines = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const visit = (start, lines) => {
    if (lines.length === lineCount - 1) {
      const candidate = [...lines, words.slice(start).join(" ")];
      const lengths = candidate.map((line) => Array.from(line).length);
      const score = Math.max(...lengths) * 4 + Math.max(...lengths) - Math.min(...lengths);
      if (score < bestScore) {
        bestScore = score;
        bestLines = candidate;
      }
      return;
    }
    const remainingLines = lineCount - lines.length - 1;
    for (let end = start + 1; end <= words.length - remainingLines; end += 1) {
      visit(end, [...lines, words.slice(start, end).join(" ")]);
    }
  };
  visit(0, []);
  return bestLines;
}

export function getTeamEmblemTextLines(team = {}, fallbackName = "") {
  const mode = normalizeTeamEmblemTextMode(team.emblemTextMode);
  const teamName = String(team.name ?? fallbackName ?? "").trim();
  const rawText = mode === "abbreviation" ? team.emblemAbbreviation : teamName;
  const text = String(rawText ?? "").trim().replace(/\s+/g, " ") || "?";
  if (mode === "initial") return [Array.from(text)[0] ?? "?"];
  if (mode === "abbreviation") return [sliceCharacters(text, 8)];

  const safeText = sliceCharacters(text, 15);
  const characterCount = Array.from(safeText).length;
  const lineCount = characterCount <= 3 ? 1 : characterCount <= 7 ? 2 : 3;
  const words = safeText.split(" ").filter(Boolean);
  if (words.length >= lineCount) {
    const balanced = getBalancedWordLines(words, lineCount);
    if (balanced && Math.max(...balanced.map((line) => Array.from(line).length)) <= 5) return balanced;
  }
  return splitEvenly(safeText.replace(/\s+/g, ""), lineCount);
}

const ACCEPTED_TEAM_EMBLEM_TYPES = new Set([
  "image/avif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ACCEPTED_TEAM_EMBLEM_EXTENSIONS = new Set(["avif", "heic", "heif", "jpeg", "jpg", "png", "webp"]);

function createImageLoadError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close?.(),
      };
    } catch {
      // 일부 브라우저는 HEIC/HEIF를 <img>로는 읽지만 createImageBitmap으로는 읽지 못한다.
    }
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
    ? -(width - dimension) * ((100 - normalized.x) / 100)
    : (dimension - width) * ((100 - normalized.x) / 100);
  const y = height >= dimension
    ? -(height - dimension) * ((100 - normalized.y) / 100)
    : (dimension - height) * ((100 - normalized.y) / 100);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, x, y, width, height);
  return canvas;
}

export async function prepareTeamEmblemUpload(file, crop = {}) {
  if (!(file instanceof Blob)) throw createImageLoadError("team_emblem_file_required");
  const fileType = String(file.type || "").toLowerCase();
  const extension = String(file.name || "").split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_TEAM_EMBLEM_TYPES.has(fileType) && !ACCEPTED_TEAM_EMBLEM_EXTENSIONS.has(extension)) {
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
      Math.min(initialDimension, 288),
      Math.min(initialDimension, 256),
      Math.min(initialDimension, 224),
      Math.min(initialDimension, 192),
      Math.min(initialDimension, 160),
      Math.min(initialDimension, 144),
    ].map((value) => Math.max(1, Math.round(value))))];
    const qualities = [0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.3];

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
    team_emblem_type_not_supported: "JPG, PNG, WebP, AVIF, HEIC 이미지만 사용할 수 있습니다.",
    team_emblem_source_too_large: "원본 이미지는 32MB 이하여야 합니다.",
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
    team_emblem_upload_unavailable: "먼저 사용할 사진을 저장하세요.",
    team_emblem_restore_unavailable: "되돌릴 이전 사진이 없습니다.",
    team_emblem_restore_failed: "이전 사진으로 되돌리지 못했습니다.",
    profile_emblem_upload_unavailable: "먼저 사용할 사진을 저장하세요.",
    profile_emblem_image_disabled: "개인 사진 엠블럼은 사용하지 않습니다.",
    team_emblem_cooldown: "교체 제한 기간입니다. 표시된 날짜 이후 다시 시도하세요.",
    team_emblem_moderation_blocked: "운영 조치로 사진 업로드가 제한되었습니다. 표시된 날짜 이후 다시 시도하세요.",
    team_emblem_not_reportable: "현재 표시 중인 팀 사진만 신고할 수 있습니다.",
    team_emblem_report_unavailable: "신고할 수 있는 팀 사진이 없습니다.",
    team_emblem_report_stale: "신고 뒤 팀 사진이 변경되었습니다. 현재 사진을 다시 확인하세요.",
    cannot_report_own_team_emblem: "내가 주장인 팀 엠블럼은 직접 신고할 수 없습니다.",
    profile_icon_unavailable: "아직 사용할 수 없는 아이콘입니다.",
    profile_emblem_cooldown: "교체 제한 기간입니다. 표시된 날짜 이후 다시 시도하세요.",
    discord_avatar_unavailable: "Discord 연동 이미지가 없습니다.",
    invalid_emblem_color: "엠블럼 색상을 확인하세요.",
    invalid_team_emblem_text_mode: "팀명 또는 약칭을 선택하세요.",
    invalid_team_emblem_abbreviation: "약칭은 1~8자로 입력하세요.",
    invalid_team_emblem_font: "글꼴을 다시 선택하세요.",
    cloudflare_r2_not_configured: "Cloudflare 저장소가 설정되지 않았습니다.",
    cloudflare_r2_upload_failed: "Cloudflare 업로드에 실패했습니다.",
    cloudflare_r2_delete_failed: "기존 엠블럼 정리에 실패했습니다.",
  };
  return messages[String(code || "")] ?? "엠블럼을 저장하지 못했습니다.";
}
