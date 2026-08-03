import { CalendarDays, RotateCcw, ShieldAlert, Swords } from "lucide-react";
import { isMatchupTitleDuplicate } from "../lib/matchListProjection.js";
import {
  cleanRoomTitle,
  getLocalDateInputValue,
  getRoomScheduleLabel,
  getRoomKindFromMatch,
  getPublicRoomTimingStatus,
  getMatchHostPlayerId,
  getMatchRoomPhase,
  getTournamentMatchDisplayTitle,
  getSafeMatchSide as getSafeMatchSideBase,
  isMatchRecordMatch,
  isMatchClosedNotice,
  isMatchPartyTeamParty,
  isMatchInScheduleMenu,
  isMatchRelatedToUser,
  isMatchSideTeamParty,
  isPersonalRecordMatch,
  isInstantRoom,
  isTournamentMatchSideRosterReady,
  isTournamentMatchInUserSchedule,
  userNeedsMatchAction,
} from "../lib/matchUtils.js";
import { ROOM_KINDS } from "../lib/constants.js";
import { formatTournamentWindow } from "../../shared/lib/scheduleUtils.js";

export { formatTournamentWindow };
import {
  getRecruitingPostTerminalState,
  getRecruitingRoomOwnerId,
  getRoomKindFromRecruitingPost,
  hasPendingRecruitingInvitation,
  isRecruitingRoomInUserSchedule,
  isTeamRecruitingRoom,
} from "../lib/recruiting.js";
import { getTeamCaptainMemberId as getTeamCaptainId } from "../data/teamMappers.js";
import { getTournamentTeamIds, getTournamentTeamStatus } from "../data/tournamentMappers.js";

export const VIEWS = [
  {
    id: "active",
    code: "MY",
    title: "내 일정",
    desc: "전체 상태",
    icon: CalendarDays,
  },
  {
    id: "todo",
    code: "ACTION",
    title: "처리 필요",
    desc: "내 일정 중 액션",
    icon: ShieldAlert,
  },
  {
    id: "scheduled",
    code: "SOON",
    title: "예정",
    desc: "시작 전 일정",
    icon: Swords,
  },
  {
    id: "cancelled",
    code: "REMATCH",
    title: "취소된 방",
    desc: "7일 보관",
    icon: RotateCcw,
  },
];

export const CHILD_VIEW_IDS = ["todo", "scheduled"];

export const VIEW_IDS = new Set(VIEWS.map((view) => view.id));

export const PANEL_MODES = new Set(["schedule", "team", "tournament"]);

export const RELATION_FILTER_IDS = new Set(["all", "created", "joined", "invited"]);

export const SCHEDULE_BRANCH_FILTERS = [
  { id: "all", label: "전체" },
  { id: "public", label: "공개 모집" },
  { id: "private", label: "비공개 초대" },
  { id: "player", label: "개인전" },
  { id: "team", label: "팀전" },
];

export const BRANCH_FILTER_IDS = new Set(SCHEDULE_BRANCH_FILTERS.map((option) => option.id));

export const AUTO_ROOM_TITLE_PREFIX_PATTERN = /^(동의 대기|진행 예정|결과 승인|이의 확인|이의제기|확정|결과 입력|확정방|경기준비|경기시작|경기종료|결과승인|이의신청|기록 확정)\s*·\s*/;

export const GENERIC_ROOM_TITLE_PATTERN = /^(경기|경기방|매치 큐|정규전|친선전|동의 대기|진행 예정|결과 승인|이의 확인|이의제기|확정|결과 입력|확정방|확정 준비\s*\d*|모집 중\s*\d*|경기준비|경기시작|경기종료|결과승인|이의신청|기록 확정)$/;

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export const tournamentFormatLabels = {
  league: "리그",
  tournament: "토너먼트",
};

export const tournamentMmrLabels = {
  gap_adjusted: "격차 보정",
  standard: "일반 MMR",
  event_only: "대회 점수만",
};

export const tournamentStatusLabels = {
  draft: "팀장 승인 대기",
  active: "진행 중",
  scheduled: "예정",
  closed: "종료",
  cancelled: "취소",
};

export const getSafeMatchSide = (match = {}, sideName = "teamA") => getSafeMatchSideBase(match, sideName, { teamIdFallback: null });

export function getExplicitMatchDate(match) {
  if (match.scheduledDate) return String(match.scheduledDate).slice(0, 10);
  const scheduledText = String(match.scheduledAt ?? "");
  const scheduledDate = scheduledText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (scheduledDate) return scheduledDate;
  return "";
}

export function getMatchDate(match) {
  const scheduledDate = getExplicitMatchDate(match);
  if (scheduledDate) return scheduledDate;
  const createdText = String(match.createdAt ?? "");
  return createdText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export function isInstantScheduleRoom(room) {
  const scheduledAt = String(room?.scheduledAt ?? "").trim().toLowerCase();
  return isInstantRoom(room) || scheduledAt === "instant" || scheduledAt === "\uC989\uC2DC";
}

export function isExpiredInstantScheduleRoom(room) {
  return isInstantScheduleRoom(room) && getPublicRoomTimingStatus(room).expired;
}

export function matchesRecruitingScheduleDate(post = {}, dateFilter = "") {
  if (!dateFilter) return true;
  if (isInstantScheduleRoom(post) && !getRecruitingPostTerminalState(post)) return false;
  return getMatchDate(post) === dateFilter;
}

export function hasAssignedTeamSchedule(match) {
  return isInstantScheduleRoom(match) || Boolean(getExplicitMatchDate(match));
}

export function getMonthKey(value = getLocalDateInputValue()) {
  return String(value).slice(0, 7);
}

export function getSearchParamValue(searchParams, key, validIds, fallback) {
  const value = searchParams.get(key);
  return validIds.has(value) ? value : fallback;
}

export function isDateParam(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export function isMonthParam(value) {
  return /^\d{4}-\d{2}$/.test(String(value ?? ""));
}

export function addMonths(monthKey, amount) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shouldIncludeScheduleWindow(item, todayValue, maxScheduleDate) {
  const itemDate = getMatchDate(item);
  if (itemDate > maxScheduleDate) return false;
  if (!itemDate || itemDate >= todayValue) return true;
  return Boolean((item?.teamA || item?.teamB) && isMatchInScheduleMenu(item));
}

export function getCalendarDays(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const days = Array.from({ length: firstDay.getDay() }, () => "");

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  }

  while (days.length % 7 !== 0) days.push("");
  return days;
}

export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}.${month}`;
}

export function formatDateLabel(dateValue) {
  if (!dateValue) return "날짜 전체";
  const [, month, day] = dateValue.split("-");
  return `${month}.${day}`;
}

export function compareSchedule(a, b) {
  const instantDiff = Number(isInstantRoom(b)) - Number(isInstantRoom(a));
  if (instantDiff) return instantDiff;
  const aKey = `${getMatchDate(a) || "9999-12-31"} ${a.scheduledTime ?? ""} ${a.scheduledAt ?? ""}`;
  const bKey = `${getMatchDate(b) || "9999-12-31"} ${b.scheduledTime ?? ""} ${b.scheduledAt ?? ""}`;
  return aKey.localeCompare(bKey);
}

export function formatMatchTime(match) {
  if (isInstantScheduleRoom(match)) return getRoomScheduleLabel(match);
  return match.scheduledAt ?? match.createdAt?.slice(0, 16)?.replace("T", " ") ?? "시간 미정";
}

export function getMatchProcessMeta(match, now = new Date()) {
  const phase = getMatchRoomPhase(match, now);
  return { ...phase, label: phase.label };
}

export function shouldShowScoreBox(match) {
  const phase = getMatchRoomPhase(match);
  return ["postgame", "dispute", "record", "void"].includes(phase.phase);
}

export function formatMatchRules(match = {}) {
  const rulesSource = match.rules ?? {};
  const targetScore = Number(rulesSource.targetScore ?? 21);
  const timeLimit = Number(rulesSource.timeLimit ?? 12);
  const rules = [
    targetScore ? `${targetScore}점` : "",
    timeLimit ? `${timeLimit}분` : "",
    (rulesSource.winByTwo ?? true) ? "2점차" : "",
    rulesSource.ball ?? "7호 공",
  ].filter(Boolean);
  return rules.join(" · ");
}

export function getRoomCardTitle(room, fallback = "") {
  if (room.tournamentId) return getTournamentMatchDisplayTitle(room, fallback || room.title);
  const title = cleanRoomTitle(room.title, "")
    .replace(AUTO_ROOM_TITLE_PREFIX_PATTERN, "")
    .replace(/^(정규전|친선전)\s+(1v1|2v2|3v3|5v5)\s*/i, "")
    .replace(/\s+(1v1|2v2|3v3|5v5)$/i, "")
    .trim();
  if (isMatchupTitleDuplicate(title, room)) return "";
  if (GENERIC_ROOM_TITLE_PATTERN.test(title)) return "";
  return title || fallback;
}

export function getWinner(match) {
  const teamA = getSafeMatchSide(match, "teamA");
  const teamB = getSafeMatchSide(match, "teamB");
  const scoreA = Number(teamA.score ?? match.result?.scoreA ?? 0);
  const scoreB = Number(teamB.score ?? match.result?.scoreB ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? teamA.name : teamB.name;
}

export function getMatchActionLabel(match) {
  return getMatchRoomPhase(match).actionLabel;
}

export function shouldShowMatchForView(match, view, userId, options = {}) {
  if (isPersonalRecordMatch(match) || isMatchRecordMatch(match)) return false;
  if (view.id === "active") {
    return CHILD_VIEW_IDS.some((viewId) => shouldShowMatchForView(match, { id: viewId }, userId, options));
  }
  if (view.id === "cancelled") return match?.status === "cancelled";
  if (isMatchClosedNotice(match) || !isMatchInScheduleMenu(match)) return false;
  if (view.id === "todo") return userNeedsMatchAction(match, userId);
  if (view.id === "scheduled") return !userNeedsMatchAction(match, userId);
  return false;
}

export function shouldShowMatchInList(match, view, userId, hasDateFilter, options = {}) {
  if (!shouldShowMatchForView(match, view, userId, options)) return false;
  return true;
}

export function isTournamentCaptainMatch(match = {}, captainTeamIds = []) {
  if (!match.tournamentId) return false;
  if (match.__feedRelations?.includes("tournament_captain")) return true;
  if (!captainTeamIds.length) return false;
  const teamIds = new Set(captainTeamIds);
  return teamIds.has(match.teamA?.teamId) || teamIds.has(match.teamB?.teamId);
}

export function getMatchTeamIds(match = {}) {
  return [match.teamA?.teamId, match.teamB?.teamId].filter(Boolean);
}

export function isMatchInUserTeamSchedule(match = {}, myTeamIds = []) {
  if (!myTeamIds.length) return false;
  const teamIds = new Set(myTeamIds);
  return getMatchTeamIds(match).some((teamId) => teamIds.has(teamId));
}

export function getMatchScheduleRelation(match = {}, userId = "", captainTeamIds = [], myTeamIds = []) {
  if (!userId) return "";
  if (match.tournamentId) {
    if (isTournamentMatchInUserSchedule(match, userId)) return "joined";
    return isMatchInUserTeamSchedule(match, myTeamIds) ? "team" : "";
  }
  const ownerId = match.createdBy || getMatchHostPlayerId(match) || "";
  const feedRelations = Array.isArray(match.__feedRelations) ? match.__feedRelations : [];
  if (ownerId === userId || feedRelations.includes("owner")) return "created";
  if (isMatchRelatedToUser(match, userId) || isTournamentCaptainMatch(match, captainTeamIds) || feedRelations.some((relation) => ["participant", "referee"].includes(relation))) return "joined";
  if (feedRelations.includes("team") || isMatchInUserTeamSchedule(match, myTeamIds)) return "team";
  return "";
}

export function getMatchTeamScheduleRelation(match = {}, myTeamIds = []) {
  const feedRelations = Array.isArray(match.__feedRelations) ? match.__feedRelations : [];
  return feedRelations.includes("team") || isMatchInUserTeamSchedule(match, myTeamIds) ? "team" : "";
}

export function getRecruitingScheduleRelation(post = {}, state = {}, userId = "", myTeamIds = []) {
  if (!userId) return "";
  if (getRecruitingRoomOwnerId(post) === userId) return "created";
  if (isRecruitingRoomInUserSchedule(post, state, userId, [])) return "joined";
  if (hasPendingRecruitingInvitation(post, userId)) return "invited";
  const myTeams = new Set(myTeamIds);
  const roomTeamIds = [
    post.teamId,
    post.targetTeamId,
    ...(post.applicants ?? []).flatMap((applicant) => [applicant.teamId, applicant.sourceTeamId]),
  ].filter(Boolean);
  if (roomTeamIds.some((teamId) => myTeams.has(teamId))) return "team";
  return "";
}

export function isRecruitingScheduleRelatedToUser(post = {}, state = {}, userId = "", myTeamIds = []) {
  return Boolean(getRecruitingScheduleRelation(post, state, userId, myTeamIds));
}

export function matchesScheduleRelation(relation = "", relationFilter = "all") {
  if (relationFilter === "all") return ["created", "joined", "invited"].includes(relation);
  return relation === relationFilter;
}

export function getScheduleRoomKind(item = {}, type = "match") {
  return type === "room" ? getRoomKindFromRecruitingPost(item) : getRoomKindFromMatch(item);
}

export function isScheduleRecordRoom(item = {}, type = "match") {
  const roomKind = getScheduleRoomKind(item, type);
  return roomKind === ROOM_KINDS.personalRecord || roomKind === ROOM_KINDS.matchRecord;
}

export function isScheduleTeamRoom(item = {}, type = "match") {
  if (type === "room") {
    return isTeamRecruitingRoom(item);
  }
  return item.hostJoinMode === "team"
    || item.teamOnly === true
    || item.rules?.hostJoinMode === "team"
    || item.rules?.teamOnly === true
    || Boolean(item.teamId || item.targetTeamId || item.teamA?.teamId || item.teamB?.teamId)
    || isMatchSideTeamParty(item, "teamA")
    || isMatchSideTeamParty(item, "teamB")
    || (item.parties ?? []).some((party) => isMatchPartyTeamParty(party));
}

export function matchesScheduleBranch(item = {}, type = "match", branchFilter = "all") {
  if (branchFilter === "all") return true;
  const roomKind = getScheduleRoomKind(item, type);
  const isRecord = isScheduleRecordRoom(item, type);
  const isTeam = isScheduleTeamRoom(item, type);
  if (branchFilter === "record") return isRecord;
  if (branchFilter === "team") return !isRecord && isTeam;
  if (branchFilter === "player") return !isRecord && !isTeam;
  if (branchFilter === "public") return !isRecord && roomKind === ROOM_KINDS.publicRecruiting;
  if (branchFilter === "private") return !isRecord && roomKind === ROOM_KINDS.privateInvite;
  return true;
}

export function getRecruitingRoomsForView(posts = [], view, userId = "") {
  if (view.id === "cancelled") return posts.filter((post) => Boolean(getRecruitingPostTerminalState(post)));
  const openPosts = posts.filter((post) => post.status === "open" && !getRecruitingPostTerminalState(post));
  if (view.id === "todo") return openPosts.filter((post) => hasPendingRecruitingInvitation(post, userId));
  if (!["active", "scheduled"].includes(view.id)) return [];
  return view.id === "scheduled" ? openPosts.filter((post) => !hasPendingRecruitingInvitation(post, userId)) : openPosts;
}

export function getScheduleItemsForView(matches = [], recruitingPosts = [], view, userId, hasDateFilter, options = {}) {
  const items = [
    ...getRecruitingRoomsForView(recruitingPosts, view, userId).map((post) => ({ type: "room", id: `room-${post.id}`, item: post })),
    ...matches
      .filter((match) => shouldShowMatchInList(match, view, userId, hasDateFilter, options))
      .map((match) => ({ type: "match", id: `match-${match.id}`, item: match })),
  ];
  if (view.id === "cancelled") {
    return items.sort((a, b) => String(
      b.item.cancelledAt ?? b.item.roomState?.cancelledAt ?? b.item.updatedAt ?? "",
    ).localeCompare(String(
      a.item.cancelledAt ?? a.item.roomState?.cancelledAt ?? a.item.updatedAt ?? "",
    )));
  }
  return items.sort((a, b) => compareSchedule(a.item, b.item));
}

export function getTournamentTeamRows(tournament, teamById, userById, currentUserId) {
  return getTournamentTeamIds(tournament)
    .map((teamId) => {
      const team = teamById[teamId];
      const captainId = getTeamCaptainId(team);
      const status = getTournamentTeamStatus(tournament, teamId);
      return {
        team,
        teamId,
        captainId,
        captainName: userById[captainId]?.name ?? "주장 미지정",
        status,
        canApprove: tournament.status === "draft" && captainId === currentUserId && status !== "accepted",
      };
    })
    .filter((row) => row.team);
}

export function getRoomCapacity(match = {}) {
  const sourceMatch = match ?? {};
  const fromRules = Number(sourceMatch.rules?.sideCapacity);
  if (Number.isFinite(fromRules) && fromRules > 0) return fromRules;
  const fromMode = Number(String(sourceMatch.mode ?? "").match(/(\d+)\s*v/i)?.[1]);
  if (Number.isFinite(fromMode) && fromMode > 0) return fromMode;
  return Math.max(sourceMatch.teamA?.players?.length ?? 0, sourceMatch.teamB?.players?.length ?? 0, 5);
}

export function getSideAgreementReady(match = {}, sideName) {
  const sourceMatch = match ?? {};
  if (sourceMatch.tournamentId) return isTournamentMatchSideRosterReady(sourceMatch, sideName);
  if (sourceMatch.status !== "contract") return true;
  const players = sourceMatch[sideName]?.players ?? [];
  const agreements = new Set(sourceMatch.agreements?.[sideName] ?? []);
  return players.length > 0 && players.every((playerId) => agreements.has(playerId));
}
