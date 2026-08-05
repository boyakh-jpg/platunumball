import { useEffect } from "react";
import { Link, Outlet } from "react-router-dom";
import BasketballLoader from "../common/BasketballLoader.jsx";
import Button from "../common/Button.jsx";
import BottomNav from "./BottomNav.jsx";
import DataAttribution from "./DataAttribution.jsx";
import Sidebar from "./Sidebar.jsx";

export default function AppShell({ app, auth, guestPreview = false }) {
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
        {guestPreview && !remoteLoading ? (
          <div className="guest-preview-bar ui-panel" role="status">
            <span>체험 데이터로 홈을 둘러보는 중입니다.</span>
            <Button as={Link} to="/login" size="sm">로그인</Button>
          </div>
        ) : null}
        {remoteLoading ? null : <Outlet />}
        {remoteLoading ? null : <DataAttribution />}
      </main>
      <BottomNav />
      {remoteLoading ? <BasketballLoader overlay randomLabel /> : null}
      {serverLoading ? <BasketballLoader overlay randomLabel /> : null}
    </div>
  );
}
