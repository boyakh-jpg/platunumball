import { Link } from "react-router-dom";
import { Star } from "lucide-react";
import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import TeamMemberList from "./TeamMemberList.jsx";

export default function TeamCard({ team, users, compact = false, linked = true, favorite = false, onToggleFavorite, rank }) {
  const winRate = Math.round((team.wins / Math.max(1, team.wins + team.losses)) * 100);

  return (
    <Card className="team-card elite-team-card">
      <div className="team-card-top">
        <div>
          <p className="eyebrow">{team.region} · {team.homeCourt}</p>
          {linked ? <Link to={`/app/teams/${team.id}`}><h3>{team.name}</h3></Link> : <h3>{team.name}</h3>}
        </div>
        <div className="team-card-actions">
          {rank ? <Badge tone={rank <= 3 ? "gold" : "blue"}>#{rank}</Badge> : null}
          <TierBadge mmr={team.mmr} compact />
          {onToggleFavorite ? (
            <button type="button" className={favorite ? "favorite-toggle active" : "favorite-toggle"} onClick={onToggleFavorite}>
              <Star size={15} fill={favorite ? "currentColor" : "none"} />
              {favorite ? "즐겨찾기" : "추가"}
            </button>
          ) : null}
          <div className="team-emblem" style={{ "--team-color": team.accent }}>
            {team.name.slice(0, 1)}
          </div>
        </div>
      </div>
      <div className="stat-strip">
        <span>
          <strong>{team.mmr}</strong>
          팀 MMR
        </span>
        <span>
          <strong>{winRate}%</strong>
          승률
        </span>
        <span>
          <strong>{team.members.length}</strong>
          로스터
        </span>
      </div>
      {compact ? null : <TeamMemberList team={team} users={users} />}
      <Badge tone="green">정규멤버 {team.members.filter((member) => member.role === "regular" || member.role === "captain").length}</Badge>
    </Card>
  );
}
