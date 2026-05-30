import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";
import Sidebar from "./Sidebar.jsx";

export default function AppShell({ app }) {
  return (
    <div className="app-shell">
      <Sidebar user={app.currentUser} />
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
