import { Component, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, PlusCircle, ShieldAlert, Swords, X } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { MATCH_MODES } from "../lib/constants.js";
import { getRegisteredCourts } from "../lib/courts.js";
import {
  canUserResolveMatchDispute,
  cleanRoomTitle,
  getRoomCompetitionLabel,
  getRoomRefereeLabel,
  getRoomVisibilityLabel,
  getMatchHostPlayerId,
  getMatchReservePlayerIds,
  getMatchRoomPhase,
  isInstantRoom,
} from "../lib/matchUtils.js";
import { getRecruitingLobby, getRecruitingRoomOwnerId, getRecruitingSideCapacity } from "../lib/recruiting.js";
import { RecruitingRoomModal, getRecruitingRoomListStatus } from "./Recruiting.jsx";

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
    title: "예정",
    desc: "내 일정 중 예정",
    icon: Swords,
  },
  {
    id: "closed",
    code: "CLOSED",
    title: "닫힘",
    desc: "내 일정 중 닫힘",
    icon: CheckCircle2,
  },
];
const CHILD_VIEW_IDS = ["todo", "scheduled", "closed"];
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

function RoomModalErrorView({ error, onClose }) {
  return (
    <div className="arena-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="arena-room-modal" role="dialog" aria-modal="true" aria-label="경기방 오류" onMouseDown={(event) => event.stopPropagation()}>
        <div className="arena-modal-status-row">
          <Badge tone="orange">경기방 오류</Badge>
        </div>
        <h2 className="arena-room-title">경기방을 열 수 없습니다</h2>
        <p className="arena-room-subtitle">{String(error?.message ?? "방 데이터를 확인해야 합니다.")}</p>
        <div className="arena-modal-close-row">
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>
            방 닫기
          </Button>
        </div>
      </aside>
    </div>
  );
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
const SIDE_LABELS = {
  teamA: "A사이드",
  teamB: "B사이드",
};

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

function subtractMonths(dateValue, amount) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setMonth(date.getMonth() - amount);
  return toDateInputValue(date);
}

function shouldIncludeByHistoryRange(item, todayValue, historyRangeMonths, historyCutoffDate) {
  const itemDate = getMatchDate(item);
  if (!itemDate || itemDate >= todayValue) return true;
  if (historyRangeMonths === 0) return false;
  return itemDate >= historyCutoffDate;
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

function getMatchPlayerCount(match) {
  return new Set([...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])]).size;
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
  const matchTeamCount = ["teamA", "teamB"].filter((sideName) => Boolean(room[sideName]?.teamId)).length;
  const matchPartyCount = (room.parties ?? []).filter((party) => party.teamId).length;
  const lobbyTeamCount = lobby?.entries?.filter((entry) => entry.kind === "team").length ?? 0;
  if (matchTeamCount >= 2 || lobbyTeamCount >= 2) return "팀전";
  if (matchTeamCount > 0 || matchPartyCount > 0 || lobbyTeamCount > 0 || room.hostJoinMode === "team") return "팀 파티 포함";
  return "개인 매칭";
}

function getWinner(match) {
  const scoreA = Number(match.teamA.score ?? match.result?.scoreA ?? 0);
  const scoreB = Number(match.teamB.score ?? match.result?.scoreB ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA.name : match.teamB.name;
}

function getMatchActionLabel(match) {
  return getMatchRoomPhase(match).actionLabel;
}

function getViewCount(matches, view, userId) {
  return matches.filter((match) => shouldShowMatchInList(match, view, userId, false)).length;
}

function matchHasUser(match, userId) {
  return Boolean(
    getUserParticipantSideName(match, userId) ||
    match.createdBy === userId ||
    match.refereeId === userId ||
    match.formerRefereeId === userId
  );
}

function getUserSideName(match, userId) {
  if (match.teamA.players.includes(userId)) return "teamA";
  if (match.teamB.players.includes(userId)) return "teamB";
  return null;
}

function getUserParticipantSideName(match, userId) {
  const sideName = getUserSideName(match, userId);
  if (sideName) return sideName;
  if (getMatchReservePlayerIds(match, "teamA").includes(userId)) return "teamA";
  if (getMatchReservePlayerIds(match, "teamB").includes(userId)) return "teamB";
  return null;
}

function userDecisionDone(match, userId) {
  const sideName = getUserSideName(match, userId);
  if (!sideName) return false;
  if (match.status === "contract") return (match.agreements?.[sideName] ?? []).includes(userId);
  if (match.status === "approval") return (match.approvals?.[sideName] ?? []).includes(userId);
  return false;
}

function userNeedsAgreement(match, userId) {
  const sideName = getUserSideName(match, userId);
  return Boolean(sideName && match.status === "contract" && !(match.agreements?.[sideName] ?? []).includes(userId));
}

function userNeedsMatchAction(match, userId) {
  const phase = getMatchRoomPhase(match).phase;
  if (userNeedsAgreement(match, userId)) return true;
  if (phase === "dispute" && match.status === "disputed") return canUserResolveMatchDispute(match, userId);
  return ["postgame", "dispute"].includes(phase) && !userDecisionDone(match, userId);
}

function shouldShowMatchForView(match, view, userId) {
  const phase = getMatchRoomPhase(match).phase;
  if (view.id === "active") {
    return CHILD_VIEW_IDS.some((viewId) => shouldShowMatchForView(match, { id: viewId }, userId));
  }
  if (view.id === "closed") return ["cancelled", "void"].includes(phase);
  if (view.id === "scheduled") return ["locked", "checkin"].includes(phase) && !userNeedsMatchAction(match, userId);
  if (view.id === "todo") return userNeedsMatchAction(match, userId);
  return false;
}

function shouldShowMatchInList(match, view, userId, hasDateFilter) {
  if (!shouldShowMatchForView(match, view, userId)) return false;
  if (view.id === "active" && match.status === "confirmed" && !hasDateFilter) return false;
  return true;
}

function getRecruitingEntryForUser(lobby, userId) {
  return (lobby.entries ?? []).find((entry) => (
    (entry.players ?? []).includes(userId) ||
    (entry.reserves ?? []).includes(userId)
  )) ?? null;
}

function isRecruitingRoomInUserSchedule(post, state, userId) {
  if (!post || !userId) return false;
  if (getRecruitingRoomOwnerId(post) === userId) return true;
  if (post.playerId === userId || (post.playerIds ?? post.players ?? []).includes(userId)) return true;
  const lobby = getRecruitingLobby(post, state);
  return Boolean(getRecruitingEntryForUser(lobby, userId));
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

function getTournamentPairingPreview(tournament) {
  return tournament.format === "tournament"
    ? tournament.bracket?.rounds?.[0]?.pairings ?? []
    : tournament.bracket?.fixtures ?? [];
}

function getRoomCapacity(match) {
  const fromRules = Number(match.rules?.sideCapacity);
  if (Number.isFinite(fromRules) && fromRules > 0) return fromRules;
  const fromMode = Number(String(match.mode ?? "").match(/(\d+)\s*v/i)?.[1]);
  if (Number.isFinite(fromMode) && fromMode > 0) return fromMode;
  return Math.max(match.teamA?.players?.length ?? 0, match.teamB?.players?.length ?? 0, 5);
}

function uniquePlayerIds(ids = []) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function getSideAgreementReady(match, sideName) {
  if (match.status !== "contract") return true;
  const players = match[sideName]?.players ?? [];
  const agreements = new Set(match.agreements?.[sideName] ?? []);
  return players.length > 0 && players.every((playerId) => agreements.has(playerId));
}

function getMatchRoomPost(match, state) {
  const sourcePost = match.recruitingPostId
    ? state.recruitingPosts?.find((post) => post.id === match.recruitingPostId)
    : null;
  const hostPlayerId = getMatchHostPlayerId(match, sourcePost);
  const sideCapacity = getRoomCapacity(match);
  const teamAPlayers = uniquePlayerIds(match.teamA?.players ?? []);
  const teamBPlayers = uniquePlayerIds(match.teamB?.players ?? []);
  const teamAReserves = uniquePlayerIds(getMatchReservePlayerIds(match, "teamA"));
  const teamBReserves = uniquePlayerIds(getMatchReservePlayerIds(match, "teamB"));
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
    .filter((party) => party.players.length || party.reserves.length || party.playerId);
  const partyHasHost = (party) => (
    party.playerId === hostPlayerId ||
    party.players.includes(hostPlayerId) ||
    party.reserves.includes(hostPlayerId)
  );
  const hostParty = matchParties.find(partyHasHost) ?? matchParties.find((party) => party.side === "teamA") ?? null;
  const hostSide = hostParty?.side ?? "teamA";
  const hostJoinMode = hostParty?.teamId || match[hostSide]?.teamId ? "team" : "player";
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
    teamAPlayers
      .filter((playerId) => playerId !== hostPlayerId)
      .forEach((playerId) => {
        applicants.push({
          kind: "player",
          joinMode: "player",
          playerId,
          side: "teamA",
          status: getSideAgreementReady(match, "teamA") ? "ready" : "waiting",
          reserve: false,
          createdAt: match.createdAt,
          updatedAt: match.createdAt,
        });
      });
    teamAReserves.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: "teamA",
        status: "ready",
        reserve: true,
        createdAt: match.createdAt,
        updatedAt: match.createdAt,
      });
    });
  } else {
    partyReserves.host = teamAReserves;
  }

  if (!matchParties.length && match.teamB?.teamId) {
    applicants.push({
      kind: "team",
      joinMode: "team",
      teamId: match.teamB.teamId,
      playerId: teamBPlayers[0] ?? null,
      playerIds: teamBPlayers,
      side: "teamB",
      status: getSideAgreementReady(match, "teamB") ? "ready" : "waiting",
      reserve: false,
      createdAt: match.createdAt,
      updatedAt: match.createdAt,
    });
    partyReserves[`team:${match.teamB.teamId}`] = teamBReserves;
  } else if (!matchParties.length) {
    teamBPlayers.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: "teamB",
        status: getSideAgreementReady(match, "teamB") ? "ready" : "waiting",
        reserve: false,
        createdAt: match.createdAt,
        updatedAt: match.createdAt,
      });
    });
    teamBReserves.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: "teamB",
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
    statRecorders: match.statRecorders ?? match.rules?.statRecorders ?? sourcePost?.roomState?.statRecorders ?? {},
  };

  if (sourcePost) {
    return {
      ...sourcePost,
      status: "open",
      title: match.title ?? sourcePost.title,
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
    id: `match-room-${match.id}`,
    title: match.title,
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

export default function Matches({ app }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewId, setViewId] = useState("active");
  const [kindFilter, setKindFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [historyRangeMonths, setHistoryRangeMonths] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(getMonthKey());
  const [tournamentPanelOpen, setTournamentPanelOpen] = useState(true);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [selectedRecruitingPostId, setSelectedRecruitingPostId] = useState(null);
  const queryMatchId = searchParams.get("match");
  const todayValue = toDateInputValue();
  const maxScheduleDate = addDays(todayValue, 365);
  const historyCutoffDate = subtractMonths(todayValue, historyRangeMonths);
  const selectedView = VIEWS.find((view) => view.id === viewId) ?? VIEWS[0];
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const matchesById = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const requestedMatchDetailsRef = useRef(new Set());
  const initialMatchListLoadRef = useRef("");
  const myRecruitingLoadRef = useRef("");
  const registeredCourts = useMemo(() => getRegisteredCourts(app.state), [app.state]);
  const courtByName = useMemo(() => Object.fromEntries(registeredCourts.map((court) => [court.name, court])), [registeredCourts]);
  const myTeamIds = useMemo(
    () => app.state.teams
      .filter((team) => team.members.some((member) => member.userId === app.currentUser.id))
      .map((team) => team.id),
    [app.currentUser.id, app.state.teams],
  );
  const activeTournaments = useMemo(() => {
    return [...(app.state.tournaments ?? [])]
      .filter((tournament) => !["closed", "cancelled"].includes(tournament.status))
      .filter((tournament) => tournament.createdBy === app.currentUser.id || getTournamentTeamIds(tournament).some((teamId) => myTeamIds.includes(teamId)))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }, [app.currentUser.id, app.state.tournaments, myTeamIds]);
  const selectedTournament = useMemo(
    () => activeTournaments.find((tournament) => tournament.id === selectedTournamentId) ?? null,
    [activeTournaments, selectedTournamentId],
  );
  const selectedRecruitingPost = useMemo(
    () => (app.state.recruitingPosts ?? []).find((post) => post.id === selectedRecruitingPostId && post.status === "open") ?? null,
    [app.state.recruitingPosts, selectedRecruitingPostId],
  );
  const selectedRecruitingLobby = selectedRecruitingPost ? getRecruitingLobby(selectedRecruitingPost, app.state) : null;
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
  useBodyScrollLock(Boolean(selectedTournament || selectedMatch || selectedRecruitingPost));
  const closeSelectedMatch = () => {
    setSelectedMatchId(null);
    if (!queryMatchId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("match");
    setSearchParams(next, { replace: true });
  };
  const requestMatchDetail = (matchId) => {
    if (!matchId || requestedMatchDetailsRef.current.has(matchId)) return;
    requestedMatchDetailsRef.current.add(matchId);
    const request = app.actions.loadMatchDetail?.(matchId);
    if (!request?.then) {
      if (!request) requestedMatchDetailsRef.current.delete(matchId);
      return;
    }
    request.then((count) => {
      if (!count) requestedMatchDetailsRef.current.delete(matchId);
    }).catch(() => {
      requestedMatchDetailsRef.current.delete(matchId);
    });
  };
  useEffect(() => {
    if (!queryMatchId) return;
    setSelectedMatchId(queryMatchId);
    requestMatchDetail(queryMatchId);
  }, [app.currentUser.id, queryMatchId]);
  useEffect(() => {
    if (!app.remoteReady || !app.currentUser.id || queryMatchId) return;
    if ((app.state.matches ?? []).length > 0) return;
    if (app.matchPagination?.loading || app.matchPagination?.exhausted) return;
    if (initialMatchListLoadRef.current === app.currentUser.id) return;
    initialMatchListLoadRef.current = app.currentUser.id;
    app.actions.loadMoreMatches?.();
  }, [app.actions, app.currentUser.id, app.matchPagination?.exhausted, app.matchPagination?.loading, app.remoteReady, app.state.matches, queryMatchId]);
  useEffect(() => {
    if (!app.remoteReady || !app.currentUser.id) return undefined;
    const userId = app.currentUser.id;
    const pendingKey = `${userId}:pending`;
    if (myRecruitingLoadRef.current === userId || myRecruitingLoadRef.current === pendingKey) return undefined;
    let cancelled = false;
    let retryTimeoutId = null;
    let attempts = 0;
    const runLoad = () => {
      attempts += 1;
      myRecruitingLoadRef.current = pendingKey;
      Promise.resolve(app.actions.loadMyRecruitingPosts?.()).then((result) => {
        if (cancelled || myRecruitingLoadRef.current !== pendingKey) return;
        if (result === false && attempts < 3) {
          myRecruitingLoadRef.current = "";
          retryTimeoutId = window.setTimeout(runLoad, 1200);
          return;
        }
        myRecruitingLoadRef.current = result === false ? "" : userId;
      }).catch(() => {
        if (cancelled || myRecruitingLoadRef.current !== pendingKey) return;
        myRecruitingLoadRef.current = "";
        if (attempts < 3) retryTimeoutId = window.setTimeout(runLoad, 1200);
      });
    };
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(runLoad, { timeout: 2000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(idleId);
        if (retryTimeoutId) window.clearTimeout(retryTimeoutId);
        if (myRecruitingLoadRef.current === pendingKey) myRecruitingLoadRef.current = "";
      };
    }
    const timeoutId = window.setTimeout(runLoad, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (retryTimeoutId) window.clearTimeout(retryTimeoutId);
      if (myRecruitingLoadRef.current === pendingKey) myRecruitingLoadRef.current = "";
    };
  }, [app.actions, app.currentUser.id, app.remoteReady]);
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
      .filter((match) => matchHasUser(match, app.currentUser.id))
      .filter((match) => {
        const matchDate = getMatchDate(match);
        if (!matchDate) return true;
        if (matchDate > maxScheduleDate) return false;
        return shouldIncludeByHistoryRange(match, todayValue, historyRangeMonths, historyCutoffDate);
      })
      .filter((match) => kindFilter === "all" || (kindFilter === "ranked" ? match.ranked !== false : match.ranked === false))
      .filter((match) => modeFilter === "all" || match.mode === modeFilter);
  }, [app.currentUser.id, app.state.matches, historyCutoffDate, historyRangeMonths, kindFilter, maxScheduleDate, modeFilter, todayValue]);

  const filteredMatches = useMemo(() => {
    return baseFilteredMatches.filter((match) => !dateFilter || getMatchDate(match) === dateFilter);
  }, [baseFilteredMatches, dateFilter]);

  const calendarMatches = useMemo(() => {
    const recruitingRooms = [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status === "open")
      .filter((post) => isRecruitingRoomInUserSchedule(post, app.state, app.currentUser.id))
      .filter((post) => {
        const postDate = getMatchDate(post);
        return postDate && postDate <= maxScheduleDate && shouldIncludeByHistoryRange(post, todayValue, historyRangeMonths, historyCutoffDate);
      })
      .filter((post) => kindFilter === "all" || (kindFilter === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter);
    const displayableMatches = baseFilteredMatches.filter((match) => (
      getMatchDate(match) && VIEWS.some((view) => shouldShowMatchForView(match, view, app.currentUser.id))
    ));
    return [...displayableMatches, ...recruitingRooms];
  }, [app.currentUser.id, app.state, app.state.recruitingPosts, baseFilteredMatches, historyCutoffDate, historyRangeMonths, kindFilter, maxScheduleDate, modeFilter, todayValue]);

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
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status === "open")
      .filter((post) => isRecruitingRoomInUserSchedule(post, app.state, app.currentUser.id))
      .filter((post) => {
        const postDate = getMatchDate(post);
        return postDate && postDate <= maxScheduleDate && shouldIncludeByHistoryRange(post, todayValue, historyRangeMonths, historyCutoffDate);
      })
      .filter((post) => kindFilter === "all" || (kindFilter === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter);
  }, [app.currentUser.id, app.state, app.state.recruitingPosts, historyCutoffDate, historyRangeMonths, kindFilter, maxScheduleDate, modeFilter, todayValue]);
  const getViewIdForDate = (day) => {
    if (visibleRecruitingCandidates.some((post) => getMatchDate(post) === day)) return "scheduled";
    const dayMatches = baseFilteredMatches.filter((match) => getMatchDate(match) === day);
    const preferredView = VIEWS.find((view) => dayMatches.some((match) => shouldShowMatchForView(match, view, app.currentUser.id)));
    return preferredView?.id ?? (day < todayValue ? "history" : "active");
  };

  const matchesByView = useMemo(() => {
    return filteredMatches
      .filter((match) => shouldShowMatchInList(match, selectedView, app.currentUser.id, Boolean(dateFilter)))
      .sort(compareSchedule);
  }, [app.currentUser.id, dateFilter, filteredMatches, selectedView]);

  const visibleRecruitingRooms = useMemo(() => {
    if (!["active", "scheduled"].includes(viewId)) return [];
    return visibleRecruitingCandidates
      .filter((post) => {
        const postDate = getMatchDate(post);
        return !dateFilter || postDate === dateFilter;
      })
      .sort(compareSchedule)
      .slice(0, 12);
  }, [dateFilter, viewId, visibleRecruitingCandidates]);

  const activeRoomCount = visibleRecruitingCandidates.length;
  const filteredActiveRoomCount = visibleRecruitingCandidates.filter((post) => {
    const postDate = getMatchDate(post);
    return !dateFilter || postDate === dateFilter;
  }).length;
  const visibleMatches = matchesByView.slice(0, 60);
  const visibleScheduleItems = useMemo(() => ([
    ...visibleRecruitingRooms.map((post) => ({ type: "room", id: `room-${post.id}`, item: post })),
    ...visibleMatches.map((match) => ({ type: "match", id: `match-${match.id}`, item: match })),
  ].sort((a, b) => compareSchedule(a.item, b.item))), [visibleMatches, visibleRecruitingRooms]);
  const matchPagination = app.matchPagination ?? { loading: false, exhausted: true, error: "" };
  const todoCount = getViewCount(filteredMatches, VIEWS[1], app.currentUser.id);
  const scheduledCount = getViewCount(filteredMatches, VIEWS[2], app.currentUser.id) + filteredActiveRoomCount;
  const closedCount = getViewCount(filteredMatches, VIEWS[3], app.currentUser.id);
  const activeCount = todoCount + scheduledCount + closedCount;
  const viewButtonCounts = {
    todo: getViewCount(baseFilteredMatches, VIEWS[1], app.currentUser.id),
    scheduled: getViewCount(baseFilteredMatches, VIEWS[2], app.currentUser.id) + activeRoomCount,
    closed: getViewCount(baseFilteredMatches, VIEWS[3], app.currentUser.id),
  };
  viewButtonCounts.active = viewButtonCounts.todo + viewButtonCounts.scheduled + viewButtonCounts.closed;
  const getViewButtonCount = (view) => viewButtonCounts[view.id] ?? 0;
  const listRecruitingRoomCount = ["active", "scheduled"].includes(viewId) ? filteredActiveRoomCount : 0;
  const saveTournamentSchedule = (event, tournamentId, matchId) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    app.actions.updateTournamentMatchSchedule(tournamentId, matchId, {
      scheduledDate: form.get("scheduledDate"),
      scheduledTime: form.get("scheduledTime"),
    });
  };

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
            <span><strong>{activeCount}</strong>MY</span>
            <span><strong>{todoCount}</strong>ACTION</span>
            <span><strong>{scheduledCount}</strong>SOON</span>
          </div>
          <Link to="/app/create">
            <Button className="om-match-create"><PlusCircle size={18} /> 경기 만들기</Button>
          </Link>
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
              <b>{getViewButtonCount(view)}</b>
            </button>
          );
        })}
      </section>

      <section className="om-calendar-panel" aria-label="진행 경기 캘린더">
        <div className="om-calendar-summary">
          <span className="om-view-icon"><CalendarDays size={22} /></span>
          <div>
            <span className="om-kicker">SCHEDULE</span>
            <h2>내 진행 일정</h2>
            <p>{dateFilter ? `${formatDateLabel(dateFilter)} 내 경기만 표시` : "내가 들어간 진행 중이거나 예정된 경기를 날짜별로 본다."}</p>
          </div>
          <div className="om-calendar-actions">
            <button type="button" className={!dateFilter ? "active" : ""} onClick={() => setDateFilter("")}>전체</button>
            <button
              type="button"
              className={dateFilter === todayValue ? "active" : ""}
              onClick={() => {
                setDateFilter(todayValue);
                setCalendarMonth(getMonthKey(todayValue));
                setViewId("active");
              }}
            >
              오늘
            </button>
          </div>
          <div className="om-history-range" aria-label="지난 경기 표시 범위">
            <span>지난 경기</span>
            {[0, 1, 3, 6].map((month) => (
              <button
                key={month}
                type="button"
                className={historyRangeMonths === month ? "active" : ""}
                onClick={() => setHistoryRangeMonths(month)}
              >
                {month ? `${month}개월` : "안보기"}
              </button>
            ))}
          </div>
          <section className="om-filter-bar om-calendar-filter-bar" aria-label="경기 필터">
            <div className="segmented-control compact-segments">
              <button type="button" className={kindFilter === "all" ? "active" : ""} onClick={() => setKindFilter("all")}>전체</button>
              <button type="button" className={kindFilter === "ranked" ? "active" : ""} onClick={() => setKindFilter("ranked")}>정규전</button>
              <button type="button" className={kindFilter === "friendly" ? "active" : ""} onClick={() => setKindFilter("friendly")}>친선전</button>
            </div>
            <label>
              <select aria-label="경기 방식" value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
                <option value="all">전체 방식</option>
                {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
              </select>
            </label>
          </section>
        </div>

        <div className="om-calendar-box">
          <div className="om-calendar-toolbar">
            <button type="button" aria-label="이전 달" onClick={() => setCalendarMonth((month) => addMonths(month, -1))}>
              <ChevronLeft size={18} />
            </button>
            <strong>
              {formatMonthLabel(calendarMonth)}
              <span>{calendarMonthCount}경기</span>
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
              const count = calendarCounts.get(day) ?? 0;
              const selected = day && day === dateFilter;
              const isToday = day && day === todayValue;
              return day ? (
                <button
                  key={day}
                  type="button"
                  className={`${selected ? "active" : ""} ${isToday ? "today" : ""}`}
                  onClick={() => {
                    setDateFilter(day);
                    setViewId(getViewIdForDate(day));
                  }}
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

      {activeTournaments.length ? (
        <section className={tournamentPanelOpen ? "om-tournament-panel" : "om-tournament-panel collapsed"} aria-label="비공개 대회">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">PRIVATE EVENT</span>
              <h2>비공개 대회</h2>
            </div>
            <div className="om-tournament-head-actions">
              <span>{activeTournaments.length}개</span>
              <button type="button" onClick={() => setTournamentPanelOpen((current) => !current)}>
                {tournamentPanelOpen ? "접기" : "펼치기"}
              </button>
            </div>
          </div>
          <div className={tournamentPanelOpen ? "om-tournament-grid" : "om-tournament-grid compact"}>
            {activeTournaments.map((tournament) => {
              const tournamentMatches = getTournamentMatches(tournament, matchesById, app.state.matches);
              const teamRows = getTournamentTeamRows(tournament, teamById, userById, app.currentUser.id);
              const acceptedCount = teamRows.filter((row) => row.status === "accepted").length;
              const pendingRows = teamRows.filter((row) => row.status !== "accepted");
              return (
                <article key={tournament.id} className="om-tournament-card">
                  <div>
                    <span className="om-kicker">{tournamentFormatLabels[tournament.format] ?? tournament.format}</span>
                    <h3>{tournament.title}</h3>
                    <p><CalendarDays size={15} />{formatTournamentWindow(tournament)} · {tournament.court}</p>
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
                    <button type="button" onClick={() => setSelectedTournamentId(tournament.id)}>자세히</button>
                    <Link className="button button-secondary button-md om-tournament-detail-link" to={`/app/tournaments/${tournament.id}`}>
                      대진표
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {selectedTournament ? (() => {
        const tournamentMatches = getTournamentMatches(selectedTournament, matchesById, app.state.matches);
        const teamRows = getTournamentTeamRows(selectedTournament, teamById, userById, app.currentUser.id);
        const pendingRows = teamRows.filter((row) => row.status !== "accepted");
        const acceptedCount = teamRows.length - pendingRows.length;
        const pairingPreview = getTournamentPairingPreview(selectedTournament);
        const canManageSchedule = selectedTournament.createdBy === app.currentUser.id;
        return (
          <div className="om-tournament-modal-backdrop" role="presentation" onMouseDown={() => setSelectedTournamentId(null)}>
            <aside className="om-tournament-modal" role="dialog" aria-modal="true" aria-label="대회 상세" onMouseDown={(event) => event.stopPropagation()}>
              <div className="om-tournament-modal-head">
                <div>
                  <span className="om-kicker">{tournamentFormatLabels[selectedTournament.format] ?? selectedTournament.format}</span>
                  <h2>{selectedTournament.title}</h2>
                  <p>{formatTournamentWindow(selectedTournament)} · {selectedTournament.court}</p>
                </div>
                <button type="button" aria-label="닫기" onClick={() => setSelectedTournamentId(null)}><X size={20} /></button>
              </div>

              <div className="om-tournament-meta">
                <span>{selectedTournament.mode}</span>
                <span>{selectedTournament.ranked === false ? "친선" : "정규"}</span>
                <span>{tournamentMmrLabels[selectedTournament.mmrPolicy] ?? selectedTournament.mmrPolicy}</span>
                <strong>{acceptedCount}/{teamRows.length} 승인</strong>
                <strong>{tournamentMatches.length}경기</strong>
              </div>

              <section className="om-tournament-modal-section">
                <div className="om-modal-section-head">
                  <strong>승인 대기</strong>
                  <span>{pendingRows.length ? `${pendingRows.length}팀 남음` : "완료"}</span>
                </div>
                {pendingRows.length ? (
                  <div className="om-tournament-teams">
                    {pendingRows.map((row) => (
                      <div key={row.teamId}>
                        <span>
                          <TeamHoverCard team={row.team}><strong>{row.team.name}</strong></TeamHoverCard>
                          <em>{row.team.mmr} MMR · 주장 {row.captainName}</em>
                        </span>
                        {row.canApprove ? (
                          <button type="button" onClick={() => app.actions.approveTournamentTeam(selectedTournament.id, row.teamId)}>승인</button>
                        ) : (
                          <b>초대</b>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="om-tournament-wait">참가팀 승인 완료. 승인 완료팀 목록은 접었다.</p>
                )}
              </section>

              {pairingPreview.length ? (
                <section className="om-tournament-modal-section">
                  <div className="om-modal-section-head">
                    <strong>{selectedTournament.format === "tournament" ? "첫 라운드" : "리그 경기"}</strong>
                    <Link to={`/app/tournaments/${selectedTournament.id}`}>전체 대진표</Link>
                  </div>
                  <div className="om-tournament-pairings">
                    {pairingPreview.slice(0, 6).map((pairing) => (
                      <span key={pairing.matchId ?? `${pairing.round}-${pairing.fixture}`}>
                        <TeamHoverCard team={teamById[pairing.teamAId]}>{teamById[pairing.teamAId]?.name ?? "TBD"}</TeamHoverCard>
                        {" vs "}
                        <TeamHoverCard team={teamById[pairing.teamBId]}>{teamById[pairing.teamBId]?.name ?? "TBD"}</TeamHoverCard>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="om-tournament-modal-section">
                <div className="om-modal-section-head">
                  <strong>경기 일정</strong>
                  <span>{canManageSchedule ? "생성자 수정 가능" : "생성자만 수정"}</span>
                </div>
                {tournamentMatches.length ? (
                  <div className="om-tournament-fixtures">
                    {tournamentMatches.map((match) => (
                      <form key={match.id} className={canManageSchedule ? "om-tournament-fixture-row" : "om-tournament-fixture-row locked"} onSubmit={(event) => saveTournamentSchedule(event, selectedTournament.id, match.id)}>
                        <Link to={`/app/matches?match=${match.id}`}>
                          <TeamHoverCard team={teamById[match.teamA.teamId]} as="span">{match.teamA.name}</TeamHoverCard>
                          {" vs "}
                          <TeamHoverCard team={teamById[match.teamB.teamId]} as="span">{match.teamB.name}</TeamHoverCard>
                        </Link>
                        <input type="date" name="scheduledDate" min={todayValue} max={maxScheduleDate} defaultValue={match.scheduledDate ?? ""} disabled={!canManageSchedule} aria-label="경기 날짜" />
                        <input type="time" name="scheduledTime" defaultValue={match.scheduledTime ?? ""} disabled={!canManageSchedule} aria-label="경기 시간" />
                        <button type="submit" disabled={!canManageSchedule}>저장</button>
                      </form>
                    ))}
                  </div>
                ) : (
                  <p className="om-tournament-wait">승인 완료 전. 대진과 경기 생성 대기.</p>
                )}
              </section>
            </aside>
          </div>
        );
      })() : null}

      {selectedMatch && selectedMatchRoomError ? (
        <RoomModalErrorView error={selectedMatchRoomError} onClose={closeSelectedMatch} />
      ) : null}

      {selectedMatch && selectedMatchRoomPost ? (
        <RoomModalErrorBoundary key={selectedMatch.id} onClose={closeSelectedMatch}>
          <RecruitingRoomModal
            app={app}
            post={selectedMatchRoomPost}
            sourceMatch={selectedMatch}
            onClose={closeSelectedMatch}
          />
        </RoomModalErrorBoundary>
      ) : null}

      {selectedRecruitingPost && selectedRecruitingLobby ? (
        <RecruitingRoomModal
          app={app}
          post={selectedRecruitingPost}
          onClose={() => setSelectedRecruitingPostId(null)}
          onOpenMatch={openSelectedMatch}
        />
      ) : null}

      <section className="om-match-list" aria-label="경기 목록">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">{selectedView.code}</span>
            <h2>{dateFilter ? `${selectedView.title} · ${formatDateLabel(dateFilter)}` : selectedView.title}</h2>
          </div>
          <span>내 일정 {matchesByView.length + listRecruitingRoomCount}개 중 {visibleScheduleItems.length}개 표시</span>
        </div>

        {visibleScheduleItems.length ? (
          <>
        {visibleScheduleItems.map(({ type, item }) => {
          if (type === "room") {
            const post = item;
            const lobby = getRecruitingLobby(post, app.state);
            const myEntry = getRecruitingEntryForUser(lobby, app.currentUser.id);
            const mine = getRecruitingRoomOwnerId(post) === app.currentUser.id;
            const needConfirm = !mine && post.visibility !== "public" && myEntry && myEntry.status !== "ready";
            const roomStatus = getRecruitingRoomListStatus(lobby, { post, myEntry, mine });
            const filled = lobby.sides.teamA.projectedFilled + lobby.sides.teamB.projectedFilled;
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
                  left={`A ${lobby.sides.teamA.projectedFilled}/${lobby.sides.teamA.capacity}`}
                  center={`${filled}/${capacity}`}
                  right={`B ${lobby.sides.teamB.projectedFilled}/${lobby.sides.teamB.capacity}`}
                  detail={formatMatchRules(post)}
                  variant="count-summary"
                />
                <button type="button" className="button button-secondary button-md om-room-link" onClick={() => setSelectedRecruitingPostId(post.id)}>
                  {needConfirm ? "확인하기" : roomStatus.actionLabel}
                </button>
              </article>
            );
          }
          const match = item;
          const status = getMatchProcessMeta(match);
          const showScoreBox = shouldShowScoreBox(match);
          const scoreA = match.teamA.score ?? match.result?.scoreA ?? 0;
          const scoreB = match.teamB.score ?? match.result?.scoreB ?? 0;
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
                  <TeamHoverCard team={teamById[match.teamA.teamId]} to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</TeamHoverCard>
                  <strong>{scoreA} : {scoreB}</strong>
                  <TeamHoverCard team={teamById[match.teamB.teamId]} to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</TeamHoverCard>
                  {winner ? <span>{winner} 우세</span> : null}
                </div>
              ) : (
                <MatchListSummary
                  left={match.teamA.name}
                  right={match.teamB.name}
                  leftTeam={teamById[match.teamA.teamId]}
                  rightTeam={teamById[match.teamB.teamId]}
                  meta={`참여 ${getMatchPlayerCount(match)}명 · A ${match.teamA.players?.length ?? 0} / B ${match.teamB.players?.length ?? 0}`}
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
        {!matchPagination.exhausted ? (
          <div className="om-load-more">
            <button type="button" className="button button-secondary button-md" disabled={matchPagination.loading} onClick={() => app.actions.loadMoreMatches?.()}>
              {matchPagination.loading ? "불러오는 중" : "더 보기"}
            </button>
            {matchPagination.error ? <span>추가 경기 로드 실패</span> : null}
          </div>
        ) : null}
          </>
        ) : (
          <div className="om-empty-state">
            <strong>해당 큐 없음</strong>
            <p>다른 상태를 선택하거나 새 경기를 만든다.</p>
          </div>
        )}
      </section>
    </div>
  );
}
