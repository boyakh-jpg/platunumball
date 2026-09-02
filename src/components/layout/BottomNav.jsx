import { Bell, CalendarDays, ClipboardList, Ellipsis, Flag, Handshake, House, MessageSquareText, Settings, UserRound, UsersRound } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { buildReportEntryPath } from "../../lib/reportEntry.js";
import { getReceiptLocale, RECEIPT_SHELL_COPY } from "../../lib/receiptLocale.js";

const items = [
  { to: "/app", labelKey: "home", icon: House },
  { to: "/app/matches", labelKey: "schedule", icon: CalendarDays },
  { to: "/app/recruiting", labelKey: "matching", icon: Handshake },
  { to: "/app/recorder", labelKey: "play", icon: ClipboardList },
  { to: "/app/community", labelKey: "board", icon: MessageSquareText },
];

const moreItems = [
  { to: "/app/notifications", labelKey: "notifications", icon: Bell, authenticatedOnly: true },
  { to: buildReportEntryPath(), labelKey: "reportHelp", icon: Flag },
  { to: "/app/profile", labelKey: "me", icon: UserRound },
  { to: "/app/teams", labelKey: "teams", icon: UsersRound },
  { to: "/app/settings", labelKey: "settings", icon: Settings },
];

export default function BottomNav({ guestPreview = false, unreadNotificationCount = 0 }) {
  const moreRef = useRef(null);
  const location = useLocation();
  const shellCopy = RECEIPT_SHELL_COPY[getReceiptLocale(location)];

  useEffect(() => {
    const closeMoreOutside = (event) => {
      const more = moreRef.current;
      if (more?.open && !more.contains(event.target)) more.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeMoreOutside);
    return () => document.removeEventListener("pointerdown", closeMoreOutside);
  }, []);

  return (
    <nav className="bottom-nav" aria-label={shellCopy.bottomNavigation}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.to} to={item.to} end={item.to === "/app"}>
            <Icon size={20} />
            <span>{shellCopy[item.labelKey]}</span>
          </NavLink>
        );
      })}
      <details ref={moreRef} className="bottom-nav-more">
        <summary>
          <Ellipsis size={20} />
          <span>{shellCopy.more}</span>
        </summary>
        <div className="bottom-nav-more-menu" aria-label={shellCopy.moreMenu}>
          {moreItems.filter((item) => !item.authenticatedOnly || !guestPreview).map((item) => {
            const Icon = item.icon;
            const isNotifications = item.to === "/app/notifications";
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={isNotifications ? "app-notification-nav" : undefined}
                aria-label={isNotifications && unreadNotificationCount ? shellCopy.unreadNotifications(unreadNotificationCount) : undefined}
                onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
              >
                <Icon size={20} />
                <span>{shellCopy[item.labelKey]}</span>
                {isNotifications && unreadNotificationCount ? <b className="app-notification-badge" aria-hidden="true">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</b> : null}
              </NavLink>
            );
          })}
        </div>
      </details>
    </nav>
  );
}
