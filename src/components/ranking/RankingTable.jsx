import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import TeamHoverCard from "../team/TeamHoverCard.jsx";

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
                <ProfileEmblem user={row} className="small" />
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.region} · {row.position}</span>
                </div>
              </PlayerHoverCard>
            ) : (
              type === "teams" ? (
                <TeamHoverCard team={row} className="ranking-name">
                  <div>
                    <strong>{row.name}</strong>
                    <span>{row.homeCourt}</span>
                  </div>
                </TeamHoverCard>
              ) : (
              <Link className="ranking-name" to="/app/affiliations">
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.homeCourt ?? row.type}</span>
                </div>
              </Link>
              )
            )}
            {type === "players" || type === "teams" ? <TierBadge mmr={mmr} compact /> : <Badge tone="blue">{row.wins}승</Badge>}
            <strong className="ranking-score">{Math.round(mmr)}</strong>
          </div>
        );
      })}
    </div>
  );
}
