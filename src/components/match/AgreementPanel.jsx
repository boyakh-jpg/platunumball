import Card from "../common/Card.jsx";
import Badge from "../common/Badge.jsx";
import { getAgreementStatus } from "../../lib/matchUtils.js";

export default function AgreementPanel({ match, teams, users, currentUserId, onAgree }) {
  const locked = !["contract", "agreed"].includes(match.status);
  const completed = match.status !== "contract";
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  const teamAStatus = getAgreementStatus(match, teams, "teamA");
  const teamBStatus = getAgreementStatus(match, teams, "teamB");

  const renderSide = (sideName) => {
    const status = getAgreementStatus(match, teams, sideName);
    const side = match[sideName] ?? { name: sideName === "teamA" ? "A" : "B", players: [] };

    return (
      <div>
        <div className="approval-side-header">
          <strong>{side.name}</strong>
          <span>{status.approvals.length}/{status.majority} · {status.captainRequired ? "팀장 동의" : "과반 동의"}</span>
        </div>
        <div className="approval-voter-list">
          {side.players.map((playerId) => {
            const user = userMap[playerId];
            const agreed = status.approvals.includes(playerId);
            const captain = status.captainId === playerId;
            const isCurrentUser = playerId === currentUserId;
            const canCurrentUserAgree = isCurrentUser && (!status.captainRequired || captain);
            const buttonClass = [
              agreed ? "approved" : "",
              isCurrentUser ? "is-current-user" : "is-not-current-user",
            ].filter(Boolean).join(" ");

            return (
              <button
                key={playerId}
                type="button"
                disabled={locked || completed || agreed || !canCurrentUserAgree}
                className={buttonClass}
                onClick={() => onAgree(sideName, playerId)}
              >
                <span className="avatar small" style={{ "--avatar": user?.avatarColor }}>{user?.name?.slice(0, 1) ?? "P"}</span>
                <strong>{user?.name ?? "플레이어"}</strong>
                <em>{agreed ? "동의" : canCurrentUserAgree ? (captain ? "팀장 동의" : "내 동의") : status.captainRequired ? "팀장 대기" : "대리 불가"}</em>
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
      <div className="approval-status-strip">
        <span>A {teamAStatus.approvals.length}/{teamAStatus.majority}</span>
        <span>B {teamBStatus.approvals.length}/{teamBStatus.majority}</span>
        <span>{teamAStatus.captainRequired || teamBStatus.captainRequired ? "팀장 동의" : "과반"}</span>
      </div>
      <div className="approval-grid">
        {renderSide("teamA")}
        {renderSide("teamB")}
      </div>
    </Card>
  );
}
