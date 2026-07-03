import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { formatStatLine } from "../lib/matchUtils.js";

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

function getRecordDate(match) {
  return String(match.scheduledDate ?? match.scheduledAt ?? match.confirmedAt ?? match.createdAt ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "날짜 미정";
}

function isRecordInDetailWindow(match) {
  const recordDate = new Date(getRecordDate(match));
  if (!Number.isFinite(recordDate.getTime())) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  return recordDate >= cutoff;
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
  const loadKeyRef = useRef("");
  useEffect(() => {
    if (!app.remoteReady || !app.actions.loadProfileRecords) return;
    if (app.actions.profileRecordsLoaded) return;
    if (loadKeyRef.current === user.id) return;
    loadKeyRef.current = user.id;
    app.actions.loadProfileRecords();
  }, [app.actions, app.remoteReady, user.id]);
  const records = [...app.state.matches]
    .filter((match) => match.status === "confirmed" && getUserSide(match, user.id))
    .sort(compareRecent);
  const recentRecords = records.filter(isRecordInDetailWindow);
  const archivedRecords = records.filter((match) => !isRecordInDetailWindow(match));
  const totals = getTotals(recentRecords, user.id);
  const wins = recentRecords.filter((match) => getUserResult(match, user.id) === "W").length;
  const losses = recentRecords.filter((match) => getUserResult(match, user.id) === "L").length;
  const draws = recentRecords.length - wins - losses;
  const averageFouls = recentRecords.length ? Number(totals.fouls ?? 0) / recentRecords.length : 0;
  const dateRows = [...recentRecords.reduce((map, match) => {
    const date = getRecordDate(match);
    map.set(date, (map.get(date) ?? 0) + 1);
    return map;
  }, new Map()).entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));

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
          <Badge tone="green">최근 6개월 {recentRecords.length}경기</Badge>
        </div>
        <div className="rank-stat-grid">
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
            <p className="eyebrow">Calendar</p>
            <h2>날짜별 기록 수</h2>
          </div>
          <Badge tone="blue">6개월</Badge>
        </div>
        <div className="rank-stat-grid">
          {dateRows.length ? dateRows.slice(0, 24).map(([date, count]) => (
            <span key={date}><strong>{count}</strong>{date}</span>
          )) : <span><strong>0</strong>기록 없음</span>}
        </div>
      </Card>

      <Card className="section-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">History</p>
            <h2>최근 6개월 경기 기록</h2>
          </div>
        </div>
        {recentRecords.length ? (
          <div className="recent-match-list profile-records-list">
            {recentRecords.map((match) => {
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
      {archivedRecords.length ? (
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Archive</p>
              <h2>6개월 초과 기록</h2>
            </div>
            <Badge tone="neutral">텍스트 {archivedRecords.length}경기</Badge>
          </div>
          <div className="recent-match-list profile-records-list">
            {archivedRecords.map((match) => {
              const line = getRecordLine(match, user.id);
              return (
                <div key={match.id} className={`recent-match-row profile-record-row record-archive-row result-${line.result.toLowerCase()}`}>
                  <b>{line.result}</b>
                  <span>
                    <strong>{line.side.name} vs {line.opponent.name}</strong>
                    <em>{getRecordDate(match)} · {match.mode} · {match.court}</em>
                    <small>상세 데이터는 보관 목록에서 텍스트로만 표시</small>
                  </span>
                  <i>{line.score}:{line.opponentScore}</i>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
