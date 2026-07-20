export const EMBLEM_FREE_UPLOADS = 2;
export const EMBLEM_COOLDOWN_DAYS = 30;
export const EMBLEM_COOLDOWN_MS = EMBLEM_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

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

export function getEmblemUploadWarning(uploadCount = 0, uploadedAt = null) {
  const count = Number(uploadCount) || 0;
  const nextAt = getNextEmblemUploadAt(count, uploadedAt);
  const policy = "사진을 업로드한 뒤 한 번까지는 바로 변경할 수 있으며, 그 이후에는 마지막 업로드일로부터 30일 뒤에 변경할 수 있습니다.";
  if (nextAt && nextAt.getTime() > Date.now()) return `${policy} 다음 변경 가능일은 ${formatEmblemDate(nextAt)}입니다.`;
  return policy;
}
