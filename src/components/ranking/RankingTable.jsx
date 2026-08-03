import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import TeamHoverCard from "../team/TeamHoverCard.jsx";
import { AFFILIATION_TYPES } from "../../lib/constants.js";

export default function RankingTable({ rows, type = "players", mode = "integrated", teams = [] }) {
  if (!rows.length) return <div className="ui-empty-state-compact">표시할 순위가 없습니다.</div>;
  return (
    <div className="ranking-table ui-design-borderless-list">
      {rows.map((row, index) => {
        const rank = index + 1;
        const key = row.id ?? `${type}-${index}`;
        const mmr = type === "players" ? (mode === "integrated" ? row.ratings.integrated : row.ratings.modes[mode]) : row.mmr ?? row.score;
        return (
          <div className="ranking-row" key={key}>
            <span className={`rank rank-${rank}`}>{rank}</span>
            {type === "players" ? (
              <PlayerHoverCard user={row} teams={teams} className="ranking-name">
                <ProfileEmblem user={row} className="small" />
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.region} · {row.position}</span>
                </div>
              </PlayerHoverCard>
            ) : (
              type === "teams" ? (
                <TeamHoverCard team={row} className="ranking-name" directNavigation>
                  <div>
                    <strong>{row.name}</strong>
                    <span>{row.homeCourt}</span>
                  </div>
                </TeamHoverCard>
              ) : (
              <Link className="ranking-name" to="/app/affiliations">
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.homeCourt ?? AFFILIATION_TYPES[row.type] ?? "소속"}</span>
                </div>
              </Link>
              )
            )}
            {type === "players" || type === "teams" ? <TierBadge mmr={mmr} ratings={type === "players" ? row.ratings : null} compact /> : <Badge tone="blue">{row.wins}승</Badge>}
            <strong className="ranking-score">{Math.round(mmr)}</strong>
          </div>
        );
      })}
    </div>
  );
}
