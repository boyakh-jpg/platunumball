import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import HoverPortal from "../common/HoverPortal.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import TierEmblem from "../rating/TierEmblem.jsx";

const rolePriority = {
  captain: 0,
  regular: 1,
  mercenary: 2,
  guest: 3,
  candidate: 4,
  substitute: 4,
};

function getUserTeams(userId, teams = []) {
  return teams
    .map((team) => {
      const member = team.members?.find((item) => item.userId === userId);
      return member ? { ...team, myRole: member.role } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (rolePriority[a.myRole] ?? 9) - (rolePriority[b.myRole] ?? 9) || b.mmr - a.mmr);
}

function roleLabel(role) {
  if (role === "captain") return "주장";
  if (role === "regular") return "활성";
  if (role === "mercenary" || role === "guest") return "용병";
  return "후보";
}

export default function PlayerHoverCard({ user, teams = [], children, className = "", as = "link", to }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);

  if (!user) return children ?? null;

  const userTeams = getUserTeams(user.id, teams);
  const activeTeam = userTeams[0];
  const modes = [
    ["통합", user.ratings?.integrated],
    ...Object.entries(user.ratings?.modes ?? {}),
  ].filter(([, mmr]) => Number.isFinite(Number(mmr)));
  const Component = as === "span" ? "span" : Link;
  const props = as === "span" ? {} : { to: to ?? `/app/players/${user.id}` };
  const showHover = () => setOpen(true);
  const hideHover = () => setOpen(false);

  return (
    <Component
      ref={anchorRef}
      className={`player-hover-trigger ${className}`}
      onBlur={hideHover}
      onFocus={showHover}
      onKeyDown={(event) => {
        if (event.key === "Escape") hideHover();
      }}
      onMouseEnter={showHover}
      onMouseLeave={hideHover}
      {...props}
    >
      {children}
      <HoverPortal
        anchorRef={anchorRef}
        className="player-hover-card hover-portal-card"
        estimatedHeight={360}
        open={open}
      >
        <span className="player-hover-head">
          <span className="avatar" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
          <span>
            <strong>{user.name}</strong>
            <em>{user.region} · {user.position} · 신뢰도 {user.trustScore ?? "-"}</em>
          </span>
        </span>
        <span className="player-hover-tier-grid">
          {modes.map(([mode, mmr]) => (
            <span className="player-hover-tier-row" key={mode}>
              <TierEmblem mmr={Number(mmr)} size="sm" />
              <span>
                <b>{mode}</b>
                <TierBadge mmr={Number(mmr)} compact />
              </span>
            </span>
          ))}
        </span>
        <span className="player-hover-team">
          <b>활성 팀</b>
          {activeTeam ? (
            <span>
              <i style={{ "--team-color": activeTeam.accent }} />
              <strong>{activeTeam.name}</strong>
              <em>{roleLabel(activeTeam.myRole)}</em>
              <TierBadge mmr={activeTeam.mmr} compact />
            </span>
          ) : (
            <em>없음</em>
          )}
        </span>
      </HoverPortal>
    </Component>
  );
}
