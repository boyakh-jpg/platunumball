import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import MatchContract from "../components/match/MatchContract.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MmrChange from "../components/rating/MmrChange.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { formatStatLine, getApprovalStatus } from "../lib/matchUtils.js";

function makeInitialStats(match) {
  const playerIds = [...(match?.teamA.players ?? []), ...(match?.teamB.players ?? [])];
  return Object.fromEntries(
    playerIds.map((playerId) => [
      playerId,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field.id, match?.result?.playerStats?.[playerId]?.[field.id] ?? 0])),
    ]),
  );
}

export default function MatchRoom({ app }) {
  const { matchId } = useParams();
  const match = useMemo(
    () => app.state.matches.find((item) => item.id === matchId) ?? app.state.matches[0],
    [app.state.matches, matchId],
  );
  const [score, setScore] = useState({
    scoreA: match?.result?.scoreA ?? match?.teamA.score ?? 21,
    scoreB: match?.result?.scoreB ?? match?.teamB.score ?? 17,
    playerStats: makeInitialStats(match),
  });

  if (!match) return <Navigate to="/app/create" replace />;

  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const teamAApproval = getApprovalStatus(match, app.state.teams, "teamA");
  const teamBApproval = getApprovalStatus(match, app.state.teams, "teamB");
  const updatePlayerStat = (playerId, fieldId, value) => {
    setScore((current) => ({
      ...current,
      playerStats: {
        ...current.playerStats,
        [playerId]: {
          ...(current.playerStats[playerId] ?? {}),
          [fieldId]: value,
        },
      },
    }));
  };
  const submitResult = (event) => {
    event.preventDefault();
    app.actions.submitMatchResult(match.id, score);
  };
  const statusLabel = match.status === "confirmed" ? "확정 완료" : match.status === "approval" ? "승인 대기" : "계약서 대기";

  return (
    <div className="page-stack match-room">
      <section className="match-hero">
        <div className="match-hero-copy">
          <div className="badge-row">
            <Badge tone={match.official ? "gold" : "neutral"}>{match.official ? "공식경기" : "일반경기"}</Badge>
            <Badge tone={match.status === "confirmed" ? "green" : "blue"}>{statusLabel}</Badge>
            {match.preRegistered ? <Badge tone="green">사전등록</Badge> : null}
          </div>
          <p className="eyebrow">경기 계약서</p>
          <h1>{match.title}</h1>
          <p>{match.court} · {match.scheduledAt} · {match.mode}</p>
        </div>
        <div className="scoreboard-panel">
          <div>
            <Link to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</Link>
            <strong>{match.teamA.score ?? 0}</strong>
          </div>
          <i>VS</i>
          <div>
            <Link to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</Link>
            <strong>{match.teamB.score ?? 0}</strong>
          </div>
        </div>
      </section>

      <div className="content-grid wide-left">
        <div className="page-stack">
          <MatchContract match={match} users={app.state.users} />
          <Card className="section-card result-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">결과 입력</p>
                <h2>경기 결과 입력</h2>
              </div>
            </div>
            <form className="score-form" onSubmit={submitResult}>
              <label>
                {match.teamA.name}
                <input type="number" min="0" value={score.scoreA} onChange={(event) => setScore((current) => ({ ...current, scoreA: event.target.value }))} />
              </label>
              <span>:</span>
              <label>
                {match.teamB.name}
                <input type="number" min="0" value={score.scoreB} onChange={(event) => setScore((current) => ({ ...current, scoreB: event.target.value }))} />
              </label>
              <Button type="submit" disabled={match.status === "confirmed"}>결과 저장</Button>
              <div className="stat-entry-grid">
                {["teamA", "teamB"].map((sideName) => (
                  <div key={sideName} className="stat-entry-side">
                    <h3>{match[sideName].name} 개인 기록</h3>
                    {match[sideName].players.map((playerId) => {
                      const user = userMap[playerId];
                      return (
                        <div key={playerId} className="player-stat-row">
                          <div>
                            <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "P"}</span>
                            <strong>{user?.name ?? "플레이어"}</strong>
                          </div>
                          {PLAYER_STAT_FIELDS.map((field) => (
                            <label key={field.id}>
                              {field.shortLabel}
                              <input
                                type="number"
                                min="0"
                                value={score.playerStats[playerId]?.[field.id] ?? 0}
                                onChange={(event) => updatePlayerStat(playerId, field.id, event.target.value)}
                              />
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </form>
          </Card>
          <ApprovalPanel match={match} teams={app.state.teams} users={app.state.users} onApprove={(sideName, playerId) => app.actions.approveMatch(match.id, sideName, playerId)} />
        </div>
        <aside className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">티어 반영</p>
                <h2>MMR 변동</h2>
              </div>
            </div>
            {match.ratingResult ? (
              <div className="delta-list">
                {match.ratingResult.map((change) => {
                  const user = app.state.users.find((item) => item.id === change.playerId);
                  return (
                    <div key={`${change.playerId}-${change.side}`} className="delta-row">
                      <Link to={`/app/players/${change.playerId}`}>{user?.name ?? "플레이어"}</Link>
                      <MmrChange value={change.integratedDelta} label="통합" />
                      <MmrChange value={change.modeDelta} label={match.mode} />
                      {change.statBoost ? <MmrChange value={change.statBoost} label="스탯" /> : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted">양팀 과반 승인 후 통합/모드별 MMR이 반영됩니다.</p>
            )}
          </Card>
          <Card className="section-card">
            <div className="contract-grid single">
              <div>
                <span>Team A 승인</span>
                <strong>{teamAApproval.approvals.length}/{teamAApproval.majority}</strong>
              </div>
              <div>
                <span>Team B 승인</span>
                <strong>{teamBApproval.approvals.length}/{teamBApproval.majority}</strong>
              </div>
              <div>
                <span>주장 승인 조건</span>
                <strong>{teamAApproval.captainRequired ? "필수" : "선택"}</strong>
              </div>
              <div>
                <span>현재 상태</span>
                <strong>{statusLabel}</strong>
              </div>
            </div>
          </Card>
          {match.result?.playerStats ? (
            <Card className="section-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">개인 기록</p>
                  <h2>개인 스탯 요약</h2>
                </div>
              </div>
              <div className="compact-list">
                {[...match.teamA.players, ...match.teamB.players].map((playerId) => {
                  const user = userMap[playerId];
                  return (
                    <div key={playerId}>
                      <span>{user?.name ?? "플레이어"}</span>
                      <strong>{formatStatLine(match.result.playerStats[playerId])}</strong>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
