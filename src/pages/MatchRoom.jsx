import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { CalendarDays, MapPin, Minus, Plus, ShieldCheck, Trophy, UsersRound, X } from "lucide-react";
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

function getTeamMmr(teams, teamId) {
  return teams.find((team) => team.id === teamId)?.mmr ?? 0;
}

function getDisplayScore(match, sideName) {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return match.result?.[resultKey] ?? match[sideName].score ?? 0;
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
  const [statEditorPlayerId, setStatEditorPlayerId] = useState(null);

  if (!match) return <Navigate to="/app/create" replace />;

  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const statEditorPlayer = statEditorPlayerId ? userMap[statEditorPlayerId] : null;
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
  const canReport = !["cancelled", "void"].includes(match.status);
  const scoreA = getDisplayScore(match, "teamA");
  const scoreB = getDisplayScore(match, "teamB");
  const teamAMmr = getTeamMmr(app.state.teams, match.teamA.teamId);
  const teamBMmr = getTeamMmr(app.state.teams, match.teamB.teamId);
  const winnerName = Number(scoreA) === Number(scoreB) ? "" : Number(scoreA) > Number(scoreB) ? match.teamA.name : match.teamB.name;
  const matchKind = match.ranked === false ? "친선전" : "정규전";
  const renderHeroRoster = (sideName) => {
    const team = match[sideName];
    const agreement = sideName === "teamA" ? teamAAgreement : teamBAgreement;

    return (
      <div className="gm-roster-row">
        {team.players.map((playerId) => {
          const user = userMap[playerId];
          const ready = agreement.approvals.includes(playerId) || match.status !== "contract";
          const captain = agreement.captainId === playerId;

          return (
            <Link key={playerId} to={`/app/players/${playerId}`} className={ready ? "gm-player-slot ready" : "gm-player-slot"}>
              <span className="avatar" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "P"}</span>
              <strong>{user?.name ?? "플레이어"}</strong>
              <em>{captain ? "CAPT" : ready ? "READY" : "WAIT"}</em>
            </Link>
          );
        })}
      </div>
    );
  };

  const updatePlayerStat = (playerId, fieldId, value) => {
    const nextValue = Math.max(0, Number(value ?? 0));
    setScore((current) => ({
      ...current,
      playerStats: {
        ...current.playerStats,
        [playerId]: {
          ...(current.playerStats[playerId] ?? {}),
          [fieldId]: nextValue,
        },
      },
    }));
  };
  const bumpPlayerStat = (playerId, fieldId, delta) => {
    const currentValue = Number(score.playerStats[playerId]?.[fieldId] ?? 0);
    updatePlayerStat(playerId, fieldId, currentValue + delta);
  };
  const submitResult = (event) => {
    event.preventDefault();
    if (canSubmitResult) app.actions.submitMatchResult(match.id, score);
  };

  return (
    <div className="page-stack match-room">
      <section className={match.ranked === false ? "gm-room-hero gm-friendly" : "gm-room-hero gm-ranked"}>
        <div className="gm-room-topline">
          <div className="badge-row">
            <Badge tone={match.ranked === false ? "neutral" : "gold"}>{matchKind}</Badge>
            <Badge tone={status.tone}>{status.label}</Badge>
            {match.preRegistered ? <Badge tone="green">사전등록</Badge> : null}
          </div>
          <span>{match.mode}</span>
        </div>

        <div className="gm-room-title">
          <span>{match.official ? "OFFICIAL ROOM" : "CUSTOM ROOM"}</span>
          <h1>{matchKind}</h1>
          <p><MapPin size={16} />{match.court} · {match.scheduledAt}</p>
        </div>

        <div className="gm-versus-stage">
          <div className="gm-team-panel team-a">
            <div className="gm-team-head">
              <span>HOME TEAM</span>
              <Link to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</Link>
              <em>{teamAMmr || "-"} MMR</em>
            </div>
            {renderHeroRoster("teamA")}
          </div>

          <div className="gm-score-core">
            <strong>{scoreA}</strong>
            <i>VS</i>
            <strong>{scoreB}</strong>
            <span>{winnerName ? `${winnerName} 우세` : "전투 준비"}</span>
          </div>

          <div className="gm-team-panel team-b">
            <div className="gm-team-head">
              <span>OPPONENT</span>
              <Link to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</Link>
              <em>{teamBMmr || "-"} MMR</em>
            </div>
            {renderHeroRoster("teamB")}
          </div>
        </div>

        <div className="gm-room-actions">
          <div><CalendarDays size={17} /><span>{match.scheduledDate ?? "일정"} {match.scheduledTime ?? ""}</span></div>
          <div><UsersRound size={17} /><span>{match.teamA.players.length} vs {match.teamB.players.length}</span></div>
          <div><ShieldCheck size={17} /><span>{match.ranked === false ? "티어 자유" : "MMR 반영"}</span></div>
          <div><Trophy size={17} /><span>{match.rules.targetScore}점 · {match.rules.timeLimit}분</span></div>
        </div>
      </section>

      <div className="content-grid wide-left">
        <div className="page-stack">
          <MatchContract match={match} users={app.state.users} />
          <AgreementPanel
            match={match}
            teams={app.state.teams}
            users={app.state.users}
            currentUserId={app.currentUser.id}
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
              <div className="empty-state">{match.status === "contract" ? "동의 필요" : "수정 잠김"}</div>
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
              <div className="stat-entry-grid compact-stat-entry">
                {["teamA", "teamB"].map((sideName) => (
                  <div key={sideName} className="stat-entry-side">
                    <h3>{match[sideName].name} 개인 기록</h3>
                    {match[sideName].players.map((playerId) => {
                      const user = userMap[playerId];
                      return (
                        <button key={playerId} type="button" className="stat-player-button" disabled={!canSubmitResult} onClick={() => setStatEditorPlayerId(playerId)}>
                          <div>
                            <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "P"}</span>
                            <span>
                              <strong>{user?.name ?? "플레이어"}</strong>
                              <em>{formatStatLine(score.playerStats[playerId])}</em>
                            </span>
                          </div>
                          <strong>입력</strong>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </form>
          </Card>
          <ApprovalPanel match={match} teams={app.state.teams} users={app.state.users} currentUserId={app.currentUser.id} onApprove={(sideName, playerId) => app.actions.approveMatch(match.id, sideName, playerId)} />
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
              <div className="empty-state">승인 대기</div>
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
              <Button type="button" variant="secondary" disabled={!canReport} onClick={() => app.actions.reportMatch(match.id, disputeReason)}>신고 접수</Button>
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
      {statEditorPlayer ? (
        <div className="modal-backdrop stat-editor-backdrop" onClick={() => setStatEditorPlayerId(null)}>
          <div className="modal stat-editor-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">개인 기록</p>
                <h2>{statEditorPlayer.name}</h2>
                <span>{formatStatLine(score.playerStats[statEditorPlayerId])}</span>
              </div>
              <button type="button" className="button button-secondary button-icon" onClick={() => setStatEditorPlayerId(null)} aria-label="닫기">
                <X size={18} />
              </button>
            </div>
            <div className="stat-stepper-list">
              {PLAYER_STAT_FIELDS.map((field) => (
                <div key={field.id} className="stat-stepper-row">
                  <div>
                    <strong>{field.label}</strong>
                    <span>{field.shortLabel}</span>
                  </div>
                  <button type="button" disabled={!canSubmitResult} onClick={() => bumpPlayerStat(statEditorPlayerId, field.id, -1)}><Minus size={16} /></button>
                  <input
                    type="number"
                    min="0"
                    disabled={!canSubmitResult}
                    value={score.playerStats[statEditorPlayerId]?.[field.id] ?? 0}
                    onChange={(event) => updatePlayerStat(statEditorPlayerId, field.id, event.target.value)}
                  />
                  <button type="button" disabled={!canSubmitResult} onClick={() => bumpPlayerStat(statEditorPlayerId, field.id, 1)}><Plus size={16} /></button>
                </div>
              ))}
            </div>
            <Button type="button" onClick={() => setStatEditorPlayerId(null)}>완료</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
