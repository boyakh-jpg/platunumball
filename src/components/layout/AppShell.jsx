import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";
import Sidebar from "./Sidebar.jsx";

export default function AppShell({ app, auth }) {
  return (
    <div className="app-shell">
      <Sidebar user={app.currentUser} auth={auth} />
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
