import {
  HOUR_MS,
  PUBLIC_ROOM_MIN_LEAD_HOURS,
  PUBLIC_ROOM_SCHEDULE_MAX_DAYS,
  QUEUE_SCHEDULE_START_DATE,
  QUEUE_SCHEDULE_TIMES,
  SCHEDULE_MAX_DAYS,
} from "../lib/constants.js";
import { addDateDays, getLocalDateInputValue, getMatchScheduledDate, isInstantRoom } from "../lib/matchUtils.js";
import { normalizeRecruitingPost } from "../lib/recruiting.js";

function getMaxScheduleDateValue(now = new Date(), maxDays = SCHEDULE_MAX_DAYS) {
  return addDateDays(getLocalDateInputValue(now), maxDays);
}

export function isScheduleDateInAllowedWindow(dateValue, now = new Date(), maxDays = SCHEDULE_MAX_DAYS) {
  const value = getDatePart(dateValue);
  if (!value) return false;
  const today = getLocalDateInputValue(now);
  const maxDate = getMaxScheduleDateValue(now, maxDays);
  return value >= today && value <= maxDate;
}

export function getDatePart(value) {
  return String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export function getTimePart(value) {
  return String(value ?? "").match(/\d{2}:\d{2}/)?.[0] ?? "";
}

export function getScheduleText(date, time) {
  return [date, time].filter(Boolean).join(" ") || "일정 미정";
}

export function toDbTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

export function getDbScheduleParts(item = {}) {
  const timingType = (
    item.timingType
    ?? item.timing_type
    ?? item.roomState?.timingType
    ?? item.room_state?.timingType
    ?? item.rules?.timingType
  ) === "instant" ? "instant" : "scheduled";
  const scheduledAtValue = item.scheduledAt ?? item.scheduled_at;
  const scheduledDate = timingType === "instant"
    ? null
    : item.scheduledDate || item.scheduled_date || getDatePart(scheduledAtValue) || null;
  const scheduledTime = timingType === "instant"
    ? null
    : toDbTime(item.scheduledTime ?? item.scheduled_time ?? getTimePart(scheduledAtValue));
  return {
    timingType,
    scheduledDate,
    scheduledTime,
    scheduledAt: timingType === "instant" ? null : [scheduledDate, scheduledTime].filter(Boolean).join(" ") || null,
  };
}

function getQueueScheduleStartDate(now = new Date()) {
  return [QUEUE_SCHEDULE_START_DATE, getLocalDateInputValue(now)].sort().at(-1);
}

function getQueueSlot(slotIndex, startDate = getQueueScheduleStartDate()) {
  const date = addDateDays(startDate, Math.floor(slotIndex / QUEUE_SCHEDULE_TIMES.length));
  const time = QUEUE_SCHEDULE_TIMES[slotIndex % QUEUE_SCHEDULE_TIMES.length];
  return {
    scheduledDate: date,
    scheduledTime: time,
    scheduledAt: `${date} ${time}`,
  };
}

function isQueueSlotAllowed(slot, now = new Date()) {
  const date = getMatchScheduledDate(slot);
  return Boolean(date && date.getTime() > now.getTime() + PUBLIC_ROOM_MIN_LEAD_HOURS * HOUR_MS);
}

function needsQueueSchedule(post = {}, startDate = getQueueScheduleStartDate()) {
  const date = getDatePart(post.scheduledDate || post.scheduledAt);
  const time = getTimePart(post.scheduledTime || post.scheduledAt);
  const maxDate = addDateDays(startDate, PUBLIC_ROOM_SCHEDULE_MAX_DAYS);
  if (isInstantRoom(post)) return false;
  if (!date || !time || date < startDate || date > maxDate) return true;
  if (!isQueueSlotAllowed({ scheduledDate: date, scheduledTime: time })) return true;
  return !date || !time || date < QUEUE_SCHEDULE_START_DATE || post.scheduledAt === "일정 미정";
}

function getQueueSortKey(post = {}) {
  return `${getDatePart(post.scheduledDate || post.scheduledAt) || QUEUE_SCHEDULE_START_DATE} ${post.createdAt ?? ""} ${post.id ?? ""}`;
}

function getQueueScheduleKey(post = {}) {
  return [getDatePart(post.scheduledDate || post.scheduledAt), getTimePart(post.scheduledTime || post.scheduledAt)].filter(Boolean).join(" ");
}

function isValidQueueScheduleKey(value = "") {
  return Boolean(value.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/));
}

export function normalizeRecruitingSchedules(posts = []) {
  const normalizedPosts = posts.map((post) => normalizeRecruitingPost(post));
  const startDate = getQueueScheduleStartDate();
  const scheduleById = new Map();
  const used = new Set(
    normalizedPosts
      .filter((post) => post.status !== "closed" && !needsQueueSchedule(post, startDate))
      .map(getQueueScheduleKey)
      .filter(isValidQueueScheduleKey),
  );
  let slotIndex = 0;

  normalizedPosts
    .filter((post) => post.status !== "closed" && needsQueueSchedule(post, startDate))
    .sort((a, b) => getQueueSortKey(a).localeCompare(getQueueSortKey(b)))
    .forEach((post) => {
      let slot = getQueueSlot(slotIndex, startDate);
      while (used.has(slot.scheduledAt) || !isQueueSlotAllowed(slot)) {
        slotIndex += 1;
        slot = getQueueSlot(slotIndex, startDate);
      }
      scheduleById.set(post.id, slot);
      used.add(slot.scheduledAt);
      slotIndex += 1;
    });

  return normalizedPosts.map((post) => (scheduleById.has(post.id) ? { ...post, ...scheduleById.get(post.id) } : post));
}

export function getNextQueueSchedule(posts = []) {
  const startDate = getQueueScheduleStartDate();
  const used = new Set(
    posts
      .filter((post) => post.status !== "closed")
      .map(getQueueScheduleKey)
      .filter(isValidQueueScheduleKey),
  );
  for (let index = 0; index < (PUBLIC_ROOM_SCHEDULE_MAX_DAYS + 1) * QUEUE_SCHEDULE_TIMES.length; index += 1) {
    const slot = getQueueSlot(index, startDate);
    if (!used.has(slot.scheduledAt) && isQueueSlotAllowed(slot)) return slot;
  }
  return getQueueSlot(posts.length, startDate);
}
