import { Bell, CalendarDays, ClipboardList, Handshake, House, LogIn, LogOut, MessageSquareText, Settings, Trophy, UserRound, UsersRound } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import BrandLockup from "../common/BrandLockup.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import { BRAND_NAME } from "../../lib/brand.js";
import { getUserHashtag } from "../../lib/handles.js";
import { DEFAULT_RATING, getTestAccountDisplayLabel } from "../../lib/constants.js";
import { getLoginPath } from "../../lib/profileSetup.js";

const navItems = [
  { to: "/app", label: "홈", icon: House },
  { to: "/app/notifications", label: "알림", icon: Bell, authenticatedOnly: true },
  { to: "/app/matches", label: "일정", icon: CalendarDays },
  { to: "/app/recruiting", label: "매칭", icon: Handshake },
  { to: "/app/recorder", label: "플레이", icon: ClipboardList },
  { to: "/app/teams", label: "팀", icon: UsersRound },
  { to: "/app/community", label: "커뮤니티", icon: MessageSquareText },
  { to: "/app/rankings", label: "랭크보드", icon: Trophy },
  { to: "/app/profile", label: "나", icon: UserRound },
  { to: "/app/settings", label: "설정", icon: Settings },
];

export default function Sidebar({ user, teams = [], auth, guestPreview = false, unreadNotificationCount = 0 }) {
  const location = useLocation();
  const safeUser = user ?? {};
  const authDisplayName = auth?.user?.user_metadata?.providerName || auth?.user?.email || "";
  const displayName = safeUser.name || getTestAccountDisplayLabel(authDisplayName) || BRAND_NAME;
  const displayHashtag = getUserHashtag(safeUser);
  const integratedRating = safeUser.ratings?.integrated ?? DEFAULT_RATING;
  const loginPath = getLoginPath(`${location.pathname}${location.search}${location.hash}`);
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label={BRAND_NAME}>
        <BrandLockup />
      </NavLink>
      <nav className="sidebar-nav" aria-label="주요 메뉴">
        {navItems.filter((item) => !item.authenticatedOnly || !guestPreview).map((item) => {
          const Icon = item.icon;
          const isNotifications = item.to === "/app/notifications";
          const accessibleLabel = isNotifications && unreadNotificationCount
            ? `알림, 읽지 않은 알림 ${unreadNotificationCount}개`
            : undefined;
          return (
            <NavLink key={item.to} to={item.to} end={item.to === "/app"} className={`nav-item${isNotifications ? " app-notification-nav" : ""}`} aria-label={accessibleLabel}>
              <Icon size={18} />
              <span>{item.label}</span>
              {isNotifications && unreadNotificationCount ? <b className="app-notification-badge" aria-hidden="true">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</b> : null}
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
            <span className="sidebar-profile-handle"><small>{displayHashtag}</small></span>
            <TierBadge mmr={integratedRating} ratings={safeUser.ratings} compact />
          </div>
          {auth?.session ? (
            <button type="button" className="sidebar-signout" onClick={() => window.confirm("로그아웃하시겠습니까?") && void auth.signOut()} aria-label="로그아웃" disabled={auth.authActionPending}>
              <LogOut size={17} />
            </button>
          ) : null}
        </PlayerHoverCard>
      )}
    </aside>
  );
}
