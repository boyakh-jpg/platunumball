const fallbackSeason = {
  id: "season-zero",
  name: "Season Zero",
  subtitle: "지역 래더를 검증하는 프리시즌",
  startsAt: "2026-05-31",
  endsAt: "2026-08-31",
  regions: ["마포", "성수", "잠실", "강남"],
  promotionLine: 4,
};

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function isConfirmed(match) {
  return match.status === "confirmed" && match.result;
}

function isInSeason(match, season = fallbackSeason) {
  const matchDate = parseDate(match.scheduledDate ?? match.createdAt);
  const start = parseDate(season.startsAt);
  const end = parseDate(season.endsAt);
  if (!matchDate || !start || !end) return true;
  return matchDate >= start && matchDate <= end;
}

function getPlayerSide(match, userId) {
  if (match.teamA?.players?.includes(userId)) return "teamA";
  if (match.teamB?.players?.includes(userId)) return "teamB";
  return null;
}

function getTeamSide(match, teamId) {
  if (match.teamA?.teamId === teamId) return "teamA";
  if (match.teamB?.teamId === teamId) return "teamB";
  return null;
}

function getOppositeSide(sideName) {
  return sideName === "teamA" ? "teamB" : "teamA";
}

function getSideScore(match, sideName) {
  const resultScore = sideName === "teamA" ? match.result?.scoreA : match.result?.scoreB;
  return Number(resultScore ?? match[sideName]?.score ?? 0);
}

function getSideResult(match, sideName) {
  const otherSide = getOppositeSide(sideName);
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "draw";
  return sideScore > otherScore ? "win" : "loss";
}

export function getCurrentSeason(state = {}) {
  return state.seasons?.find((season) => season.active) ?? state.seasons?.[0] ?? fallbackSeason;
}

export function getSeasonProgress(season = fallbackSeason, now = new Date()) {
  const start = parseDate(season.startsAt);
  const end = parseDate(season.endsAt);
  if (!start || !end || end <= start) return 0;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

export function getSeasonMatches(matches = [], season = fallbackSeason) {
  return matches.filter((match) => isInSeason(match, season));
}

export function getPlayerSeasonRows(users = [], matches = [], season = fallbackSeason, region = "전체") {
  const seasonMatches = getSeasonMatches(matches, season).filter(isConfirmed);
  return users
    .filter((user) => region === "전체" || user.region === region)
    .map((user) => {
      const played = seasonMatches.filter((match) => getPlayerSide(match, user.id));
      const wins = played.filter((match) => getSideResult(match, getPlayerSide(match, user.id)) === "win").length;
      const losses = played.filter((match) => getSideResult(match, getPlayerSide(match, user.id)) === "loss").length;
      const delta = played.reduce((sum, match) => {
        const change = match.ratingResult?.find((item) => item.playerId === user.id);
        return sum + Number(change?.integratedDelta ?? 0);
      }, 0);
      const stats = played.reduce(
        (totals, match) => {
          const statLine = match.result?.playerStats?.[user.id] ?? {};
          totals.points += Number(statLine.points ?? 0);
          totals.rebounds += Number(statLine.rebounds ?? 0);
          totals.assists += Number(statLine.assists ?? 0);
          return totals;
        },
        { points: 0, rebounds: 0, assists: 0 },
      );

      return {
        ...user,
        seasonPlayed: played.length,
        seasonWins: wins,
        seasonLosses: losses,
        seasonDelta: Math.round(delta),
        seasonStats: stats,
        seasonScore: user.ratings.integrated + wins * 12 - losses * 6 + delta,
      };
    })
    .sort((a, b) => b.seasonScore - a.seasonScore || b.ratings.integrated - a.ratings.integrated);
}

export function getTeamSeasonRows(teams = [], matches = [], season = fallbackSeason, region = "전체") {
  const seasonMatches = getSeasonMatches(matches, season).filter(isConfirmed);
  return teams
    .filter((team) => region === "전체" || team.region === region)
    .map((team) => {
      const played = seasonMatches.filter((match) => getTeamSide(match, team.id));
      const wins = played.filter((match) => getSideResult(match, getTeamSide(match, team.id)) === "win").length;
      const losses = played.filter((match) => getSideResult(match, getTeamSide(match, team.id)) === "loss").length;
      const delta = played.reduce((sum, match) => {
        const sideName = getTeamSide(match, team.id);
        const sideDelta = sideName === "teamA" ? match.teamRatingResult?.teamA : match.teamRatingResult?.teamB;
        return sum + Number(sideDelta ?? 0);
      }, 0);
      return {
        ...team,
        seasonPlayed: played.length,
        seasonWins: wins,
        seasonLosses: losses,
        seasonDelta: Math.round(delta),
        seasonScore: team.mmr + wins * 16 - losses * 8 + delta,
      };
    })
    .sort((a, b) => b.seasonScore - a.seasonScore || b.mmr - a.mmr);
}

export function getLocalRivalries(teams = [], matches = [], region = "전체", limit = 6) {
  const localTeams = teams.filter((team) => region === "전체" || team.region === region);
  const pairs = [];

  for (let i = 0; i < localTeams.length; i += 1) {
    for (let j = i + 1; j < localTeams.length; j += 1) {
      const teamA = localTeams[i];
      const teamB = localTeams[j];
      const headToHead = matches.filter((match) => {
        const aSide = getTeamSide(match, teamA.id);
        const bSide = getTeamSide(match, teamB.id);
        return aSide && bSide;
      });
      const mmrGap = Math.abs(teamA.mmr - teamB.mmr);
      const heat = Math.max(0, 220 - mmrGap) + headToHead.length * 55 + Math.min(teamA.wins + teamB.wins, 40);
      pairs.push({ id: `${teamA.id}-${teamB.id}`, teamA, teamB, headToHead, mmrGap, heat });
    }
  }

  return pairs.sort((a, b) => b.heat - a.heat).slice(0, limit);
}

export function getOperationsSummary(matches = [], reports = []) {
  return {
    contract: matches.filter((match) => match.status === "contract").length,
    approval: matches.filter((match) => match.status === "approval").length,
    disputed: matches.filter((match) => match.status === "disputed").length,
    reports: reports.filter((report) => report.status !== "resolved").length,
  };
}
