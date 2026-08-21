import { Bell, CalendarDays, ClipboardList, Handshake, House, LogIn, MessageSquareText, Settings, Trophy, UserRound, UsersRound } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import BrandLockup from "../common/BrandLockup.jsx";
import PlayerHoverCard from "../profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import TierBadge from "../rating/TierBadge.jsx";
import { BRAND_NAME } from "../../lib/brand.js";
import { getUserHashtag } from "../../lib/handles.js";
import { DEFAULT_RATING, getTestAccountDisplayLabel } from "../../lib/constants.js";
import { getLoginPath } from "../../lib/profileSetup.js";
import { getReceiptLocale, RECEIPT_SHELL_COPY } from "../../lib/receiptLocale.js";

const navItems = [
  { to: "/app", labelKey: "home", icon: House },
  { to: "/app/notifications", labelKey: "notifications", icon: Bell, authenticatedOnly: true },
  { to: "/app/matches", labelKey: "schedule", icon: CalendarDays },
  { to: "/app/recruiting", labelKey: "matching", icon: Handshake },
  { to: "/app/recorder", labelKey: "play", icon: ClipboardList },
  { to: "/app/teams", labelKey: "teams", icon: UsersRound },
  { to: "/app/community", labelKey: "community", icon: MessageSquareText },
  { to: "/app/rankings", labelKey: "rankings", icon: Trophy },
  { to: "/app/profile", labelKey: "me", icon: UserRound },
  { to: "/app/settings", labelKey: "settings", icon: Settings },
];

export default function Sidebar({ user, teams = [], auth, guestPreview = false, unreadNotificationCount = 0 }) {
  const location = useLocation();
  const shellCopy = RECEIPT_SHELL_COPY[getReceiptLocale(location)];
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
      <nav className="sidebar-nav" aria-label={shellCopy.primaryNavigation}>
        {navItems.filter((item) => !item.authenticatedOnly || !guestPreview).map((item) => {
          const Icon = item.icon;
          const isNotifications = item.to === "/app/notifications";
          const accessibleLabel = isNotifications && unreadNotificationCount
            ? shellCopy.unreadNotifications(unreadNotificationCount)
            : undefined;
          return (
            <NavLink key={item.to} to={item.to} end={item.to === "/app"} className={`nav-item${isNotifications ? " app-notification-nav" : ""}`} aria-label={accessibleLabel}>
              <Icon size={18} />
              <span>{shellCopy[item.labelKey]}</span>
              {isNotifications && unreadNotificationCount ? <b className="app-notification-badge" aria-hidden="true">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</b> : null}
            </NavLink>
          );
        })}
      </nav>
      {guestPreview ? (
        <NavLink to={loginPath} className="sidebar-profile">
          <LogIn size={22} />
          <div className="sidebar-profile-copy">
            <strong>{shellCopy.signIn}</strong>
            <small>{shellCopy.guestHint}</small>
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
        </PlayerHoverCard>
      )}
    </aside>
  );
}
