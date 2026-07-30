import { Link } from "react-router-dom";
import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";
import TeamEmblem from "./TeamEmblem.jsx";
import { isMercenaryTeamRole } from "../../lib/constants.js";

export default function TeamCard({ team, users, teams = [team], compact = false, linked = true, rank }) {
  const wins = Number(team.wins ?? 0);
  const losses = Number(team.losses ?? 0);
  const played = wins + losses;
  const members = Array.isArray(team.members) ? team.members : [];
  const winRate = played ? Math.round((wins / played) * 100) : 0;
  const regularCount = members.filter((member) => !isMercenaryTeamRole(member.role)).length;

  return (
    <Card
      as={linked ? Link : "section"}
      aria-label={linked ? `${team.name} 팀 상세 보기` : undefined}
      className="team-card elite-team-card"
      state={linked ? { teamPreview: team } : undefined}
      to={linked ? `/app/teams/${team.id}` : undefined}
    >
      <div className="team-card-top">
        <div className="team-card-title">
          <p className="eyebrow">{team.region} · {team.homeCourt}</p>
          <span className="team-card-identity">
            <TeamEmblem team={team} size="md" />
            <h3>{team.name}</h3>
          </span>
        </div>
        <div className="team-card-actions">
          {rank ? <Badge tone={rank <= 3 ? "gold" : "blue"}>#{rank}</Badge> : null}
          <TierEmblem mmr={team.mmr} size="md" />
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
          <strong>{members.length}</strong>
          로스터
        </span>
      </div>
      <Badge tone="green">정규멤버 {regularCount}</Badge>
    </Card>
  );
}
