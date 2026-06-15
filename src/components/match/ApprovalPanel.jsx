import Card from "../common/Card.jsx";
import Badge from "../common/Badge.jsx";
import { getApprovalStatus, getPlayerStatSubmitted, getResultPointAudit, getStatSubmissionStatus } from "../../lib/matchUtils.js";

export default function ApprovalPanel({ match, teams, users, currentUserId, onApprove }) {
  const confirmed = match.status === "confirmed";
  const locked = !match.result || ["confirmed", "disputed", "void", "cancelled"].includes(match.status);
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  const statStatus = getStatSubmissionStatus(match);
  const pointAudit = getResultPointAudit(match);
  const approvalReady = !locked && statStatus.complete && pointAudit.matched;
  const renderSide = (sideName) => {
    const status = getApprovalStatus(match, teams, sideName);
    return (
      <div>
        <div className="approval-side-header">
          <strong>{match[sideName].name}</strong>
          <span>{status.approvals.length}/{status.majority} · {status.captainRequired ? "주장 필수" : "과반 승인"}</span>
        </div>
        <div className="approval-voter-list">
          {match[sideName].players.map((playerId) => {
            const user = userMap[playerId];
            const approved = status.approvals.includes(playerId);
            const captain = status.captainId === playerId;
            const isCurrentUser = playerId === currentUserId;
            const statSubmitted = getPlayerStatSubmitted(match, playerId);
            const disabled = locked || approved || !isCurrentUser || !approvalReady;
            const buttonClass = [
              approved ? "approved" : "",
              statSubmitted ? "stat-submitted" : "stat-missing",
              isCurrentUser ? "is-current-user" : "is-not-current-user",
            ].filter(Boolean).join(" ");
            return (
              <button key={playerId} type="button" disabled={disabled} className={buttonClass} onClick={() => onApprove(sideName, playerId)}>
                <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "P"}</span>
                <strong>{user?.name ?? "플레이어"}</strong>
                <em>
                  {approved
                    ? "승인됨"
                    : !statSubmitted
                      ? "기록 미제출"
                      : !statStatus.complete
                        ? "전원 제출 대기"
                        : !pointAudit.matched
                          ? "득점 합계 불일치"
                          : isCurrentUser
                            ? (captain ? "주장 승인" : "내 승인")
                            : "대리 불가"}
                </em>
              </button>
            );
          })}
        </div>
        <Badge tone={status.approved ? "green" : "orange"}>{status.approved ? "조건 충족" : "승인 필요"}</Badge>
      </div>
    );
  };

  return (
    <Card className="approval-panel">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">결과 승인</p>
          <h2>{confirmed ? "티어 반영 완료" : "플레이어별 승인"}</h2>
        </div>
        <Badge tone={confirmed ? "green" : match.status === "disputed" ? "orange" : "orange"}>{confirmed ? "확정" : match.status === "disputed" ? "보류" : "대기"}</Badge>
      </div>
      <div className="approval-grid">
        {renderSide("teamA")}
        {renderSide("teamB")}
      </div>
      {!confirmed ? (
        <div className={approvalReady ? "approval-guard-note ready" : "approval-guard-note"}>
          <strong>{approvalReady ? "승인 가능" : "승인 잠김"}</strong>
          <span>
            {approvalReady
              ? "전원 개인 기록 제출과 팀 득점 합계 검사를 통과했습니다."
              : `개인 기록 ${statStatus.submitted}/${statStatus.total}명 · A ${pointAudit.teamA.statPoints}/${pointAudit.teamA.teamScore} · B ${pointAudit.teamB.statPoints}/${pointAudit.teamB.teamScore}`}
          </span>
        </div>
      ) : null}
    </Card>
  );
}
