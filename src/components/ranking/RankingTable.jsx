import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import TierBadge from "../rating/TierBadge.jsx";

export default function RankingTable({ rows, type = "players", mode = "integrated" }) {
  return (
    <div className="ranking-table">
      {rows.map((row, index) => {
        const rank = index + 1;
        const key = row.id ?? `${type}-${index}`;
        const mmr = type === "players" ? (mode === "integrated" ? row.ratings.integrated : row.ratings.modes[mode]) : row.mmr ?? row.score;
        return (
          <div className="ranking-row" key={key}>
            <span className={`rank rank-${rank}`}>{rank}</span>
            <Link className="ranking-name" to={type === "players" ? `/app/players/${row.id}` : type === "teams" ? `/app/teams/${row.id}` : "/app/affiliations"}>
              {type === "players" ? (
                <div className="avatar small" style={{ "--avatar": row.avatarColor }}>
                  {row.name.slice(0, 1)}
                </div>
              ) : null}
              <div>
                <strong>{row.name}</strong>
                <span>{type === "players" ? `${row.region} · ${row.position}` : row.homeCourt ?? row.type}</span>
              </div>
            </Link>
            {type === "players" ? <TierBadge mmr={mmr} compact /> : <Badge tone="blue">{row.wins}승</Badge>}
            <strong className="ranking-score">{Math.round(mmr)}</strong>
          </div>
        );
      })}
    </div>
  );
}
