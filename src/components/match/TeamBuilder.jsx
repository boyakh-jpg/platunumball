import TeamCard from "../team/TeamCard.jsx";

export default function TeamBuilder({ teams, users, draft, onChange }) {
  return (
    <div className="team-picker-grid">
      {teams.map((team) => (
        <button
          className={`team-picker ${draft.teamAId === team.id || draft.teamBId === team.id ? "selected" : ""}`}
          key={team.id}
          type="button"
          onClick={() => {
            if (draft.teamAId === team.id) return;
            onChange(draft.teamAId ? { teamBId: team.id } : { teamAId: team.id });
          }}
        >
          <TeamCard team={team} users={users} compact linked={false} />
        </button>
      ))}
    </div>
  );
}
