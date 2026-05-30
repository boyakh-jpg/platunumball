import { Link } from "react-router-dom";
import MemberTypeBadge from "./MemberTypeBadge.jsx";
import TierBadge from "../rating/TierBadge.jsx";

export default function TeamMemberList({ team, users }) {
  const userMap = Object.fromEntries(users.map((user) => [user.id, user]));
  return (
    <div className="member-list">
      {team.members.map((member) => {
        const user = userMap[member.userId];
        if (!user) return null;
        return (
          <Link className="member-row" key={`${team.id}-${member.userId}`} to={`/app/players/${member.userId}`}>
            <div className="avatar small" style={{ "--avatar": user.avatarColor }}>
              {user.name.slice(0, 1)}
            </div>
            <div className="member-main">
              <strong>{user.name}</strong>
              <span>{user.position}</span>
            </div>
            <TierBadge mmr={user.ratings.integrated} compact />
            <MemberTypeBadge role={member.role} />
          </Link>
        );
      })}
    </div>
  );
}
