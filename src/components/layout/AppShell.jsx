import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import BasketballLoader from "../common/BasketballLoader.jsx";
import BottomNav from "./BottomNav.jsx";
import DataAttribution from "./DataAttribution.jsx";
import Sidebar from "./Sidebar.jsx";

export default function AppShell({ app, auth }) {
  const remoteLoading = app.remoteReady === false;
  const serverLoading = !remoteLoading && app.serverBusy === true;

  useEffect(() => {
    document.documentElement.classList.toggle("rankball-remote-loading", remoteLoading);
    return () => {
      document.documentElement.classList.remove("rankball-remote-loading");
    };
  }, [remoteLoading]);

  return (
    <div className="app-shell ui-design-host" data-design="editorial">
      <Sidebar user={app.currentUser} teams={app.state.teams} auth={auth} />
      <main className="app-main ui-design-app" aria-busy={remoteLoading || serverLoading}>
        {remoteLoading ? null : <Outlet />}
        {remoteLoading ? null : <DataAttribution />}
      </main>
      <BottomNav />
      {remoteLoading ? <BasketballLoader overlay randomLabel /> : null}
      {serverLoading ? <BasketballLoader overlay randomLabel /> : null}
    </div>
  );
}
