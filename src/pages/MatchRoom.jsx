import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import AgreementPanel from "../components/match/AgreementPanel.jsx";
import ApprovalPanel from "../components/match/ApprovalPanel.jsx";
import MatchContract from "../components/match/MatchContract.jsx";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MmrChange from "../components/rating/MmrChange.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { formatStatLine, getAgreementStatus, getApprovalStatus } from "../lib/matchUtils.js";

const statusMeta = {
  contract: { label: "경기 전 동의 대기", tone: "blue" },
  agreed: { label: "진행 예정", tone: "green" },
  approval: { label: "결과 승인 대기", tone: "orange" },
  disputed: { label: "이의제기 보류", tone: "orange" },
  confirmed: { label: "확정 완료", tone: "green" },
  void: { label: "무효 처리", tone: "neutral" },
  cancelled: { label: "취소됨", tone: "neutral" },
};

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
  const [disputeReason, setDisputeReason] = useState("스코어 또는 개인 기록 재확인 필요");

  if (!match) return <Navigate to="/app/create" replace />;

  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const status = statusMeta[match.status] ?? { label: match.status, tone: "blue" };
  const teamAAgreement = getAgreementStatus(match, app.state.teams, "teamA");
  const teamBAgreement = getAgreementStatus(match, app.state.teams, "teamB");
  const teamAApproval = getApprovalStatus(match, app.state.teams, "teamA");
  const teamBApproval = getApprovalStatus(match, app.state.teams, "teamB");
  const canSubmitResult = ["agreed", "approval"].includes(match.status);
  const canCancel = ["contract", "agreed"].includes(match.status);
  const canDispute = Boolean(match.result) && match.status === "approval";
  const canVoid = match.status === "disputed";
  const canResumeApproval = match.status === "disputed";

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
    if (canSubmitResult) app.actions.submitMatchResult(match.id, score);
  };

  return (
    <div className="page-stack match-room">
      <section className="match-hero">
        <div className="match-hero-copy">
          <div className="badge-row">
            <Badge tone={match.official ? "gold" : "neutral"}>{match.official ? "공식경기" : "일반경기"}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
            {match.preRegistered ? <Badge tone="green">사전등록</Badge> : null}
          </div>
          <p className="eyebrow">경기방</p>
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
          <AgreementPanel
            match={match}
            teams={app.state.teams}
            users={app.state.users}
            onAgree={(sideName, playerId) => app.actions.agreeMatch(match.id, sideName, playerId)}
          />
          <Card className="section-card result-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Result entry</p>
                <h2>경기 결과 입력</h2>
              </div>
              <Badge tone={canSubmitResult ? "green" : "neutral"}>{canSubmitResult ? "입력 가능" : "잠김"}</Badge>
            </div>
            {!canSubmitResult ? (
              <p className="muted">
                {match.status === "contract"
                  ? "양팀 경기 전 동의가 끝나면 결과 입력이 열립니다."
                  : "확정, 보류, 취소, 무효 상태에서는 결과를 수정하지 않습니다."}
              </p>
            ) : null}
            <form className="score-form" onSubmit={submitResult}>
              <label>
                {match.teamA.name}
                <input type="number" min="0" disabled={!canSubmitResult} value={score.scoreA} onChange={(event) => setScore((current) => ({ ...current, scoreA: event.target.value }))} />
              </label>
              <span>:</span>
              <label>
                {match.teamB.name}
                <input type="number" min="0" disabled={!canSubmitResult} value={score.scoreB} onChange={(event) => setScore((current) => ({ ...current, scoreB: event.target.value }))} />
              </label>
              <Button type="submit" disabled={!canSubmitResult}>결과 저장</Button>
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
                                disabled={!canSubmitResult}
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
                <span>Team A 동의</span>
                <strong>{teamAAgreement.approvals.length}/{teamAAgreement.majority}</strong>
              </div>
              <div>
                <span>Team B 동의</span>
                <strong>{teamBAgreement.approvals.length}/{teamBAgreement.majority}</strong>
              </div>
              <div>
                <span>Team A 결과 승인</span>
                <strong>{teamAApproval.approvals.length}/{teamAApproval.majority}</strong>
              </div>
              <div>
                <span>Team B 결과 승인</span>
                <strong>{teamBApproval.approvals.length}/{teamBApproval.majority}</strong>
              </div>
              <div>
                <span>주장 확인 조건</span>
                <strong>{teamAApproval.captainRequired ? "필수" : "선택"}</strong>
              </div>
              <div>
                <span>현재 상태</span>
                <strong>{status.label}</strong>
              </div>
            </div>
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Review controls</p>
                <h2>보류와 취소</h2>
              </div>
              <Badge tone={canDispute || canCancel || canVoid ? "orange" : "neutral"}>{canDispute || canCancel || canVoid ? "처리 가능" : "닫힘"}</Badge>
            </div>
            {match.disputes?.[0] ? <p className="muted">최근 이의제기: {match.disputes[0].reason}</p> : null}
            <label className="memo-label">
              이의제기 사유
              <textarea disabled={!canDispute} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} />
            </label>
            <div className="match-action-row">
              <Button type="button" variant="secondary" disabled={!canDispute} onClick={() => app.actions.disputeMatch(match.id, disputeReason)}>이의제기</Button>
              <Button type="button" variant="secondary" disabled={!canCancel} onClick={() => app.actions.cancelMatch(match.id)}>경기 취소</Button>
              <Button type="button" variant="secondary" disabled={!canResumeApproval} onClick={() => app.actions.resumeMatchApproval(match.id)}>승인 재개</Button>
              <Button type="button" variant="secondary" disabled={!canVoid} onClick={() => app.actions.voidMatch(match.id)}>무효 처리</Button>
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
          <ShareCard user={app.currentUser} match={match} />
        </aside>
      </div>
    </div>
  );
}
