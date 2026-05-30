import Card from "../common/Card.jsx";
import Badge from "../common/Badge.jsx";
import { getApprovalStatus } from "../../lib/matchUtils.js";

export default function ApprovalPanel({ match, teams, users, onApprove }) {
  const confirmed = match.status === "confirmed";
  const locked = !match.result || ["confirmed", "disputed", "void", "cancelled"].includes(match.status);
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
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
            return (
              <button key={playerId} type="button" disabled={locked || approved} className={approved ? "approved" : ""} onClick={() => onApprove(sideName, playerId)}>
                <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "P"}</span>
                <strong>{user?.name ?? "플레이어"}</strong>
                <em>{captain ? "주장" : approved ? "승인됨" : "승인"}</em>
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
    </Card>
  );
}
