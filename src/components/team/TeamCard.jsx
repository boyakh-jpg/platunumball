import Badge from "../common/Badge.jsx";
import Card from "../common/Card.jsx";
import TeamMemberList from "./TeamMemberList.jsx";

export default function TeamCard({ team, users, compact = false }) {
  const winRate = Math.round((team.wins / Math.max(1, team.wins + team.losses)) * 100);

  return (
    <Card className="team-card elite-team-card">
      <div className="team-card-top">
        <div>
          <p className="eyebrow">{team.region} · {team.homeCourt}</p>
          <h3>{team.name}</h3>
        </div>
        <div className="team-emblem" style={{ "--team-color": team.accent }}>
          {team.name.slice(0, 1)}
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
