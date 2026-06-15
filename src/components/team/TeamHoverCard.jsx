import { Link } from "react-router-dom";
import TierBadge from "../rating/TierBadge.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";

export default function TeamHoverCard({ team, children, className = "", as = "link", to }) {
  if (!team) {
    if (as === "span") return <span className={className}>{children}</span>;
    return to ? <Link className={className} to={to}>{children}</Link> : children ?? null;
  }

  const Component = as === "span" ? "span" : Link;
  const props = as === "span" ? {} : { to: to ?? `/app/teams/${team.id}` };
  const played = Number(team.wins ?? 0) + Number(team.losses ?? 0);
  const winRate = played ? Math.round((Number(team.wins ?? 0) / played) * 100) : 0;

  return (
    <Component className={`team-hover-trigger ${className}`} {...props}>
      {children}
      <span className="team-hover-card" role="tooltip">
        <span className="team-hover-head">
          <span className="team-emblem" style={{ "--team-color": team.accent }}>{team.name.slice(0, 1)}</span>
          <span>
            <strong>{team.name}</strong>
            <em>{team.region} · {team.homeCourt}</em>
          </span>
        </span>
        <span className="team-hover-tier">
          <TierEmblem mmr={team.mmr} size="sm" showLabel />
          <span>
            <b>팀 티어</b>
            <TierBadge mmr={team.mmr} compact />
            <em>{Math.round(team.mmr ?? 1200)} MMR</em>
          </span>
        </span>
        <span className="team-hover-stats">
          <span><b>{team.wins ?? 0}승</b><em>{team.losses ?? 0}패</em></span>
          <span><b>{winRate}%</b><em>승률</em></span>
          <span><b>{team.members?.length ?? 0}명</b><em>로스터</em></span>
        </span>
      </span>
    </Component>
  );
}
