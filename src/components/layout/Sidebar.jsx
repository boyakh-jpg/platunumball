import { CalendarDays, ClipboardList, Handshake, House, LogOut, Settings, Trophy, UserRound, UsersRound } from "lucide-react";
import { NavLink } from "react-router-dom";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import { BOXTIER_LETTER_DARK_URL, BOXTIER_LETTER_LIGHT_URL, BOXTIER_LOGO_URL } from "../../lib/assets.js";
import { getDiscordAvatarClassName, getDiscordAvatarStyle } from "../../lib/discord.js";
import { getUserHashtag } from "../../lib/handles.js";

const navItems = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/matches", label: "경기", icon: CalendarDays },
  { to: "/app/recruiting", label: "매칭", icon: Handshake },
  { to: "/app/recorder", label: "진행", icon: ClipboardList },
  { to: "/app/teams", label: "팀", icon: UsersRound },
  { to: "/app/rankings", label: "랭크보드", icon: Trophy },
  { to: "/app/profile", label: "나", icon: UserRound },
  { to: "/app/settings", label: "설정", icon: Settings },
];

export default function Sidebar({ user, teams = [], auth }) {
  const safeUser = user ?? {};
  const displayName = safeUser.name || auth?.user?.user_metadata?.providerName || auth?.user?.email || "RankBall";
  const displayHashtag = getUserHashtag(safeUser);
  const integratedRating = safeUser.ratings?.integrated ?? 1200;
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="boxtier">
        <span className="brand-logo-frame" aria-hidden="true">
          <img className="brand-logo-img" src={BOXTIER_LOGO_URL} alt="" />
        </span>
        <span className="brand-letter-wrap" aria-hidden="true">
          <img className="brand-letter-img brand-letter-dark" src={BOXTIER_LETTER_DARK_URL} alt="" />
          <img className="brand-letter-img brand-letter-light" src={BOXTIER_LETTER_LIGHT_URL} alt="" />
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
      <PlayerHoverCard as="span" user={safeUser} teams={teams} className="sidebar-profile">
        <div className={getDiscordAvatarClassName(safeUser)} style={getDiscordAvatarStyle(safeUser)}>
          {displayName.slice(0, 1)}
        </div>
        <div className="sidebar-profile-copy">
          <strong>{displayName}</strong>
          <small>{displayHashtag}</small>
          <TierBadge mmr={integratedRating} compact />
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
