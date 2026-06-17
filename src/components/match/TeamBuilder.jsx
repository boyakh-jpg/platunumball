import Badge from "../common/Badge.jsx";
import TeamCard from "../team/TeamCard.jsx";

export default function TeamBuilder({ teams, users, draft }) {
  return (
    <div className="team-picker-grid">
      {teams.map((team) => {
        const sideLabel = draft.teamAId === team.id ? "A사이드" : "B사이드";
        return (
          <div className="team-picker selected" key={`${sideLabel}-${team.id}`}>
            <Badge tone={sideLabel === "A사이드" ? "green" : "blue"}>{sideLabel}</Badge>
            <TeamCard team={team} users={users} compact linked={false} />
          </div>
        );
      })}
    </div>
  );
}
