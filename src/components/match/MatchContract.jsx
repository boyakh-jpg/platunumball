import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import { CREDIBILITY_LEVELS } from "../../lib/constants.js";
import { getMatchReferee, normalizeStatRecorders } from "../../lib/matchUtils.js";
import { getCredibilityLevel } from "../../lib/rating.js";

const mmrLimitLabels = {
  off: "제한 없음",
  warn: "경고만",
  block: "생성 차단",
};

export default function MatchContract({ match, users, teams = [] }) {
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  const credibility = CREDIBILITY_LEVELS[getCredibilityLevel(match)] ?? CREDIBILITY_LEVELS.street_majority;
  const referee = getMatchReferee(match, users);
  const statRecorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const recorderLabel = ["teamA", "teamB"]
    .filter((sideName) => statRecorders[sideName])
    .map((sideName) => `${sideName === "teamA" ? "A팀" : "B팀"} ${userMap[statRecorders[sideName]]?.name ?? "후보"}`)
    .join(" · ");
  const renderRoster = (side) => (
    <div className="roster">
      {side.players.map((id) => {
        const user = userMap[id];
        return (
          <PlayerHoverCard key={id} user={user} teams={teams}>
            <i style={{ "--avatar": user?.avatarColor }} />
            <strong>{user?.name ?? "플레이어"}</strong>
            <em>{user?.position ?? "-"}</em>
          </PlayerHoverCard>
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
          <span>일정</span>
          <strong>{match.scheduledDate ?? match.scheduledAt}</strong>
        </div>
        <div>
          <span>시간</span>
          <strong>{match.scheduledTime ?? "-"}</strong>
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
        <div>
          <span>정규전 반영</span>
          <strong>{match.ranked === false ? "OFF" : "ON"}</strong>
        </div>
        <div>
          <span>MMR 제한</span>
          <strong>{mmrLimitLabels[match.mmrLimitMode] ?? "생성 차단"}</strong>
        </div>
        <div>
          <span>공신력</span>
          <strong>{credibility.label}</strong>
        </div>
        <div>
          <span>이의제기</span>
          <strong>{match.disputeMinutes ?? 120}분</strong>
        </div>
        <div>
          <span>개인 기록</span>
          <strong>{match.statEntryMinutes ?? 60}분 안에 입력</strong>
        </div>
        <div>
          <span>심판</span>
          <strong>{referee ? `${referee.name} · 신뢰도 ${referee.trustScore}` : "없음 · 득점만"}</strong>
        </div>
        <div>
          <span>후보 기록자</span>
          <strong>{recorderLabel || "없음"}</strong>
        </div>
        <div>
          <span>공격권</span>
          <strong>{match.rules.attackRule ?? "득점 후 공격권 교대"}</strong>
        </div>
        <div>
          <span>파울 룰</span>
          <strong>{match.rules.foulRule ?? "현장 합의"}</strong>
        </div>
      </div>
      <div className="two-column">
        <div>
          <Link to={`/app/teams/${match.teamA.teamId}`}><h3>{match.teamA.name}</h3></Link>
          {renderRoster(match.teamA)}
        </div>
        <div>
          <Link to={`/app/teams/${match.teamB.teamId}`}><h3>{match.teamB.name}</h3></Link>
          {renderRoster(match.teamB)}
        </div>
      </div>
      <div className="contract-note-grid">
        <div className="memo-box">
          <span>약속/벌칙 메모</span>
          <strong>{match.stakes ?? "금전 거래 없이 기록과 약속만 남깁니다."}</strong>
        </div>
        <div className="memo-box">
          <span>경기 메모</span>
          <strong>{match.memo}</strong>
        </div>
      </div>
      <div className="badge-row">
        {match.preRegistered ? <Badge tone="green">사전등록</Badge> : null}
        {match.evidence.map((evidence) => <Badge key={evidence.id} tone="blue">{evidence.label}</Badge>)}
      </div>
    </Card>
  );
}
