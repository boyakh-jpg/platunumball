import {
  REMOTE_CLIENT_RECORD_LIST_YEARS,
  REMOTE_CLIENT_RECORD_MONTHS,
} from "./constants.js";

const SEOUL_TIME_ZONE = "Asia/Seoul";

function getSeoulDateParts(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function shiftCalendarDate(parts, { months = 0, years = 0 } = {}) {
  const targetMonthIndex = parts.month - 1 - Number(months || 0) - Number(years || 0) * 12;
  const targetYear = parts.year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  return [
    targetYear,
    String(normalizedMonthIndex + 1).padStart(2, "0"),
    String(Math.min(parts.day, lastDay)).padStart(2, "0"),
  ].join("-");
}

export function getRecordWindowDates(now = new Date(), options = {}) {
  const parts = getSeoulDateParts(now);
  if (!parts) return { detailSince: "", listSince: "" };
  const detailMonths = Math.max(1, Number(options.detailMonths ?? REMOTE_CLIENT_RECORD_MONTHS) || REMOTE_CLIENT_RECORD_MONTHS);
  const listYears = Math.max(1, Number(options.listYears ?? REMOTE_CLIENT_RECORD_LIST_YEARS) || REMOTE_CLIENT_RECORD_LIST_YEARS);
  return {
    detailSince: shiftCalendarDate(parts, { months: detailMonths }),
    listSince: shiftCalendarDate(parts, { years: listYears }),
  };
}

export function isRecordDetailDate(recordDate = "", now = new Date()) {
  const date = String(recordDate ?? "").match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? "";
  const { detailSince } = getRecordWindowDates(now);
  return !date || !detailSince || date >= detailSince;
}
