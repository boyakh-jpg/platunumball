import { useEffect } from "react";
import { Bell, Settings } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import BasketballLoader from "../common/BasketballLoader.jsx";
import Button from "../common/Button.jsx";
import BottomNav from "./BottomNav.jsx";
import DataAttribution from "./DataAttribution.jsx";
import Sidebar from "./Sidebar.jsx";
import MyNavigation from "../profile/MyNavigation.jsx";
import { APP_NOTIFICATION_PATH, APP_SETTINGS_PATH } from "../../lib/appNavigation.js";
import { getLoginPath } from "../../lib/profileSetup.js";
import { getReceiptLocale, RECEIPT_SHELL_COPY } from "../../lib/receiptLocale.js";

export default function AppShell({ app, auth, guestPreview = false }) {
  const location = useLocation();
  const shellCopy = RECEIPT_SHELL_COPY[getReceiptLocale(location)];
  const remoteLoading = app.remoteReady === false;
  const loadedUnreadCount = (app.state.notifications ?? []).filter((notification) => !notification.readAt).length;
  const unreadNotificationCount = guestPreview
    ? 0
    : Math.max(0, Number.isFinite(app.state.notificationUnreadCount) ? app.state.notificationUnreadCount : loadedUnreadCount);

  useEffect(() => {
    document.documentElement.classList.toggle("rankball-remote-loading", remoteLoading);
    return () => {
      document.documentElement.classList.remove("rankball-remote-loading");
    };
  }, [remoteLoading]);

  return (
    <div className="app-shell ui-design-host" data-design="editorial">
      <Sidebar user={app.currentUser} teams={app.state.teams} auth={auth} guestPreview={guestPreview} />
      <main className="app-main ui-design-app" aria-busy={remoteLoading}>
        <div className="app-shell-tools">
          <Button as={Link} to={guestPreview ? getLoginPath(APP_NOTIFICATION_PATH) : APP_NOTIFICATION_PATH} variant="secondary" size="sm" aria-label={unreadNotificationCount ? shellCopy.unreadNotifications(unreadNotificationCount) : shellCopy.notifications}>
            <Bell size={18} aria-hidden="true" />
            <span>{shellCopy.notifications}</span>
            {unreadNotificationCount ? <b className="app-notification-badge" aria-hidden="true">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</b> : null}
          </Button>
          <Button as={Link} to={guestPreview ? getLoginPath(APP_SETTINGS_PATH) : APP_SETTINGS_PATH} variant="secondary" size="sm" aria-label={shellCopy.settings}>
            <Settings size={18} aria-hidden="true" />
            <span>{shellCopy.settings}</span>
          </Button>
        </div>
        {remoteLoading ? null : <MyNavigation />}
        {remoteLoading ? null : <Outlet />}
        {remoteLoading ? null : <DataAttribution />}
      </main>
      <BottomNav />
      {remoteLoading ? <BasketballLoader overlay randomLabel /> : null}
    </div>
  );
}
