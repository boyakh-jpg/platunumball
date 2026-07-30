import Card from "../common/Card.jsx";
import Badge from "../common/Badge.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import { getApprovalStatus, isMatchRecordMatch } from "../../lib/matchUtils.js";
import { getPostgameRecordVerification } from "../../lib/postgameRecordVerification.js";

export default function ApprovalPanel({ match, teams, users, currentUserId, onApprove }) {
  const recordRoom = isMatchRecordMatch(match);
  if (!recordRoom) return null;
  const confirmed = match.status === "confirmed";
  const waitingForScore = !match.result;
  const verification = getPostgameRecordVerification(match);
  const locked = waitingForScore
    || verification.expired
    || ["confirmed", "disputed", "void", "cancelled"].includes(match.status);
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  const sideStatuses = {
    teamA: getApprovalStatus(match, teams, "teamA"),
    teamB: getApprovalStatus(match, teams, "teamB"),
  };
  const currentUserRequired = Object.values(sideStatuses).some((status) => status.requiredIds.includes(currentUserId));
  const currentUserConfirmed = Object.values(sideStatuses).some((status) => status.approvals.includes(currentUserId));
  const renderSide = (sideName) => {
    const status = sideStatuses[sideName];
    const side = match[sideName] ?? { name: sideName === "teamA" ? "A" : "B", players: [] };
    return (
      <div>
        <div className="approval-side-header">
          <strong>{side.name}</strong>
          <span>{status.approvals.length}/{status.majority} · {status.approvalLabel}</span>
        </div>
        <div className="approval-voter-list">
          {side.players.map((playerId) => {
            const user = userMap[playerId];
            const approved = status.approvals.includes(playerId);
            const isCurrentUser = playerId === currentUserId;
            const isRequiredApprover = status.requiredIds.includes(playerId);
            const disabled = locked || approved || !isCurrentUser || !isRequiredApprover || !onApprove;
            const buttonClass = [
              approved ? "approved" : "",
              isCurrentUser ? "is-current-user" : "is-not-current-user",
            ].filter(Boolean).join(" ");
            return (
              <button key={playerId} type="button" disabled={disabled} className={buttonClass} onClick={() => onApprove(sideName, playerId)}>
                <ProfileEmblem user={user} className="small" initial="P" />
                <strong>{user?.name ?? "플레이어"}</strong>
                <em>
                  {approved
                    ? "참가 확인됨"
                    : !isRequiredApprover
                      ? "확인 대상 아님"
                      : isCurrentUser
                        ? waitingForScore ? "점수 입력 대기" : "내 참가 확인"
                        : "본인 확인 대기"}
                </em>
              </button>
            );
          })}
        </div>
        <Badge tone={status.approvals.length ? "green" : "orange"}>
          {status.approvals.length}/{status.total} 확인
        </Badge>
      </div>
    );
  };

  return (
    <Card className="approval-panel record-approval-panel">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">참가 확인</p>
          <h2>{confirmed ? "기록 확정 완료" : "내 참가 사실 확인"}</h2>
        </div>
        <Badge tone={confirmed ? "green" : verification.verificationStatus === "insufficient" ? "neutral" : "orange"}>
          {confirmed
            ? "확정"
            : verification.verificationStatus === "insufficient"
              ? "확인 부족"
              : `${verification.approvalCount}/${verification.approvalThreshold} 확인`}
        </Badge>
      </div>
      <div className="approval-grid">
        {renderSide("teamA")}
        {renderSide("teamB")}
      </div>
      {!confirmed ? (
        <div className={!locked && currentUserRequired && !currentUserConfirmed ? "approval-guard-note ready" : "approval-guard-note"}>
          <strong>
            {waitingForScore
              ? "점수 입력 대기"
              : currentUserConfirmed
                ? "내 참가 확인 완료"
                : currentUserRequired
                  ? "내 참가 확인 필요"
                  : "참가자 확인 대기"}
          </strong>
          <span>
            {locked
              ? verification.verificationStatus === "insufficient"
                ? "24시간 안에 확정 기준을 채우지 못해 확인 부족으로 종료됐습니다."
                : "결과가 제출되면 각 참가자가 본인 참가 사실을 확인합니다."
              : currentUserConfirmed
                ? `전체 참가자 ${verification.approvalThreshold}명 확인 시 확정됩니다.`
                : currentUserRequired
                  ? "본인 계정으로만 참가 사실을 확인할 수 있습니다. 24시간 뒤 확인 기준을 검사합니다."
                  : "확인 대상 참가자가 직접 처리해야 합니다."}
          </span>
        </div>
      ) : null}
    </Card>
  );
}
