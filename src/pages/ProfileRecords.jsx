import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { formatStatLine } from "../lib/matchUtils.js";

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

function getUserSide(match, userId) {
  if (match.teamA?.players?.includes(userId)) return "teamA";
  if (match.teamB?.players?.includes(userId)) return "teamB";
  return null;
}

function getSideScore(match, sideName) {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(match.result?.[resultKey] ?? match[sideName]?.score ?? 0);
}

function getUserResult(match, userId) {
  const sideName = getUserSide(match, userId);
  if (!sideName) return "D";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
}

function getRecordLine(match, userId) {
  const sideName = getUserSide(match, userId) ?? "teamA";
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  return {
    side: match[sideName],
    opponent: match[otherSide],
    score: getSideScore(match, sideName),
    opponentScore: getSideScore(match, otherSide),
    result: getUserResult(match, userId),
  };
}

function getTotals(records, userId) {
  return records.reduce((totals, match) => {
    const stats = match.result?.playerStats?.[userId] ?? {};
    PLAYER_STAT_FIELDS.forEach((field) => {
      totals[field.id] = (totals[field.id] ?? 0) + Number(stats[field.id] ?? 0);
    });
    return totals;
  }, {});
}

export default function ProfileRecords({ app }) {
  const user = app.currentUser;
  const records = [...app.state.matches]
    .filter((match) => match.status === "confirmed" && getUserSide(match, user.id))
    .sort(compareRecent);
  const totals = getTotals(records, user.id);
  const wins = records.filter((match) => getUserResult(match, user.id) === "W").length;
  const losses = records.filter((match) => getUserResult(match, user.id) === "L").length;
  const draws = records.length - wins - losses;
  const averageFouls = records.length ? Number(totals.fouls ?? 0) / records.length : 0;

  return (
    <div className="page-stack profile-records-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">MY RECORDS</p>
          <h1>내 기록</h1>
        </div>
        <Link className="button button-secondary button-md" to="/app/profile">프로필로</Link>
      </header>

      <Card className="section-card profile-records-summary">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Summary</p>
            <h2>{user.name}</h2>
          </div>
          <Badge tone="green">{records.length}경기</Badge>
        </div>
        <div className="opgg-stat-grid">
          <span><strong>{wins}</strong>승</span>
          <span><strong>{losses}</strong>패</span>
          <span><strong>{draws}</strong>무</span>
          <span><strong>{averageFouls.toFixed(1)}</strong>평균 파울</span>
          {PLAYER_STAT_FIELDS.map((field) => (
            <span key={field.id}>
              <strong>{totals[field.id] ?? 0}</strong>
              {field.label}
            </span>
          ))}
        </div>
      </Card>

      <Card className="section-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">History</p>
            <h2>전체 경기 기록</h2>
          </div>
        </div>
        {records.length ? (
          <div className="recent-match-list profile-records-list">
            {records.map((match) => {
              const line = getRecordLine(match, user.id);
              const stats = match.result?.playerStats?.[user.id] ?? {};
              return (
                <Link key={match.id} to={`/app/matches?match=${match.id}`} className={`recent-match-row profile-record-row result-${line.result.toLowerCase()}`}>
                  <b>{line.result}</b>
                  <span>
                    <strong>{line.side.name} vs {line.opponent.name}</strong>
                    <em>{match.scheduledAt} · {match.mode} · {match.court}</em>
                    <small>{formatStatLine(stats)}</small>
                  </span>
                  <i>{line.score}:{line.opponentScore}</i>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">확정된 경기 기록이 없습니다.</div>
        )}
      </Card>
    </div>
  );
}
