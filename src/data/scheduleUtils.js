import { SCHEDULE_MAX_DAYS } from "../lib/constants.js";

export function addDateDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getLocalDateValue(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getMaxScheduleDateValue(now = new Date(), maxDays = SCHEDULE_MAX_DAYS) {
  return addDateDays(getLocalDateValue(now), maxDays);
}

export function isScheduleDateInAllowedWindow(dateValue, now = new Date(), maxDays = SCHEDULE_MAX_DAYS) {
  const value = getDatePart(dateValue);
  if (!value) return false;
  const today = getLocalDateValue(now);
  const maxDate = getMaxScheduleDateValue(now, maxDays);
  return value >= today && value <= maxDate;
}

export function getDatePart(value) {
  return String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export function getTimePart(value) {
  return String(value ?? "").match(/\d{2}:\d{2}/)?.[0] ?? "";
}
