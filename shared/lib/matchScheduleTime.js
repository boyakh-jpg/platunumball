import {
  HOUR_MS,
  INSTANT_ROOM_EXPIRE_MINUTES,
  MINUTE_MS,
} from "./constants.js";
import {
  getLocalDateInputValue,
  getPublicRoomMaxDateInput,
  isInstantRoom,
} from "./matchTimeUtils.js";

const PUBLIC_ROOM_CONFIRM_OPEN_HOURS = 24;
const PUBLIC_ROOM_CONFIRM_CLOSE_HOURS = 4;

export function getMatchStartDate(match = {}) {
  const actualStart = match.startedAt;
  if (actualStart) {
    const started = new Date(actualStart);
    if (Number.isFinite(started.getTime())) return started;
  }
  return null;
}

export function getMatchEndDate(match = {}) {
  if (match.endedAt) {
    const ended = new Date(match.endedAt);
    if (Number.isFinite(ended.getTime())) return ended;
  }
  if (match.status === "agreed" && match.startedAt && !match.endedAt) return null;
  const fallback = match.result?.submittedAt ?? match.confirmedAt;
  if (!fallback) return null;
  const parsed = new Date(fallback);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function getMatchScheduledDate(match = {}) {
  if (isInstantRoom(match)) return null;
  const raw = match.scheduledDate
    ? `${match.scheduledDate} ${match.scheduledTime || "00:00"}`
    : String(match.scheduledAt ?? "").trim();
  const kstMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  const source = kstMatch ? `${kstMatch[1]}T${kstMatch[2]}:00+09:00` : raw;
  const parsed = new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function getInstantRoomExpiresAt(room = {}) {
  if (!isInstantRoom(room)) return null;
  const createdAt = new Date(room.createdAt ?? room.created_at ?? "");
  if (!Number.isFinite(createdAt.getTime())) return null;
  return new Date(createdAt.getTime() + INSTANT_ROOM_EXPIRE_MINUTES * MINUTE_MS);
}

export function getRoomScheduleLabel(room = {}) {
  if (isInstantRoom(room)) return "즉시";
  return [room.scheduledDate, room.scheduledTime].filter(Boolean).join(" ")
    || room.scheduledAt
    || "일정 미정";
}

export function getPublicRoomTimingStatus(room = {}, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const timingType = isInstantRoom(room) ? "instant" : "scheduled";
  if (timingType === "instant") {
    const createdAt = new Date(room.createdAt ?? nowDate);
    const expiresAt = getInstantRoomExpiresAt(room)
      ?? new Date(createdAt.getTime() + INSTANT_ROOM_EXPIRE_MINUTES * MINUTE_MS);
    return {
      timingType,
      label: "즉시",
      detail: "정원 충족 시 바로 확정 가능",
      canConfirm: true,
      canCreate: true,
      expired: Number.isFinite(expiresAt.getTime()) && nowMs > expiresAt.getTime(),
      expiresAt,
    };
  }

  const scheduledAt = getMatchScheduledDate(room);
  if (!scheduledAt) {
    return {
      timingType,
      label: "일정 필요",
      detail: "날짜와 시간을 입력해야 합니다.",
      canConfirm: false,
      canCreate: false,
      expired: false,
      scheduledAt: null,
    };
  }

  const scheduledMs = scheduledAt.getTime();
  if (room.visibility === "private") {
    return {
      timingType,
      label: "예약방",
      detail: "비공개방은 경기 전까지 확정할 수 있습니다.",
      canConfirm: scheduledMs > nowMs,
      canCreate: scheduledMs > nowMs,
      expired: false,
      scheduledAt,
    };
  }
  const today = getLocalDateInputValue(nowDate);
  const maxDate = getPublicRoomMaxDateInput(nowDate);
  const dateValue = String(room.scheduledDate ?? "").slice(0, 10);
  const dateAllowed = dateValue >= today && dateValue <= maxDate;
  const createLeadAllowed = scheduledMs > nowMs + PUBLIC_ROOM_CONFIRM_CLOSE_HOURS * HOUR_MS;
  const confirmOpenMs = scheduledMs - PUBLIC_ROOM_CONFIRM_OPEN_HOURS * HOUR_MS;
  const confirmCloseMs = scheduledMs - PUBLIC_ROOM_CONFIRM_CLOSE_HOURS * HOUR_MS;
  const beforeConfirmOpen = nowMs < confirmOpenMs;
  const afterConfirmClose = nowMs > confirmCloseMs;

  return {
    timingType,
    label: beforeConfirmOpen
      ? "확정 가능 시간 대기"
      : afterConfirmClose
        ? "확정 마감"
        : "경기 확정 가능",
    detail: beforeConfirmOpen
      ? "경기 24시간 전부터 확정할 수 있습니다."
      : afterConfirmClose
        ? "경기 4시간 전 확정 마감이 지났습니다."
        : "방장이 경기 확정을 누를 수 있습니다.",
    canConfirm: dateAllowed && !beforeConfirmOpen && !afterConfirmClose,
    canCreate: dateAllowed && createLeadAllowed,
    expired: afterConfirmClose,
    scheduledAt,
    confirmOpenAt: new Date(confirmOpenMs),
    confirmCloseAt: new Date(confirmCloseMs),
  };
}
