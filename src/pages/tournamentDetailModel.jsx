import TierBadge from "../components/rating/TierBadge.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { getMatchRoomPhase, getTournamentScheduleEditPolicy, isMatchResultConfirmed } from "../lib/matchUtils.js";
import { formatTournamentWindow as formatWindow } from "../../shared/lib/scheduleUtils.js";
import { getTournamentRefereePoolValidation } from "../lib/tournamentGovernance.js";

export { formatWindow };

export const formatLabels = {
  league: "리그",
  tournament: "토너먼트",
};

export const statusLabels = {
  draft: "팀장 승인 대기",
  active: "진행 중",
  scheduled: "예정",
  closed: "종료",
  cancelled: "취소",
};

export const mmrPolicyLabels = {
  gap_adjusted: "격차 보정",
  standard: "일반 MMR",
  event_only: "대회 점수만",
};

export const tournamentDetailSections = Object.freeze({
  teams: "tournament-teams",
  referees: "tournament-referees",
  sanction: "tournament-sanction",
  competition: "tournament-competition",
  matchReferees: "tournament-match-referees",
  schedule: "tournament-schedule",
});

export function getTournamentNextAction({
  app,
  tournament,
  teamRows = [],
  hasPendingTeamApprovals,
  governanceEnabled,
  requiredRefereeCount = 0,
  acceptedRefereeIds = [],
  refereeRows = [],
  canInviteReferee,
  canReviewRegion,
  canStartCommunity,
  canManageSchedule,
  tournamentMatches = [],
}) {
  const competitionLabel = tournament.format === "league" ? "리그 경기표 보기" : "대진표 보기";
  const competition = { target: tournamentDetailSections.competition, actionLabel: competitionLabel };
  if (["closed", "cancelled"].includes(tournament.status)) {
    return { title: `대회가 ${tournament.status === "cancelled" ? "취소" : "종료"}되었습니다`, description: "아래에서 경기별 상태와 확정 기록을 확인할 수 있습니다.", ...competition };
  }
  const myTeamApproval = teamRows.find((row) => row.canApprove || row.needsRepresentativeTeam);
  if (myTeamApproval) {
    return {
      title: myTeamApproval.needsRepresentativeTeam ? "대표팀 설정 후 참가를 승인해 주세요" : `${myTeamApproval.team.name} 참가를 승인해 주세요`,
      description: myTeamApproval.needsRepresentativeTeam ? "참가팀을 내 대표팀으로 설정하면 팀장 승인을 할 수 있습니다." : "참가팀의 승인 버튼에서 내 팀의 대회 참여를 확정합니다.",
      target: tournamentDetailSections.teams,
      actionLabel: "내 팀 승인 확인",
    };
  }
  if (refereeRows.some((row) => row.canApprove)) {
    return { title: "심판 초대에 응답해 주세요", description: "대회 심판에서 참여를 승인하거나 거절할 수 있습니다.", target: tournamentDetailSections.referees, actionLabel: "심판 초대 확인" };
  }
  if (tournament.status === "draft") {
    if (hasPendingTeamApprovals) {
      return { title: "참가팀 승인을 기다리고 있습니다", description: "참가팀 목록에서 승인 대기 팀과 담당 팀장을 확인해 주세요.", target: tournamentDetailSections.teams, actionLabel: "승인 대기 팀 확인" };
    }
    if (governanceEnabled) {
      const remainingReferees = Math.max(0, requiredRefereeCount - acceptedRefereeIds.length);
      if (remainingReferees) {
        return { title: `심판 ${remainingReferees}명의 승인이 더 필요합니다`, description: canInviteReferee ? "심판의 응답 상태를 확인하고, 거절했거나 참여가 어려운 심판 대신 새 심판을 초대해 주세요." : "대회 심판에서 초대와 승인 현황을 확인할 수 있습니다.", target: tournamentDetailSections.referees, actionLabel: "심판 승인 확인" };
      }
      const refereePool = getTournamentRefereePoolValidation({ tournament, teams: app?.state?.teams, users: app?.state?.users, refereeAppointments: app?.state?.settings?.refereeAppointments, requireAccepted: true });
      if (!refereePool.allowed) {
        return { title: "심판 구성을 확인해 주세요", description: refereePool.ineligibleRefereeId ? "승인 심판의 자격 정보를 확인하고 유효한 심판으로 교체해 주세요." : "승인 인원은 충족했지만 중립 심판이 없는 대진이 있습니다. 양 팀과 무관한 심판의 승인이 필요합니다.", target: tournamentDetailSections.referees, actionLabel: "대회 심판 확인" };
      }
      return { title: canReviewRegion || canStartCommunity ? "개최 방식을 선택해 주세요" : "개최 승인을 기다리고 있습니다", description: "지역관리자의 공식 승인 또는 주최자의 지역 비승인 개최 후 대진이 생성됩니다.", target: tournamentDetailSections.sanction, actionLabel: canReviewRegion || canStartCommunity ? "개최 방식 확인" : "개최 승인 현황" };
    }
    return { title: "참가팀 승인이 완료되었습니다", description: "경기가 생성되면 대진과 일정을 확인할 수 있습니다.", ...competition };
  }
  const editableMatches = tournamentMatches.filter((match) => isTournamentScheduleEditable(match));
  const unassignedMatches = governanceEnabled ? editableMatches.filter((match) => !match.refereeId) : [];
  if (unassignedMatches.length) {
    return { title: `심판 미배정 ${unassignedMatches.length}경기`, description: "경기별 중립 심판을 배정해야 일정을 저장할 수 있습니다.", target: tournamentDetailSections.matchReferees, actionLabel: canManageSchedule ? "심판 배정하기" : "심판 배정 현황" };
  }
  const unscheduledMatches = editableMatches.filter((match) => !getTournamentScheduleEditPolicy(match).hasSchedule);
  if (unscheduledMatches.length) {
    return { title: `일정 미정 ${unscheduledMatches.length}경기`, description: canManageSchedule ? "날짜·시간·구장을 저장하면 각 팀장이 출전 명단을 준비할 수 있습니다." : "주최자가 일정을 저장하면 각 팀장이 출전 명단을 준비할 수 있습니다.", target: tournament.format === "league" ? tournamentDetailSections.competition : tournamentDetailSections.schedule, actionLabel: canManageSchedule ? "다음 경기 일정 설정" : "경기 일정 보기", scheduleMatchId: canManageSchedule ? unscheduledMatches[0].id : "" };
  }
  const pendingResults = tournamentMatches.filter((match) => getLeagueFixtureState(match).resultPending);
  if (pendingResults.length) {
    return { title: `결과 확인 중 ${pendingResults.length}경기`, description: "경기 방에서 이의와 승인 상태를 확인해 주세요. 결과 확정 후 순위와 다음 대진에 반영됩니다.", actionLabel: "첫 경기 결과 확인", matchId: pendingResults[0].id };
  }
  return { title: "경기별 준비 상태를 확인해 주세요", description: "경기 방에서 출전 명단, 출석, 경기 진행 상태를 확인할 수 있습니다.", ...competition };
}

export function getMatchTime(match) {
  return [match.scheduledDate, match.scheduledTime].filter(Boolean).join(" ") || match.scheduledAt || "일정 미정";
}

export function isTournamentForfeitAvailable(match) {
  if (!match || ["confirmed", "cancelled", "void", "voided", "closed"].includes(match.status) || match.startedAt || match.endedAt || match.result) return false;
  if (!match.scheduledDate || !match.scheduledTime) return false;
  const scheduledAt = new Date(`${match.scheduledDate}T${String(match.scheduledTime).slice(0, 5)}:00+09:00`).getTime();
  return Number.isFinite(scheduledAt) && scheduledAt <= Date.now();
}

export function isTournamentScheduleEditable(match) {
  return getTournamentScheduleEditPolicy(match).allowed;
}

export function getTournamentSchedulePolicyLabel(match) {
  const policy = getTournamentScheduleEditPolicy(match);
  if (policy.allowed) return policy.hasSchedule ? "수정 1회 가능" : "일정 설정 가능";
  if (policy.reason === "lineup_submitted") return "출전 명단 제출 후 잠금";
  if (policy.reason === "revision_limit") return "일정 수정 1회 사용";
  return "일정 잠금";
}

export function getTournamentSchedulePolicyMessage(match) {
  const policy = getTournamentScheduleEditPolicy(match);
  if (policy.reason === "lineup_submitted") return "한 팀이라도 출전 명단을 제출한 뒤에는 경기 일정을 변경할 수 없습니다.";
  if (policy.reason === "revision_limit") return "경기 일정은 최초 지정 후 한 번만 변경할 수 있습니다.";
  return "이미 시작·종료·취소·무효 처리된 경기의 일정은 변경할 수 없습니다.";
}

export function getMatchFinalScore(match) {
  const losingSide = match?.rules?.forfeit?.losingSide || match?.forfeitSide || "";
  if (losingSide === "teamA") return { scoreA: 0, scoreB: 1 };
  if (losingSide === "teamB") return { scoreA: 1, scoreB: 0 };

  const scoreA = Number(match?.result?.scoreA ?? match?.scoreA ?? match?.score_a ?? match?.teamA?.score);
  const scoreB = Number(match?.result?.scoreB ?? match?.scoreB ?? match?.score_b ?? match?.teamB?.score);
  return Number.isFinite(scoreA) && Number.isFinite(scoreB) ? { scoreA, scoreB } : null;
}

export function getWinnerName(match) {
  const winnerTeamId = getMatchWinnerTeamId(match);
  if (!winnerTeamId) return "";
  return winnerTeamId === match.teamA?.teamId ? match.teamA?.name ?? "A" : match.teamB?.name ?? "B";
}

export function getMatchWinnerTeamId(match) {
  if (!isMatchResultConfirmed(match)) return "";
  const score = getMatchFinalScore(match);
  if (!score) return "";
  const { scoreA, scoreB } = score;
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA?.teamId ?? match.teamAId ?? "" : match.teamB?.teamId ?? match.teamBId ?? "";
}

export function getLeagueMatchResult(match) {
  if (!isMatchResultConfirmed(match)) return null;
  const score = getMatchFinalScore(match);
  const teamAId = match.teamA?.teamId ?? match.teamAId ?? "";
  const teamBId = match.teamB?.teamId ?? match.teamBId ?? "";
  if (!teamAId || !teamBId || !score) return null;
  return { teamAId, teamBId, ...score };
}

export function getLeagueFixtureState(match, matchId = "") {
  if (!match) return matchId
    ? { label: "경기 불러오기", tone: "blue" }
    : { label: "경기 생성 전", tone: "neutral" };

  const phase = getMatchRoomPhase(match);
  if (phase.phase === "dispute" || (["approval", "disputed"].includes(match.status) && match.result)) {
    return { label: "결과 확인 중", tone: "orange", actionLabel: "결과 확인", resultPending: true };
  }
  const labels = {
    waiting: match.scheduledDate || match.scheduledAt ? "일정 확정" : "일정 대기",
    locked: "경기 예정",
    checkin: "경기 준비",
    live: "경기 중",
    postgame: "결과 입력",
    record: "결과 확정",
    cancelled: "취소",
    void: "무효",
  };
  return { label: labels[phase.phase] ?? phase.listLabel, tone: phase.tone };
}

export function getLeagueStandings(teamRows, matches) {
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

export function getBracketRoundName(roundIndex, totalRounds) {
  const entrantCount = 2 ** (totalRounds - roundIndex);
  if (entrantCount === 2) return "결승";
  if (entrantCount === 4) return "준결승";
  return `${entrantCount}강`;
}

export function findPairingForFirstRound(row, pairings = []) {
  return pairings.find((pairing) => (
    (pairing.bracketMatch ?? pairing.fixture) === row.fixture ||
    (pairing.teamAId === row.teamAId && pairing.teamBId === row.teamBId)
  ));
}

export function getFallbackFirstRoundRows(tournament, bracketRound = {}) {
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

export function getNodeWinnerTeamId(node) {
  if (!node) return "";
  if (node.winnerTeamId) return node.winnerTeamId;
  if (node.byeTeamId) return node.byeTeamId;
  if (node.match) return getMatchWinnerTeamId(node.match);
  return "";
}

export function makeBracketSourceFromNode(node) {
  const winnerTeamId = getNodeWinnerTeamId(node);
  return {
    type: "advance",
    node,
    teamId: winnerTeamId || null,
  };
}

export function buildTournamentBracketTree(tournament, matchesById) {
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

export function getBracketSourceInfo(source, teamById) {
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

export function getBracketNodeStatus(node, teamById) {
  if (node.byeTeamId) return `${teamById[node.byeTeamId]?.name ?? "팀"} 부전승 진출`;
  if (node.match) {
    const winner = getWinnerName(node.match);
    if (winner) return `${winner} 승`;
    const fixtureState = getLeagueFixtureState(node.match);
    return fixtureState.resultPending ? fixtureState.label : getMatchTime(node.match);
  }
  const sourceA = getBracketSourceInfo(node.sourceA, teamById);
  const sourceB = getBracketSourceInfo(node.sourceB, teamById);
  if (sourceA.team && sourceB.team) return "대진 확정 · 경기 생성 대기";
  return "승자 결정 후 대진 확정";
}

export function renderBracketSource(source, teamById) {
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

export function getVerticalBracketLayout(bracketTree = []) {
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

export function renderBracketNode(node, teamById, onOpenMatch) {
  if (!node) return null;
  const winner = node.match ? getWinnerName(node.match) : "";
  return (
    <article key={node.id} className={winner || node.byeTeamId ? "bracket-match-card done" : "bracket-match-card"}>
      <div className="bracket-node-head">
        <span>{node.name}</span>
        {node.match ? <button type="button" onClick={() => onOpenMatch?.(node.match.id)}>{getLeagueFixtureState(node.match).actionLabel ?? "방 보기"}</button> : <b>{node.byeTeamId ? "BYE" : "예정"}</b>}
      </div>
      {renderBracketSource(node.sourceA, teamById)}
      <strong className="bracket-midline">vs</strong>
      {renderBracketSource(node.sourceB, teamById)}
      <em className="bracket-status">{getBracketNodeStatus(node, teamById)}</em>
      <span className="bracket-connector" aria-hidden="true" />
    </article>
  );
}
