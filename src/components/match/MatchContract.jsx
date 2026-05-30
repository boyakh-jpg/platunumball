import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";

export default function MatchContract({ match, users }) {
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  const renderRoster = (side) => (
    <div className="roster">
      {side.players.map((id) => {
        const user = userMap[id];
        return (
          <span key={id}>
            <i style={{ "--avatar": user?.avatarColor }} />
            {user?.name ?? "플레이어"}
          </span>
        );
      })}
    </div>
  );

  return (
    <Card className="contract-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">경기계약서</p>
          <h2>{match.title}</h2>
        </div>
        <Badge tone={match.official ? "gold" : "neutral"}>{match.official ? "공식경기" : "일반경기"}</Badge>
      </div>
      <div className="contract-grid">
        <div>
          <span>코트</span>
          <strong>{match.court}</strong>
        </div>
        <div>
          <span>방식</span>
          <strong>{match.mode}</strong>
        </div>
        <div>
          <span>목표 점수</span>
          <strong>{match.rules.targetScore}점</strong>
        </div>
        <div>
          <span>제한 시간</span>
          <strong>{match.rules.timeLimit}분</strong>
        </div>
      </div>
      <div className="two-column">
        <div>
          <h3>{match.teamA.name}</h3>
          {renderRoster(match.teamA)}
        </div>
        <div>
          <h3>{match.teamB.name}</h3>
          {renderRoster(match.teamB)}
        </div>
      </div>
      <div className="memo-box">{match.memo}</div>
      <div className="badge-row">
        {match.preRegistered ? <Badge tone="green">사전등록</Badge> : null}
        {match.evidence.map((evidence) => <Badge key={evidence.id} tone="blue">{evidence.label}</Badge>)}
      </div>
    </Card>
  );
}
