import { Link, useParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, Save, ShieldCheck, Trophy } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";

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

function getTeamCaptainId(team) {
  return team?.members?.find((member) => member.role === "captain")?.userId ?? null;
}

function getTournamentTeamStatus(tournament, teamId) {
  return tournament.teamStatuses?.[teamId] ?? "invited";
}

function formatWindow(tournament) {
  return [tournament.startDate, tournament.endDate].filter(Boolean).join(" ~ ") || "일정 미정";
}

function getMatchTime(match) {
  return [match.scheduledDate, match.scheduledTime].filter(Boolean).join(" ") || match.scheduledAt || "일정 미정";
}

function getTournamentMatches(tournament, matchesById, matches = []) {
  const fromIds = (tournament.matchIds ?? []).map((matchId) => matchesById[matchId]).filter(Boolean);
  const source = fromIds.length ? fromIds : matches.filter((match) => match.tournamentId === tournament.id);
  return [...source].sort((a, b) => (a.tournamentRound ?? 0) - (b.tournamentRound ?? 0) || (a.tournamentFixture ?? 0) - (b.tournamentFixture ?? 0));
}

function getWinnerName(match) {
  const scoreA = Number(match.result?.scoreA ?? match.teamA?.score ?? 0);
  const scoreB = Number(match.result?.scoreB ?? match.teamB?.score ?? 0);
  if (!match.result || scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA.name : match.teamB.name;
}

function getRoundEntrantCount(round = {}) {
  return (round.pairings?.length ?? 0) + (round.byes?.length ?? 0);
}

function getNextRoundSlotCount(round = {}) {
  return Math.max(1, Math.ceil(getRoundEntrantCount(round) / 2));
}

export default function TournamentDetail({ app }) {
  const { tournamentId } = useParams();
  const tournament = (app.state.tournaments ?? []).find((item) => item.id === tournamentId);
  const teamById = Object.fromEntries(app.state.teams.map((team) => [team.id, team]));
  const userById = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const matchesById = Object.fromEntries(app.state.matches.map((match) => [match.id, match]));

  if (!tournament) {
    return (
      <div className="page-stack tournament-detail-page">
        <Link className="button button-secondary button-md tournament-back-link" to="/app/matches"><ChevronLeft size={17} /> 경기로</Link>
        <section className="tournament-empty">
          <strong>대회 없음</strong>
          <p>삭제됐거나 아직 동기화되지 않은 대회다.</p>
        </section>
      </div>
    );
  }

  const tournamentMatches = getTournamentMatches(tournament, matchesById, app.state.matches);
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
        canApprove: tournament.status === "draft" && captainId === app.currentUser.id && getTournamentTeamStatus(tournament, teamId) !== "accepted",
      };
    })
    .filter((row) => row.team);
  const acceptedCount = teamRows.filter((row) => row.status === "accepted").length;
  const bracketRounds = tournament.bracket?.rounds ?? [];
  const canManageSchedule = tournament.createdBy === app.currentUser.id;
  const leagueFixtures = tournament.bracket?.fixtures ?? tournamentMatches.map((match) => ({
    matchId: match.id,
    round: match.tournamentRound,
    fixture: match.tournamentFixture,
    teamAId: match.teamA.teamId,
    teamBId: match.teamB.teamId,
  }));

  const saveSchedule = (event, matchId) => {
    event.preventDefault();
    if (!canManageSchedule) return;
    const form = new FormData(event.currentTarget);
    app.actions.updateTournamentMatchSchedule(tournament.id, matchId, {
      scheduledDate: form.get("scheduledDate"),
      scheduledTime: form.get("scheduledTime"),
    });
  };

  return (
    <div className="page-stack tournament-detail-page">
      <Link className="button button-secondary button-md tournament-back-link" to="/app/matches"><ChevronLeft size={17} /> 경기로</Link>

      <section className="tournament-hero">
        <div>
          <span className="om-kicker">PRIVATE EVENT</span>
          <h1>{tournament.title}</h1>
          <p><CalendarDays size={16} />{formatWindow(tournament)} · {tournament.court}</p>
        </div>
        <div className="tournament-hero-badges">
          <Badge tone="gold">{formatLabels[tournament.format] ?? tournament.format}</Badge>
          <Badge tone={tournament.status === "active" ? "green" : "orange"}>{statusLabels[tournament.status] ?? tournament.status}</Badge>
          <Badge tone="blue">{tournament.mode}</Badge>
        </div>
      </section>

      <section className="tournament-summary-grid">
        <div>
          <span>팀 승인</span>
          <strong>{acceptedCount}/{teamRows.length}</strong>
          <em>모든 주장 승인 후 시작</em>
        </div>
        <div>
          <span>생성 경기</span>
          <strong>{tournamentMatches.length}</strong>
          <em>{tournament.status === "draft" ? "승인 후 자동 생성" : "일정 입력 가능"}</em>
        </div>
        <div>
          <span>MMR</span>
          <strong>{mmrPolicyLabels[tournament.mmrPolicy] ?? tournament.mmrPolicy}</strong>
          <em>{tournament.format === "tournament" ? "토너먼트 보너스 1.18" : "리그 보너스 1.12"}</em>
        </div>
      </section>

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
              <div className="team-emblem" style={{ "--team-color": row.team.accent }}>{row.team.name.slice(0, 1)}</div>
              <div>
                <TeamHoverCard team={row.team}>{row.team.name}</TeamHoverCard>
                <span>{row.team.region} · {row.team.homeCourt} · 주장 {row.captainName}</span>
              </div>
              <TierBadge mmr={row.team.mmr} compact />
              {row.canApprove ? (
                <button type="button" onClick={() => app.actions.approveTournamentTeam(tournament.id, row.teamId)}>
                  <ShieldCheck size={15} /> 승인
                </button>
              ) : (
                <b>{row.status === "accepted" ? "승인" : "초대"}</b>
              )}
            </article>
          ))}
        </div>
      </section>

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
            <p>초대팀 주장이 모두 승인하면 자동으로 경기와 대진이 열린다.</p>
          </div>
        ) : tournament.format === "tournament" ? (
          <div className="tournament-bracket tournament-bracket-graphic">
            {bracketRounds.map((round) => (
              <div key={round.id} className="tournament-round bracket-round-column">
                <h3>{round.name}</h3>
                <div className="bracket-lanes">
                  {(round.pairings ?? []).map((pairing) => {
                    const match = matchesById[pairing.matchId];
                    const winner = match ? getWinnerName(match) : "";
                    return (
                      <article key={pairing.matchId} className={winner ? "bracket-match-card done" : "bracket-match-card"}>
                        <div className={winner === match?.teamA.name ? "bracket-team-row winner" : "bracket-team-row"}>
                          <TeamHoverCard team={teamById[pairing.teamAId]} as="span">{teamById[pairing.teamAId]?.name ?? "TBD"}</TeamHoverCard>
                          <TierBadge mmr={teamById[pairing.teamAId]?.mmr ?? 1200} compact />
                        </div>
                        <strong className="bracket-midline">vs</strong>
                        <div className={winner === match?.teamB.name ? "bracket-team-row winner" : "bracket-team-row"}>
                          <TeamHoverCard team={teamById[pairing.teamBId]} as="span">{teamById[pairing.teamBId]?.name ?? "TBD"}</TeamHoverCard>
                          <TierBadge mmr={teamById[pairing.teamBId]?.mmr ?? 1200} compact />
                        </div>
                        {winner ? <em>{winner} 승</em> : <em>{match ? getMatchTime(match) : "일정 미정"}</em>}
                        <span className="bracket-connector" aria-hidden="true" />
                      </article>
                    );
                  })}
                  {(round.byes ?? []).map((teamId) => (
                    <article key={`bye-${teamId}`} className="bracket-match-card bracket-bye-card">
                      <div className="bracket-team-row winner">
                        <TeamHoverCard team={teamById[teamId]} as="span">{teamById[teamId]?.name ?? "TBD"}</TeamHoverCard>
                        <TierBadge mmr={teamById[teamId]?.mmr ?? 1200} compact />
                      </div>
                      <strong className="bracket-midline">BYE</strong>
                      <em>부전승</em>
                      <span className="bracket-connector" aria-hidden="true" />
                    </article>
                  ))}
                </div>
              </div>
            ))}
            <div className="tournament-round locked bracket-round-column">
              <h3>다음 라운드</h3>
              <div className="bracket-lanes bracket-next-lanes">
                {Array.from({ length: getNextRoundSlotCount(bracketRounds[bracketRounds.length - 1]) }).map((_, index) => (
                  <article key={`next-${index}`} className="bracket-next-slot">
                    <span>{index + 1}번 슬롯</span>
                    <strong><Trophy size={16} /></strong>
                    <em>승자/부전승 진출</em>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="league-fixture-grid">
            {leagueFixtures.map((fixture) => {
              const match = matchesById[fixture.matchId];
              return (
                <article key={fixture.matchId ?? `${fixture.teamAId}-${fixture.teamBId}`}>
                  <span>{fixture.fixture}경기</span>
                  <TeamHoverCard team={teamById[fixture.teamAId]}><strong>{teamById[fixture.teamAId]?.name ?? match?.teamA.name ?? "TBD"}</strong></TeamHoverCard>
                  <b>vs</b>
                  <TeamHoverCard team={teamById[fixture.teamBId]}><strong>{teamById[fixture.teamBId]?.name ?? match?.teamB.name ?? "TBD"}</strong></TeamHoverCard>
                  <em>{match ? getMatchTime(match) : "일정 미정"}</em>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {tournamentMatches.length ? (
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
              <form key={match.id} className={canManageSchedule ? "" : "locked"} onSubmit={(event) => saveSchedule(event, match.id)}>
                <Link to={`/app/matches/${match.id}`}>
                  <TeamHoverCard team={teamById[match.teamA.teamId]} as="span">{match.teamA.name}</TeamHoverCard>
                  {" vs "}
                  <TeamHoverCard team={teamById[match.teamB.teamId]} as="span">{match.teamB.name}</TeamHoverCard>
                </Link>
                <span>{match.status === "confirmed" ? "확정" : match.status === "agreed" ? "예정" : "대기"}</span>
                <input type="date" name="scheduledDate" defaultValue={match.scheduledDate ?? ""} disabled={!canManageSchedule} aria-label="경기 날짜" />
                <input type="time" name="scheduledTime" defaultValue={match.scheduledTime ?? ""} disabled={!canManageSchedule} aria-label="경기 시간" />
                <button type="submit" disabled={!canManageSchedule}><Save size={14} /> 저장</button>
              </form>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
