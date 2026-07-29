// Shared emblem cooldown and validation policy.
import { DAY_MS } from "./matchConstants.js";

export const EMBLEM_FREE_UPLOADS = 2;
export const EMBLEM_COOLDOWN_DAYS = 30;
export const EMBLEM_COOLDOWN_MS = EMBLEM_COOLDOWN_DAYS * DAY_MS;
export const EMBLEM_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isEmblemHexColor(value = "") {
  return EMBLEM_HEX_COLOR_PATTERN.test(String(value || "").trim());
}

export function getNextEmblemUploadAt(uploadCount = 0, uploadedAt = null) {
  if (Number(uploadCount) < EMBLEM_FREE_UPLOADS || !uploadedAt) return null;
  const time = new Date(uploadedAt).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time + EMBLEM_COOLDOWN_MS);
}

export function isEmblemUploadLocked(uploadCount = 0, uploadedAt = null, now = Date.now()) {
  const nextAt = getNextEmblemUploadAt(uploadCount, uploadedAt);
  return Boolean(nextAt && nextAt.getTime() > now);
}

export function formatEmblemDate(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return "날짜 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function getEmblemUploadWarning() {
  return "(처음 한번) 사진을 업로드한 뒤 한 번까지는 바로 변경할 수 있으며, 그 이후에는 마지막 업로드일로부터 30일 뒤에 변경할 수 있습니다.";
}
