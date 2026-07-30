import {
  DEFAULT_RATING,
  MINUTE_MS,
  isSameRegion,
} from "./constants.js";
import {
  addDateDays,
  cleanRoomTitle,
  getLocalDateInputValue,
  getPublicRoomMaxDateInput,
} from "./matchUtils.js";
import { getMatchCreationPolicyPayload } from "./matchCreationPolicies.js";
import { normalizeMatchRules } from "./matchRules.js";
import {
  getRecruitingBenchCapacity,
  getRecruitingBestSide,
  getRecruitingLobby,
  getRecruitingSideCapacity,
  isIndividualOnlyRecruitingRoom,
  isTeamOnlyRecruitingRoom,
} from "./recruiting.js";
import {
  getRecruitingDefaultTeamPlayerIds,
  getRecruitingDefaultTeamReserveIds,
} from "./teamPartyRoster.js";

const AUTO_RECRUITING_TITLE_PATTERN = /^(모집방|모집 중\s*\d*|정규전|친선전|대기방|매치 큐)$/;

export function formatRecruitingMessageTime(value) {
  if (!value) return "방금";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "방금";
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function getNonNegativeNumber(value) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;
}

export function getDefaultRecruitingTitle(draft) {
  return `${draft.ranked ? "정규전" : "친선전"} ${draft.mode} 매치 큐`;
}

export function getRecruitingCardTitle(post) {
  const title = cleanRoomTitle(post.title, "")
    .replace(/^(정규전|친선전)\s+(1v1|2v2|3v3|5v5)\s*/i, "")
    .replace(/\s+(1v1|2v2|3v3|5v5)$/i, "")
    .trim();
  return AUTO_RECRUITING_TITLE_PATTERN.test(title) ? "" : title;
}

function getRecruitingFallbackTitle(post = {}) {
  const competition = post.ranked === false ? "친선전" : "정규전";
  return `${competition} ${post.mode || "매치"} 매치 큐`;
}

export function getRecruitingDisplayTitle(post = {}, fallback = "") {
  return getRecruitingCardTitle(post) || fallback || getRecruitingFallbackTitle(post);
}

export function getRoomTitleSizeClass(title = "") {
  const length = Array.from(String(title)).length;
  if (length > 52) return "is-very-long";
  if (length > 32) return "is-long";
  return "";
}

export function getStartDateFilterOptions() {
  const todayValue = getLocalDateInputValue();
  const dateOptions = Array.from({ length: 7 }, (_, index) => {
    const dateValue = addDateDays(todayValue, index);
    const [, month, date] = dateValue.split("-").map(Number);
    const day = new Date(`${dateValue}T00:00:00Z`).getUTCDay();
    return {
      id: dateValue,
      type: "date",
      label: `${month}/${date}`,
      subLabel: index === 0
        ? "오늘"
        : index === 1
          ? "내일"
          : ["일", "월", "화", "수", "목", "금", "토"][day],
      weekend: day === 0 ? "sun" : day === 6 ? "sat" : "",
    };
  });
  return [
    { id: "instant", type: "instant", label: "즉시", subLabel: "바로" },
    ...dateOptions,
  ];
}

export function getRecruitingMaxDateInput() {
  return getPublicRoomMaxDateInput();
}

export function getRoomShareUrl(roomId = "") {
  const path = roomId ? `/app/recruiting?post=${encodeURIComponent(roomId)}` : "/app/recruiting";
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL;
  const fallbackBase = typeof window !== "undefined" ? window.location.origin : "";
  const base = String(configuredBase || fallbackBase).replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export async function copyTextToClipboard(text) {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the selection copy path below.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

export function getDefaultApplyTeamId(post, teams) {
  return teams.find((team) => isSameRegion(team.region, post.region))?.id ?? teams[0]?.id ?? "";
}

export function getJoinActiveCapacity(post, lobby, sideName, reserve = false) {
  const side = lobby?.sides?.[sideName];
  if (!side) {
    return reserve ? getRecruitingBenchCapacity(post) : getRecruitingSideCapacity(post);
  }
  if (reserve) {
    return Math.max(0, getRecruitingBenchCapacity(post) - (side.reserveCandidates?.length ?? 0));
  }
  if (isTeamOnlyRecruitingRoom(post)) return getRecruitingSideCapacity(post);
  return Math.max(0, side.capacity - side.filled);
}

export function getJoinReserveCapacity(post, lobby, sideName) {
  const side = lobby?.sides?.[sideName];
  const benchCapacity = getRecruitingBenchCapacity(post);
  if (!side) return benchCapacity;
  return Math.max(0, benchCapacity - (side.reserveCandidates?.length ?? 0));
}

export function getDefaultJoinRoster(post, lobby, team, currentUser, sideName, reserve = false) {
  if (isTeamOnlyRecruitingRoom(post)) {
    return {
      playerIds: currentUser?.id ? [currentUser.id] : [],
      reservePlayerIds: [],
    };
  }
  const capacity = getJoinActiveCapacity(post, lobby, sideName, reserve);
  const playerIds = getRecruitingDefaultTeamPlayerIds(team, capacity, currentUser.id);
  return {
    playerIds,
    reservePlayerIds: reserve
      ? []
      : getRecruitingDefaultTeamReserveIds(
        team,
        playerIds,
        getJoinReserveCapacity(post, lobby, sideName),
      ),
  };
}

export function getPlayerMmrAverage(playerIds = [], userById = {}, fallback = DEFAULT_RATING) {
  const values = playerIds
    .map((playerId) => Number(userById[playerId]?.ratings?.integrated))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return fallback;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function getRoomEditDraft(post, sourceMatch = null) {
  const room = sourceMatch
    ? {
        ...post,
        ...sourceMatch,
        sideCapacity: sourceMatch.rules?.sideCapacity ?? post.sideCapacity,
        benchCapacity: sourceMatch.rules?.benchCapacity ?? post.benchCapacity,
        hostJoinMode: sourceMatch.rules?.hostJoinMode ?? post.hostJoinMode,
        mmrRangeMode: sourceMatch.mmrRangeMode
          ?? sourceMatch.rules?.mmrRangeMode
          ?? post.mmrRangeMode,
        rules: sourceMatch.rules ?? post.rules,
      }
    : post;
  const rules = normalizeMatchRules({
    ...(room.rules ?? {}),
    visibility: room.visibility,
    matchPurpose: room.matchPurpose ?? room.rules?.matchPurpose,
    formationMode: room.formationMode ?? room.rules?.formationMode,
  }, { mode: room.mode });
  const operations = getMatchCreationPolicyPayload({
    ...room,
    ...(room.rules ?? {}),
    mode: room.mode,
  });
  return {
    visibility: room.visibility,
    matchPurpose: room.matchPurpose ?? room.rules?.matchPurpose,
    formationMode: room.formationMode ?? room.rules?.formationMode,
    courtId: room.courtId ?? room.court_id ?? "",
    court: room.court ?? "",
    timingType: (
      room.timingType
      ?? room.roomState?.timingType
      ?? room.rules?.timingType
      ?? (room.scheduledDate ? "scheduled" : "instant")
    ) === "instant"
      ? "instant"
      : "scheduled",
    scheduledDate: room.scheduledDate ?? "",
    scheduledTime: String(room.scheduledTime ?? "").slice(0, 5),
    sideCapacity: getRecruitingSideCapacity(room),
    benchCapacity: getRecruitingBenchCapacity(room),
    matchJoinMode: room.hostJoinMode === "team" ? "team" : "player",
    mmrRangeMode: room.mmrRangeMode ?? room.roomState?.mmrRangeMode ?? "narrow",
    ...rules,
    ballProvider: operations.ballProvider,
    vestsProvided: operations.vestsProvided,
    stakes: room.stakes ?? "",
    memo: room.memo ?? "",
  };
}

export function getRoomEditSaveError(result, matchRoom = false) {
  const errorCode = String(
    result?.error
    ?? result?.reason
    ?? result?.details?.reason
    ?? result?.message
    ?? "",
  ).trim();
  if (["recruiting_side_capacity_below_roster", "match_side_capacity_below_roster"].includes(errorCode)) {
    return "현재 출전 인원보다 팀당 정원을 작게 줄일 수 없습니다.";
  }
  if (errorCode === "pickup_participant_capacity_below_pool") {
    return "현재 참가 인원보다 전체 참가 정원을 작게 줄일 수 없습니다.";
  }
  if ([
    "recruiting_bench_capacity_below_roster",
    "match_bench_capacity_below_roster",
    "recruiting_reserve_full",
    "match_reserve_exceeds_bench_capacity",
  ].includes(errorCode)) {
    return "현재 후보 인원보다 후보 정원을 작게 줄일 수 없습니다.";
  }
  if (errorCode === "court_not_found" || errorCode === "invalid_room_court") {
    return "등록된 구장을 다시 선택해 주세요.";
  }
  if (errorCode === "room_meeting_point_required") {
    return "실제로 만날 장소를 2자 이상 적어 주세요.";
  }
  if (errorCode === "match_regulation_duration_exceeded") {
    return "정규 경기시간은 총 63분 이하로 입력해 주세요.";
  }
  if (errorCode === "room_edit_limit_reached") {
    return "방 수정은 한 번만 가능합니다. 추가 변경이 필요하면 기존 방을 취소한 뒤 다시 만들어 주세요.";
  }
  if (errorCode === "room_edit_window_closed" || errorCode === "room_schedule_target_too_soon") {
    return "방 수정과 새 일정 제안은 경기 시작 12시간 전까지만 가능합니다.";
  }
  if (errorCode === "match_room_operator_required" || errorCode === "recruiting_owner_required") {
    return "현재 계정에는 이 방을 수정할 권한이 없습니다.";
  }
  if (errorCode === "match_room_edit_locked" || errorCode === "recruiting_room_edit_locked") {
    return matchRoom
      ? "이미 시작했거나 종료된 경기는 수정할 수 없습니다."
      : "이미 닫힌 방은 수정할 수 없습니다.";
  }
  if (errorCode.includes("room_update_rpc_required") || errorCode.includes("could not find the function")) {
    return "최신 방 수정 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.";
  }
  return "방 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function getDefaultJoinDraft(post, teams, currentUser, state) {
  const teamId = getDefaultApplyTeamId(post, teams);
  const team = teams.find((item) => item.id === teamId) ?? null;
  const individualOnlyRoom = isIndividualOnlyRecruitingRoom(post);
  const teamOnly = isTeamOnlyRecruitingRoom(post) && !individualOnlyRoom;
  const side = getRecruitingBestSide(post, state);
  const lobby = getRecruitingLobby(post, state);
  const reserve = (
    !teamOnly
    && getJoinActiveCapacity(post, lobby, side, false) <= 0
    && getJoinReserveCapacity(post, lobby, side) > 0
  );
  const roster = teamOnly
    ? getDefaultJoinRoster(post, lobby, team, currentUser, side, reserve)
    : { playerIds: [], reservePlayerIds: [] };
  return {
    joinMode: teamOnly ? "team" : "player",
    teamId: teamOnly ? teamId : "",
    playerIds: roster.playerIds,
    reservePlayerIds: roster.reservePlayerIds,
    side,
    reserve,
    position: currentUser.position,
  };
}
