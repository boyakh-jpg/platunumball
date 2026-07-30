import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import TeamEmblem from "../team/TeamEmblem.jsx";

export default function SeasonPromotionTable({
  rows = [],
  type = "players",
  teams = [],
  promotionLine = 4,
}) {
  if (!rows.length) {
    return <div className="ui-empty-state-compact">시즌 순위 기록이 없습니다.</div>;
  }

  return (
    <div className="season-race-list ranking-table ui-design-borderless-list">
      {rows.map((row, index) => {
        const rank = index + 1;
        const copy = (
          <>
            <span className={`rank rank-${rank}`}>{rank}</span>
            <span className="ranking-name">
              {type === "players"
                ? <ProfileEmblem user={row} className="small" />
                : <TeamEmblem team={row} size="sm" />}
              <span className="season-ranking-copy">
                <b>{row.name}</b>
                <em>
                  {row.seasonWins}승 {row.seasonLosses}패
                  {" · "}
                  {row.seasonDelta >= 0 ? "+" : ""}{row.seasonDelta}
                  {" · "}
                  {Math.round(row.seasonScore)}점
                </em>
              </span>
            </span>
            {type === "players"
              ? <TierBadge mmr={row.ratings.integrated} ratings={row.ratings} compact />
              : <Badge tone={rank <= promotionLine ? "gold" : "neutral"}>{rank <= promotionLine ? "승격권" : "추격"}</Badge>}
          </>
        );

        return type === "players" ? (
          <PlayerHoverCard
            key={row.id}
            user={row}
            teams={teams}
            className="ranking-row ui-design-soft-surface"
          >
            {copy}
          </PlayerHoverCard>
        ) : (
          <Link
            key={row.id}
            aria-label={`${row.name} 팀 상세 보기`}
            className="ranking-row ui-design-soft-surface"
            state={{ teamPreview: row }}
            to={`/app/teams/${row.id}`}
          >
            {copy}
          </Link>
        );
      })}
    </div>
  );
}
