import { getCourtId } from "../../../lib/courts.js";
import { getMatchPlayerIds } from "../../../lib/matchUtils.js";
import { getMatchReservePlayerIds } from "../../../lib/matchUtils.js";
import { getMatchScheduledDate } from "../../../lib/matchUtils.js";
import { getRecruitingRoomOwnerId } from "../../../lib/recruiting.js";
import { getRecruitingRoomParticipantIds } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { uniquePlayerIds } from "../../rowUtils.js";

const ROOM_SCHEDULE_PATCH_KEYS = new Set([
  "timingType",
  "scheduledDate",
  "scheduledTime",
  "courtId",
  "court",
]);
export function withoutRoomSchedulePatch(patch = {}) {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => !ROOM_SCHEDULE_PATCH_KEYS.has(key)));
}
export function getRoomScheduleTarget(room = {}, patch = {}) {
  const timingType = patch.timingType === "instant"
    ? "instant"
    : patch.timingType === "scheduled" ? "scheduled" : room.timingType === "instant" ? "instant" : "scheduled";
  const scheduledDate = timingType === "instant" ? "" : String(patch.scheduledDate ?? room.scheduledDate ?? "");
  const scheduledTime = timingType === "instant" ? "" : String(patch.scheduledTime ?? room.scheduledTime ?? "").slice(0, 5);
  return {
    timingType,
    scheduledDate,
    scheduledTime,
    scheduledAt: timingType === "instant" ? "즉시" : `${scheduledDate} ${scheduledTime}`.trim(),
    courtId: String(patch.courtId ?? getCourtId(room) ?? ""),
    court: String(patch.court ?? room.court ?? "미정").slice(0, 80),
  };
}
export function getRoomChangeDeadlineAt(room = {}, scheduleTarget = null) {
  const currentStart = getMatchScheduledDate(room);
  const targetStart = scheduleTarget
    ? getMatchScheduledDate({ ...room, ...scheduleTarget })
    : null;
  const candidates = [currentStart, targetStart].filter(Boolean);
  if (!candidates.length) return "";
  const earliestStartMs = Math.min(...candidates.map((date) => date.getTime()));
  return new Date(earliestStartMs - 6 * 3_600_000).toISOString();
}
export function hasRoomScheduleChange(room = {}, patch = {}) {
  if (![...ROOM_SCHEDULE_PATCH_KEYS].some((key) => patch[key] !== undefined)) return false;
  const current = getRoomScheduleTarget(room);
  const target = getRoomScheduleTarget(room, patch);
  return [...ROOM_SCHEDULE_PATCH_KEYS].some((key) => String(current[key] ?? "") !== String(target[key] ?? ""));
}
export function hasNonScheduleRoomChange(room = {}, patch = {}) {
  return Object.entries(withoutRoomSchedulePatch(patch)).some(([key, value]) => {
    const currentValue = room[key] ?? room.rules?.[key] ?? room.roomState?.[key];
    return JSON.stringify(currentValue ?? null) !== JSON.stringify(value ?? null);
  });
}
export function getRecruitingChangeRequiredIds(post = {}, state = {}) {
  return uniquePlayerIds([
    getRecruitingRoomOwnerId(post),
    ...getRecruitingRoomParticipantIds(post, state),
    post.refereeId,
  ]);
}
export function getMatchChangeRequiredIds(match = {}) {
  return uniquePlayerIds([
    match.createdBy,
    match.refereeId,
    ...getMatchPlayerIds(match),
    ...getMatchReservePlayerIds(match, "teamA"),
    ...getMatchReservePlayerIds(match, "teamB"),
  ]);
}
export function getPendingScheduleChangeNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "일정 변경 승인 대기",
    body: "현재 일정 변경안의 승인이 끝난 뒤 다시 수정할 수 있습니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}
export function getRoomEditLimitNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "방 수정 완료",
    body: "방 수정은 한 번만 가능합니다. 추가 변경이 필요하면 기존 방을 취소한 뒤 다시 만들어 주세요.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}
export function getRoomEditWindowNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "방 수정 가능 시간 종료",
    body: "방 수정은 경기 시작 12시간 전까지만 가능합니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}
export function getRoomCancelLockedNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "취소 가능 시간 종료",
    body: "경기 시작 2시간 전부터는 방을 취소할 수 없습니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}
