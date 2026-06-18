import { CalendarDays, ClipboardList, Handshake, House, LogOut, Settings, UserRound, UsersRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import TierBadge from "../rating/TierBadge.jsx";

const navItems = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/matches", label: "경기", icon: CalendarDays },
  { to: "/app/recruiting", label: "매칭", icon: Handshake },
  { to: "/app/recorder", label: "진행", icon: ClipboardList },
  { to: "/app/teams", label: "팀", icon: UsersRound },
  { to: "/app/profile", label: "나", icon: UserRound },
  { to: "/app/settings", label: "설정", icon: Settings },
];

export default function Sidebar({ user, teams = [], auth }) {
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand">
        <span className="brand-mark">R</span>
        <span>
          <strong>RankBall</strong>
          <small>street court ladder</small>
        </span>
      </NavLink>
      <nav className="sidebar-nav" aria-label="주요 메뉴">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.to === "/app"} className="nav-item">
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <PlayerHoverCard as="span" user={user} teams={teams} className="sidebar-profile">
        <div className="avatar" style={{ "--avatar": user.avatarColor }}>
          {user.name.slice(0, 1)}
        </div>
        <div>
          <strong>{user.name}</strong>
          {auth?.user ? <small>{auth.user.user_metadata?.providerName ?? auth.user.email}</small> : null}
          <TierBadge mmr={user.ratings.integrated} compact />
        </div>
        {auth?.session ? (
          <button type="button" className="sidebar-signout" onClick={auth.signOut} aria-label="로그아웃">
            <LogOut size={17} />
          </button>
        ) : null}
      </PlayerHoverCard>
    </aside>
  );
}
