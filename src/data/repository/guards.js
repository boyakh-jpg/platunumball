import { DEFAULT_BENCH_CAPACITY } from "../../lib/constants.js";
import { ROOM_SCHEDULE_MAX_DAYS } from "../../lib/constants.js";
import { SCHEDULE_MAX_DAYS } from "../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../lib/constants.js";
import { getActivePublicRoomDiscipline } from "../../lib/admin.js";
import { getActiveUserDiscipline } from "../../lib/admin.js";
import { getHostTrustRequirement } from "../../lib/constants.js";
import { makeId } from "../rowUtils.js";

function getHostTrustBlockNotification(state, draft = {}) {
  const ranked = draft.ranked !== false;
  const visibility = draft.visibility === "public" ? "public" : "private";
  const requiredTrust = getHostTrustRequirement({ ranked, visibility, official: Boolean(draft.official) });
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const trustScore = Number(currentUser?.trustScore ?? 0);
  if (!requiredTrust || trustScore >= requiredTrust) return null;
  return {
    id: makeId("n"),
    title: "방장 신뢰도 부족",
    body: `${visibility === "public" ? "공개 정규전" : "정규전"} 방장은 신뢰도 ${requiredTrust}점 이상부터 가능합니다. 현재 ${trustScore}점입니다.`,
    tone: "orange",
  };
}

function getDisciplineBlockedState(state, actionLabel = "이 작업") {
  const discipline = getActiveUserDiscipline(state.settings, state.currentUserId);
  if (!discipline) return null;
  const until = discipline.endsAt ? new Date(discipline.endsAt).toLocaleString("ko-KR") : "제한 해제 전";
  return {
    ...state,
    notifications: [
      {
        id: makeId("n"),
        title: "이용 제한 중",
        body: `${actionLabel}은 ${until}까지 제한됩니다. 사유: ${discipline.reason || "관리자 제재"}`,
        tone: "orange",
      },
      ...state.notifications,
    ],
  };
}

function getInvalidScheduleNotification(maxDays = SCHEDULE_MAX_DAYS) {
  return {
    id: makeId("n"),
    title: "일정 설정 불가",
    body: maxDays <= ROOM_SCHEDULE_MAX_DAYS
      ? "비공개 경기방 날짜는 오늘부터 1개월 안에서만 만들 수 있습니다."
      : "경기 날짜는 오늘부터 1년 안에서만 만들 수 있습니다.",
    tone: "orange",
  };
}

function getInvalidPublicScheduleNotification(detail = "공개 예약방은 5일 이내, 경기 4시간 이후 시간만 만들 수 있습니다.") {
  return {
    id: makeId("n"),
    title: "공개방 일정 불가",
    body: detail,
    tone: "orange",
  };
}

function getPublicRoomDisciplineBlockedState(state, post, actionLabel = "공개방 참가") {
  if ((post?.visibility ?? "public") !== "public") return null;
  const discipline = getActivePublicRoomDiscipline(state.settings, state.currentUserId);
  if (!discipline) return null;
  const until = discipline.endsAt ? new Date(discipline.endsAt).toLocaleString("ko-KR") : "제한 해제 전";
  return {
    ...state,
    notifications: [{
      id: makeId("n"),
      title: "공개방 참가 제한 중",
      body: `${actionLabel}은 ${until}까지 제한됩니다. 사유: ${discipline.reason || "관리자 제재"}`,
      tone: "orange",
    }, ...state.notifications],
  };
}

function getRecruitingReserveLimitNotification(postId, sideName, benchCapacity = DEFAULT_BENCH_CAPACITY) {
  return {
    id: makeId("n"),
    title: "후보 슬롯 초과",
    body: `${SIDE_LABEL_TEXT[sideName] ?? "해당 사이드"} 후보는 최대 ${benchCapacity}명까지 가능합니다.`,
    tone: "orange",
    recruitingPostId: postId,
  };
}

function getMatchOverlapConflictBlockedState(state, matchId, overlapConflict) {
  if (!overlapConflict) return null;
  return {
    ...state,
    notifications: [{
      id: makeId("n"),
      title: "중복 경기 차단",
      body: `${overlapConflict.title}와 같은 출전선수의 시간이 겹칩니다.`,
      tone: "orange",
      matchId,
    }, ...state.notifications],
  };
}

export {
  getDisciplineBlockedState,
  getHostTrustBlockNotification,
  getInvalidPublicScheduleNotification,
  getInvalidScheduleNotification,
  getMatchOverlapConflictBlockedState,
  getPublicRoomDisciplineBlockedState,
  getRecruitingReserveLimitNotification,
};
