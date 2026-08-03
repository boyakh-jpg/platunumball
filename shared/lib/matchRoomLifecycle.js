import {
  INSTANT_ROOM_EXPIRE_MINUTES,
  MATCH_SIDES,
  MINUTE_MS,
  STAT_ENTRY_WINDOW_MINUTES,
  normalizeDisputeWindowMinutes,
} from "./constants.js";
import { getOpenMatchDisputes } from "./matchDisputeRequests.js";
import { isTerminalMatchStatus } from "./notifications.js";
import { isRecordKindMatch } from "./matchRecordTypes.js";
import {
  getMatchEndDate,
  getMatchScheduledDate,
  getMatchStartDate,
} from "./matchScheduleTime.js";
import { isInstantRoom } from "./matchTimeUtils.js";
import { isPracticeEntity } from "./practiceMode.js";

const MATCH_CLOSED_NOTICE_GRACE_MINUTES = INSTANT_ROOM_EXPIRE_MINUTES;
export const MATCH_FINALIZATION_MINIMUM_MINUTES = 3;
export const MATCH_MANUAL_FINALIZATION_DELAY_MINUTES = MATCH_FINALIZATION_MINIMUM_MINUTES;
export { INSTANT_ROOM_EXPIRE_MINUTES };

const ROOM_PHASE_META = {
  waiting: { phase: "waiting", label: "대기방", listLabel: "모집 중", tone: "blue", actionLabel: "방 보기" },
  locked: { phase: "locked", label: "확정방", listLabel: "확정방", tone: "green", actionLabel: "방 보기" },
  checkin: { phase: "checkin", label: "경기준비방", listLabel: "경기준비", tone: "orange", actionLabel: "준비" },
  live: { phase: "live", label: "경기시작", listLabel: "경기 진행", tone: "blue", actionLabel: "기록" },
  postgame: { phase: "postgame", label: "경기종료", listLabel: "경기 종료", tone: "orange", actionLabel: "기록완료" },
  dispute: { phase: "dispute", label: "이의신청방", listLabel: "이의신청", tone: "orange", actionLabel: "처리" },
  record: { phase: "record", label: "경기 기록", listLabel: "경기 기록", tone: "green", actionLabel: "보기" },
  cancelled: { phase: "cancelled", label: "취소", listLabel: "취소", tone: "neutral", actionLabel: "보기" },
  void: { phase: "void", label: "무효", listLabel: "무효", tone: "neutral", actionLabel: "보기" },
};

const MATCH_ROOM_CHAT_LOCKED_PHASES = new Set(["dispute", "record", "cancelled", "void"]);

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes ?? 0) * MINUTE_MS);
}

export function isMatchClosedNotice(match = {}, now = new Date()) {
  if (isRecordKindMatch(match)) return false;
  const status = String(match.status ?? "");
  if (status === "cancelled" || status === "void") return true;
  if (status === "confirmed" || status === "closed") return false;
  if (match.endedAt || match.result || getMatchStartDate(match)) return false;
  if (!["agreed", "contract"].includes(status)) return false;
  const scheduledAt = getMatchScheduledDate(match);
  if (!scheduledAt) return false;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return false;
  return nowMs >= scheduledAt.getTime() + MATCH_CLOSED_NOTICE_GRACE_MINUTES * MINUTE_MS;
}

export function cleanRoomTitle(title = "", fallback = "경기방") {
  const cleaned = String(title || "")
    .replace(/^FLOW\s*/i, "")
    .trim();
  return cleaned || fallback;
}

export function getTournamentMatchDisplayTitle(match = {}, fallback = "") {
  if (!match.tournamentId) return String(fallback || match.title || "").trim();

  const round = Math.max(0, Number(match.tournamentRound) || 0);
  const fixture = Math.max(0, Number(match.tournamentFixture) || 0);
  const stageLabel = fixture
    ? (match.tournamentFormat === "tournament" ? `${round || 1}R-${fixture}` : `L-${fixture}`)
    : "";
  const matchupLabel = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return [stageLabel, matchupLabel].filter(Boolean).join(" · ") || String(fallback || match.title || "대회 경기").trim();
}

export function getRoomVisibilityLabel(room = {}, sourceRoom = null) {
  if (room.tournamentId) return "대회방";
  const visibility = room.visibility ?? sourceRoom?.visibility;
  if (visibility) return visibility === "private" ? "비공개방" : "공개방";
  return room.recruitingPostId ? "공개방" : "비공개방";
}

export function getRoomCompetitionLabel(room = {}) {
  if (isPracticeEntity(room)) return "연습경기";
  return room.ranked === false ? "친선전" : "정규전";
}

export function getRoomRefereeLabel(room = {}) {
  if (room.refereeId) return "심판 있음";
  if (room.refereeWanted || room.roomState?.refereeWanted) return "심판 모집";
  return "심판 없음";
}

export function isTournamentMatchSideRosterReady(match = {}, sideName = "") {
  if (!match.tournamentId || !MATCH_SIDES.includes(sideName)) return false;
  if (match.rules?.rosterReady?.[sideName] !== true) return false;
  const readyAt = match.rules?.rosterReadyAt?.[sideName];
  const scheduledAt = getMatchScheduledDate(match);
  if (!readyAt || !scheduledAt) return true;
  const readyAtMs = new Date(readyAt).getTime();
  return Number.isFinite(readyAtMs) && readyAtMs <= scheduledAt.getTime();
}

export function isTournamentMatchRosterReady(match = {}) {
  return !match.tournamentId || (
    isTournamentMatchSideRosterReady(match, "teamA")
    && isTournamentMatchSideRosterReady(match, "teamB")
  );
}

export function getMatchRoomPhase(match = {}, now = new Date()) {
  if (match.status === "cancelled") return ROOM_PHASE_META.cancelled;
  if (match.status === "void") return ROOM_PHASE_META.void;
  if (match.status === "confirmed") return ROOM_PHASE_META.record;
  if (match.status === "disputed" && getOpenMatchDisputes(match).length) return ROOM_PHASE_META.dispute;
  if ((match.status === "approval" || match.status === "disputed") && getMatchRecordWindow(match, now).disputeExpired) {
    return ROOM_PHASE_META.record;
  }
  if (match.status === "approval" || match.status === "disputed") return ROOM_PHASE_META.dispute;
  if (match.endedAt) return ROOM_PHASE_META.postgame;
  if (getMatchStartDate(match)) return ROOM_PHASE_META.live;
  if (match.status === "agreed" && match.result) return ROOM_PHASE_META.postgame;

  if (match.status === "agreed" || match.status === "contract") {
    if (match.tournamentId && !isTournamentMatchRosterReady(match)) return ROOM_PHASE_META.locked;
    if (isInstantRoom(match)) return ROOM_PHASE_META.checkin;
    const scheduledAt = getMatchScheduledDate(match);
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (
      scheduledAt
      && Number.isFinite(nowMs)
      && nowMs >= scheduledAt.getTime() - (
        match.rules?.qrAttendanceEnabled === true ? 20 : 10
      ) * MINUTE_MS
    ) return ROOM_PHASE_META.checkin;
    return ROOM_PHASE_META.locked;
  }

  return ROOM_PHASE_META.waiting;
}

export function isMatchRoomChatLocked(match = {}, now = new Date()) {
  const phase = getMatchRoomPhase(match, now).phase;
  const status = String(match.status ?? "").trim().toLowerCase();
  return MATCH_ROOM_CHAT_LOCKED_PHASES.has(phase) || isTerminalMatchStatus(status);
}

export function isMatchInScheduleMenu(match = {}, now = new Date()) {
  return ["locked", "checkin"].includes(getMatchRoomPhase(match, now).phase);
}

export function isMatchInPlayMenu(match = {}, now = new Date()) {
  return ["live", "postgame", "dispute"].includes(getMatchRoomPhase(match, now).phase);
}

export function getMatchRecordWindow(match = {}, now = Date.now()) {
  const startAt = getMatchStartDate(match);
  const endAt = getMatchEndDate(match);
  const statEntryMinutes = Number(match.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES);
  const disputeMinutes = normalizeDisputeWindowMinutes(match.disputeMinutes);

  if (!endAt) {
    return {
      endAt: null,
      statClosesAt: null,
      disputeClosesAt: null,
      beforeStart: !startAt,
      beforeEnd: Boolean(startAt),
      statOpen: false,
      disputeOpen: false,
      statExpired: false,
      disputeExpired: false,
    };
  }

  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const endMs = endAt.getTime();
  const statClosesAt = addMinutes(endAt, statEntryMinutes);
  const disputeClosesAt = addMinutes(endAt, disputeMinutes);

  return {
    endAt,
    statClosesAt,
    disputeClosesAt,
    beforeEnd: nowMs < endMs,
    statOpen: nowMs >= endMs && nowMs <= statClosesAt.getTime(),
    disputeOpen: nowMs >= endMs && nowMs <= disputeClosesAt.getTime(),
    statExpired: nowMs > statClosesAt.getTime(),
    disputeExpired: nowMs > disputeClosesAt.getTime(),
  };
}

export function getMatchFinalizationWindow(match = {}, now = Date.now()) {
  const sourceMatch = match ?? {};
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const submittedAtMs = new Date(
    sourceMatch.result?.submittedAt ?? sourceMatch.result?.submitted_at ?? "",
  ).getTime();
  const endedAtMs = new Date(sourceMatch.endedAt ?? sourceMatch.ended_at ?? "").getTime();
  const baseMs = Math.max(
    Number.isFinite(submittedAtMs) ? submittedAtMs : 0,
    Number.isFinite(endedAtMs) ? endedAtMs : 0,
  );
  const availableAtMs = baseMs
    ? baseMs + MATCH_FINALIZATION_MINIMUM_MINUTES * MINUTE_MS
    : 0;
  return {
    availableAt: availableAtMs ? new Date(availableAtMs) : null,
    ready: availableAtMs > 0 && nowMs >= availableAtMs,
  };
}

export function getMatchManualFinalizationStatus(match = {}, now = Date.now()) {
  const sourceMatch = match ?? {};
  const submittedAt = sourceMatch.result?.submittedAt ?? sourceMatch.result?.submitted_at ?? null;
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const { availableAt, ready } = getMatchFinalizationWindow(sourceMatch, nowMs);
  const readyAtMs = availableAt?.getTime() ?? NaN;
  return {
    submittedAt,
    ready,
    readyAt: availableAt,
    remainingMs: Number.isFinite(nowMs) && Number.isFinite(readyAtMs)
      ? Math.max(0, readyAtMs - nowMs)
      : null,
  };
}

export function canOperatorSubmitMissingPostgameResult(match = {}, canOperatePostStart = false, now = Date.now()) {
  if (!canOperatePostStart || match.result) return false;
  if (["confirmed", "void", "cancelled", "disputed"].includes(match.status)) return false;
  if (!getMatchEndDate(match)) return false;
  return getMatchRoomPhase(match, now).phase === "postgame";
}
