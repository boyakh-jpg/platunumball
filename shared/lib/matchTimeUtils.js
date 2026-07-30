import {
  DAY_MS,
  PUBLIC_ROOM_SCHEDULE_MAX_DAYS,
} from "./constants.js";

export function addDateDays(dateValue, days) {
  const match = String(dateValue ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + Number(days || 0),
  ));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function getRoomTimingType(room = {}) {
  const value = room.timingType ?? room.rules?.timingType ?? room.roomState?.timingType;
  return value === "instant" || room.scheduledAt === "즉시" ? "instant" : "scheduled";
}

export function isInstantRoom(room = {}) {
  return getRoomTimingType(room) === "instant";
}

export function getLocalDateInputValue(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const RECORD_CREATION_WINDOW_MS = DAY_MS;

export function getSeoulTimeInputValue(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

export function getRecordCreationWindowStatus(dateValue, timeValue, now = new Date()) {
  const date = String(dateValue ?? "").trim();
  const time = String(timeValue ?? "").trim();
  const nowDate = now instanceof Date ? now : new Date(now);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !/^\d{2}:\d{2}$/.test(time)
    || !Number.isFinite(nowDate.getTime())
  ) {
    return {
      valid: false,
      reason: "invalid",
      occurredAtMs: null,
      ageMs: null,
    };
  }
  const occurredAtMs = Date.parse(`${date}T${time}:00+09:00`);
  if (!Number.isFinite(occurredAtMs)) {
    return {
      valid: false,
      reason: "invalid",
      occurredAtMs: null,
      ageMs: null,
    };
  }
  const ageMs = nowDate.getTime() - occurredAtMs;
  if (ageMs < 0) return { valid: false, reason: "future", occurredAtMs, ageMs };
  if (ageMs > RECORD_CREATION_WINDOW_MS) {
    return { valid: false, reason: "expired", occurredAtMs, ageMs };
  }
  return { valid: true, reason: "", occurredAtMs, ageMs };
}

export function formatKoreanDateTime(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const displayOptions = Object.keys(options).length ? options : {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  return date.toLocaleString("ko-KR", {
    ...displayOptions,
    timeZone: "Asia/Seoul",
  });
}

export function formatMatchWindowTime(value) {
  if (!value) return "일정 없음";
  return formatKoreanDateTime(value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getPublicRoomMaxDateInput(now = new Date()) {
  return addDateDays(getLocalDateInputValue(now), PUBLIC_ROOM_SCHEDULE_MAX_DAYS);
}

export function isDateWithinPastMonths(value, months = 6, now = new Date()) {
  const dateValue = String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!dateValue) return true;
  const todayValue = getLocalDateInputValue(now);
  const [year, month, day] = todayValue.split("-").map(Number);
  const targetMonthIndex = month - 1 - Math.max(0, Number(months) || 0);
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  const cutoffValue = [
    targetYear,
    String(normalizedMonthIndex + 1).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0"),
  ].join("-");
  return dateValue >= cutoffValue;
}
