import { LogIn } from "lucide-react";
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
import PrimaryNavigationLinks from "./PrimaryNavigationLinks.jsx";

export default function Sidebar({ user, teams = [], auth, guestPreview = false }) {
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
        <PrimaryNavigationLinks className="nav-item" iconSize={18} />
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
