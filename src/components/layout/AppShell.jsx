import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import BasketballLoader from "../common/BasketballLoader.jsx";
import BottomNav from "./BottomNav.jsx";
import Sidebar from "./Sidebar.jsx";

export default function AppShell({ app, auth }) {
  const remoteLoading = app.remoteReady === false;

  useEffect(() => {
    document.documentElement.classList.toggle("rankball-remote-loading", remoteLoading);
    return () => {
      document.documentElement.classList.remove("rankball-remote-loading");
    };
  }, [remoteLoading]);

  return (
    <div className="app-shell">
      <Sidebar user={app.currentUser} teams={app.state.teams} auth={auth} />
      <main className="app-main" aria-busy={remoteLoading}>
        {remoteLoading ? null : <Outlet />}
      </main>
      <BottomNav />
      {remoteLoading ? <BasketballLoader overlay randomLabel /> : null}
    </div>
  );
}
