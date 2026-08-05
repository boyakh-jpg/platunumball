import { CalendarDays, ClipboardList, Handshake, House, LogIn, LogOut, MessageCircle, MessageSquareText, Settings, Trophy, UserRound, UsersRound } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import BrandLockup from "../common/BrandLockup.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import { BRAND_NAME } from "../../lib/brand.js";
import { getDiscordProfileUrl } from "../../lib/discord.js";
import { getUserHashtag } from "../../lib/handles.js";
import { DEFAULT_RATING, getTestAccountDisplayLabel } from "../../lib/constants.js";
import { getLoginPath } from "../../lib/profileSetup.js";

const navItems = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/matches", label: "일정", icon: CalendarDays },
  { to: "/app/recruiting", label: "매칭", icon: Handshake },
  { to: "/app/recorder", label: "플레이", icon: ClipboardList },
  { to: "/app/teams", label: "팀", icon: UsersRound },
  { to: "/app/community", label: "커뮤니티", icon: MessageSquareText },
  { to: "/app/rankings", label: "랭크보드", icon: Trophy },
  { to: "/app/profile", label: "나", icon: UserRound },
  { to: "/app/settings", label: "설정", icon: Settings },
];

export default function Sidebar({ user, teams = [], auth, guestPreview = false }) {
  const location = useLocation();
  const safeUser = user ?? {};
  const authDisplayName = auth?.user?.user_metadata?.providerName || auth?.user?.email || "";
  const displayName = safeUser.name || getTestAccountDisplayLabel(authDisplayName) || BRAND_NAME;
  const displayHashtag = getUserHashtag(safeUser);
  const discordProfileUrl = getDiscordProfileUrl(safeUser);
  const integratedRating = safeUser.ratings?.integrated ?? DEFAULT_RATING;
  const loginPath = getLoginPath(`${location.pathname}${location.search}${location.hash}`);
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label={BRAND_NAME}>
        <BrandLockup />
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
      {guestPreview ? (
        <NavLink to={loginPath} className="sidebar-profile">
          <LogIn size={22} />
          <div className="sidebar-profile-copy">
            <strong>로그인</strong>
            <small>기록·참가 기능 사용</small>
          </div>
        </NavLink>
      ) : (
        <PlayerHoverCard as="span" user={safeUser} teams={teams} className="sidebar-profile">
          <ProfileEmblem user={safeUser} />
          <div className="sidebar-profile-copy">
            <strong>{displayName}</strong>
            <span className="sidebar-profile-handle">
              <small>{displayHashtag}</small>
              {discordProfileUrl ? (
                <a className="discord-link-badge discord-icon-link" href={discordProfileUrl} target="_blank" rel="noreferrer" aria-label="Discord에서 DM 열기" title="Discord에서 DM 열기" onClick={(event) => event.stopPropagation()}>
                  <MessageCircle size={12} aria-hidden="true" />
                </a>
              ) : null}
            </span>
            <TierBadge mmr={integratedRating} ratings={safeUser.ratings} compact />
          </div>
          {auth?.session ? (
            <button type="button" className="sidebar-signout" onClick={auth.signOut} aria-label="로그아웃" disabled={auth.authActionPending}>
              <LogOut size={17} />
            </button>
          ) : null}
        </PlayerHoverCard>
      )}
    </aside>
  );
}
