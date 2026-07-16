import { Component, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, ClipboardCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, PlusCircle, ShieldAlert, Swords, UserRound } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { getRegisteredCourts } from "../lib/courts.js";
import { getUserHashtag } from "../lib/handles.js";
import {
  cleanRoomTitle,
  getRoomCompetitionLabel,
  getRoomRefereeLabel,
  getRoomVisibilityLabel,
  getRoomScheduleLabel,
  getRoomKindFromMatch,
  getPublicRoomTimingStatus,
  getMatchHostPlayerId,
  getMatchReservePlayerIds,
  getMatchRoomPhase,
  getTournamentMatchDisplayTitle,
  getSafeMatchSide as getSafeMatchSideBase,
  isMatchRecordMatch,
  isMatchClosedNotice,
  isMatchPartyTeamParty,
  isMatchRelatedToUser,
  isMatchSideTeamParty,
  isPersonalRecordMatch,
  isInstantRoom,
  isTournamentMatchSideRosterReady,
  isTournamentMatchInUserSchedule,
  userNeedsMatchAction,
} from "../lib/matchUtils.js";
import { ROOM_KINDS } from "../lib/constants.js";
import { getRecruitingEntryForUser, getRecruitingListCardLobby, getRecruitingLobby, getRecruitingRoomOwnerId, getRecruitingSideCapacity, getRoomKindFromRecruitingPost, hasPendingRecruitingInvitation, isRecruitingTeamEntry, isRecruitingRoomInUserSchedule, isTeamRecruitingRoom } from "../lib/recruiting.js";
import { RECRUITING_ROOM_REFRESH_INTERVAL_MS, RecruitingRoomModal, getRecruitingRoomListStatus } from "./Recruiting.jsx";
import "../styles/recruiting-arena.css";
import "../styles/matches-arena.css";

const VIEWS = [
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
    title: "예정·진행",
    desc: "처리할 일 없는 일정",
    icon: Swords,
  },
  {
    id: "closed",
    code: "CLOSED",
    title: "닫힘",
    desc: "취소·무효·만료",
    icon: CheckCircle2,
  },
];
const CHILD_VIEW_IDS = ["todo", "scheduled", "closed"];
const MATCH_MENU_PHASES = new Set(["locked", "checkin", "live", "postgame", "dispute"]);
const SCHEDULE_BRANCH_FILTERS = [
  { id: "all", label: "전체" },
  { id: "public", label: "공개 모집" },
  { id: "private", label: "비공개 초대" },
  { id: "player", label: "개인전" },
  { id: "team", label: "팀전" },
];
const AUTO_ROOM_TITLE_PREFIX_PATTERN = /^(동의 대기|진행 예정|결과 승인|이의 확인|이의제기|확정|결과 입력|확정방|경기준비|경기시작|경기종료|결과승인|이의신청|기록 확정)\s*·\s*/;
const GENERIC_ROOM_TITLE_PATTERN = /^(경기|경기방|매치 큐|정규전|친선전|동의 대기|진행 예정|결과 승인|이의 확인|이의제기|확정|결과 입력|확정방|확정 준비\s*\d*|모집 중\s*\d*|경기준비|경기시작|경기종료|결과승인|이의신청|기록 확정)$/;

class RoomModalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <RoomModalErrorView error={this.state.error} onClose={this.props.onClose} />;
  }
}

function RoomModalErrorView({ error, onClose, onRetry = null }) {
  return (
    <div className="arena-modal-backdrop arena-room-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="arena-room-modal" role="dialog" aria-modal="true" aria-label="경기방 오류" onMouseDown={(event) => event.stopPropagation()}>
        <div className="arena-modal-status-row">
          <Badge tone="orange">경기방 오류</Badge>
        </div>
        <h2 className="arena-room-title">경기방을 열 수 없습니다</h2>
        <p className="arena-room-subtitle">{String(error?.message ?? "방 데이터를 확인해야 합니다.")}</p>
        <div className="arena-modal-close-row">
          {onRetry ? (
            <Button type="button" size="lg" onClick={onRetry}>
              다시 시도
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>
            방 닫기
          </Button>
        </div>
      </aside>
    </div>
  );
}

function RoomModalLoadingView() {
  return <BasketballLoader overlay label="방 불러오는 중" />;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const tournamentFormatLabels = {
  league: "리그",
  tournament: "토너먼트",
};
const tournamentMmrLabels = {
  gap_adjusted: "격차 보정",
  standard: "일반 MMR",
  event_only: "대회 점수만",
};
const tournamentStatusLabels = {
  draft: "팀장 승인 대기",
  active: "진행 중",
  scheduled: "예정",
  closed: "종료",
  cancelled: "취소",
};
const getSafeMatchSide = (match = {}, sideName = "teamA") => getSafeMatchSideBase(match, sideName, { teamIdFallback: null });

function toDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMatchDate(match) {
  if (match.scheduledDate) return String(match.scheduledDate).slice(0, 10);
  const scheduledText = String(match.scheduledAt ?? "");
  const scheduledDate = scheduledText.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (scheduledDate) return scheduledDate;
  const createdText = String(match.createdAt ?? "");
  return createdText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function isInstantScheduleRoom(room) {
  const scheduledAt = String(room?.scheduledAt ?? "").trim().toLowerCase();
  return isInstantRoom(room) || scheduledAt === "instant" || scheduledAt === "\uC989\uC2DC";
}

function isExpiredInstantScheduleRoom(room) {
  return isInstantScheduleRoom(room) && getPublicRoomTimingStatus(room).expired;
}

function getMonthKey(value = toDateInputValue()) {
  return String(value).slice(0, 7);
}

function addMonths(monthKey, amount) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addDays(dateValue, amount) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}

function shouldIncludeScheduleWindow(item, todayValue, maxScheduleDate) {
  const itemDate = getMatchDate(item);
  if (itemDate > maxScheduleDate) return false;
  if (!itemDate || itemDate >= todayValue) return true;
  return item?.recentCompleted === true;
}

function getCalendarDays(monthKey) {
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

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}.${month}`;
}

function formatDateLabel(dateValue) {
  if (!dateValue) return "날짜 전체";
  const [, month, day] = dateValue.split("-");
  return `${month}.${day}`;
}

function formatTournamentWindow(tournament) {
  return [tournament.startDate, tournament.endDate].filter(Boolean).join(" ~ ") || "일정 미정";
}

function compareSchedule(a, b) {
  const instantDiff = Number(isInstantRoom(b)) - Number(isInstantRoom(a));
  if (instantDiff) return instantDiff;
  const aKey = `${getMatchDate(a) || "9999-12-31"} ${a.scheduledTime ?? ""} ${a.scheduledAt ?? ""}`;
  const bKey = `${getMatchDate(b) || "9999-12-31"} ${b.scheduledTime ?? ""} ${b.scheduledAt ?? ""}`;
  return aKey.localeCompare(bKey);
}

function formatMatchTime(match) {
  if (isInstantScheduleRoom(match)) return getRoomScheduleLabel(match);
  return match.scheduledAt ?? match.createdAt?.slice(0, 16)?.replace("T", " ") ?? "시간 미정";
}

function getMatchProcessMeta(match, now = new Date()) {
  const phase = getMatchRoomPhase(match, now);
  return { ...phase, label: phase.label };
}

function shouldShowScoreBox(match) {
  const phase = getMatchRoomPhase(match);
  return ["postgame", "dispute", "record", "void"].includes(phase.phase);
}

function getMatchSideCount(match, sideName) {
  const count = Number(match?.[sideName]?.count);
  if (Number.isFinite(count)) return Math.max(0, count);
  const players = match?.[sideName]?.players;
  return Array.isArray(players) ? players.length : 0;
}

function getMatchPlayerCount(match) {
  return getMatchSideCount(match, "teamA") + getMatchSideCount(match, "teamB");
}

function formatMatchRules(match = {}) {
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

function normalizeMatchupText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/\s+vs\s+/i, " vs ")
    .trim()
    .toLowerCase();
}

function getRoomCardTitle(room, fallback = "") {
  if (room.tournamentId) return getTournamentMatchDisplayTitle(room, fallback || room.title);
  const title = cleanRoomTitle(room.title, "")
    .replace(AUTO_ROOM_TITLE_PREFIX_PATTERN, "")
    .replace(/^(정규전|친선전)\s+(1v1|2v2|3v3|5v5)\s*/i, "")
    .replace(/\s+(1v1|2v2|3v3|5v5)$/i, "")
    .trim();
  const matchupTitle = [room.teamA?.name, room.teamB?.name].filter(Boolean).join(" vs ");

  if (matchupTitle && normalizeMatchupText(title) === normalizeMatchupText(matchupTitle)) return "";
  if (GENERIC_ROOM_TITLE_PATTERN.test(title)) return "";
  return title || fallback;
}

function MatchListSummary({ left, center = "vs", right, meta, detail, leftTeam = null, rightTeam = null, variant = "" }) {
  const renderSide = (label, team) => (
    <span className="om-summary-side">
      {team ? <TeamHoverCard team={team} as="span">{label}</TeamHoverCard> : label}
    </span>
  );

  return (
    <div className={variant ? `om-match-summary-box ${variant}` : "om-match-summary-box"}>
      <div className="om-summary-line">
        {renderSide(left, leftTeam)}
        <strong>{center}</strong>
        {renderSide(right, rightTeam)}
      </div>
      {meta ? <span className="om-summary-meta">{meta}</span> : null}
      {detail ? <span className="om-summary-detail">{detail}</span> : null}
    </div>
  );
}

function getRoomTypeLabel(room = {}, lobby = null) {
  const matchTeamCount = ["teamA", "teamB"].filter((sideName) => Boolean(room?.[sideName]?.teamId) || isMatchSideTeamParty(room, sideName)).length;
  const matchPartyCount = (room.parties ?? []).filter((party) => isMatchPartyTeamParty(party)).length;
  const lobbyTeamCount = lobby?.entries?.filter((entry) => isRecruitingTeamEntry(entry)).length ?? 0;
  if (matchTeamCount >= 2 || lobbyTeamCount >= 2) return "팀전";
  if (matchTeamCount > 0 || matchPartyCount > 0 || lobbyTeamCount > 0) return "팀 파티 포함";
  return "개인 매칭";
}

function getWinner(match) {
  const teamA = getSafeMatchSide(match, "teamA");
  const teamB = getSafeMatchSide(match, "teamB");
  const scoreA = Number(teamA.score ?? match.result?.scoreA ?? 0);
  const scoreB = Number(teamB.score ?? match.result?.scoreB ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? teamA.name : teamB.name;
}

function getMatchActionLabel(match) {
  return getMatchRoomPhase(match).actionLabel;
}

function shouldShowMatchForView(match, view, userId, options = {}) {
  if (isPersonalRecordMatch(match) || isMatchRecordMatch(match)) return false;
  const closedNotice = isMatchClosedNotice(match);
  const phase = getMatchRoomPhase(match).phase;
  if (view.id === "active") {
    return CHILD_VIEW_IDS.some((viewId) => shouldShowMatchForView(match, { id: viewId }, userId, options));
  }
  if (view.id === "closed") return closedNotice;
  if (closedNotice) return false;
  if (!MATCH_MENU_PHASES.has(phase)) return false;
  if (view.id === "todo") return userNeedsMatchAction(match, userId);
  if (view.id === "scheduled") return !userNeedsMatchAction(match, userId);
  return false;
}

function shouldShowMatchInList(match, view, userId, hasDateFilter, options = {}) {
  if (!shouldShowMatchForView(match, view, userId, options)) return false;
  if (view.id === "active" && match.status === "confirmed" && !hasDateFilter) return false;
  return true;
}

function isTournamentCaptainMatch(match = {}, captainTeamIds = []) {
  if (!match.tournamentId) return false;
  if (match.__feedRelations?.includes("tournament_captain")) return true;
  if (!captainTeamIds.length) return false;
  const teamIds = new Set(captainTeamIds);
  return teamIds.has(match.teamA?.teamId) || teamIds.has(match.teamB?.teamId);
}

function getMatchTeamIds(match = {}) {
  return [match.teamA?.teamId, match.teamB?.teamId, match.teamAId, match.teamBId].filter(Boolean);
}

function isMatchInUserTeamSchedule(match = {}, myTeamIds = []) {
  if (!myTeamIds.length) return false;
  const teamIds = new Set(myTeamIds);
  return getMatchTeamIds(match).some((teamId) => teamIds.has(teamId));
}

function getMatchScheduleRelation(match = {}, userId = "", captainTeamIds = [], myTeamIds = []) {
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

function getRecruitingScheduleRelation(post = {}, state = {}, userId = "", myTeamIds = []) {
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

function isRecruitingScheduleRelatedToUser(post = {}, state = {}, userId = "", myTeamIds = []) {
  return Boolean(getRecruitingScheduleRelation(post, state, userId, myTeamIds));
}

function matchesScheduleRelation(relation = "", relationFilter = "all") {
  if (relationFilter === "all") return ["created", "joined"].includes(relation);
  return relation === relationFilter;
}

function getScheduleRoomKind(item = {}, type = "match") {
  return type === "room" ? getRoomKindFromRecruitingPost(item) : getRoomKindFromMatch(item);
}

function isScheduleRecordRoom(item = {}, type = "match") {
  const roomKind = getScheduleRoomKind(item, type);
  return roomKind === ROOM_KINDS.personalRecord || roomKind === ROOM_KINDS.matchRecord;
}

function isScheduleTeamRoom(item = {}, type = "match") {
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

function matchesScheduleBranch(item = {}, type = "match", branchFilter = "all") {
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

function getRecruitingRoomsForView(posts = [], view) {
  if (!["active", "scheduled"].includes(view.id)) return [];
  return posts;
}

function getScheduleItemsForView(matches = [], recruitingPosts = [], view, userId, hasDateFilter, options = {}) {
  return [
    ...getRecruitingRoomsForView(recruitingPosts, view).map((post) => ({ type: "room", id: `room-${post.id}`, item: post })),
    ...matches
      .filter((match) => shouldShowMatchInList(match, view, userId, hasDateFilter, options))
      .map((match) => ({ type: "match", id: `match-${match.id}`, item: match })),
  ].sort((a, b) => compareSchedule(a.item, b.item));
}

function getTeamCaptainId(team) {
  return team?.members?.find((member) => member.role === "captain")?.userId ?? null;
}

function getTournamentTeamStatus(tournament, teamId) {
  return tournament.teamStatuses?.[teamId] ?? "invited";
}

function getTournamentTeamIds(tournament) {
  return [...new Set([
    ...(tournament.teamIds ?? []),
    ...Object.keys(tournament.teamStatuses ?? {}),
  ].filter(Boolean))];
}

function getTournamentMatches(tournament, matchesById, matches = []) {
  const fromIds = (tournament.matchIds ?? []).map((matchId) => matchesById[matchId]).filter(Boolean);
  const source = fromIds.length ? fromIds : matches.filter((match) => match.tournamentId === tournament.id);
  return [...source].sort((a, b) => (a.tournamentRound ?? 0) - (b.tournamentRound ?? 0) || (a.tournamentFixture ?? 0) - (b.tournamentFixture ?? 0));
}

function getTournamentTeamRows(tournament, teamById, userById, currentUserId) {
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

function getRoomCapacity(match = {}) {
  const sourceMatch = match ?? {};
  const fromRules = Number(sourceMatch.rules?.sideCapacity);
  if (Number.isFinite(fromRules) && fromRules > 0) return fromRules;
  const fromMode = Number(String(sourceMatch.mode ?? "").match(/(\d+)\s*v/i)?.[1]);
  if (Number.isFinite(fromMode) && fromMode > 0) return fromMode;
  return Math.max(sourceMatch.teamA?.players?.length ?? 0, sourceMatch.teamB?.players?.length ?? 0, 5);
}

function uniquePlayerIds(ids = []) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function getSideAgreementReady(match = {}, sideName) {
  const sourceMatch = match ?? {};
  if (sourceMatch.tournamentId) return isTournamentMatchSideRosterReady(sourceMatch, sideName);
  if (sourceMatch.status !== "contract") return true;
  const players = sourceMatch[sideName]?.players ?? [];
  const agreements = new Set(sourceMatch.agreements?.[sideName] ?? []);
  return players.length > 0 && players.every((playerId) => agreements.has(playerId));
}

export function getMatchRoomPost(match, state) {
  if (!match) return null;
  const sourceMatch = match;
  const sourceState = state ?? {};
  const sourcePost = sourceMatch.recruitingPostId
    ? sourceState.recruitingPosts?.find((post) => post.id === sourceMatch.recruitingPostId)
    : null;
  const sourcePostLobby = sourcePost ? getRecruitingLobby(sourcePost, sourceState) : null;
  const tournamentRoom = Boolean(sourceMatch.tournamentId && !sourcePost);
  const tournamentReadySide = tournamentRoom
    ? ["teamA", "teamB"].find((sideName) => sourceMatch.rules?.rosterReady?.[sideName] === true) ?? ""
    : "";
  const configuredTournamentHostSide = ["teamA", "teamB"].includes(sourceMatch.rules?.tournamentHostSide)
    ? sourceMatch.rules.tournamentHostSide
    : "";
  const tournamentHostClaimed = Boolean(
    tournamentRoom && (sourceMatch.rules?.tournamentSideAssignmentLocked === true || tournamentReadySide),
  );
  const projectedTournamentHostSide = tournamentRoom
    ? configuredTournamentHostSide || tournamentReadySide || "teamA"
    : "";
  const projectedTournamentHostTeam = projectedTournamentHostSide
    ? sourceState.teams?.find((team) => team.id === sourceMatch[projectedTournamentHostSide]?.teamId) ?? null
    : null;
  const projectedTournamentCaptainId = projectedTournamentHostTeam
    ? getTeamCaptainId(projectedTournamentHostTeam)
    : "";
  const hostPlayerId = tournamentRoom
    ? (tournamentHostClaimed
        ? sourceMatch.rules?.tournamentHostPlayerId || projectedTournamentCaptainId
        : sourceMatch.rules?.tournamentProvisionalHostPlayerId || projectedTournamentCaptainId)
    : getMatchHostPlayerId(sourceMatch, sourcePost);
  const sideCapacity = getRoomCapacity(sourceMatch);
  const soloRecord = isPersonalRecordMatch(sourceMatch);
  const soloPlayedPlayerIds = sourceMatch.playedPlayerIds ?? sourceMatch.rules?.playedPlayerIds ?? {};
  const sourceTeamAPlayers = uniquePlayerIds(soloRecord ? soloPlayedPlayerIds.teamA ?? [] : sourceMatch.teamA?.players ?? []);
  const sourceTeamBPlayers = uniquePlayerIds(soloRecord ? soloPlayedPlayerIds.teamB ?? [] : sourceMatch.teamB?.players ?? []);
  const fallbackTeamAPlayers = uniquePlayerIds(sourcePostLobby?.sides?.teamA?.projectedPlayers ?? []);
  const fallbackTeamBPlayers = uniquePlayerIds(sourcePostLobby?.sides?.teamB?.projectedPlayers ?? []);
  const teamAPlayers = sourceTeamAPlayers.length ? sourceTeamAPlayers : fallbackTeamAPlayers;
  const teamBPlayers = sourceTeamBPlayers.length ? sourceTeamBPlayers : fallbackTeamBPlayers;
  const sourceTeamAReserves = uniquePlayerIds(getMatchReservePlayerIds(sourceMatch, "teamA"));
  const sourceTeamBReserves = uniquePlayerIds(getMatchReservePlayerIds(sourceMatch, "teamB"));
  const fallbackTeamAReserves = uniquePlayerIds((sourcePostLobby?.sides?.teamA?.reserveCandidates ?? []).map((candidate) => candidate.playerId));
  const fallbackTeamBReserves = uniquePlayerIds((sourcePostLobby?.sides?.teamB?.reserveCandidates ?? []).map((candidate) => candidate.playerId));
  const teamAReserves = sourceTeamAReserves.length ? sourceTeamAReserves : fallbackTeamAReserves;
  const teamBReserves = sourceTeamBReserves.length ? sourceTeamBReserves : fallbackTeamBReserves;
  const applicants = [];
  const partyReserves = {};
  const matchParties = (match.parties ?? [])
    .map((party, index) => ({
      ...party,
      index,
      side: ["teamA", "teamB"].includes(party.side) ? party.side : "teamB",
      players: uniquePlayerIds(party.players ?? []),
      reserves: uniquePlayerIds(party.reserves ?? []),
    }))
    .filter((party) => party.teamId ? isMatchPartyTeamParty(party) : party.players.length || party.reserves.length || party.playerId);
  const partyHasHost = (party) => (
    party.playerId === hostPlayerId ||
    party.players.includes(hostPlayerId) ||
    party.reserves.includes(hostPlayerId)
  );
  const hostParty = matchParties.find(partyHasHost) ?? matchParties.find((party) => party.side === "teamA") ?? null;
  const hostSide = tournamentRoom ? projectedTournamentHostSide || "teamA" : hostParty?.side ?? "teamA";
  const hostJoinMode = tournamentRoom
    ? (sourceMatch[hostSide]?.teamId ? "team" : "player")
    : (hostParty?.teamId || isMatchSideTeamParty(match, hostSide) ? "team" : "player");
  const hostTeamId = hostJoinMode === "team" ? (hostParty?.teamId ?? match[hostSide]?.teamId ?? null) : null;
  const hostPlayers = hostJoinMode === "team"
    ? uniquePlayerIds(hostParty?.players?.length ? hostParty.players : match[hostSide]?.players ?? [])
    : [hostPlayerId].filter(Boolean);
  const pushPlayerApplicant = (playerId, side, reserve = false, status = "ready") => {
    if (!playerId || playerId === hostPlayerId) return;
    applicants.push({
      kind: "player",
      joinMode: "player",
      playerId,
      side,
      status,
      reserve,
      createdAt: match.createdAt,
      updatedAt: match.createdAt,
    });
  };

  if (matchParties.length) {
    matchParties.forEach((party) => {
      const isHostParty = party === hostParty;
      const sideReady = getSideAgreementReady(match, party.side) ? "ready" : "waiting";
      if (isHostParty) {
        if (party.teamId) partyReserves.host = party.reserves;
        else {
          party.players.forEach((playerId) => pushPlayerApplicant(playerId, party.side, false, sideReady));
          party.reserves.forEach((playerId) => pushPlayerApplicant(playerId, party.side, true));
        }
        return;
      }

      if (party.teamId) {
        const reserveKey = `team:${party.teamId}`;
        applicants.push({
          kind: "team",
          joinMode: "team",
          teamId: party.teamId,
          playerId: party.playerId ?? party.players[0] ?? party.reserves[0] ?? null,
          playerIds: party.players,
          side: party.side,
          status: sideReady,
          reserve: Boolean(party.reserve && !party.players.length),
          createdAt: match.createdAt,
          updatedAt: match.createdAt,
        });
        partyReserves[reserveKey] = party.reserves;
        return;
      }

      party.players.forEach((playerId) => pushPlayerApplicant(playerId, party.side, false, sideReady));
      party.reserves.forEach((playerId) => pushPlayerApplicant(playerId, party.side, true));
    });
  } else if (hostJoinMode === "player") {
    const hostSidePlayers = hostSide === "teamA" ? teamAPlayers : teamBPlayers;
    const hostSideReserves = hostSide === "teamA" ? teamAReserves : teamBReserves;
    hostSidePlayers
      .filter((playerId) => playerId !== hostPlayerId)
      .forEach((playerId) => {
        applicants.push({
          kind: "player",
          joinMode: "player",
          playerId,
          side: hostSide,
          status: getSideAgreementReady(match, hostSide) ? "ready" : "waiting",
          reserve: false,
          createdAt: match.createdAt,
          updatedAt: match.createdAt,
        });
      });
    hostSideReserves.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: hostSide,
        status: "ready",
        reserve: true,
        createdAt: match.createdAt,
        updatedAt: match.createdAt,
      });
    });
  } else {
    partyReserves.host = hostSide === "teamA" ? teamAReserves : teamBReserves;
  }

  const opponentSide = hostSide === "teamA" ? "teamB" : "teamA";
  const opponentPlayers = opponentSide === "teamA" ? teamAPlayers : teamBPlayers;
  const opponentReserves = opponentSide === "teamA" ? teamAReserves : teamBReserves;
  const opponentTeam = sourceState.teams?.find((team) => team.id === match[opponentSide]?.teamId) ?? null;
  if (!matchParties.length && (tournamentRoom ? Boolean(match[opponentSide]?.teamId) : isMatchSideTeamParty(match, opponentSide))) {
    applicants.push({
      kind: "team",
      joinMode: "team",
      teamId: match[opponentSide]?.teamId,
      playerId: getTeamCaptainId(opponentTeam) ?? opponentPlayers[0] ?? null,
      playerIds: opponentPlayers,
      side: opponentSide,
      status: getSideAgreementReady(match, opponentSide) ? "ready" : "waiting",
      reserve: false,
      createdAt: match.createdAt,
      updatedAt: match.createdAt,
    });
    partyReserves[`team:${match[opponentSide]?.teamId}`] = opponentReserves;
  } else if (!matchParties.length) {
    opponentPlayers.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: opponentSide,
        status: getSideAgreementReady(match, opponentSide) ? "ready" : "waiting",
        reserve: false,
        createdAt: match.createdAt,
        updatedAt: match.createdAt,
      });
    });
    opponentReserves.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: opponentSide,
        status: "ready",
        reserve: true,
        createdAt: match.createdAt,
        updatedAt: match.createdAt,
      });
    });
  }

  if (matchParties.length) {
    const representedPlayerIds = new Set([hostPlayerId, ...hostPlayers].filter(Boolean));
    applicants.forEach((applicant) => {
      if (applicant.playerId) representedPlayerIds.add(applicant.playerId);
      (applicant.playerIds ?? []).forEach((playerId) => representedPlayerIds.add(playerId));
    });
    Object.values(partyReserves).flat().forEach((playerId) => representedPlayerIds.add(playerId));
    teamAPlayers.filter((playerId) => !representedPlayerIds.has(playerId)).forEach((playerId) => pushPlayerApplicant(playerId, "teamA", false, getSideAgreementReady(match, "teamA") ? "ready" : "waiting"));
    teamAReserves.filter((playerId) => !representedPlayerIds.has(playerId)).forEach((playerId) => pushPlayerApplicant(playerId, "teamA", true));
    teamBPlayers.filter((playerId) => !representedPlayerIds.has(playerId)).forEach((playerId) => pushPlayerApplicant(playerId, "teamB", false, getSideAgreementReady(match, "teamB") ? "ready" : "waiting"));
    teamBReserves.filter((playerId) => !representedPlayerIds.has(playerId)).forEach((playerId) => pushPlayerApplicant(playerId, "teamB", true));
  }

  const baseRoomState = {
    ...(sourcePost?.roomState ?? {}),
    ruleRevision: sourcePost?.roomState?.ruleRevision ?? 1,
    partyReserves,
    pinnedReservePlayers: {
      ...(sourcePost?.roomState?.pinnedReservePlayers ?? {}),
      teamA: teamAReserves,
      teamB: teamBReserves,
    },
    statRecorders: match.statRecorders ?? match.rules?.statRecorders ?? sourcePost?.roomState?.statRecorders ?? {},
  };

  if (sourcePost) {
    return {
      ...sourcePost,
      status: "open",
      title: match.title ?? sourcePost.title,
      tournamentId: match.tournamentId ?? sourcePost.tournamentId,
      mode: match.mode ?? sourcePost.mode,
      court: match.court ?? sourcePost.court,
      scheduledDate: match.scheduledDate ?? sourcePost.scheduledDate,
      scheduledTime: match.scheduledTime ?? sourcePost.scheduledTime,
      scheduledAt: match.scheduledAt ?? sourcePost.scheduledAt,
      timingType: match.timingType ?? sourcePost.timingType ?? match.rules?.timingType ?? sourcePost.roomState?.timingType ?? "scheduled",
      ranked: match.ranked ?? sourcePost.ranked,
      official: match.official ?? sourcePost.official,
      preRegistered: match.preRegistered ?? sourcePost.preRegistered,
      refereeId: match.refereeId ?? sourcePost.refereeId ?? "",
      refereeTrustMin: match.refereeTrustMin ?? sourcePost.refereeTrustMin,
      sideCapacity,
      hostSide,
      hostJoinMode,
      hostReady: getSideAgreementReady(match, hostSide),
      teamId: hostTeamId,
      playerId: hostPlayerId,
      playerIds: hostPlayers,
      applicants,
      rules: { ...(sourcePost.rules ?? {}), ...(match.rules ?? {}) },
      memo: match.memo ?? sourcePost.memo,
      stakes: match.stakes ?? sourcePost.stakes,
      visibility: sourcePost.visibility ?? "public",
      ownerId: hostPlayerId,
      roomState: { ...baseRoomState, ownerId: hostPlayerId },
    };
  }

  return {
    id: match.recruitingPostId || `match-room-${match.id}`,
    title: match.title,
    tournamentId: match.tournamentId,
    type: "need_player",
    mode: match.mode,
    court: match.court,
    scheduledDate: match.scheduledDate ?? "",
    scheduledTime: match.scheduledTime ?? "",
    scheduledAt: match.scheduledAt,
    timingType: match.timingType ?? match.rules?.timingType ?? "scheduled",
    status: "open",
    visibility: match.tournamentId ? "private" : match.recruitingPostId ? "public" : "private",
    ranked: match.ranked !== false,
    official: Boolean(match.official),
    preRegistered: Boolean(match.preRegistered),
    refereeId: match.refereeId ?? "",
    refereeTrustMin: match.refereeTrustMin,
    hostSide,
    hostJoinMode,
    hostReady: getSideAgreementReady(match, hostSide),
    ownerId: hostPlayerId,
    playerId: hostPlayerId,
    teamId: hostTeamId,
    playerIds: hostPlayers,
    sideCapacity,
    mmrRangeMode: match.mmrRangeMode ?? match.rules?.mmrRangeMode ?? "narrow",
    ratingScale: match.ratingScale ?? match.rules?.ratingScale ?? 1,
    rules: { ...(match.rules ?? {}), timingType: match.timingType ?? match.rules?.timingType ?? "scheduled" },
    memo: match.memo ?? match.stakes ?? "",
    stakes: match.stakes ?? "",
    applicants,
    roomState: {
      ...baseRoomState,
      ownerId: hostPlayerId,
      timingType: match.timingType ?? match.rules?.timingType ?? "scheduled",
      partyReserves,
      chatMessages: [],
      invitations: [],
    },
    createdAt: match.createdAt,
  };
}

export function MatchRoomModal({ app, matchId, onClose, entryPoint = "" }) {
  const [selectedMatchDetailLoadingId, setSelectedMatchDetailLoadingId] = useState(null);
  const [openedMatchId, setOpenedMatchId] = useState("");
  const requestedMatchDetailsRef = useRef(new Set());
  const matchesById = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const selectedMatch = matchId ? matchesById[matchId] ?? null : null;
  const selectedMatchRoom = useMemo(() => {
    if (!selectedMatch) return { post: null, error: null };
    try {
      return { post: getMatchRoomPost(selectedMatch, app.state), error: null };
    } catch (error) {
      return { post: null, error };
    }
  }, [app.state, selectedMatch]);
  const selectedMatchDetailLoading = Boolean(matchId && (app.remoteReady === false || selectedMatchDetailLoadingId === matchId || openedMatchId !== matchId));
  useBodyScrollLock(Boolean(matchId));

  useEffect(() => {
    if (!matchId || app.remoteReady === false || !app.currentUser.id) return;
    if (requestedMatchDetailsRef.current.has(matchId)) {
      setOpenedMatchId(matchId);
      return;
    }
    setOpenedMatchId(matchId);
    requestedMatchDetailsRef.current.add(matchId);
    setSelectedMatchDetailLoadingId(matchId);
    const request = app.actions.loadMatchDetail?.(matchId);
    if (!request?.then) {
      if (!request) requestedMatchDetailsRef.current.delete(matchId);
      setSelectedMatchDetailLoadingId((currentId) => currentId === matchId ? null : currentId);
      return;
    }
    request.then((count) => {
      if (!count) requestedMatchDetailsRef.current.delete(matchId);
    }).catch(() => {
      requestedMatchDetailsRef.current.delete(matchId);
    }).finally(() => {
      setSelectedMatchDetailLoadingId((currentId) => currentId === matchId ? null : currentId);
    });
  }, [app.actions, app.currentUser.id, app.remoteReady, matchId]);

  if (!matchId) return null;
  if (selectedMatchDetailLoading) return <RoomModalLoadingView onClose={onClose} />;
  if (selectedMatchRoom.error) return <RoomModalErrorView error={selectedMatchRoom.error} onClose={onClose} />;
  if (!selectedMatch || !selectedMatchRoom.post) {
    return <RoomModalErrorView error={new Error("경기 기록을 불러오지 못했습니다.")} onClose={onClose} />;
  }
  return (
    <RoomModalErrorBoundary key={selectedMatch.id} onClose={onClose}>
      <RecruitingRoomModal
        app={app}
        post={selectedMatchRoom.post}
        sourceMatch={selectedMatch}
        entryPoint={entryPoint}
        skipInitialDetailLoad
        onClose={onClose}
      />
    </RoomModalErrorBoundary>
  );
}

export default function Matches({ app }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewId, setViewId] = useState("active");
  const [branchFilter, setBranchFilter] = useState("all");
  const [relationFilter, setRelationFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(getMonthKey());
  const [tournamentPanelOpen, setTournamentPanelOpen] = useState(true);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [selectedRecruitingPostId, setSelectedRecruitingPostId] = useState(null);
  const [selectedMatchDetailLoadingId, setSelectedMatchDetailLoadingId] = useState(null);
  const [selectedRecruitingPostDetailLoadingId, setSelectedRecruitingPostDetailLoadingId] = useState(null);
  const [selectedRecruitingPostDetailFailedId, setSelectedRecruitingPostDetailFailedId] = useState(null);
  const queryMatchId = searchParams.get("match");
  const activeSelectedMatchId = selectedMatchId ?? queryMatchId;
  const todayValue = toDateInputValue();
  const maxScheduleDate = addDays(todayValue, 365);
  const selectedView = VIEWS.find((view) => view.id === viewId) ?? VIEWS[0];
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const matchesById = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const requestedMatchDetailsRef = useRef(new Set());
  const scheduleLoadRequestedRef = useRef("");
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const courtByName = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.name, court])), [registeredCourts]);
  const myTeamIds = useMemo(
    () => app.state.teams
      .filter((team) => team.members.some((member) => member.userId === app.currentUser.id))
      .map((team) => team.id),
    [app.currentUser.id, app.state.teams],
  );
  const captainTeamIds = useMemo(
    () => app.state.teams
      .filter((team) => team.members.some((member) => member.userId === app.currentUser.id && member.role === "captain"))
      .map((team) => team.id),
    [app.currentUser.id, app.state.teams],
  );
  const activeTournaments = useMemo(() => {
    return [...(app.state.tournaments ?? [])]
      .filter((tournament) => !["closed", "cancelled"].includes(tournament.status))
      .filter((tournament) => tournament.createdBy === app.currentUser.id || getTournamentTeamIds(tournament).some((teamId) => myTeamIds.includes(teamId)))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }, [app.currentUser.id, app.state.tournaments, myTeamIds]);
  const selectedRecruitingPost = useMemo(
    () => (app.state.recruitingPosts ?? []).find((post) => post.id === selectedRecruitingPostId && post.status === "open") ?? null,
    [app.state.recruitingPosts, selectedRecruitingPostId],
  );
  const selectedRecruitingLobby = selectedRecruitingPost ? getRecruitingLobby(selectedRecruitingPost, app.state) : null;
  const selectedRecruitingPostNeedsDetail = Boolean(selectedRecruitingPost?.listCardOnly);
  const selectedRecruitingPostDetailFailed = Boolean(
    selectedRecruitingPostId && selectedRecruitingPostDetailFailedId === selectedRecruitingPostId && (!selectedRecruitingPost || selectedRecruitingPostNeedsDetail),
  );
  const selectedRecruitingPostDetailLoading = Boolean(
    selectedRecruitingPostId && !selectedRecruitingPostDetailFailed && (selectedRecruitingPostDetailLoadingId === selectedRecruitingPostId || selectedRecruitingPostNeedsDetail),
  );
  const selectedMatch = (selectedMatchId ? matchesById[selectedMatchId] : null) ?? (queryMatchId ? matchesById[queryMatchId] : null) ?? null;
  const selectedMatchRoom = useMemo(() => {
    if (!selectedMatch) return { post: null, error: null };
    try {
      return { post: getMatchRoomPost(selectedMatch, app.state), error: null };
    } catch (error) {
      return { post: null, error };
    }
  }, [app.state, selectedMatch]);
  const selectedMatchRoomPost = selectedMatchRoom.post;
  const selectedMatchRoomError = selectedMatchRoom.error;
  const selectedMatchDetailLoading = Boolean(activeSelectedMatchId && selectedMatchDetailLoadingId === activeSelectedMatchId);
  useBodyScrollLock(Boolean(selectedMatch || selectedRecruitingPost || selectedMatchDetailLoading || selectedRecruitingPostDetailLoading));
  const closeSelectedMatch = () => {
    setSelectedMatchId(null);
    if (!queryMatchId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("match");
    setSearchParams(next, { replace: true });
  };
  const requestMatchDetail = (matchId) => {
    if (!matchId || app.remoteReady === false || !app.currentUser.id || requestedMatchDetailsRef.current.has(matchId)) return;
    requestedMatchDetailsRef.current.add(matchId);
    setSelectedMatchDetailLoadingId(matchId);
    const request = app.actions.loadMatchDetail?.(matchId);
    if (!request?.then) {
      if (!request) requestedMatchDetailsRef.current.delete(matchId);
      setSelectedMatchDetailLoadingId((currentId) => currentId === matchId ? null : currentId);
      return;
    }
    request.then((count) => {
      if (!count) requestedMatchDetailsRef.current.delete(matchId);
    }).catch(() => {
      requestedMatchDetailsRef.current.delete(matchId);
    }).finally(() => {
      setSelectedMatchDetailLoadingId((currentId) => currentId === matchId ? null : currentId);
    });
  };
  const openSelectedRecruitingPost = (postId) => {
    if (!postId) return;
    setSelectedRecruitingPostDetailFailedId(null);
    setSelectedRecruitingPostDetailLoadingId(postId);
    setSelectedRecruitingPostId(postId);
  };
  useEffect(() => {
    if (!queryMatchId) return;
    setSelectedMatchId(queryMatchId);
    requestMatchDetail(queryMatchId);
  }, [app.actions, app.currentUser.id, app.remoteReady, queryMatchId]);

  useEffect(() => {
    if (!selectedRecruitingPostId || !app.remoteReady || !app.currentUser.id) return undefined;
    const explicitDetailReload = selectedRecruitingPostDetailLoadingId === selectedRecruitingPostId;
    if (!explicitDetailReload && (app.state.recruitingPosts ?? []).some((post) => post.id === selectedRecruitingPostId && post.listCardOnly !== true)) {
      setSelectedRecruitingPostDetailLoadingId((currentId) => currentId === selectedRecruitingPostId ? null : currentId);
      setSelectedRecruitingPostDetailFailedId((currentId) => currentId === selectedRecruitingPostId ? null : currentId);
      return undefined;
    }
    if (selectedRecruitingPostDetailFailed) return undefined;
    setSelectedRecruitingPostDetailLoadingId(selectedRecruitingPostId);
    Promise.resolve(app.actions.loadRecruitingPost?.(selectedRecruitingPostId)).then((count) => {
      if (!count) setSelectedRecruitingPostDetailFailedId(selectedRecruitingPostId);
    }).finally(() => {
      setSelectedRecruitingPostDetailLoadingId((currentId) => currentId === selectedRecruitingPostId ? null : currentId);
    });
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      app.actions.loadRecruitingPost?.(selectedRecruitingPostId);
    }, RECRUITING_ROOM_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [app.actions, app.currentUser.id, app.remoteReady, app.state.recruitingPosts, selectedRecruitingPostDetailLoadingId, selectedRecruitingPostId]);

  const openSelectedMatch = (matchId) => {
    if (!matchId) return;
    requestMatchDetail(matchId);
    setSelectedMatchId(matchId);
    const next = new URLSearchParams(searchParams);
    next.set("match", matchId);
    setSearchParams(next, { replace: true });
  };

  const baseFilteredMatches = useMemo(() => {
    return [...app.state.matches]
      .filter((match) => Boolean(getMatchScheduleRelation(match, app.currentUser.id, captainTeamIds, myTeamIds)))
      .filter((match) => {
        const matchDate = getMatchDate(match);
        if (!matchDate) return !dateFilter;
        if (matchDate > maxScheduleDate) return false;
        return shouldIncludeScheduleWindow(match, todayValue, maxScheduleDate);
      })
      .filter((match) => matchesScheduleBranch(match, "match", branchFilter))
      .filter((match) => matchesScheduleRelation(getMatchScheduleRelation(match, app.currentUser.id, captainTeamIds, myTeamIds), relationFilter));
  }, [app.currentUser.id, app.state.matches, branchFilter, captainTeamIds, dateFilter, maxScheduleDate, myTeamIds, relationFilter, todayValue]);

  const filteredMatches = useMemo(() => {
    return baseFilteredMatches.filter((match) => !dateFilter || getMatchDate(match) === dateFilter);
  }, [baseFilteredMatches, dateFilter]);

  const matchPagination = app.matchPagination ?? {
    loading: false,
    exhausted: true,
    error: "",
    recruitingScheduleChecked: false,
    recruitingScheduleLoading: false,
    recruitingSchedulePostIds: [],
    teamScheduleChecked: false,
    teamScheduleLoading: false,
  };
  useEffect(() => {
    scheduleLoadRequestedRef.current = "";
  }, [app.currentUser.id]);
  useEffect(() => {
    if (!app.remoteReady || !app.currentUser.id) return;
    if (matchPagination.recruitingScheduleChecked || matchPagination.recruitingScheduleLoading) return;
    if (scheduleLoadRequestedRef.current === app.currentUser.id) return;
    scheduleLoadRequestedRef.current = app.currentUser.id;
    const request = app.actions.loadMatchRecruitingSchedule?.();
    if (!request?.then) {
      if (!request) scheduleLoadRequestedRef.current = "";
      return;
    }
    request.then((count) => {
      if (count === false) scheduleLoadRequestedRef.current = "";
    }).catch(() => {
      scheduleLoadRequestedRef.current = "";
    });
  }, [app.actions, app.currentUser.id, app.remoteReady, matchPagination.recruitingScheduleChecked, matchPagination.recruitingScheduleLoading]);
  const matchPageRecruitingPosts = useMemo(() => {
    if (!matchPagination.recruitingScheduleChecked) return [];
    const scheduleIds = new Set(matchPagination.recruitingSchedulePostIds ?? []);
    if (!scheduleIds.size) return [];
    return (app.state.recruitingPosts ?? []).filter((post) => scheduleIds.has(post.id));
  }, [app.state.recruitingPosts, matchPagination.recruitingScheduleChecked, matchPagination.recruitingSchedulePostIds]);

  const calendarMatches = useMemo(() => {
    const recruitingRooms = [...matchPageRecruitingPosts]
      .filter((post) => post.status === "open")
      .filter((post) => ["active", "scheduled"].includes(selectedView.id))
      .filter((post) => isRecruitingScheduleRelatedToUser(post, app.state, app.currentUser.id, myTeamIds))
      .filter((post) => {
        if (isInstantScheduleRoom(post)) return false;
        const postDate = getMatchDate(post);
        if (!postDate) return false;
        return postDate <= maxScheduleDate && shouldIncludeScheduleWindow(post, todayValue, maxScheduleDate);
      })
      .filter((post) => matchesScheduleBranch(post, "room", branchFilter))
      .filter((post) => matchesScheduleRelation(getRecruitingScheduleRelation(post, app.state, app.currentUser.id, myTeamIds), relationFilter));
    return getScheduleItemsForView(baseFilteredMatches, recruitingRooms, selectedView, app.currentUser.id, true)
      .map(({ item }) => item)
      .filter((item) => getMatchDate(item));
  }, [app.currentUser.id, app.state, baseFilteredMatches, branchFilter, matchPageRecruitingPosts, maxScheduleDate, myTeamIds, relationFilter, selectedView, todayValue]);

  const calendarCounts = useMemo(() => {
    return calendarMatches.reduce((map, match) => {
      const date = getMatchDate(match);
      map.set(date, (map.get(date) ?? 0) + 1);
      return map;
    }, new Map());
  }, [calendarMatches]);

  const calendarDays = useMemo(() => getCalendarDays(calendarMonth), [calendarMonth]);
  const calendarMonthCount = calendarDays.reduce((sum, day) => sum + (calendarCounts.get(day) ?? 0), 0);
  const visibleRecruitingCandidates = useMemo(() => {
    return [...matchPageRecruitingPosts]
      .filter((post) => post.status === "open")
      .filter((post) => !isExpiredInstantScheduleRoom(post))
      .filter((post) => isRecruitingScheduleRelatedToUser(post, app.state, app.currentUser.id, myTeamIds))
      .filter((post) => {
        if (isInstantScheduleRoom(post)) return true;
        const postDate = getMatchDate(post);
        return postDate && postDate <= maxScheduleDate && shouldIncludeScheduleWindow(post, todayValue, maxScheduleDate);
      })
      .filter((post) => matchesScheduleBranch(post, "room", branchFilter))
      .filter((post) => matchesScheduleRelation(getRecruitingScheduleRelation(post, app.state, app.currentUser.id, myTeamIds), relationFilter));
  }, [app.currentUser.id, app.state, branchFilter, matchPageRecruitingPosts, maxScheduleDate, myTeamIds, relationFilter, todayValue]);
  const dateScopedRecruitingCandidates = useMemo(() => visibleRecruitingCandidates.filter((post) => {
    if (isInstantScheduleRoom(post)) return !dateFilter;
    const postDate = getMatchDate(post);
    return !dateFilter || postDate === dateFilter;
  }), [dateFilter, visibleRecruitingCandidates]);

  const hasDateFilter = Boolean(dateFilter);
  const scheduleItemsByView = useMemo(() => Object.fromEntries(
    VIEWS.map((view) => [
      view.id,
      getScheduleItemsForView(filteredMatches, dateScopedRecruitingCandidates, view, app.currentUser.id, hasDateFilter),
    ]),
  ), [app.currentUser.id, branchFilter, dateScopedRecruitingCandidates, filteredMatches, hasDateFilter]);
  const visibleScheduleItems = scheduleItemsByView[viewId] ?? [];
  const viewButtonCounts = Object.fromEntries(
    VIEWS.map((view) => [view.id, scheduleItemsByView[view.id]?.length ?? 0]),
  );
  const activeCount = viewButtonCounts.active ?? 0;
  const todoCount = viewButtonCounts.todo ?? 0;
  const scheduledCount = viewButtonCounts.scheduled ?? 0;
  const closedCount = viewButtonCounts.closed ?? 0;
  const getViewButtonCount = (view) => viewButtonCounts[view.id] ?? 0;
  const scheduleLoading = app.remoteReady === false || matchPagination.loading;
  const displayScheduleItems = scheduleLoading ? [] : visibleScheduleItems;
  const scheduleCountLabel = scheduleLoading
    ? "내 일정 확인 중"
    : `내 일정 ${visibleScheduleItems.length}개 중 ${displayScheduleItems.length}개 표시`;
  const displayActiveCount = scheduleLoading ? "..." : activeCount;
  const displayTodoCount = scheduleLoading ? "..." : todoCount;
  const displayScheduledCount = scheduleLoading ? "..." : scheduledCount;
  const displayClosedCount = scheduleLoading ? "..." : closedCount;
  const getDisplayViewButtonCount = (view) => (scheduleLoading ? "..." : getViewButtonCount(view));
  return (
    <div className="page-stack om-match-page">
      <section className="om-match-hero">
        <div className="om-match-copy">
          <span className="om-kicker">MATCH QUEUE</span>
          <h1>내 경기</h1>
          <p>내가 들어간 진행, 예정, 지난 경기를 날짜별로 본다.</p>
        </div>
        <div className="om-match-panel">
          <div className="om-match-stats">
            <span><strong>{displayActiveCount}</strong>MY</span>
            <span><strong>{displayTodoCount}</strong>ACTION</span>
            <span><strong>{displayScheduledCount}</strong>SOON</span>
            <span><strong>{displayClosedCount}</strong>CLOSED</span>
          </div>
          <div className="om-match-actions">
            <Link to="/app/create">
              <Button className="om-match-create"><PlusCircle size={18} /> 매칭 만들기</Button>
            </Link>
            <Link to="/app/create?intent=record">
              <Button className="om-match-create"><ClipboardCheck size={18} /> 경기 기록하기</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="om-view-grid" aria-label="경기 상태">
        {VIEWS.map((view) => {
          const Icon = view.icon;
          const active = view.id === viewId;
          return (
            <button
              key={view.id}
              type="button"
              className={active ? "om-view-card active" : "om-view-card"}
              onClick={() => setViewId(view.id)}
            >
              <span className="om-view-icon"><Icon size={22} /></span>
              <span>
                <small>{view.code}</small>
                <strong>{view.title}</strong>
                <em>{view.desc}</em>
              </span>
              <b>{getDisplayViewButtonCount(view)}</b>
            </button>
          );
        })}
      </section>

      <section className="om-calendar-panel" aria-label="진행 경기 캘린더">
        <div className="om-calendar-summary">
          <div className="om-calendar-heading">
            <span className="om-view-icon"><CalendarDays size={22} /></span>
            <div>
              <span className="om-kicker">SCHEDULE</span>
              <h2>내 진행 일정</h2>
              <p>{dateFilter ? `${formatDateLabel(dateFilter)} 내 경기만 표시` : "내가 들어간 진행 중이거나 예정된 경기를 날짜별로 본다."}</p>
            </div>
          </div>
          <section className="om-calendar-filter-bar" aria-label="경기 필터">
            <div className="om-calendar-filter-row">
              <span className="om-calendar-filter-label">관계</span>
              <div className="segmented-control compact-segments" role="group" aria-label="관계 필터">
                <button type="button" className={relationFilter === "all" ? "active" : ""} onClick={() => setRelationFilter("all")}>전체</button>
                <button type="button" className={relationFilter === "created" ? "active" : ""} onClick={() => setRelationFilter("created")}>내가 만든 방</button>
                <button type="button" className={relationFilter === "joined" ? "active" : ""} onClick={() => setRelationFilter("joined")}>내 참여방</button>
                <button
                  type="button"
                  className={relationFilter === "team" ? "active" : ""}
                  onClick={() => {
                    setRelationFilter("team");
                    app.actions.loadMatchTeamSchedule?.();
                  }}
                >
                  {matchPagination.teamScheduleLoading ? "팀 일정 확인 중" : "내 팀 참여방"}
                </button>
                <button type="button" className={relationFilter === "invited" ? "active" : ""} onClick={() => setRelationFilter("invited")}>초대받은 방</button>
              </div>
            </div>
            <div className="om-calendar-filter-row">
              <span className="om-calendar-filter-label">유형</span>
              <div className="segmented-control compact-segments" role="group" aria-label="유형 필터">
                {SCHEDULE_BRANCH_FILTERS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={branchFilter === option.id ? "active" : ""}
                    onClick={() => setBranchFilter(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="om-calendar-box">
          <div className="om-calendar-toolbar">
            <button type="button" aria-label="이전 달" onClick={() => setCalendarMonth((month) => addMonths(month, -1))}>
              <ChevronLeft size={18} />
            </button>
            <strong>
              {formatMonthLabel(calendarMonth)}
              <span>{scheduleLoading ? "확인 중" : `${calendarMonthCount}경기`}</span>
            </strong>
            <button type="button" aria-label="다음 달" onClick={() => setCalendarMonth((month) => addMonths(month, 1))}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="om-calendar-weekdays">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="om-calendar-grid">
            {calendarDays.map((day, index) => {
              const count = scheduleLoading ? 0 : calendarCounts.get(day) ?? 0;
              const selected = day && day === dateFilter;
              const isToday = day && day === todayValue;
              return day ? (
                <button
                  key={day}
                  type="button"
                  className={`${selected ? "active" : ""} ${isToday ? "today" : ""}`}
                  onClick={() => setDateFilter((current) => current === day ? "" : day)}
                >
                  <strong>{Number(day.slice(-2))}</strong>
                  {count ? <span>{count}</span> : null}
                </button>
              ) : (
                <span key={`empty-${index}`} />
              );
            })}
          </div>
        </div>
      </section>

      <section className={activeTournaments.length && !tournamentPanelOpen ? "om-tournament-panel collapsed" : "om-tournament-panel"} aria-label="비공개 대회">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">PRIVATE EVENT</span>
            <h2>비공개 대회</h2>
          </div>
          <div className="om-tournament-head-actions">
            <span>{activeTournaments.length}개</span>
            {activeTournaments.length ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="button-icon section-disclosure-button"
                aria-expanded={tournamentPanelOpen}
                aria-controls="private-tournament-list"
                aria-label={tournamentPanelOpen ? "비공개 대회 접기" : "비공개 대회 펼치기"}
                title={tournamentPanelOpen ? "비공개 대회 접기" : "비공개 대회 펼치기"}
                onClick={() => setTournamentPanelOpen((current) => !current)}
              >
                {tournamentPanelOpen ? <ChevronUp size={18} strokeWidth={2.5} /> : <ChevronDown size={18} strokeWidth={2.5} />}
              </Button>
            ) : null}
          </div>
        </div>
        <div id="private-tournament-list" className={tournamentPanelOpen ? "om-tournament-grid" : "om-tournament-grid compact"}>
          {activeTournaments.length ? activeTournaments.map((tournament) => {
            const tournamentMatches = getTournamentMatches(tournament, matchesById, app.state.matches);
            const teamRows = getTournamentTeamRows(tournament, teamById, userById, app.currentUser.id);
            const organizer = userById[tournament.createdBy] ?? null;
            const acceptedCount = teamRows.filter((row) => row.status === "accepted").length;
            const pendingRows = teamRows.filter((row) => row.status !== "accepted");
            return (
              <article key={tournament.id} className="om-tournament-card">
                <div className="om-tournament-copy">
                  <span className="om-kicker">{tournamentFormatLabels[tournament.format] ?? tournament.format}</span>
                  <h3>{tournament.title}</h3>
                  <p>
                    <span><CalendarDays size={15} />{formatTournamentWindow(tournament)} · {tournament.court}</span>
                    <span><UserRound size={15} />개최자 {organizer?.name ?? "알 수 없음"}{organizer ? ` ${getUserHashtag(organizer)}` : ""}</span>
                  </p>
                </div>
                <div className="om-tournament-meta">
                  <span>{tournament.mode}</span>
                  <span>{tournament.ranked === false ? "친선" : "정규"}</span>
                  <span>{tournamentMmrLabels[tournament.mmrPolicy] ?? tournament.mmrPolicy}</span>
                  <strong>{acceptedCount}/{teamRows.length} 승인</strong>
                  <strong>{tournamentMatches.length}경기</strong>
                </div>
                <div className="om-tournament-state">
                  <span>{tournamentStatusLabels[tournament.status] ?? tournament.status}</span>
                  <em>{pendingRows.length ? `${pendingRows.length}팀 승인 대기` : "참가 승인 완료"}</em>
                </div>
                <div className="om-tournament-actions">
                  <Link className="button button-primary button-md om-tournament-detail-link" to={`/app/tournaments/${tournament.id}`}>
                    {tournament.format === "tournament" ? "대진표" : "리그표"}
                  </Link>
                </div>
              </article>
            );
          }) : (
            <div className="om-empty-state om-tournament-empty">
              <strong>관련 대회 없음</strong>
              <span>내가 만든 대회나 내 팀이 초대된 대회가 여기에 표시된다.</span>
            </div>
          )}
        </div>
      </section>

      {!selectedMatchDetailLoading && selectedMatch && selectedMatchRoomError ? (
        <RoomModalErrorView error={selectedMatchRoomError} onClose={closeSelectedMatch} />
      ) : null}

      {selectedMatchDetailLoading ? (
        <RoomModalLoadingView onClose={closeSelectedMatch} />
      ) : selectedMatch && selectedMatchRoomPost ? (
        <RoomModalErrorBoundary key={selectedMatch.id} onClose={closeSelectedMatch}>
          <RecruitingRoomModal
            app={app}
            post={selectedMatchRoomPost}
            sourceMatch={selectedMatch}
            skipInitialDetailLoad
            onClose={closeSelectedMatch}
          />
        </RoomModalErrorBoundary>
      ) : null}

      {selectedRecruitingPostDetailFailed ? (
        <RoomModalErrorView
          error={new Error("방이 닫혔거나 권한이 없거나 잠시 응답이 비었습니다.")}
          onClose={() => {
            setSelectedRecruitingPostId(null);
            setSelectedRecruitingPostDetailLoadingId(null);
            setSelectedRecruitingPostDetailFailedId(null);
          }}
          onRetry={() => {
            setSelectedRecruitingPostDetailFailedId(null);
            setSelectedRecruitingPostDetailLoadingId(selectedRecruitingPostId);
            Promise.resolve(app.actions.loadRecruitingPost?.(selectedRecruitingPostId)).then((count) => {
              if (!count) setSelectedRecruitingPostDetailFailedId(selectedRecruitingPostId);
            }).finally(() => {
              setSelectedRecruitingPostDetailLoadingId((currentId) => currentId === selectedRecruitingPostId ? null : currentId);
            });
          }}
        />
      ) : selectedRecruitingPostDetailLoading ? (
        <RoomModalLoadingView />
      ) : selectedRecruitingPost && selectedRecruitingLobby ? (
        <RecruitingRoomModal
          app={app}
          post={selectedRecruitingPost}
          skipInitialDetailLoad
          onClose={() => {
            setSelectedRecruitingPostId(null);
            setSelectedRecruitingPostDetailLoadingId(null);
            setSelectedRecruitingPostDetailFailedId(null);
          }}
          onOpenMatch={openSelectedMatch}
        />
      ) : null}

      {scheduleLoading ? <BasketballLoader overlay label="서버 데이터 불러오는 중" /> : null}

      <section className="om-match-list" aria-label="경기 목록">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">{selectedView.code}</span>
            <h2>{dateFilter ? `${selectedView.title} · ${formatDateLabel(dateFilter)}` : selectedView.title}</h2>
          </div>
          <span>{scheduleCountLabel}</span>
        </div>

        {displayScheduleItems.length ? (
          <>
        {displayScheduleItems.map(({ type, item }) => {
          if (type === "room") {
            const post = item;
            const lobby = getRecruitingListCardLobby(post, app.state);
            const myEntry = getRecruitingEntryForUser(lobby, app.currentUser.id);
            const mine = getRecruitingRoomOwnerId(post) === app.currentUser.id;
            const needConfirm = !mine && post.visibility !== "public" && myEntry && myEntry.status !== "ready";
            const roomStatus = getRecruitingRoomListStatus(lobby, { post, myEntry, mine });
            const filled = lobby.sides.teamA.filled + lobby.sides.teamB.filled;
            const capacity = getRecruitingSideCapacity(post) * 2;
            const roomTitle = getRoomCardTitle(post);
            return (
              <article key={`room-${post.id}`} className="om-match-card om-status-contract">
                <div className="om-card-main">
                  <div className="om-card-kicker">
                    <span className={`om-status-pill ${roomStatus.tone}`}>{roomStatus.label}</span>
                    <span className="om-card-mode">{post.mode}</span>
                    <span className="om-card-official">{getRoomVisibilityLabel(post)}</span>
                    <span className="om-card-official">{getRoomTypeLabel(post, lobby)}</span>
                    <span className="om-card-official">{getRoomCompetitionLabel(post)}</span>
                    <span className="om-card-official">{getRoomRefereeLabel(post)}</span>
                  </div>
                  {roomTitle ? <h3>{roomTitle}</h3> : null}
                  <p><CalendarDays size={15} />{formatMatchTime(post)} · <CourtHoverCard court={courtByName[post.court]} courtName={post.court}>{post.court}</CourtHoverCard></p>
                </div>
                <MatchListSummary
                  left={`A ${lobby.sides.teamA.filled}/${lobby.sides.teamA.capacity}`}
                  center={`${filled}/${capacity}`}
                  right={`B ${lobby.sides.teamB.filled}/${lobby.sides.teamB.capacity}`}
                  detail={formatMatchRules(post)}
                  variant="count-summary"
                />
                <button type="button" className="button button-secondary button-md om-room-link" onClick={() => openSelectedRecruitingPost(post.id)}>
                  {needConfirm ? "확인하기" : roomStatus.actionLabel}
                </button>
              </article>
            );
          }
          const match = item;
          const status = getMatchProcessMeta(match);
          const showScoreBox = shouldShowScoreBox(match);
          const scoreA = getSafeMatchSide(match, "teamA").score ?? match.result?.scoreA ?? 0;
          const scoreB = getSafeMatchSide(match, "teamB").score ?? match.result?.scoreB ?? 0;
          const winner = getWinner(match);
          const sourcePost = match.recruitingPostId ? app.state.recruitingPosts.find((post) => post.id === match.recruitingPostId) : null;
          const visibilityLabel = getRoomVisibilityLabel(match, sourcePost);
          const matchTitle = getRoomCardTitle(match);

          return (
            <article key={`match-${match.id}`} className={`om-match-card om-status-${match.status}`}>
              <div className="om-card-main">
                <div className="om-card-kicker">
                  <span className={`om-status-pill ${status.tone}`}>{status.label}</span>
                  <span className="om-card-mode">{match.mode}</span>
                  <span className="om-card-official">{visibilityLabel}</span>
                  <span className="om-card-official">{getRoomTypeLabel(match)}</span>
                  <span className="om-card-official">{getRoomCompetitionLabel(match)}</span>
                  <span className="om-card-official">{getRoomRefereeLabel(match)}</span>
                </div>
                {matchTitle ? <h3>{matchTitle}</h3> : null}
                <p><CalendarDays size={15} />{formatMatchTime(match)} · <CourtHoverCard court={courtByName[match.court]} courtName={match.court}>{match.court}</CourtHoverCard></p>
              </div>
              {showScoreBox ? (
                <div className="om-score-box">
                  <TeamHoverCard team={teamById[match.teamA?.teamId]} to={match.teamA?.teamId ? `/app/teams/${match.teamA?.teamId}` : undefined}>{match.teamA?.name ?? "A"}</TeamHoverCard>
                  <strong>{scoreA} : {scoreB}</strong>
                  <TeamHoverCard team={teamById[match.teamB?.teamId]} to={match.teamB?.teamId ? `/app/teams/${match.teamB?.teamId}` : undefined}>{match.teamB?.name ?? "B"}</TeamHoverCard>
                  {winner ? <span>{winner} 우세</span> : null}
                </div>
              ) : (
                <MatchListSummary
                  left={match.teamA?.name ?? "A"}
                  right={match.teamB?.name ?? "B"}
                  leftTeam={teamById[match.teamA?.teamId]}
                  rightTeam={teamById[match.teamB?.teamId]}
                  meta={`참여 ${getMatchPlayerCount(match)}명 · A ${getMatchSideCount(match, "teamA")} / B ${getMatchSideCount(match, "teamB")}`}
                  detail={formatMatchRules(match)}
                  variant="count-summary"
                />
              )}
              <button type="button" className="button button-secondary button-md om-room-link" onClick={() => openSelectedMatch(match.id)}>
                {getMatchActionLabel(match)}
              </button>
            </article>
          );
        })}
        {matchPagination.error ? <div className="om-load-more"><span>경기 목록 로드 실패</span></div> : null}
          </>
        ) : scheduleLoading ? null : (
          <div className="om-empty-state">
            <strong>해당 일정 없음</strong>
            <p>다른 상태를 선택하거나 새 경기를 만든다.</p>
          </div>
        )}
      </section>
    </div>
  );
}
