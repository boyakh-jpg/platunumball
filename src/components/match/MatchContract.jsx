import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import RefereeHoverCard from "../referee/RefereeHoverCard.jsx";
import { CREDIBILITY_LEVELS, EVIDENCE_OPTIONS, normalizeDisputeWindowMinutes } from "../../lib/constants.js";
import { getMatchReferee, isPersonalRecordMatch } from "../../lib/matchUtils.js";
import { getMatchBreakLabel, getMatchClockLabel, getMatchEndLabel, getMatchFormatLabel, getMatchPeriodLabel, getMeetingPointSummary, normalizeMatchRules } from "../../lib/matchRules.js";
import { getCredibilityLevel } from "../../lib/rating.js";

const mmrLimitLabels = {
  off: "제한 없음",
  warn: "경고만",
  block: "생성 차단",
};

function getSafeSide(side = {}, fallbackName = "") {
  return {
    ...side,
    name: side?.name || fallbackName,
    teamId: side?.teamId || "",
    players: Array.isArray(side?.players) ? side.players : [],
  };
}

export default function MatchContract({ match, users = [], teams = [], matches = [] }) {
  if (!match) return null;
  const rules = normalizeMatchRules(match.rules, { mode: match.mode });
  const sideA = getSafeSide(match.teamA, "A");
  const sideB = getSafeSide(match.teamB, "B");
  const activeEvidenceIds = new Set(EVIDENCE_OPTIONS.map((item) => item.id));
  const evidenceItems = (match.evidence ?? []).filter((evidence) => activeEvidenceIds.has(evidence.id ?? evidence.type));
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  const credibility = CREDIBILITY_LEVELS[getCredibilityLevel(match)] ?? CREDIBILITY_LEVELS.street_majority;
  const referee = getMatchReferee(match, users);
  const personalRecord = isPersonalRecordMatch(match);
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
          <strong>{getMatchFormatLabel(match.mode, rules)}</strong>
        </div>
        <div>
          <span>경기 구성</span>
          <strong>{getMatchPeriodLabel(rules, match.mode)}</strong>
        </div>
        <div>
          <span>종료 기준</span>
          <strong>{getMatchEndLabel(rules, match.mode)}</strong>
        </div>
        <div>
          <span>BOXTIER 모바일 전광판</span>
          <strong>{getMatchClockLabel(rules, match.mode)}</strong>
        </div>
        <div>
          <span>휴식·연장</span>
          <strong>{getMatchBreakLabel(rules, match.mode)} · 연장 {rules.overtimeMinutes}분</strong>
        </div>
        <div>
          <span>만남 장소</span>
          <strong>{getMeetingPointSummary(rules, match.timingType, match.mode)}</strong>
        </div>
        <div>
          <span>MMR 반영</span>
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
          <strong>{normalizeDisputeWindowMinutes(match.disputeMinutes)}분</strong>
        </div>
        {referee ? <div>
          <span>개인 기록</span>
          <strong>{match.statEntryMinutes ?? 60}분 안에 입력</strong>
        </div> : null}
        <div>
          <span>심판</span>
          <strong>
            {referee ? (
              <RefereeHoverCard user={referee} matches={matches} minTrust={match.refereeTrustMin}>
                {referee.name} · 신뢰도 {referee.trustScore}
              </RefereeHoverCard>
            ) : "없음 · 득점만"}
          </strong>
        </div>
        <div>
          <span>개인 스탯 기록</span>
          <strong>{referee ? "배정 심판" : personalRecord ? "작성자 본인" : "미기록"}</strong>
        </div>
        <div>
          <span>점수·모바일 전광판</span>
          <strong>{personalRecord ? "작성자 입력" : rules.gameClockEnabled === false ? (referee ? "배정 심판" : "방장 · 양쪽 점수") : "모바일 전광판 담당자"}</strong>
        </div>
        <div>
          <span>공격권</span>
          <strong>{rules.attackRule ?? "득점 후 공격권 교대"}</strong>
        </div>
        <div>
          <span>파울 룰</span>
          <strong>{rules.foulRule ?? "현장 합의"}</strong>
        </div>
      </div>
      <div className="two-column">
        <div>
          {sideA.teamId ? <Link to={`/app/teams/${sideA.teamId}`}><h3>{sideA.name}</h3></Link> : <h3>{sideA.name}</h3>}
          {renderRoster(sideA)}
        </div>
        <div>
          {sideB.teamId ? <Link to={`/app/teams/${sideB.teamId}`}><h3>{sideB.name}</h3></Link> : <h3>{sideB.name}</h3>}
          {renderRoster(sideB)}
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
      {(match.preRegistered || evidenceItems.length) ? (
        <div className="badge-row">
          {match.preRegistered ? <Badge tone="green">사전등록</Badge> : null}
          {evidenceItems.map((evidence) => <Badge key={evidence.id ?? evidence.type} tone="blue">{evidence.label}</Badge>)}
        </div>
      ) : null}
    </Card>
  );
}
