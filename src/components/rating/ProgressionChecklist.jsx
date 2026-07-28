import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import { getPlacementLabel, isPlacementComplete } from "../../lib/rating.js";
import { getTier, TIERS } from "../../lib/tier.js";

function playerInMatch(match, userId) {
  return (match?.teamA?.players ?? []).includes(userId) || (match?.teamB?.players ?? []).includes(userId);
}

function countMatches(matches, userId, predicate) {
  return matches.filter((match) => match.status === "confirmed" && playerInMatch(match, userId) && predicate(match)).length;
}

export default function ProgressionChecklist({ user, matches }) {
  if (!isPlacementComplete(user.ratings)) {
    return (
      <Card className="section-card progression-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Placement</p>
            <h2>배치 진행 중</h2>
          </div>
          <Badge tone="neutral">{getPlacementLabel(user.ratings)}</Badge>
        </div>
        <div className="progression-list">
          <div>
            <span>·</span>
            <strong>경쟁전 5경기 완료</strong>
            <em>{getPlacementLabel(user.ratings).replace("배정 전 · ", "")}</em>
          </div>
        </div>
      </Card>
    );
  }
  const currentTier = getTier(user.ratings.integrated);
  const nextTier = TIERS.find((tier) => tier.min > currentTier.min);
  const ranked3Or5 = countMatches(matches, user.id, (match) => match.ranked !== false && ["3v3", "5v5"].includes(match.mode));
  const ranked5 = countMatches(matches, user.id, (match) => match.ranked !== false && match.mode === "5v5");
  const official5 = countMatches(matches, user.id, (match) => match.ranked !== false && match.mode === "5v5" && match.official);
  const trust = user.trustScore ?? 80;

  const checks = nextTier
    ? [
        { label: `통합 MMR ${nextTier.min}+`, done: user.ratings.integrated >= nextTier.min },
        ...(nextTier.name === "Platinum" ? [{ label: "3v3 또는 5v5 정규전 5경기", done: ranked3Or5 >= 5, value: `${ranked3Or5}/5` }] : []),
        ...(nextTier.name === "Diamond" ? [{ label: "5v5 정규전 5경기", done: ranked5 >= 5, value: `${ranked5}/5` }] : []),
        ...(nextTier.name === "Master" ? [
          { label: "5v5 공식경기 5경기", done: official5 >= 5, value: `${official5}/5` },
          { label: "신뢰도 80 이상", done: trust >= 80, value: trust },
        ] : []),
        ...(nextTier.name === "Legend" ? [
          { label: "5v5 공식경기 10경기", done: official5 >= 10, value: `${official5}/10` },
          { label: "신뢰도 90 이상", done: trust >= 90, value: trust },
        ] : []),
      ]
    : [{ label: "최상위 티어 유지", done: true }];

  return (
    <Card className="section-card progression-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Promotion</p>
          <h2>{nextTier ? `${nextTier.name} 승급 조건` : "최상위 티어"}</h2>
        </div>
        <Badge tone="gold">{currentTier.name}</Badge>
      </div>
      <div className="progression-list">
        {checks.map((check) => (
          <div key={check.label} className={check.done ? "done" : ""}>
            <span>{check.done ? "✓" : "·"}</span>
            <strong>{check.label}</strong>
            {check.value !== undefined ? <em>{check.value}</em> : null}
          </div>
        ))}
      </div>
    </Card>
  );
}
