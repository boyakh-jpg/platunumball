import { useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import MatchContract from "../components/match/MatchContract.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MmrChange from "../components/rating/MmrChange.jsx";

export default function MatchRoom({ app }) {
  const { matchId } = useParams();
  const match = useMemo(
    () => app.state.matches.find((item) => item.id === matchId) ?? app.state.matches[0],
    [app.state.matches, matchId],
  );
  const [score, setScore] = useState({
    scoreA: match?.result?.scoreA ?? match?.teamA.score ?? 21,
    scoreB: match?.result?.scoreB ?? match?.teamB.score ?? 17,
  });

  if (!match) return <Navigate to="/app/create" replace />;

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
          <p className="eyebrow">RankBall Contract</p>
          <h1>{match.title}</h1>
          <p>{match.court} · {match.scheduledAt} · {match.mode}</p>
        </div>
        <div className="scoreboard-panel">
          <div>
            <span>{match.teamA.name}</span>
            <strong>{match.teamA.score ?? 0}</strong>
          </div>
          <i>VS</i>
          <div>
            <span>{match.teamB.name}</span>
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
                <p className="eyebrow">Result</p>
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
            </form>
          </Card>
          <ApprovalPanel match={match} onApprove={(sideName) => app.actions.approveMatch(match.id, sideName)} />
        </div>
        <aside className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Rating Impact</p>
                <h2>MMR 변동</h2>
              </div>
            </div>
            {match.ratingResult ? (
              <div className="delta-list">
                {match.ratingResult.map((change) => {
                  const user = app.state.users.find((item) => item.id === change.playerId);
                  return (
                    <div key={`${change.playerId}-${change.side}`} className="delta-row">
                      <span>{user?.name ?? "플레이어"}</span>
                      <MmrChange value={change.integratedDelta} label="통합" />
                      <MmrChange value={change.modeDelta} label={match.mode} />
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
                <strong>{match.approvals.teamA.length}</strong>
              </div>
              <div>
                <span>Team B 승인</span>
                <strong>{match.approvals.teamB.length}</strong>
              </div>
              <div>
                <span>현재 상태</span>
                <strong>{statusLabel}</strong>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
