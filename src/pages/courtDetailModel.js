import { getRegisteredCourts } from "../lib/courts.js";

export function formatDate(value) {
  if (!value) return "날짜 미정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function getMatchDate(match = {}) {
  return match.scheduledAt || (match.scheduledDate ? `${match.scheduledDate}T${match.scheduledTime || "00:00"}` : "") || match.endedAt;
}

export function getLoadError(error) {
  const code = error?.code || error?.message || "court_detail_load_failed";
  if (error?.statusCode === 404 || code === "court_not_found") {
    return { code, message: "등록된 구장을 찾을 수 없습니다.", retryable: false };
  }
  return { code, message: "구장 정보를 불러오지 못했습니다.", retryable: true };
}

export function getLocalDetail(settings, courtId) {
  const court = getRegisteredCourts(settings).find((item) => item.id === courtId);
  if (!court) return null;
  const reviews = (settings?.courtReviews ?? [])
    .filter((review) => review.status !== "hidden")
    .filter((review) => review.courtId === court.id || review.courtName === court.name)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .map((review) => ({ ...review, adjustedRating: review.adjustedRating ?? review.rating }));
  return { ok: true, court, reviews, reviewableMatches: [] };
}
