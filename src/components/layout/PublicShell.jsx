import { Outlet } from "react-router-dom";
import DataAttribution from "./DataAttribution.jsx";

export default function PublicShell() {
  return (
    <div className="public-shell">
      <Outlet />
      <DataAttribution />
    </div>
  );
}
