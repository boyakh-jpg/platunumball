import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, Save, ShieldCheck, Trophy, UserRound } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { getUserHashtag } from "../lib/handles.js";
import "../styles/matches-arena.css";

function toDateInputValue(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(dateValue, amount) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}

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
  const winnerTeamId = getMatchWinnerTeamId(match);
  if (!winnerTeamId) return "";
  return winnerTeamId === match.teamA?.teamId ? match.teamA?.name ?? "A" : match.teamB?.name ?? "B";
}

function getMatchWinnerTeamId(match) {
  if (!match?.result) return "";
  const scoreA = Number(match.result?.scoreA ?? match.teamA?.score ?? 0);
  const scoreB = Number(match.result?.scoreB ?? match.teamB?.score ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA?.teamId ?? "" : match.teamB?.teamId ?? "";
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
      sourceA: row.teamAId ? { type: "team", teamId: row.teamAId } : { type: "empty" },
      sourceB: row.teamBId ? { type: "team", teamId: row.teamBId } : { type: "bye" },
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

function renderBracketNode(node, teamById) {
  if (!node) return null;
  const winner = node.match ? getWinnerName(node.match) : "";
  return (
    <article key={node.id} className={winner || node.byeTeamId ? "bracket-match-card done" : "bracket-match-card"}>
      <div className="bracket-node-head">
        <span>{node.name}</span>
        {node.match ? <Link to={`/app/matches?match=${node.match.id}`}>방 보기</Link> : <b>{node.byeTeamId ? "BYE" : "예정"}</b>}
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
  const { tournamentId } = useParams();
  const tournament = (app.state.tournaments ?? []).find((item) => item.id === tournamentId);
  const requestedTournamentIdRef = useRef("");
  const [tournamentMissing, setTournamentMissing] = useState(false);
  const [scheduleDialog, setScheduleDialog] = useState(null);
  const [savingScheduleId, setSavingScheduleId] = useState("");
  const teamById = Object.fromEntries(app.state.teams.map((team) => [team.id, team]));
  const userById = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const matchesById = Object.fromEntries(app.state.matches.map((match) => [match.id, match]));

  useEffect(() => {
    if (!tournamentId || tournament || app.remoteReady === false || requestedTournamentIdRef.current === tournamentId) return;
    setTournamentMissing(false);
    requestedTournamentIdRef.current = tournamentId;
    Promise.resolve(app.actions.loadTournament?.(tournamentId)).then((count) => {
      if (!count) setTournamentMissing(true);
    }).catch(() => {
      requestedTournamentIdRef.current = "";
      setTournamentMissing(true);
    });
  }, [app.actions, app.remoteReady, tournament, tournamentId]);

  if (!tournament && !tournamentMissing) {
    return <BasketballLoader overlay label="대회 불러오는 중" />;
  }

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
  const bracketTree = tournament.format === "tournament" ? buildTournamentBracketTree(tournament, matchesById) : [];
  const verticalBracket = tournament.format === "tournament" ? getVerticalBracketLayout(bracketTree) : { baseSlots: 1, rounds: [], finalNode: null };
  const championTeamId = verticalBracket.finalNode ? getNodeWinnerTeamId(verticalBracket.finalNode) : "";
  const championTeam = championTeamId ? teamById[championTeamId] : null;
  const canManageSchedule = tournament.createdBy === app.currentUser.id;
  const todayValue = toDateInputValue();
  const maxScheduleDate = addDays(todayValue, 365);
  const leagueFixtures = tournament.bracket?.fixtures ?? tournamentMatches.map((match) => ({
    matchId: match.id,
    round: match.tournamentRound,
    fixture: match.tournamentFixture,
    teamAId: match.teamA?.teamId ?? "",
    teamBId: match.teamB?.teamId ?? "",
  }));

  const saveSchedule = (event, matchId) => {
    event.preventDefault();
    if (!canManageSchedule) return;
    const form = new FormData(event.currentTarget);
    const scheduledDate = String(form.get("scheduledDate") ?? "");
    const scheduledTime = String(form.get("scheduledTime") ?? "");
    if (!scheduledDate || !scheduledTime) return;
    setScheduleDialog({ mode: "confirm", matchId, scheduledDate, scheduledTime });
  };
  const confirmSchedule = async () => {
    if (scheduleDialog?.mode !== "confirm" || savingScheduleId) return;
    const { matchId, scheduledDate, scheduledTime } = scheduleDialog;
    setSavingScheduleId(matchId);
    try {
      const result = await app.actions.updateTournamentMatchSchedule(tournament.id, matchId, { scheduledDate, scheduledTime });
      if (!result || result?.ok === false) throw new Error(result?.error ?? "schedule_save_failed");
      setScheduleDialog({ mode: "success", matchId, scheduledDate, scheduledTime });
    } catch (error) {
      setScheduleDialog({ mode: "error", message: error.message || "schedule_save_failed" });
    } finally {
      setSavingScheduleId("");
    }
  };
  const organizer = userById[tournament.createdBy] ?? null;
  const dialogMatch = scheduleDialog?.matchId ? matchesById[scheduleDialog.matchId] : null;

  return (
    <div className="page-stack tournament-detail-page">
      <Link className="button button-secondary button-md tournament-back-link" to="/app/matches"><ChevronLeft size={17} /> 경기로</Link>

      <section className="tournament-hero">
        <div>
          <span className="om-kicker">PRIVATE EVENT</span>
          <h1>{tournament.title}</h1>
          <p className="tournament-hero-meta">
            <span><CalendarDays size={16} />{formatWindow(tournament)} · {tournament.court}</span>
            <span><UserRound size={16} />개최자 {organizer?.name ?? "알 수 없음"}{organizer ? ` ${getUserHashtag(organizer)}` : ""}</span>
          </p>
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
          <em>모든 팀 승인 후 시작</em>
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
                        {renderBracketNode(node, teamById)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
                <Link to={`/app/matches?match=${match.id}`}>
                  <TeamHoverCard team={teamById[match.teamA?.teamId]} as="span">{match.teamA?.name ?? "A"}</TeamHoverCard>
                  {" vs "}
                  <TeamHoverCard team={teamById[match.teamB?.teamId]} as="span">{match.teamB?.name ?? "B"}</TeamHoverCard>
                </Link>
                <span>{match.status === "confirmed" ? "확정" : match.status === "agreed" ? "예정" : "대기"}</span>
                <input type="date" name="scheduledDate" min={todayValue} max={maxScheduleDate} defaultValue={match.scheduledDate ?? ""} disabled={!canManageSchedule} aria-label="경기 날짜" />
                <input type="time" name="scheduledTime" defaultValue={match.scheduledTime ?? ""} disabled={!canManageSchedule} aria-label="경기 시간" />
                <button type="submit" disabled={!canManageSchedule || savingScheduleId === match.id}><Save size={14} /> {savingScheduleId === match.id ? "저장 중" : "저장"}</button>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      {scheduleDialog ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !savingScheduleId && setScheduleDialog(null)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="대회 경기 일정 저장" onMouseDown={(event) => event.stopPropagation()}>
            <strong>{scheduleDialog.mode === "confirm" ? "경기 일정을 저장할까요?" : scheduleDialog.mode === "success" ? "일정을 저장했습니다." : "일정을 저장하지 못했습니다."}</strong>
            <p>
              {scheduleDialog.mode === "confirm"
                ? `${dialogMatch?.teamA?.name ?? "A"} vs ${dialogMatch?.teamB?.name ?? "B"} · ${scheduleDialog.scheduledDate} ${scheduleDialog.scheduledTime}`
                : scheduleDialog.mode === "success"
                  ? "양 팀장에게 출전·후보 명단 구성 알림을 보냈습니다."
                  : `서버 저장 실패: ${scheduleDialog.message}`}
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
    </div>
  );
}
