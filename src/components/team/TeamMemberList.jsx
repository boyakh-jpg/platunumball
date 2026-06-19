import MemberTypeBadge from "./MemberTypeBadge.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import TierBadge from "../rating/TierBadge.jsx";

export default function TeamMemberList({ team, users, teams = [team], compact = false }) {
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  return (
    <div className="member-list">
      {team.members.map((member) => {
        const user = userMap[member.userId];
        if (!user) return null;
        if (compact) {
          return (
            <PlayerHoverCard className="member-row member-row-compact" key={`${team.id}-${member.userId}`} user={user} teams={teams}>
              <div className="member-main">
                <strong>{user.name}</strong>
                <span>{user.position}</span>
              </div>
              <MemberTypeBadge role={member.role} />
            </PlayerHoverCard>
          );
        }

        return (
          <PlayerHoverCard className="member-row" key={`${team.id}-${member.userId}`} user={user} teams={teams}>
            <div className="avatar small" style={{ "--avatar": user.avatarColor }}>
              {user.name.slice(0, 1)}
            </div>
            <div className="member-main">
              <strong>{user.name}</strong>
              <span>{user.position}</span>
            </div>
            <TierBadge mmr={user.ratings.integrated} compact />
            <MemberTypeBadge role={member.role} />
          </PlayerHoverCard>
        );
      })}
    </div>
  );
}
