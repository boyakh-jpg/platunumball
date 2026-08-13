import { Outlet, useLocation } from "react-router-dom";
import DataAttribution from "./DataAttribution.jsx";

export default function PublicShell() {
  const location = useLocation();
  const compactFooter = location.pathname === "/" || location.pathname === "/start";

  return (
    <div className="public-shell">
      <Outlet />
      <DataAttribution compact={compactFooter} />
    </div>
  );
}
