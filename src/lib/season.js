import { getMatchPlayedDate, getMatchSideScore as getSideScore } from "./matchUtils.js";
import { SOLO_RECORD_MODE_IDS } from "./constants.js";

const fallbackSeason = {
  id: "season-zero",
  name: "Season Zero",
  subtitle: "전국 래더를 검증하는 프리시즌",
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
  const matchDate = parseDate(getMatchPlayedDate(match));
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

export function getTeamSide(match, teamId) {
  if (match.teamA?.teamId === teamId) return "teamA";
  if (match.teamB?.teamId === teamId) return "teamB";
  return null;
}

function getOppositeSide(sideName) {
  return sideName === "teamA" ? "teamB" : "teamA";
}

export function getSideResult(match, sideName) {
  const otherSide = getOppositeSide(sideName);
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "draw";
  return sideScore > otherScore ? "win" : "loss";
}

export function getTeamScoreSummary(matches = [], archiveRecords = [], teamId = "") {
  const rows = [];
  const seenMatchIds = new Set();

  matches.forEach((match) => {
    if (!isConfirmed(match)) return;
    const sideName = getTeamSide(match, teamId);
    if (!sideName) return;
    if (match.id) seenMatchIds.add(String(match.id));
    rows.push({
      pointsFor: getSideScore(match, sideName),
      pointsAgainst: getSideScore(match, getOppositeSide(sideName)),
    });
  });

  archiveRecords.forEach((record) => {
    const matchId = String(record?.matchId ?? "").trim();
    if (matchId && seenMatchIds.has(matchId)) return;
    const pointsFor = Number(record?.score);
    const pointsAgainst = Number(record?.opponentScore);
    if (!Number.isFinite(pointsFor) || !Number.isFinite(pointsAgainst)) return;
    if (matchId) seenMatchIds.add(matchId);
    rows.push({ pointsFor, pointsAgainst });
  });

  const totals = rows.reduce((summary, row) => {
    const margin = row.pointsFor - row.pointsAgainst;
    return {
      pointsFor: summary.pointsFor + row.pointsFor,
      pointsAgainst: summary.pointsAgainst + row.pointsAgainst,
      wins: summary.wins + Number(margin > 0),
      losses: summary.losses + Number(margin < 0),
      draws: summary.draws + Number(margin === 0),
      highestPointsFor: Math.max(summary.highestPointsFor, row.pointsFor),
      lowestPointsAgainst: Math.min(summary.lowestPointsAgainst, row.pointsAgainst),
      largestWinMargin: Math.max(summary.largestWinMargin, margin),
    };
  }, {
    pointsFor: 0,
    pointsAgainst: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    highestPointsFor: 0,
    lowestPointsAgainst: Number.POSITIVE_INFINITY,
    largestWinMargin: 0,
  });
  const games = rows.length;
  return {
    games,
    ...totals,
    lowestPointsAgainst: games ? totals.lowestPointsAgainst : 0,
    averagePointsFor: games ? totals.pointsFor / games : 0,
    averagePointsAgainst: games ? totals.pointsAgainst / games : 0,
    averageMargin: games ? (totals.pointsFor - totals.pointsAgainst) / games : 0,
  };
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

function getSeasonMatches(matches = [], season = fallbackSeason) {
  return matches.filter((match) => isInSeason(match, season));
}

export function getPlayerSeasonActivity(matches = [], userId = "", season = fallbackSeason) {
  const confirmedMatches = getSeasonMatches(matches, season)
    .filter(isConfirmed)
    .filter((match) => getPlayerSide(match, userId));
  const modes = Object.fromEntries([...SOLO_RECORD_MODE_IDS].map((mode) => [
    mode,
    confirmedMatches.filter((match) => match.mode === mode).length,
  ]));
  const primaryMode = Object.entries(modes)
    .sort((a, b) => b[1] - a[1] || Number.parseInt(b[0], 10) - Number.parseInt(a[0], 10))
    .find(([, count]) => count > 0)?.[0] ?? "기록 없음";

  return {
    total: confirmedMatches.length,
    modes,
    primaryMode,
    ranked: confirmedMatches.filter((match) => match.ranked !== false).length,
    friendly: confirmedMatches.filter((match) => match.ranked === false).length,
    official: confirmedMatches.filter((match) => match.official === true).length,
  };
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

export function getLocalRivalries(teams = [], matches = [], region = "전체", limit = 6, anchorTeamIds = []) {
  const anchorTeamIdSet = new Set(anchorTeamIds);
  const localTeams = anchorTeamIdSet.size
    ? teams
    : teams.filter((team) => region === "전체" || team.region === region);
  const pairs = [];

  for (let i = 0; i < localTeams.length; i += 1) {
    for (let j = i + 1; j < localTeams.length; j += 1) {
      const teamA = localTeams[i];
      const teamB = localTeams[j];
      if (anchorTeamIdSet.size && anchorTeamIdSet.has(teamA.id) === anchorTeamIdSet.has(teamB.id)) continue;
      if (anchorTeamIdSet.size && teamA.region !== teamB.region) continue;
      const headToHead = matches.filter((match) => {
        if (!isConfirmed(match)) return false;
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
