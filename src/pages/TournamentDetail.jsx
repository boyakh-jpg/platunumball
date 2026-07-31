import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { getTeamCaptainMemberId as getTeamCaptainId } from "../data/teamMappers.js";
import { getTournamentTeamIds, getTournamentTeamStatus } from "../data/tournamentMappers.js";
import { getRegisteredCourts } from "../lib/courts.js";
import { getUserHashtag } from "../lib/handles.js";
import { addDateDays, getLocalDateInputValue, isEligibleReferee } from "../lib/matchUtils.js";
import { getTournamentMatches } from "../lib/tournamentMatches.js";
import { REFEREE_TRUST_MIN } from "../lib/constants.js";
import { TOURNAMENT_SANCTION_STATUS, getActiveTournamentTeamIds, getAcceptedTournamentRefereeIds, getRequiredTournamentRefereeCount, getTournamentRefereeStatus, isTournamentGovernanceEnabled } from "../lib/tournamentGovernance.js";
import "../styles/matches-arena.css";
import {
  isTournamentScheduleEditable,
  getTournamentSchedulePolicyMessage,
  getLeagueStandings,
  getNodeWinnerTeamId,
  buildTournamentBracketTree,
  getVerticalBracketLayout,
} from "./tournamentDetailModel.jsx";
import TournamentDetailView from "./TournamentDetailView.jsx";

export default function TournamentDetail({
  app
}) {
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
  const tournamentTeamIds = getTournamentTeamIds(tournament);
  const representativeTeamId = app.state.settings?.representativeTeamId ?? app.currentUser.representativeTeamId ?? "";
  const representativeTeam = teamById[representativeTeamId] ?? null;
  const teamRows = tournamentTeamIds
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
  const hasPendingTeamApprovals = tournamentTeamIds
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
    if (governanceAction) return false;
    setGovernanceAction(key);
    setGovernanceFeedback("");
    try {
      const result = await action();
      if (!result || result?.ok === false) throw new Error(result?.error ?? "tournament_governance_failed");
      await app.actions.loadTournament?.(tournament.id);
      setGovernanceFeedback(successMessage);
      return true;
    } catch (error) {
      setGovernanceFeedback(formatGovernanceError(error.message));
      return false;
    } finally {
      setGovernanceAction("");
    }
  };
  const inviteTournamentReferee = async (referee) => {
    const invited = await runGovernanceAction(
      `invite:${referee.id}`,
      () => app.actions.inviteTournamentReferee(tournament.id, referee.id),
      `${referee.name} 심판에게 초대했습니다.`,
    );
    if (invited) setRefereeQuery("");
  };
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
  const controller = { app, tournament, scheduleDialog, setScheduleDialog, savingScheduleId, forfeitDialog, setForfeitDialog, savingForfeitId, selectedMatchId, setSelectedMatchId, editingScheduleId, setEditingScheduleId, refereeQuery, setRefereeQuery, governanceAction, governanceFeedback, teamById, userById, matchesById, tournamentMatches, teamRows, acceptedCount, hasPendingTeamApprovals, governanceEnabled, requiredRefereeCount, acceptedRefereeIds, refereeRows, eligibleRefereeCandidates, canInviteReferee, canReviewRegion, canStartCommunity, verticalBracket, championTeam, canManageSchedule, todayValue, maxScheduleDate, leagueFixtures, leagueMatchesByFixture, leagueStandings, tournamentCourts, saveSchedule, confirmSchedule, confirmForfeit, runGovernanceAction, saveMatchReferee, renderRefereeInviteItem, organizer, dialogMatch, forfeitMatch, matchesReturnTo };
  return <TournamentDetailView controller={controller} />;
}
