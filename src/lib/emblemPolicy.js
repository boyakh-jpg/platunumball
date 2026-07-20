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
  if (nextAt && nextAt.getTime() > Date.now()) return `${formatEmblemDate(nextAt)}부터 새 이미지를 업로드할 수 있습니다.`;
  if (count < EMBLEM_FREE_UPLOADS) return `이번 저장은 대기 없는 업로드 ${count + 1}/${EMBLEM_FREE_UPLOADS}회입니다. ${EMBLEM_FREE_UPLOADS}회 이후에는 새 이미지 교체 사이에 ${EMBLEM_COOLDOWN_DAYS}일이 필요합니다.`;
  return `저장하면 다음 새 이미지 교체는 ${EMBLEM_COOLDOWN_DAYS}일 뒤 가능합니다.`;
}
