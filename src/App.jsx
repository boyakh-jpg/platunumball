import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell.jsx";
import { useAppData } from "./hooks/useAppData.js";
import Affiliations from "./pages/Affiliations.jsx";
import CreateMatch from "./pages/CreateMatch.jsx";
import Home from "./pages/Home.jsx";
import Landing from "./pages/Landing.jsx";
import Matches from "./pages/Matches.jsx";
import MatchRoom from "./pages/MatchRoom.jsx";
import Notifications from "./pages/Notifications.jsx";
import PlayerDetail from "./pages/PlayerDetail.jsx";
import Profile from "./pages/Profile.jsx";
import Rankings from "./pages/Rankings.jsx";
import Settings from "./pages/Settings.jsx";
import TeamDetail from "./pages/TeamDetail.jsx";
import Teams from "./pages/Teams.jsx";

export default function App() {
  const app = useAppData();

  return (
    <Routes>
      <Route path="/" element={<Landing state={app.state} />} />
      <Route element={<AppShell app={app} />}>
        <Route path="/app" element={<Home app={app} />} />
        <Route path="/app/create" element={<CreateMatch app={app} />} />
        <Route path="/app/matches/:matchId" element={<MatchRoom app={app} />} />
        <Route path="/app/matches" element={<Matches app={app} />} />
        <Route path="/app/rankings" element={<Rankings app={app} />} />
        <Route path="/app/teams" element={<Teams app={app} />} />
        <Route path="/app/teams/:teamId" element={<TeamDetail app={app} />} />
        <Route path="/app/players/:playerId" element={<PlayerDetail app={app} />} />
        <Route path="/app/profile" element={<Profile app={app} />} />
        <Route path="/app/affiliations" element={<Affiliations app={app} />} />
        <Route path="/app/notifications" element={<Notifications app={app} />} />
        <Route path="/app/settings" element={<Settings app={app} />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
