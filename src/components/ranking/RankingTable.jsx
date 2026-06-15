import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import TierBadge from "../rating/TierBadge.jsx";

export default function RankingTable({ rows, type = "players", mode = "integrated", teams = [] }) {
  return (
    <div className="ranking-table">
      {rows.map((row, index) => {
        const rank = index + 1;
        const key = row.id ?? `${type}-${index}`;
        const mmr = type === "players" ? (mode === "integrated" ? row.ratings.integrated : row.ratings.modes[mode]) : row.mmr ?? row.score;
        return (
          <div className="ranking-row" key={key}>
            <span className={`rank rank-${rank}`}>{rank}</span>
            {type === "players" ? (
              <PlayerHoverCard user={row} teams={teams} className="ranking-name">
                <div className="avatar small" style={{ "--avatar": row.avatarColor }}>
                  {row.name.slice(0, 1)}
                </div>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.region} · {row.position}</span>
                </div>
              </PlayerHoverCard>
            ) : (
              <Link className="ranking-name" to={type === "teams" ? `/app/teams/${row.id}` : "/app/affiliations"}>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.homeCourt ?? row.type}</span>
                </div>
              </Link>
            )}
            {type === "players" || type === "teams" ? <TierBadge mmr={mmr} compact /> : <Badge tone="blue">{row.wins}승</Badge>}
            <strong className="ranking-score">{Math.round(mmr)}</strong>
          </div>
        );
      })}
    </div>
  );
}
