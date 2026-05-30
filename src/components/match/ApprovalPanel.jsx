import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import Badge from "../common/Badge.jsx";

function approvalText(match, sideName) {
  const total = match[sideName].players.length;
  const needed = Math.floor(total / 2) + 1;
  return `${match.approvals[sideName].length}/${needed}`;
}

export default function ApprovalPanel({ match, onApprove }) {
  const confirmed = match.status === "confirmed";
  return (
    <Card className="approval-panel">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">결과 승인</p>
          <h2>{confirmed ? "티어 반영 완료" : "양팀 과반 승인"}</h2>
        </div>
        <Badge tone={confirmed ? "green" : "orange"}>{confirmed ? "확정" : "대기"}</Badge>
      </div>
      <div className="approval-grid">
        <div>
          <strong>{match.teamA.name}</strong>
          <span>{approvalText(match, "teamA")}</span>
          <Button disabled={!match.result || confirmed} onClick={() => onApprove("teamA")}>과반 승인</Button>
        </div>
        <div>
          <strong>{match.teamB.name}</strong>
          <span>{approvalText(match, "teamB")}</span>
          <Button disabled={!match.result || confirmed} onClick={() => onApprove("teamB")}>과반 승인</Button>
        </div>
      </div>
    </Card>
  );
}
