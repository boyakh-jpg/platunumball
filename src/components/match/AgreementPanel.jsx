import Card from "../common/Card.jsx";
import Badge from "../common/Badge.jsx";
import { getAgreementStatus } from "../../lib/matchUtils.js";

export default function AgreementPanel({ match, teams, users, onAgree }) {
  const locked = !["contract", "agreed"].includes(match.status);
  const completed = match.status !== "contract";
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));

  const renderSide = (sideName) => {
    const status = getAgreementStatus(match, teams, sideName);

    return (
      <div>
        <div className="approval-side-header">
          <strong>{match[sideName].name}</strong>
          <span>{status.approvals.length}/{status.majority} · {status.captainRequired ? "주장 필수" : "과반 동의"}</span>
        </div>
        <div className="approval-voter-list">
          {match[sideName].players.map((playerId) => {
            const user = userMap[playerId];
            const agreed = status.approvals.includes(playerId);
            const captain = status.captainId === playerId;

            return (
              <button
                key={playerId}
                type="button"
                disabled={locked || completed || agreed}
                className={agreed ? "approved" : ""}
                onClick={() => onAgree(sideName, playerId)}
              >
                <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "P"}</span>
                <strong>{user?.name ?? "플레이어"}</strong>
                <em>{captain ? "주장" : agreed ? "동의됨" : "동의"}</em>
              </button>
            );
          })}
        </div>
        <Badge tone={status.approved ? "green" : "orange"}>{status.approved ? "조건 충족" : "동의 필요"}</Badge>
      </div>
    );
  };

  return (
    <Card className="approval-panel">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Pre-match agreement</p>
          <h2>{completed ? "경기 전 동의 완료" : "경기 전 동의"}</h2>
        </div>
        <Badge tone={completed ? "green" : "orange"}>{completed ? "완료" : "대기"}</Badge>
      </div>
      <p className="muted">양팀 과반이 동의하면 결과 입력이 열립니다. 주장 확인 옵션이 켜져 있으면 각 팀 주장의 동의가 반드시 포함됩니다.</p>
      <div className="approval-grid">
        {renderSide("teamA")}
        {renderSide("teamB")}
      </div>
    </Card>
  );
}
