import { useEffect, useMemo, useState } from "react";
import { ThumbsUp } from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import { MATCH_SIDES } from "../../lib/constants.js";
import {
  formatKoreanDateTime,
  getEffectiveStatRecorders,
  getMatchPlayerIds,
  getMatchReservePlayerIds,
  getMatchTrustFeedbackClosesAt,
  getMatchTrustFeedbackLimit,
  getMatchTrustFeedbackParticipantIds,
  isMatchTrustFeedbackOpen,
} from "../../lib/matchUtils.js";

function getRecommendationRole(match, playerId) {
  const roles = [];
  if ([match.createdBy, match.hostPlayerId, match.createdPlayerId, match.teamA?.players?.[0]].includes(playerId)) roles.push("방장");
  if (match.refereeId === playerId) roles.push("심판");
  if (Object.values(getEffectiveStatRecorders(match)).includes(playerId)) roles.push("기록자");
  if (getMatchPlayerIds(match).includes(playerId)) roles.push("선수");
  if (MATCH_SIDES.some((sideName) => getMatchReservePlayerIds(match, sideName).includes(playerId))) roles.push("후보");
  return roles.length ? roles.join(" · ") : "관계자";
}

function formatCloseTime(value) {
  if (!value) return "일정 없음";
  return formatKoreanDateTime(value, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MatchRecommendationPanel({ match, currentUserId, users = [], teams = [], onSubmit, className = "" }) {
  const userById = useMemo(() => Object.fromEntries(users.map((user) => [user.id, user])), [users]);
  const participantIds = useMemo(
    () => getMatchTrustFeedbackParticipantIds(match).filter((playerId) => userById[playerId]),
    [match, userById],
  );
  const existingTargetIds = match?.trustFeedback?.stars?.[currentUserId] ?? [];
  const [selectedIds, setSelectedIds] = useState(() => existingTargetIds.filter((playerId) => participantIds.includes(playerId)));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setSelectedIds(existingTargetIds.filter((playerId) => participantIds.includes(playerId)));
    setStatus("");
  }, [currentUserId, match?.id, match?.trustFeedback, participantIds]);

  if (match?.status !== "confirmed" || !participantIds.includes(currentUserId)) return null;

  const limit = getMatchTrustFeedbackLimit(match);
  const canSubmit = isMatchTrustFeedbackOpen(match) && !saving;
  const targets = participantIds.filter((playerId) => playerId !== currentUserId);
  const receivedCountByPlayer = Object.values(match?.trustFeedback?.stars ?? {}).reduce((counts, targetIds = []) => {
    targetIds.forEach((targetId) => {
      counts[targetId] = (counts[targetId] ?? 0) + 1;
    });
    return counts;
  }, {});
  const toggle = (playerId) => {
    setSelectedIds((current) => {
      if (current.includes(playerId)) return current.filter((id) => id !== playerId);
      if (current.length >= limit) return current;
      return [...current, playerId];
    });
    setStatus("");
  };
  const submit = async () => {
    if (!canSubmit || !onSubmit) return;
    setSaving(true);
    setStatus("저장 중");
    try {
      const result = await onSubmit(match.id, selectedIds);
      setStatus(result === false || result?.ok === false ? "추천을 저장하지 못했습니다." : "추천을 저장했습니다.");
    } catch {
      setStatus("추천을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className={["section-card", "trust-star-card", className].filter(Boolean).join(" ")}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Recommendation</p>
          <h2>함께한 사람 추천</h2>
        </div>
        <Badge tone={canSubmit ? "gold" : "neutral"}>{selectedIds.length}/{limit}</Badge>
      </div>
      <p className="muted">기록 확정 후 24시간 안에 함께한 사람을 추천할 수 있습니다. 선수·방장·기록자·심판의 추천은 같은 신뢰 평가로 반영됩니다.</p>
      <div className="trust-star-grid">
        {targets.map((playerId) => {
          const user = userById[playerId];
          const selected = selectedIds.includes(playerId);
          const limitReached = !selected && selectedIds.length >= limit;
          return (
            <button
              key={playerId}
              type="button"
              className={selected ? "trust-star-button selected" : "trust-star-button"}
              disabled={!canSubmit || limitReached}
              onClick={() => toggle(playerId)}
            >
              <PlayerHoverCard as="span" user={user} teams={teams}>
                <ProfileEmblem user={user} className="small" initial={user?.name?.slice(0, 1) ?? "P"} />
                <span>
                  <strong>{user?.name ?? "플레이어"}</strong>
                  <em>{getRecommendationRole(match, playerId)} · 받은 추천 {receivedCountByPlayer[playerId] ?? 0}</em>
                </span>
              </PlayerHoverCard>
              <ThumbsUp size={16} fill={selected ? "currentColor" : "none"} />
            </button>
          );
        })}
      </div>
      <Button type="button" disabled={!canSubmit || !onSubmit} onClick={submit}>
        <ThumbsUp size={16} /> {saving ? "저장 중" : "추천 저장"}
      </Button>
      {status ? <p className="muted" role="status">{status}</p> : null}
      {!canSubmit ? <p className="muted">추천 시간이 지났거나 아직 기록이 확정되지 않았습니다. 마감: {formatCloseTime(getMatchTrustFeedbackClosesAt(match))}</p> : null}
    </Card>
  );
}
