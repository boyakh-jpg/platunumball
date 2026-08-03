import { PLAYER_STAT_FIELDS } from "./constants.js";
import { isMatchRecordMatch, isPersonalRecordMatch } from "./matchRecordTypes.js";
import { getActualMatchPlayerSideName } from "./matchRoster.js";
import { getMatchSideResult, getMatchSideScore, hasVerifiedPlayerStats } from "./matchSummary.js";

const VERIFIED_STAT_SOURCES = new Set(["referee", "dispute_operator"]);

function isPersonalRecord(record = {}) {
  const type = record.rules?.recordType ?? record.recordType;
  return isPersonalRecordMatch(record) || type === "personal_record";
}

function getRecordStats(record = {}, playerId = "") {
  if (isMatchRecordMatch(record)) return null;
  if (record.matchId && !record.id) {
    const stats = record.stats ?? {};
    return PLAYER_STAT_FIELDS.some(({ id }) => Object.prototype.hasOwnProperty.call(stats, id)) ? stats : null;
  }
  const stats = record.result?.playerStats?.[playerId];
  return stats && (isPersonalRecord(record) || hasVerifiedPlayerStats(record, playerId)) ? stats : null;
}

export function getProfileRecordFolder(record = {}, playerId = "") {
  if (isPersonalRecord(record)) return "personal";
  if (isMatchRecordMatch(record)) return "postgame";
  const source = String(record.stats?.record_source ?? record.stats?.recordSource ?? "").toLowerCase();
  return record.refereeId || record.tournamentId || VERIFIED_STAT_SOURCES.has(source) || hasVerifiedPlayerStats(record, playerId)
    ? "official"
    : "no_referee";
}

export function filterProfileRecords(records = [], {
  folder = "summary",
  officialSection = "general",
  playerId = "",
  mode = "all",
  visibility = "all",
} = {}) {
  return records.filter((record) => {
    const recordFolder = getProfileRecordFolder(record, playerId);
    if (folder === "summary" ? recordFolder === "personal" : recordFolder !== folder) return false;
    if (folder === "official" && officialSection !== "venue") {
      if (officialSection === "tournament" ? !record.tournamentId : record.tournamentId) return false;
    }
    if (folder === "personal") {
      return visibility === "all" || (record.visibility ?? record.rules?.visibility ?? "private") === visibility;
    }
    return mode === "all" || record.mode === mode;
  });
}

export function getProfileRecordLine(record = {}, playerId = "") {
  if (record.matchId && !record.id) {
    return {
      score: Number(record.score ?? 0),
      opponentScore: Number(record.opponentScore ?? 0),
      result: record.result ?? "D",
      stats: getRecordStats(record, playerId),
    };
  }
  const sideName = getActualMatchPlayerSideName(record, playerId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    score: getMatchSideScore(record, sideName),
    opponentScore: getMatchSideScore(record, otherSide),
    result: getMatchSideResult(record, sideName),
    stats: getRecordStats(record, playerId),
  };
}

export function summarizeProfileRecords(records = [], playerId = "") {
  const summary = {
    games: 0, wins: 0, losses: 0, draws: 0,
    scoreFor: 0, scoreAgainst: 0, statGames: 0,
    totals: Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [id, 0])),
  };
  records.forEach((record) => {
    const line = getProfileRecordLine(record, playerId);
    summary.games += 1;
    summary.scoreFor += line.score;
    summary.scoreAgainst += line.opponentScore;
    if (line.result === "W") summary.wins += 1;
    else if (line.result === "L") summary.losses += 1;
    else summary.draws += 1;
    if (!line.stats) return;
    summary.statGames += 1;
    PLAYER_STAT_FIELDS.forEach(({ id }) => { summary.totals[id] += Number(line.stats[id] ?? 0); });
  });
  return {
    ...summary,
    winRate: summary.games ? (summary.wins / summary.games) * 100 : 0,
    averageScore: summary.games ? summary.scoreFor / summary.games : 0,
    averageAllowed: summary.games ? summary.scoreAgainst / summary.games : 0,
    averageDiff: summary.games ? (summary.scoreFor - summary.scoreAgainst) / summary.games : 0,
    averages: Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => [
      id,
      summary.statGames ? summary.totals[id] / summary.statGames : 0,
    ])),
  };
}

export function groupProfileRecordsByCourt(records = [], playerId = "") {
  const grouped = new Map();
  records.forEach((record) => {
    const id = record.courtId || record.court || "unknown";
    const group = grouped.get(id) ?? { id, name: record.court || "미정", records: [] };
    group.records.push(record);
    grouped.set(id, group);
  });
  return [...grouped.values()]
    .map((group) => ({ ...group, summary: summarizeProfileRecords(group.records, playerId) }))
    .sort((a, b) => b.summary.games - a.summary.games || a.name.localeCompare(b.name, "ko"));
}
