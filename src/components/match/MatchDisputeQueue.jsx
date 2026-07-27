import { useState } from "react";
import { RefreshCw } from "lucide-react";
import Button from "../common/Button.jsx";

function getDisputeRequestSummary(dispute = {}, match = {}) {
  const request = dispute.request ?? {};
  if (request.kind === "team_score") {
    const sideName = request.side === "teamB" ? "teamB" : "teamA";
    const scoreKey = sideName === "teamA" ? "scoreA" : "scoreB";
    const sideLabel = sideName === "teamA" ? "A" : "B";
    const requestedScore = Number(request.requestedScore);
    if (!Number.isFinite(requestedScore)) return "점수 확인 요청";
    const currentScore = Number(match.result?.[scoreKey] ?? match[sideName]?.score ?? 0);
    return `${sideLabel} 점수 ${currentScore}점 → ${Math.max(0, Math.round(requestedScore))}점 요청`;
  }
  const playerId = String(request.playerId ?? "");
  const requestedPoints = Number(request.requestedPoints);
  if (!playerId || !Number.isFinite(requestedPoints)) return "기록 확인 요청";
  const currentPoints = Number(match.result?.playerStats?.[playerId]?.points ?? 0);
  return `득점 ${currentPoints}점 → ${Math.max(0, Math.round(requestedPoints))}점 요청`;
}

export default function MatchDisputeQueue({
  match,
  userById = {},
  canResolve = false,
  onResolve,
  onRefresh,
  refreshing = false,
}) {
  const [pendingId, setPendingId] = useState("");
  const openDisputes = (match?.disputes ?? [])
    .filter((dispute) => dispute?.status === "open")
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));

  if (!openDisputes.length) return null;

  const resolveItem = async (disputeId, decision) => {
    if (!canResolve || pendingId) return;
    setPendingId(disputeId);
    try {
      await onResolve?.(disputeId, decision);
    } finally {
      setPendingId("");
    }
  };

  return (
    <section className="match-dispute-queue" aria-label="이의제기 처리 큐">
      <div className="match-dispute-queue-head">
        <div>
          <strong>이의제기 처리 큐</strong>
          <span>접수 순서와 관계없이 각 요청을 독립적으로 처리합니다.</span>
        </div>
        <div className="match-dispute-queue-head-actions">
          <em>{openDisputes.length}건</em>
          {onRefresh ? (
            <Button type="button" size="sm" variant="secondary" disabled={refreshing} onClick={() => void onRefresh()}>
              <RefreshCw size={14} /> {refreshing ? "갱신 중" : "새로고침"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="match-dispute-queue-list">
        {openDisputes.map((dispute) => (
          <article className="match-dispute-queue-item" key={dispute.id}>
            <div>
              <strong>{userById[dispute.by]?.name ?? "참여자"}</strong>
              <span>{getDisputeRequestSummary(dispute, match)}</span>
              <p>{dispute.reason}</p>
            </div>
            {canResolve ? (
              <div className="match-dispute-queue-actions">
                <Button type="button" size="sm" disabled={Boolean(pendingId)} onClick={() => resolveItem(dispute.id, "accepted")}>
                  {pendingId === dispute.id ? "처리 중" : "가결"}
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={Boolean(pendingId)} onClick={() => resolveItem(dispute.id, "rejected")}>
                  부결
                </Button>
              </div>
            ) : <small>방장 처리 대기</small>}
          </article>
        ))}
      </div>
    </section>
  );
}
