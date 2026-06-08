import { BarChart3, Bell, CalendarDays, Handshake, House, LogOut, PlusCircle, Settings, Shield, Trophy, UserRound, UsersRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import TierBadge from "../rating/TierBadge.jsx";

const navItems = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/create", label: "판 만들기", icon: PlusCircle },
  { to: "/app/matches", label: "경기방", icon: CalendarDays },
  { to: "/app/season", label: "시즌", icon: Trophy },
  { to: "/app/recruiting", label: "용병", icon: Handshake },
  { to: "/app/rankings", label: "랭킹", icon: BarChart3 },
  { to: "/app/teams", label: "팀", icon: UsersRound },
  { to: "/app/profile", label: "프로필", icon: UserRound },
  { to: "/app/affiliations", label: "소속", icon: Shield },
  { to: "/app/notifications", label: "알림", icon: Bell },
  { to: "/app/settings", label: "설정", icon: Settings },
];

export default function Sidebar({ user, auth }) {
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
      <div className="sidebar-profile">
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
      </div>
    </aside>
  );
}
