import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Flag, MapPin, Save, ShieldCheck, Trophy, UserRound } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { getTeamCaptainMemberId as getTeamCaptainId } from "../data/teamMappers.js";
import { getRegisteredCourts } from "../lib/courts.js";
import { getUserHashtag } from "../lib/handles.js";
import { addDateDays, getLocalDateInputValue, getMatchRoomPhase, getTournamentScheduleEditPolicy, isEligibleReferee } from "../lib/matchUtils.js";
import { REFEREE_TRUST_MIN } from "../lib/constants.js";
import {
  TOURNAMENT_SANCTION_STATUS,
  getActiveTournamentTeamIds,
  getAcceptedTournamentRefereeIds,
  getRequiredTournamentRefereeCount,
  getTournamentRefereeStatus,
  getTournamentSanctionLabel,
  isTournamentGovernanceEnabled,
  isTournamentRefereeNeutral,
} from "../lib/tournamentGovernance.js";
import { MatchRoomModal } from "./Matches.jsx";
import "../styles/matches-arena.css";

const formatLabels = {
  league: "리그",
  tournament: "토너먼트",
};

const statusLabels = {
  draft: "팀장 승인 대기",
  active: "진행 중",
  scheduled: "예정",
  closed: "종료",
  cancelled: "취소",
};

const mmrPolicyLabels = {
  gap_adjusted: "격차 보정",
  standard: "일반 MMR",
  event_only: "대회 점수만",
};

function getTournamentTeamStatus(tournament, teamId) {
  return tournament.teamStatuses?.[teamId] ?? "invited";
}

function formatWindow(tournament) {
  return [tournament.startDate, tournament.endDate].filter(Boolean).join(" ~ ") || "일정 미정";
}

function getMatchTime(match) {
  return [match.scheduledDate, match.scheduledTime].filter(Boolean).join(" ") || match.scheduledAt || "일정 미정";
}

function isTournamentForfeitAvailable(match) {
  if (!match || ["confirmed", "cancelled", "void", "voided", "closed"].includes(match.status) || match.startedAt || match.endedAt || match.result) return false;
  if (!match.scheduledDate || !match.scheduledTime) return false;
  const scheduledAt = new Date(`${match.scheduledDate}T${String(match.scheduledTime).slice(0, 5)}:00+09:00`).getTime();
  return Number.isFinite(scheduledAt) && scheduledAt <= Date.now();
}

function isTournamentScheduleEditable(match) {
  return getTournamentScheduleEditPolicy(match).allowed;
}

function getTournamentSchedulePolicyLabel(match) {
  const policy = getTournamentScheduleEditPolicy(match);
  if (policy.allowed) return policy.hasSchedule ? "수정 1회 가능" : "일정 설정 가능";
  if (policy.reason === "lineup_submitted") return "출전 명단 제출 후 잠금";
  if (policy.reason === "revision_limit") return "일정 수정 1회 사용";
  return "일정 잠금";
}

function getTournamentSchedulePolicyMessage(match) {
  const policy = getTournamentScheduleEditPolicy(match);
  if (policy.reason === "lineup_submitted") return "한 팀이라도 출전 명단을 제출한 뒤에는 경기 일정을 변경할 수 없습니다.";
  if (policy.reason === "revision_limit") return "경기 일정은 최초 지정 후 한 번만 변경할 수 있습니다.";
  return "이미 시작·종료·취소·무효 처리된 경기의 일정은 변경할 수 없습니다.";
}

function getTournamentMatches(tournament, matchesById, matches = []) {
  const fromIds = (tournament.matchIds ?? []).map((matchId) => matchesById[matchId]).filter(Boolean);
  const tournamentMatches = matches.filter((match) => match.tournamentId === tournament.id);
  const source = [...new Map([...fromIds, ...tournamentMatches].map((match) => [match.id, match])).values()];
  return [...source].sort((a, b) => (a.tournamentRound ?? 0) - (b.tournamentRound ?? 0) || (a.tournamentFixture ?? 0) - (b.tournamentFixture ?? 0));
}

function getMatchFinalScore(match) {
  const losingSide = match?.rules?.forfeit?.losingSide || match?.forfeitSide || "";
  if (losingSide === "teamA") return { scoreA: 0, scoreB: 1 };
  if (losingSide === "teamB") return { scoreA: 1, scoreB: 0 };

  const scoreA = Number(match?.result?.scoreA ?? match?.scoreA ?? match?.score_a ?? match?.teamA?.score);
  const scoreB = Number(match?.result?.scoreB ?? match?.scoreB ?? match?.score_b ?? match?.teamB?.score);
  return Number.isFinite(scoreA) && Number.isFinite(scoreB) ? { scoreA, scoreB } : null;
}

function getWinnerName(match) {
  const winnerTeamId = getMatchWinnerTeamId(match);
  if (!winnerTeamId) return "";
  return winnerTeamId === match.teamA?.teamId ? match.teamA?.name ?? "A" : match.teamB?.name ?? "B";
}

function getMatchWinnerTeamId(match) {
  const hasForfeit = Boolean(match?.rules?.forfeit?.losingSide || match?.forfeitSide);
  const hasFinalState = ["confirmed", "closed"].includes(match?.status) || Boolean(match?.confirmedAt);
  const hasStoredScore = match?.scoreA != null || match?.scoreB != null || match?.score_a != null || match?.score_b != null;
  if (!match || (!match.result && !hasForfeit && !hasFinalState && !hasStoredScore)) return "";
  const score = getMatchFinalScore(match);
  if (!score) return "";
  const { scoreA, scoreB } = score;
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA?.teamId ?? match.teamAId ?? "" : match.teamB?.teamId ?? match.teamBId ?? "";
}

function getLeagueMatchResult(match) {
  const hasForfeit = Boolean(match?.rules?.forfeit?.losingSide || match?.forfeitSide);
  const hasFinalState = ["confirmed", "closed"].includes(match?.status) || Boolean(match?.confirmedAt);
  if (!match || (!match.result && !hasForfeit && !hasFinalState)) return null;
  const score = getMatchFinalScore(match);
  const teamAId = match.teamA?.teamId ?? match.teamAId ?? "";
  const teamBId = match.teamB?.teamId ?? match.teamBId ?? "";
  if (!teamAId || !teamBId || !score) return null;
  return { teamAId, teamBId, ...score };
}

function getLeagueFixtureState(match, matchId = "") {
  if (!match) return matchId
    ? { label: "경기 불러오기", tone: "blue" }
    : { label: "경기 생성 전", tone: "neutral" };

  const phase = getMatchRoomPhase(match);
  const labels = {
    waiting: match.scheduledDate || match.scheduledAt ? "일정 확정" : "일정 대기",
    locked: "경기 예정",
    checkin: "경기 준비",
    live: "경기 중",
    postgame: "결과 입력",
    dispute: "결과 확인",
    record: "결과 확정",
    cancelled: "취소",
    void: "무효",
  };
  return { label: labels[phase.phase] ?? phase.listLabel, tone: phase.tone };
}

function getLeagueStandings(teamRows, matches) {
  const table = new Map(teamRows.map(({ team, teamId }) => [teamId, {
    team,
    teamId,
    played: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  }]));

  matches.forEach((match) => {
    const result = getLeagueMatchResult(match);
    if (!result) return;
    const teamA = table.get(result.teamAId);
    const teamB = table.get(result.teamBId);
    if (!teamA || !teamB) return;
    teamA.played += 1;
    teamB.played += 1;
    teamA.pointsFor += result.scoreA;
    teamA.pointsAgainst += result.scoreB;
    teamB.pointsFor += result.scoreB;
    teamB.pointsAgainst += result.scoreA;
    if (result.scoreA > result.scoreB) {
      teamA.wins += 1;
      teamB.losses += 1;
    } else if (result.scoreB > result.scoreA) {
      teamB.wins += 1;
      teamA.losses += 1;
    }
  });

  return [...table.values()]
    .map((row) => ({ ...row, pointDiff: row.pointsFor - row.pointsAgainst }))
    .sort((a, b) => (
      b.wins - a.wins ||
      b.pointDiff - a.pointDiff ||
      b.pointsFor - a.pointsFor ||
      a.team.name.localeCompare(b.team.name, "ko")
    ));
}

function getBracketRoundName(roundIndex, totalRounds) {
  const entrantCount = 2 ** (totalRounds - roundIndex);
  if (entrantCount === 2) return "결승";
  if (entrantCount === 4) return "준결승";
  return `${entrantCount}강`;
}

function findPairingForFirstRound(row, pairings = []) {
  return pairings.find((pairing) => (
    (pairing.bracketMatch ?? pairing.fixture) === row.fixture ||
    (pairing.teamAId === row.teamAId && pairing.teamBId === row.teamBId)
  ));
}

function getFallbackFirstRoundRows(tournament, bracketRound = {}) {
  const bracket = tournament.bracket ?? {};
  if (Array.isArray(bracket.firstRound) && bracket.firstRound.length) return bracket.firstRound;
  if (Array.isArray(bracket.slots) && bracket.slots.length) {
    const rows = [];
    for (let index = 0; index < bracket.slots.length; index += 2) {
      const teamAId = bracket.slots[index] ?? null;
      const teamBId = bracket.slots[index + 1] ?? null;
      rows.push({
        id: `r1-${rows.length + 1}`,
        round: 1,
        fixture: rows.length + 1,
        teamAId,
        teamBId,
        byeTeamId: teamAId && !teamBId ? teamAId : null,
      });
    }
    return rows;
  }

  return [
    ...(bracketRound.pairings ?? []).map((pairing, index) => ({
      id: `r1-${pairing.bracketMatch ?? pairing.fixture ?? index + 1}`,
      round: 1,
      fixture: pairing.bracketMatch ?? pairing.fixture ?? index + 1,
      teamAId: pairing.teamAId,
      teamBId: pairing.teamBId,
      byeTeamId: null,
    })),
    ...(bracketRound.byes ?? []).map((teamId, index) => ({
      id: `r1-bye-${teamId}`,
      round: 1,
      fixture: (bracketRound.pairings?.length ?? 0) + index + 1,
      teamAId: teamId,
      teamBId: null,
      byeTeamId: teamId,
    })),
  ];
}

function getNodeWinnerTeamId(node) {
  if (!node) return "";
  if (node.winnerTeamId) return node.winnerTeamId;
  if (node.byeTeamId) return node.byeTeamId;
  if (node.match) return getMatchWinnerTeamId(node.match);
  return "";
}

function makeBracketSourceFromNode(node) {
  const winnerTeamId = getNodeWinnerTeamId(node);
  return {
    type: "advance",
    node,
    teamId: winnerTeamId || null,
  };
}

function buildTournamentBracketTree(tournament, matchesById) {
  const bracket = tournament.bracket ?? {};
  const bracketRound = bracket.rounds?.[0] ?? {};
  const firstRoundRows = getFallbackFirstRoundRows(tournament, bracketRound);
  const firstRoundPairings = bracketRound.pairings ?? [];
  const bracketSize = bracket.bracketSize ?? Math.max(2, firstRoundRows.length * 2);
  const totalRounds = Math.max(1, Math.ceil(Math.log2(bracketSize)));
  const firstRoundName = getBracketRoundName(0, totalRounds);
  const firstRoundNodes = firstRoundRows.map((row, index) => {
    const pairing = findPairingForFirstRound(row, firstRoundPairings);
    const match = pairing?.matchId ? matchesById[pairing.matchId] : null;
    const fixture = row.fixture ?? pairing?.fixture ?? index + 1;
    const byeTeamId = row.byeTeamId ?? (row.teamAId && !row.teamBId ? row.teamAId : null);
    return {
      id: row.id ?? `round-1-${fixture}`,
      roundIndex: 0,
      fixture,
      name: `${firstRoundName} ${fixture}경기`,
      sourceA: match?.teamA?.teamId || row.teamAId ? { type: "team", teamId: match?.teamA?.teamId || row.teamAId } : { type: "empty" },
      sourceB: match?.teamB?.teamId || row.teamBId ? { type: "team", teamId: match?.teamB?.teamId || row.teamBId } : { type: "bye" },
      match,
      byeTeamId,
      winnerTeamId: byeTeamId || getMatchWinnerTeamId(match),
    };
  });
  const rounds = [{ id: "round-1", name: firstRoundName, nodes: firstRoundNodes }];
  let currentNodes = firstRoundNodes;

  for (let roundIndex = 1; currentNodes.length > 1; roundIndex += 1) {
    const roundName = getBracketRoundName(roundIndex, totalRounds);
    const savedRound = bracket.rounds?.[roundIndex] ?? {};
    const savedPairings = savedRound.pairings ?? [];
    const nodes = [];
    for (let index = 0; index < currentNodes.length; index += 2) {
      const left = currentNodes[index];
      const right = currentNodes[index + 1];
      const fixture = nodes.length + 1;
      const pairing = savedPairings.find((item) => Number(item.fixture ?? 0) === fixture);
      const match = pairing?.matchId ? matchesById[pairing.matchId] : null;
      nodes.push({
        id: `round-${roundIndex + 1}-${fixture}`,
        roundIndex,
        fixture,
        name: `${roundName} ${fixture}경기`,
        sourceA: makeBracketSourceFromNode(left),
        sourceB: right ? makeBracketSourceFromNode(right) : { type: "bye" },
        match,
        byeTeamId: null,
        winnerTeamId: getMatchWinnerTeamId(match),
      });
    }
    rounds.push({ id: `round-${roundIndex + 1}`, name: roundName, nodes });
    currentNodes = nodes;
  }

  return rounds;
}

function getBracketSourceInfo(source, teamById) {
  if (!source || source.type === "empty") return { label: "빈 슬롯", detail: "부전승", team: null, state: "empty" };
  if (source.type === "bye") return { label: "BYE", detail: "부전승 슬롯", team: null, state: "bye" };
  const team = source.teamId ? teamById[source.teamId] : null;
  if (team) {
    return {
      label: team.name,
      detail: source.type === "advance" ? `${source.node.name} 승자` : "참가팀",
      team,
      state: "ready",
    };
  }
  if (source.type === "advance") {
    return { label: `${source.node.name} 승자`, detail: "결과 대기", team: null, state: "pending" };
  }
  return { label: "TBD", detail: "대기", team: null, state: "pending" };
}

function getBracketNodeStatus(node, teamById) {
  if (node.byeTeamId) return `${teamById[node.byeTeamId]?.name ?? "팀"} 부전승 진출`;
  if (node.match) {
    const winner = getWinnerName(node.match);
    return winner ? `${winner} 승` : getMatchTime(node.match);
  }
  const sourceA = getBracketSourceInfo(node.sourceA, teamById);
  const sourceB = getBracketSourceInfo(node.sourceB, teamById);
  if (sourceA.team && sourceB.team) return "대진 확정 · 경기 생성 대기";
  return "승자 결정 후 대진 확정";
}

function renderBracketSource(source, teamById) {
  const info = getBracketSourceInfo(source, teamById);
  return (
    <div className={`bracket-team-row ${info.state}`}>
      {info.team
        ? <TeamEmblem team={info.team} size="xs" />
        : <span className="bracket-team-emblem placeholder" aria-hidden="true">{info.state === "bye" ? "B" : "?"}</span>}
      <span className="bracket-slot-copy">
        <strong>
          {info.team ? <TeamHoverCard team={info.team} as="span">{info.team.name}</TeamHoverCard> : info.label}
        </strong>
        <em>{info.detail}</em>
      </span>
      {info.team ? <TierBadge mmr={info.team.mmr} compact /> : <span className="bracket-tbd-pill">{info.state === "bye" ? "BYE" : "TBD"}</span>}
    </div>
  );
}

function getVerticalBracketLayout(bracketTree = []) {
  const finalRound = bracketTree[bracketTree.length - 1] ?? null;
  const baseSlots = Math.max(1, bracketTree[0]?.nodes?.length ?? 1);
  const rounds = [...bracketTree].reverse().map((round) => {
    const span = Math.max(1, Math.floor(baseSlots / Math.max(1, round.nodes.length)));
    return {
      ...round,
      span,
      nodes: round.nodes.map((node, index) => ({
        node,
        gridColumn: `${index * span + 1} / span ${span}`,
      })),
    };
  });

  return {
    baseSlots,
    rounds,
    finalNode: finalRound?.nodes?.[0] ?? bracketTree[0]?.nodes?.[0] ?? null,
  };
}

function renderBracketNode(node, teamById, onOpenMatch) {
  if (!node) return null;
  const winner = node.match ? getWinnerName(node.match) : "";
  return (
    <article key={node.id} className={winner || node.byeTeamId ? "bracket-match-card done" : "bracket-match-card"}>
      <div className="bracket-node-head">
        <span>{node.name}</span>
        {node.match ? <button type="button" onClick={() => onOpenMatch?.(node.match.id)}>방 보기</button> : <b>{node.byeTeamId ? "BYE" : "예정"}</b>}
      </div>
      {renderBracketSource(node.sourceA, teamById)}
      <strong className="bracket-midline">vs</strong>
      {renderBracketSource(node.sourceB, teamById)}
      <em className="bracket-status">{getBracketNodeStatus(node, teamById)}</em>
      <span className="bracket-connector" aria-hidden="true" />
    </article>
  );
}

export default function TournamentDetail({ app }) {
  const location = useLocation();
  const { tournamentId } = useParams();
  const tournament = (app.state.tournaments ?? []).find((item) => item.id === tournamentId);
  const requestedTournamentIdRef = useRef("");
  const [tournamentMissing, setTournamentMissing] = useState(false);
  const [scheduleDialog, setScheduleDialog] = useState(null);
  const [savingScheduleId, setSavingScheduleId] = useState("");
  const [forfeitDialog, setForfeitDialog] = useState(null);
  const [savingForfeitId, setSavingForfeitId] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const [refereeQuery, setRefereeQuery] = useState("");
  const [governanceAction, setGovernanceAction] = useState("");
  const [governanceFeedback, setGovernanceFeedback] = useState("");
  useBodyScrollLock(Boolean(scheduleDialog || forfeitDialog));
  const teamById = Object.fromEntries(app.state.teams.map((team) => [team.id, team]));
  const userById = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const matchesById = Object.fromEntries(app.state.matches.map((match) => [match.id, match]));

  useEffect(() => {
    if (!tournamentId || app.remoteReady === false || requestedTournamentIdRef.current === tournamentId) return;
    setTournamentMissing(false);
    requestedTournamentIdRef.current = tournamentId;
    Promise.resolve(app.actions.loadTournament?.(tournamentId)).then((count) => {
      if (!count) setTournamentMissing(true);
    }).catch(() => {
      setTournamentMissing(true);
    });
  }, [app.actions, app.remoteReady, tournamentId, tournamentMissing]);

  if (!tournament && !tournamentMissing) {
    return <BasketballLoader overlay label="대회 불러오는 중" />;
  }

  if (!tournament) {
    return (
      <div className="page-stack tournament-detail-page">
        <Button as={Link} variant="secondary" className="tournament-back-link" to="/app/matches"><ChevronLeft size={17} /> 경기로</Button>
        <section className="tournament-empty">
          <strong>대회 없음</strong>
          <p>삭제되었거나 아직 불러오지 못한 대회입니다.</p>
          <Button type="button" variant="secondary" onClick={() => {
            requestedTournamentIdRef.current = "";
            setTournamentMissing(false);
          }}>다시 시도</Button>
        </section>
      </div>
    );
  }

  const tournamentMatches = getTournamentMatches(tournament, matchesById, app.state.matches);
  const representativeTeamId = app.state.settings?.representativeTeamId ?? app.currentUser.representativeTeamId ?? "";
  const representativeTeam = teamById[representativeTeamId] ?? null;
  const teamRows = (tournament.teamIds ?? [])
    .map((teamId) => {
      const team = teamById[teamId];
      const captainId = getTeamCaptainId(team);
      return {
        team,
        teamId,
        captainId,
        captainName: userById[captainId]?.name ?? "주장 미지정",
        status: getTournamentTeamStatus(tournament, teamId),
        canApprove: tournament.status === "draft"
          && captainId === app.currentUser.id
          && representativeTeam?.id === teamId
          && getTournamentTeamStatus(tournament, teamId) !== "accepted",
        needsRepresentativeTeam: tournament.status === "draft"
          && captainId === app.currentUser.id
          && representativeTeam?.id !== teamId
          && getTournamentTeamStatus(tournament, teamId) !== "accepted",
      };
    })
    .filter((row) => row.team);
  const acceptedCount = teamRows.filter((row) => row.status === "accepted").length;
  const hasPendingTeamApprovals = (tournament.teamIds ?? [])
    .some((teamId) => getTournamentTeamStatus(tournament, teamId) !== "accepted");
  const governanceEnabled = isTournamentGovernanceEnabled(tournament);
  const requiredRefereeCount = getRequiredTournamentRefereeCount(getActiveTournamentTeamIds(tournament).length);
  const acceptedRefereeIds = getAcceptedTournamentRefereeIds(tournament);
  const refereeRows = (tournament.refereeIds ?? []).map((refereeId) => ({
    refereeId,
    referee: userById[refereeId] ?? (refereeId === app.currentUser.id ? app.currentUser : null),
    status: getTournamentRefereeStatus(tournament, refereeId),
    canApprove: governanceEnabled
      && ["draft", "active"].includes(tournament.status)
      && refereeId === app.currentUser.id
      && getTournamentRefereeStatus(tournament, refereeId) === "invited",
  }));
  const eligibleRefereeCandidates = (app.state.users ?? [])
    .filter((user) => isEligibleReferee(
      user,
      REFEREE_TRUST_MIN,
      app.state.settings?.refereeAppointments,
      tournament.endDate,
    ))
    .filter((user) => !(tournament.refereeIds ?? []).includes(user.id))
    .sort((left, right) => Number(right.trustScore ?? 0) - Number(left.trustScore ?? 0));
  const canInviteReferee = governanceEnabled
    && tournament.createdBy === app.currentUser.id
    && ["draft", "active"].includes(tournament.status);
  const canReviewRegion = governanceEnabled
    && Boolean(tournament.viewerCanReviewRegion)
    && tournament.status === "draft"
    && [TOURNAMENT_SANCTION_STATUS.regionalPending, TOURNAMENT_SANCTION_STATUS.regionalRejected].includes(tournament.sanctionStatus);
  const canStartCommunity = governanceEnabled
    && tournament.createdBy === app.currentUser.id
    && tournament.status === "draft"
    && [TOURNAMENT_SANCTION_STATUS.regionalPending, TOURNAMENT_SANCTION_STATUS.regionalRejected].includes(tournament.sanctionStatus);
  const bracketTree = tournament.format === "tournament" ? buildTournamentBracketTree(tournament, matchesById) : [];
  const verticalBracket = tournament.format === "tournament" ? getVerticalBracketLayout(bracketTree) : { baseSlots: 1, rounds: [], finalNode: null };
  const championTeamId = verticalBracket.finalNode ? getNodeWinnerTeamId(verticalBracket.finalNode) : "";
  const championTeam = championTeamId ? teamById[championTeamId] : null;
  const canManageSchedule = tournament.createdBy === app.currentUser.id;
  const todayValue = getLocalDateInputValue();
  const maxScheduleDate = addDateDays(todayValue, 365);
  const leagueFixtures = tournament.bracket?.fixtures ?? tournamentMatches.map((match) => ({
    matchId: match.id,
    round: match.tournamentRound,
    fixture: match.tournamentFixture,
    teamAId: match.teamA?.teamId ?? "",
    teamBId: match.teamB?.teamId ?? "",
  }));
  const leagueMatchesByFixture = new Map(tournamentMatches.map((match) => [Number(match.tournamentFixture), match]));
  const leagueStandings = tournament.format === "league" ? getLeagueStandings(teamRows, tournamentMatches) : [];
  const registeredCourts = getRegisteredCourts(app.state);
  const allowedCourtIds = new Set([
    tournament.courtId,
    ...(tournament.rules?.allowedCourtIds ?? []),
  ].filter(Boolean));
  const allowedCourtSnapshots = tournament.rules?.allowedCourts ?? [];
  const tournamentCourts = registeredCourts.filter((court) => allowedCourtIds.has(court.id));
  allowedCourtSnapshots.forEach((snapshot) => {
    if (snapshot?.id && allowedCourtIds.has(snapshot.id) && !tournamentCourts.some((court) => court.id === snapshot.id)) tournamentCourts.push(snapshot);
  });
  if (!tournamentCourts.length && tournament.courtId) {
    tournamentCourts.push({ id: tournament.courtId, name: tournament.court, region: tournament.region });
  }

  const saveSchedule = (event, matchId) => {
    event.preventDefault();
    if (!canManageSchedule) return;
    if (!isTournamentScheduleEditable(matchesById[matchId])) {
      setScheduleDialog({ mode: "notice", matchId, message: getTournamentSchedulePolicyMessage(matchesById[matchId]) });
      return;
    }
    const form = new FormData(event.currentTarget);
    const scheduledDate = String(form.get("scheduledDate") ?? "");
    const scheduledTime = String(form.get("scheduledTime") ?? "");
    const courtId = String(form.get("courtId") ?? "");
    const court = tournamentCourts.find((item) => item.id === courtId);
    if (!scheduledDate || !scheduledTime || !court) {
      setScheduleDialog({ mode: "notice", matchId, message: "경기 날짜, 시간, 구장을 모두 선택해야 합니다." });
      return;
    }
    setScheduleDialog({ mode: "confirm", matchId, scheduledDate, scheduledTime, courtId, courtName: court.name });
  };
  const formatScheduleError = (message = "") => {
    if (message.includes("tournament_schedule_lineup_submitted")) return "한 팀이라도 출전 명단을 제출한 뒤에는 경기 일정을 변경할 수 없습니다.";
    if (message.includes("tournament_schedule_revision_limit")) return "경기 일정은 최초 지정 후 한 번만 변경할 수 있습니다.";
    if (message.includes("tournament_match_schedule_locked")) return "이미 시작·종료·취소·무효 처리된 경기는 일정을 바꿀 수 없습니다.";
    if (message.includes("invalid_tournament_match_schedule")) return "오늘부터 365일 안의 날짜와 시간을 입력해야 합니다.";
    if (message.includes("tournament_owner_required")) return "대회 생성자만 경기 일정을 저장할 수 있습니다.";
    if (message.includes("tournament_court_not_allowed") || message.includes("tournament_court_not_active")) return "대회 사용 구장으로 등록된 승인 구장만 선택할 수 있습니다.";
    return "일정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
  const confirmSchedule = async () => {
    if (scheduleDialog?.mode !== "confirm" || savingScheduleId) return;
    const { matchId, scheduledDate, scheduledTime, courtId, courtName } = scheduleDialog;
    setSavingScheduleId(matchId);
    try {
      const result = await app.actions.updateTournamentMatchSchedule(tournament.id, matchId, { scheduledDate, scheduledTime, courtId, courtName });
      if (!result || result?.ok === false) throw new Error(result?.error ?? "schedule_save_failed");
      setEditingScheduleId("");
      setScheduleDialog({ mode: "success", matchId, scheduledDate, scheduledTime });
    } catch (error) {
      setScheduleDialog({ mode: "error", message: formatScheduleError(error.message) });
    } finally {
      setSavingScheduleId("");
    }
  };
  const formatForfeitError = (message = "") => {
    if (message.includes("tournament_owner_required")) return "대회 개최자만 몰수패를 확정할 수 있습니다.";
    if (message.includes("tournament_match_schedule_required")) return "경기 일정을 먼저 확정해야 합니다.";
    if (message.includes("tournament_match_forfeit_before_start")) return "경기 시작 시각 이후에만 불참을 확정할 수 있습니다.";
    if (message.includes("tournament_match_forfeit_locked")) return "이미 시작·결과·취소 처리가 된 경기입니다.";
    return "불참 처리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  };
  const confirmForfeit = async () => {
    if (forfeitDialog?.mode !== "confirm" || savingForfeitId) return;
    const { matchId, losingSide } = forfeitDialog;
    setSavingForfeitId(matchId);
    try {
      const result = await app.actions.forfeitTournamentMatch(tournament.id, matchId, losingSide, "팀 불참");
      if (!result || result?.ok === false) throw new Error(result?.error ?? "tournament_forfeit_failed");
      setForfeitDialog({ mode: "success", matchId, losingSide });
    } catch (error) {
      setForfeitDialog({ mode: "error", matchId, message: formatForfeitError(error.message) });
    } finally {
      setSavingForfeitId("");
    }
  };
  const formatGovernanceError = (message = "") => {
    if (message.includes("tournament_referee_not_eligible")) return "심판 자격, 임기 또는 신뢰도 조건을 충족하지 못했습니다.";
    if (message.includes("tournament_referee_pool_insufficient")) return "팀 수에 필요한 승인 심판 수가 부족합니다.";
    if (message.includes("tournament_neutral_referee_coverage_required")) return "모든 가능한 대진에 중립 심판을 배정할 수 있어야 합니다.";
    if (message.includes("tournament_approval_not_ready")) return "팀장과 필수 심판 전원의 승인이 먼저 필요합니다.";
    if (message.includes("tournament_region_manager_required")) return "해당 지역관리자 이상만 처리할 수 있습니다.";
    if (message.includes("tournament_referee_not_neutral")) return "양 팀 어느 쪽에도 속하지 않은 중립 심판만 배정할 수 있습니다.";
    if (message.includes("tournament_referee_schedule_conflict")) return "같은 심판이 겹치는 시간대의 다른 경기에 배정되어 있습니다.";
    return "대회 승인·심판 작업을 완료하지 못했습니다.";
  };
  const runGovernanceAction = async (key, action, successMessage) => {
    if (governanceAction) return;
    setGovernanceAction(key);
    setGovernanceFeedback("");
    try {
      const result = await action();
      if (!result || result?.ok === false) throw new Error(result?.error ?? "tournament_governance_failed");
      await app.actions.loadTournament?.(tournament.id);
      setGovernanceFeedback(successMessage);
    } catch (error) {
      setGovernanceFeedback(formatGovernanceError(error.message));
    } finally {
      setGovernanceAction("");
    }
  };
  const inviteTournamentReferee = (referee) => runGovernanceAction(
    `invite:${referee.id}`,
    () => app.actions.inviteTournamentReferee(tournament.id, referee.id),
    `${referee.name} 심판에게 초대했습니다.`,
  ).then(() => setRefereeQuery(""));
  const saveMatchReferee = (event, match) => {
    event.preventDefault();
    const refereeId = String(new FormData(event.currentTarget).get("refereeId") ?? "");
    if (!refereeId) {
      setGovernanceFeedback("중립 심판을 선택해 주세요.");
      return;
    }
    runGovernanceAction(
      `assign:${match.id}`,
      () => app.actions.assignTournamentMatchReferee(tournament.id, match.id, refereeId),
      "경기 심판을 배정했습니다.",
    );
  };
  const renderRefereeInviteItem = (referee) => (
    <button
      key={referee.id}
      type="button"
      className="search-picker-result-row"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => inviteTournamentReferee(referee)}
    >
      <strong>{referee.name}</strong>
      <span>{getUserHashtag(referee)} · {referee.region ?? "지역 미정"}</span>
      <em>신뢰도 {referee.trustScore} · 대회 심판 초대</em>
    </button>
  );
  const organizer = userById[tournament.createdBy] ?? null;
  const dialogMatch = scheduleDialog?.matchId ? matchesById[scheduleDialog.matchId] : null;
  const forfeitMatch = forfeitDialog?.matchId ? matchesById[forfeitDialog.matchId] : null;
  const matchesReturnTo = typeof location.state?.from === "string" && location.state.from.startsWith("/app/matches")
    ? location.state.from
    : "/app/matches?panel=tournament";

  return (
    <div className="page-stack tournament-detail-page">
      <Button as={Link} variant="secondary" className="tournament-back-link" to={matchesReturnTo}><ChevronLeft size={17} /> 경기로</Button>

      <section className="tournament-hero">
        <div>
          <span className="om-kicker">PRIVATE EVENT</span>
          <h1>{tournament.title}</h1>
          <p className="tournament-hero-meta">
            <span><CalendarDays size={16} />{formatWindow(tournament)} · {tournament.court}</span>
            <span><UserRound size={16} />개최자 {organizer?.name ?? "알 수 없음"}{organizer ? ` ${getUserHashtag(organizer)}` : ""}</span>
          </p>
        </div>
        <div className="tournament-hero-badges" aria-label="대회 상태">
          <Badge tone="gold">{formatLabels[tournament.format] ?? "대회"}</Badge>
          <Badge tone={tournament.status === "active" ? "green" : "orange"}>
            {tournament.status === "draft" && governanceEnabled
              ? getTournamentSanctionLabel(tournament)
              : statusLabels[tournament.status] ?? "상태 확인 중"}
          </Badge>
          <Badge tone="blue">{tournament.mode}</Badge>
        </div>
      </section>

      <section className={`tournament-summary-grid${governanceEnabled ? " is-governed" : ""}`}>
        <div>
          <span>팀 승인</span>
          <strong>{acceptedCount}/{teamRows.length}</strong>
          <em>모든 팀장 승인 필수</em>
        </div>
        {governanceEnabled ? (
          <div>
            <span>심판 승인</span>
            <strong>{acceptedRefereeIds.length}/{requiredRefereeCount}</strong>
            <em>대진별 중립 심판 필수</em>
          </div>
        ) : null}
        <div>
          <span>생성 경기</span>
          <strong>{tournamentMatches.length}</strong>
          <em>
            {tournament.status === "draft"
              ? governanceEnabled ? "지역 승인 또는 비승인 개최 후 생성" : "승인 후 자동 생성"
              : "일정 입력 가능"}
          </em>
        </div>
        <div>
          <span>MMR</span>
          <strong>{mmrPolicyLabels[tournament.mmrPolicy] ?? "MMR 조건 확인"}</strong>
          <em>
            {tournament.sanctionStatus === TOURNAMENT_SANCTION_STATUS.community
              ? "지역 비승인 · 서버 정책 적용"
              : "서버 검증 후 반영"}
          </em>
        </div>
      </section>

      {hasPendingTeamApprovals ? (
        <section className="tournament-section">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">INVITED TEAMS</span>
              <h2>참가팀</h2>
            </div>
            <span>{acceptedCount}팀 승인</span>
          </div>
          <div className="tournament-team-list">
            {teamRows.map((row) => (
              <article key={row.teamId} className={row.status === "accepted" ? "accepted" : ""}>
                <TeamEmblem team={row.team} size="md" />
                <div className="tournament-team-copy">
                  <TeamHoverCard team={row.team}>{row.team.name}</TeamHoverCard>
                  <span>{row.team.region} · {row.team.homeCourt} · 주장 {row.captainName}</span>
                </div>
                <div className="tournament-team-state">
                  <TierBadge mmr={row.team.mmr} compact />
                  {row.canApprove ? (
                    <button type="button" onClick={() => app.actions.approveTournamentTeam(tournament.id, row.teamId)}>
                      <ShieldCheck size={15} /> 승인
                    </button>
                  ) : (
                    <b>{row.status === "accepted" ? "승인 완료" : row.needsRepresentativeTeam ? "대표팀 설정 필요" : "승인 대기"}</b>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {governanceEnabled ? (
        <section className="tournament-section tournament-governance-section">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">REFEREE APPROVAL</span>
            <h2>대회 심판</h2>
          </div>
          <span>최소 {requiredRefereeCount}명 · 승인 {acceptedRefereeIds.length}명</span>
        </div>
        <div className="tournament-referee-list">
          {refereeRows.map((row) => (
            <article key={row.refereeId} className={row.status === "accepted" ? "accepted" : ""}>
              <div>
                <strong>{row.referee?.name ?? row.refereeId}</strong>
                <span>{row.referee ? `${getUserHashtag(row.referee)} · 신뢰도 ${row.referee.trustScore}` : "심판 정보 확인 중"}</span>
              </div>
              {row.canApprove ? (
                <div className="tournament-referee-actions">
                  <button
                    type="button"
                    disabled={Boolean(governanceAction)}
                    onClick={() => runGovernanceAction(
                      `approve-referee:${row.refereeId}`,
                      () => app.actions.approveTournamentReferee(tournament.id),
                      "대회 심판 참여를 승인했습니다.",
                    )}
                  ><ShieldCheck size={15} /> 승인</button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(governanceAction)}
                    onClick={() => runGovernanceAction(
                      `decline-referee:${row.refereeId}`,
                      () => app.actions.declineTournamentReferee(tournament.id),
                      "대회 심판 초대를 거절했습니다.",
                    )}
                  >거절</button>
                </div>
              ) : (
                <b>{row.status === "accepted" ? "승인 완료" : row.status === "declined" ? "거절" : "승인 대기"}</b>
              )}
            </article>
          ))}
        </div>
        {canInviteReferee ? (
          <div className="tournament-referee-invite">
            <SearchPicker
              value={refereeQuery}
              onChange={setRefereeQuery}
              placeholder="교체·추가 심판 검색"
              items={eligibleRefereeCandidates}
              remoteSearchType="referee"
              remoteSearchContext={{ refereeThroughDate: tournament.endDate }}
              title="초대 가능한 심판"
              emptyText="초대 가능한 심판 없음"
              floating
              closeOnResultClick
              renderItem={renderRefereeInviteItem}
            />
          </div>
        ) : null}
        <p className="tournament-governance-note">
          공식 대회와 지역 비승인 대회 모두 필수 심판 전원 승인과 모든 가능한 대진의 중립 심판 커버리지가 필요합니다.
        </p>
        </section>
      ) : null}

      {governanceEnabled && tournament.status === "draft" ? (
        <section className="tournament-section tournament-sanction-panel">
          <div>
            <span className="om-kicker">REGIONAL REVIEW</span>
            <h2>{getTournamentSanctionLabel(tournament)}</h2>
            <p>팀장·심판 승인이 완료된 뒤 지역관리자가 승인하면 공식 대회로, 주최자가 비승인 개최를 선택하면 MMR 0.8 계수 대회로 시작합니다.</p>
          </div>
          <div className="tournament-sanction-actions">
            {canReviewRegion ? (
              <>
                <Button
                  type="button"
                  disabled={Boolean(governanceAction)}
                  onClick={() => runGovernanceAction(
                    "region-approve",
                    () => app.actions.approveTournamentRegion(tournament.id),
                    "지역 승인 공식 대회로 시작했습니다.",
                  )}
                >지역 승인</Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(governanceAction)}
                  onClick={() => runGovernanceAction(
                    "region-reject",
                    () => app.actions.rejectTournamentRegion(tournament.id),
                    "지역 비승인 처리했습니다.",
                  )}
                >비승인</Button>
              </>
            ) : null}
            {canStartCommunity ? (
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(governanceAction)}
                onClick={() => runGovernanceAction(
                  "community-start",
                  () => app.actions.startCommunityTournament(tournament.id),
                  "지역 비승인 대회로 시작했습니다.",
                )}
              >지역 비승인으로 개최</Button>
            ) : null}
          </div>
          {governanceFeedback ? <strong className="tournament-governance-feedback">{governanceFeedback}</strong> : null}
        </section>
      ) : governanceEnabled && governanceFeedback ? (
        <div className="tournament-governance-feedback">{governanceFeedback}</div>
      ) : null}

      <section className="tournament-section">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">{tournament.format === "tournament" ? "BRACKET" : "LEAGUE FIXTURES"}</span>
            <h2>{tournament.format === "tournament" ? "대진표" : "리그 경기표"}</h2>
          </div>
          <span>{tournament.status === "draft" ? "대기" : `${tournamentMatches.length}경기`}</span>
        </div>

        {tournament.status === "draft" ? (
          <div className="tournament-empty">
            <strong>대진 생성 전</strong>
            <p>
              {governanceEnabled
                ? "팀장·심판 승인 후 지역 승인 또는 지역 비승인 개최를 선택하면 경기와 대진이 생성됩니다."
                : "초대팀 주장이 모두 승인하면 경기와 대진이 자동으로 생성됩니다."}
            </p>
          </div>
        ) : tournament.format === "tournament" ? (
          <div className="tournament-bracket tournament-vertical-bracket" style={{ "--bracket-slots": verticalBracket.baseSlots }}>
            <div className="vertical-bracket-title">
              <span>우승</span>
              <strong>{championTeam ? <TeamHoverCard team={championTeam} as="span">{championTeam.name}</TeamHoverCard> : "결승 승자"}</strong>
            </div>
            <div className="vertical-bracket-trophy">
              <Trophy size={42} />
            </div>
            <div className="vertical-bracket-rows">
              {verticalBracket.rounds.map((round) => (
                <div key={round.id} className="vertical-bracket-row">
                  <h3>{round.name}</h3>
                  <div className="vertical-bracket-lanes">
                    {round.nodes.map(({ node, gridColumn }) => (
                      <div key={node.id} className="vertical-bracket-node" style={{ gridColumn }}>
                        {renderBracketNode(node, teamById, setSelectedMatchId)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="league-layout">
            <div className="league-standings-panel">
              <div className="league-panel-head">
                <strong>현재 순위</strong>
                <span>승수 · 득실차 · 득점 순</span>
              </div>
              <div className="league-table-scroll">
                <table className="league-table">
                  <thead>
                    <tr><th>순위</th><th>팀</th><th>경기</th><th>승</th><th>패</th><th>득실</th></tr>
                  </thead>
                  <tbody>
                    {leagueStandings.map((row, index) => (
                      <tr key={row.teamId} className={index === 0 && row.played ? "leader" : ""}>
                        <td>{index + 1}</td>
                        <td><TeamHoverCard team={row.team}>{row.team.name}</TeamHoverCard></td>
                        <td>{row.played}</td>
                        <td>{row.wins}</td>
                        <td>{row.losses}</td>
                        <td>{row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="league-fixtures-panel">
              <div className="league-panel-head">
                <strong>경기 일정·결과</strong>
                <span>{leagueFixtures.length}경기</span>
              </div>
              <div className="league-fixture-grid">
                {leagueFixtures.map((fixture) => {
                  const match = matchesById[fixture.matchId] ?? leagueMatchesByFixture.get(Number(fixture.fixture));
                  const openMatchId = match?.id ?? fixture.matchId ?? "";
                  const result = getLeagueMatchResult(match);
                  const fixtureState = getLeagueFixtureState(match, openMatchId);
                  const teamA = teamById[match?.teamA?.teamId] ?? teamById[fixture.teamAId];
                  const teamB = teamById[match?.teamB?.teamId] ?? teamById[fixture.teamBId];
                  const teamAName = match?.teamA?.name ?? teamA?.name ?? "TBD";
                  const teamBName = match?.teamB?.name ?? teamB?.name ?? "TBD";
                  const matchCourt = tournamentCourts.find((court) => court.id === match?.courtId);
                  const courtName = match?.court ?? match?.courtName ?? matchCourt?.name ?? tournament.court ?? "구장 미정";
                  const losingSide = match?.forfeitSide || match?.rules?.forfeit?.losingSide || "";
                  const losingTeamName = losingSide === "teamA" ? teamAName : losingSide === "teamB" ? teamBName : "";
                  return (
                    <form
                      key={fixture.matchId || `${fixture.fixture}-${fixture.teamAId}-${fixture.teamBId}`}
                      className={`league-fixture-card${result ? " completed" : ""}${openMatchId ? " openable" : " pending"}`}
                      onSubmit={(event) => match?.id && saveSchedule(event, match.id)}
                    >
                      <button
                        type="button"
                        className="league-fixture-summary"
                        disabled={!openMatchId}
                        title={openMatchId ? "경기 방 보기" : "경기 생성 후 방을 열 수 있습니다."}
                        aria-label={`${fixture.fixture}경기 ${teamAName} 대 ${teamBName}${openMatchId ? " 방 보기" : " 경기 생성 전"}`}
                        onClick={() => openMatchId && setSelectedMatchId(openMatchId)}
                      >
                        <span className="league-fixture-topline">
                          <span className="league-fixture-round">{fixture.fixture}경기</span>
                          <Badge tone={fixtureState.tone} className="league-fixture-status">{fixtureState.label}</Badge>
                        </span>
                        <span className="league-fixture-matchup">
                          <strong title={teamAName}>{teamAName}</strong>
                          <b>{result ? `${result.scoreA}:${result.scoreB}` : "VS"}</b>
                          <strong title={teamBName}>{teamBName}</strong>
                        </span>
                        <span className="league-fixture-meta">
                          <span><CalendarDays size={14} />{match ? getMatchTime(match) : "일정 미정"}</span>
                          <span><MapPin size={14} />{courtName}</span>
                          {losingTeamName ? <span className="league-fixture-forfeit"><Flag size={14} />{losingTeamName} 불참 · 1:0 몰수</span> : null}
                        </span>
                      </button>
                      <div className="league-fixture-actions">
                        {openMatchId ? (
                          <button type="button" className="league-fixture-open" onClick={() => setSelectedMatchId(openMatchId)}>
                            방 보기 <ChevronRight size={16} />
                          </button>
                        ) : (
                          <span className="league-fixture-pending">생성 전</span>
                        )}
                        {canManageSchedule && match && !result ? (
                          isTournamentScheduleEditable(match) ? (
                            <button
                              type="button"
                              className="league-fixture-schedule-toggle"
                              aria-expanded={editingScheduleId === match.id}
                              onClick={() => setEditingScheduleId((current) => current === match.id ? "" : match.id)}
                            >
                              <CalendarDays size={14} />
                              {editingScheduleId === match.id ? "입력 닫기" : match.scheduledDate ? "일정 수정" : "일정 설정"}
                            </button>
                          ) : (
                            <span className="tournament-schedule-policy">{getTournamentSchedulePolicyLabel(match)}</span>
                          )
                        ) : null}
                      </div>
                      {canManageSchedule && match && !result && isTournamentScheduleEditable(match) && editingScheduleId === match.id ? (
                        <div className="tournament-inline-schedule">
                          <input type="date" name="scheduledDate" min={todayValue} max={maxScheduleDate} defaultValue={match.scheduledDate ?? ""} aria-label="경기 날짜" />
                          <input type="time" name="scheduledTime" defaultValue={match.scheduledTime ?? ""} aria-label="경기 시간" />
                          <select name="courtId" defaultValue={match.courtId ?? tournament.courtId ?? tournamentCourts[0]?.id} aria-label="경기 구장">
                            {tournamentCourts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}
                          </select>
                          <button type="submit" disabled={savingScheduleId === match.id}><Save size={14} /> {savingScheduleId === match.id ? "저장 중" : "저장"}</button>
                          <button
                            type="button"
                            className="tournament-forfeit-button"
                            disabled={!isTournamentForfeitAvailable(match)}
                            title={isTournamentForfeitAvailable(match) ? "팀 불참 처리" : "경기 시작 시각 이후 사용 가능"}
                            onClick={() => setForfeitDialog({ mode: "choose", matchId: match.id })}
                          ><Flag size={14} /> 몰수</button>
                        </div>
                      ) : null}
                    </form>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {governanceEnabled && tournamentMatches.length ? (
        <section className="tournament-section">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">MATCH REFEREES</span>
              <h2>경기별 중립 심판</h2>
            </div>
            <span>{canManageSchedule ? "주최자 배정" : "배정 현황"}</span>
          </div>
          <div className="tournament-match-referee-list">
            {tournamentMatches.map((match) => {
              const teamAId = match.teamA?.teamId ?? match.teamAId;
              const teamBId = match.teamB?.teamId ?? match.teamBId;
              const neutralRefereeIds = acceptedRefereeIds.filter((refereeId) => (
                isEligibleReferee(
                  userById[refereeId],
                  REFEREE_TRUST_MIN,
                  app.state.settings?.refereeAppointments,
                  tournament.endDate,
                )
                && isTournamentRefereeNeutral(tournament, refereeId, teamAId, teamBId, app.state.teams)
              ));
              return (
                <form key={`${match.id}:${match.refereeId ?? ""}`} onSubmit={(event) => saveMatchReferee(event, match)}>
                  <strong>{match.teamA?.name ?? "A"} vs {match.teamB?.name ?? "B"}</strong>
                  <select
                    name="refereeId"
                    defaultValue={match.refereeId ?? ""}
                    disabled={!canManageSchedule || Boolean(match.startedAt || match.endedAt)}
                    aria-label={`${match.teamA?.name ?? "A"} 대 ${match.teamB?.name ?? "B"} 심판`}
                  >
                    <option value="">심판 선택</option>
                    {neutralRefereeIds.map((refereeId) => (
                      <option key={refereeId} value={refereeId}>{userById[refereeId]?.name ?? refereeId}</option>
                    ))}
                  </select>
                  {canManageSchedule ? (
                    <button type="submit" disabled={Boolean(governanceAction || match.startedAt || match.endedAt || !neutralRefereeIds.length)}>
                      <ShieldCheck size={14} /> 배정
                    </button>
                  ) : (
                    <span>{userById[match.refereeId]?.name ?? "미배정"}</span>
                  )}
                </form>
              );
            })}
          </div>
        </section>
      ) : null}

      {tournament.format === "tournament" && tournamentMatches.length ? (
        <section className="tournament-section">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">SCHEDULE</span>
              <h2>경기 일정</h2>
            </div>
            <span>{canManageSchedule ? "생성자 일정 입력" : "생성자만 수정 가능"}</span>
          </div>
          <div className="tournament-schedule-list">
            {tournamentMatches.map((match) => (
              <form
                key={match.id}
                className={canManageSchedule && isTournamentScheduleEditable(match) ? "" : "locked"}
                onSubmit={(event) => saveSchedule(event, match.id)}
                title={getTournamentSchedulePolicyLabel(match)}
              >
                <button type="button" className="tournament-match-open" onClick={() => setSelectedMatchId(match.id)}>
                  <TeamHoverCard team={teamById[match.teamA?.teamId]} as="span">{match.teamA?.name ?? "A"}</TeamHoverCard>
                  {" vs "}
                  <TeamHoverCard team={teamById[match.teamB?.teamId]} as="span">{match.teamB?.name ?? "B"}</TeamHoverCard>
                </button>
                <span>{getLeagueFixtureState(match, match.id).label}</span>
                <input type="date" name="scheduledDate" min={todayValue} max={maxScheduleDate} defaultValue={match.scheduledDate ?? ""} disabled={!canManageSchedule || !isTournamentScheduleEditable(match)} aria-label="경기 날짜" />
                <input type="time" name="scheduledTime" defaultValue={match.scheduledTime ?? ""} disabled={!canManageSchedule || !isTournamentScheduleEditable(match)} aria-label="경기 시간" />
                <select name="courtId" defaultValue={match.courtId ?? tournament.courtId ?? tournamentCourts[0]?.id} disabled={!canManageSchedule || !isTournamentScheduleEditable(match)} aria-label="경기 구장">
                  {tournamentCourts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}
                </select>
                <button type="submit" disabled={!canManageSchedule || !isTournamentScheduleEditable(match) || savingScheduleId === match.id}><Save size={14} /> {savingScheduleId === match.id ? "저장 중" : isTournamentScheduleEditable(match) ? "저장" : getTournamentSchedulePolicyLabel(match)}</button>
                {canManageSchedule ? (
                  <button
                    type="button"
                    className="tournament-forfeit-button"
                    disabled={!isTournamentForfeitAvailable(match)}
                    title={isTournamentForfeitAvailable(match) ? "팀 불참 처리" : "경기 시작 시각 이후 사용 가능"}
                    onClick={() => setForfeitDialog({ mode: "choose", matchId: match.id })}
                  ><Flag size={14} /> 몰수</button>
                ) : null}
              </form>
            ))}
          </div>
        </section>
      ) : null}

      {scheduleDialog ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !savingScheduleId && setScheduleDialog(null)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="대회 경기 일정 저장" onMouseDown={(event) => event.stopPropagation()}>
            <strong>{scheduleDialog.mode === "confirm" ? "경기 일정을 저장할까요?" : scheduleDialog.mode === "success" ? "일정을 저장했습니다." : scheduleDialog.mode === "notice" ? "일정 정보를 확인해 주세요." : "일정을 저장하지 못했습니다."}</strong>
            <p>
              {scheduleDialog.mode === "confirm"
                ? `${dialogMatch?.teamA?.name ?? "A"} vs ${dialogMatch?.teamB?.name ?? "B"} · ${scheduleDialog.scheduledDate} ${scheduleDialog.scheduledTime} · ${scheduleDialog.courtName}`
                : scheduleDialog.mode === "success"
                  ? "양 팀장에게 출전·후보 명단 구성 알림을 보냈습니다."
                  : scheduleDialog.mode === "notice"
                    ? scheduleDialog.message
                  : scheduleDialog.message}
            </p>
            <div className="app-confirm-actions">
              {scheduleDialog.mode === "confirm" ? (
                <>
                  <Button type="button" variant="secondary" disabled={Boolean(savingScheduleId)} onClick={() => setScheduleDialog(null)}>취소</Button>
                  <Button type="button" disabled={Boolean(savingScheduleId)} onClick={confirmSchedule}>{savingScheduleId ? "저장 중" : "저장"}</Button>
                </>
              ) : (
                <Button type="button" onClick={() => setScheduleDialog(null)}>확인</Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {forfeitDialog ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !savingForfeitId && setForfeitDialog(null)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="대회 경기 몰수 처리" onMouseDown={(event) => event.stopPropagation()}>
            <strong>
              {forfeitDialog.mode === "choose"
                ? "불참 팀을 선택해 주세요."
                : forfeitDialog.mode === "confirm"
                  ? "1:0 몰수패로 확정할까요?"
                  : forfeitDialog.mode === "success"
                    ? "몰수패를 확정했습니다."
                    : "몰수패를 확정하지 못했습니다."}
            </strong>
            <p>
              {forfeitDialog.mode === "choose"
                ? `${forfeitMatch?.teamA?.name ?? "A팀"} vs ${forfeitMatch?.teamB?.name ?? "B팀"}`
                : forfeitDialog.mode === "confirm"
                  ? `${forfeitDialog.losingSide === "teamA" ? forfeitMatch?.teamA?.name ?? "A팀" : forfeitMatch?.teamB?.name ?? "B팀"} 불참 · 상대 팀 1:0 몰수승 · MMR 미반영`
                  : forfeitDialog.mode === "success"
                    ? "리그 승패 또는 다음 토너먼트 라운드에 반영했습니다."
                    : forfeitDialog.message}
            </p>
            <div className="app-confirm-actions tournament-forfeit-actions">
              {forfeitDialog.mode === "choose" ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => setForfeitDialog(null)}>취소</Button>
                  <Button type="button" variant="secondary" onClick={() => setForfeitDialog((current) => ({ ...current, mode: "confirm", losingSide: "teamA" }))}>{forfeitMatch?.teamA?.name ?? "A팀"} 불참</Button>
                  <Button type="button" variant="secondary" onClick={() => setForfeitDialog((current) => ({ ...current, mode: "confirm", losingSide: "teamB" }))}>{forfeitMatch?.teamB?.name ?? "B팀"} 불참</Button>
                </>
              ) : forfeitDialog.mode === "confirm" ? (
                <>
                  <Button type="button" variant="secondary" disabled={Boolean(savingForfeitId)} onClick={() => setForfeitDialog((current) => ({ ...current, mode: "choose", losingSide: "" }))}>이전</Button>
                  <Button type="button" disabled={Boolean(savingForfeitId)} onClick={confirmForfeit}>{savingForfeitId ? "처리 중" : "몰수 확정"}</Button>
                </>
              ) : (
                <Button type="button" onClick={() => setForfeitDialog(null)}>확인</Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <MatchRoomModal app={app} matchId={selectedMatchId} entryPoint="tournament" onClose={() => setSelectedMatchId("")} />
    </div>
  );
}
