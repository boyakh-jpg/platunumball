import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/auth/RequireAuth.jsx";
import AppShell from "./components/layout/AppShell.jsx";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { useAppData } from "./hooks/useAppData.js";
import Affiliations from "./pages/Affiliations.jsx";
import CreateMatch from "./pages/CreateMatch.jsx";
import Home from "./pages/Home.jsx";
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Matches from "./pages/Matches.jsx";
import MatchRoom from "./pages/MatchRoom.jsx";
import Notifications from "./pages/Notifications.jsx";
import PlayerDetail from "./pages/PlayerDetail.jsx";
import Profile from "./pages/Profile.jsx";
import Rankings from "./pages/Rankings.jsx";
import Recruiting from "./pages/Recruiting.jsx";
import Season from "./pages/Season.jsx";
import Settings from "./pages/Settings.jsx";
import TeamDetail from "./pages/TeamDetail.jsx";
import Teams from "./pages/Teams.jsx";
import TournamentDetail from "./pages/TournamentDetail.jsx";

export default function App() {
  const auth = useAuthSession();
  const app = useAppData(auth.user?.id ?? null);
  const theme = app.state.settings?.theme === "light" ? "light" : "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <Routes>
      <Route path="/" element={<Landing state={app.state} />} />
      <Route path="/login" element={<Login auth={auth} app={app} />} />
      <Route element={<RequireAuth auth={auth} />}>
        <Route element={<AppShell app={app} auth={auth} />}>
          <Route path="/app" element={<Home app={app} />} />
          <Route path="/app/create" element={<CreateMatch app={app} />} />
          <Route path="/app/matches/:matchId" element={<MatchRoom app={app} />} />
          <Route path="/app/matches" element={<Matches app={app} />} />
          <Route path="/app/season" element={<Season app={app} />} />
          <Route path="/app/rankings" element={<Rankings app={app} />} />
          <Route path="/app/recruiting" element={<Recruiting app={app} />} />
          <Route path="/app/teams" element={<Teams app={app} />} />
          <Route path="/app/teams/:teamId" element={<TeamDetail app={app} />} />
          <Route path="/app/tournaments/:tournamentId" element={<TournamentDetail app={app} />} />
          <Route path="/app/players/:playerId" element={<PlayerDetail app={app} />} />
          <Route path="/app/profile" element={<Profile app={app} />} />
          <Route path="/app/affiliations" element={<Affiliations app={app} />} />
          <Route path="/app/notifications" element={<Notifications app={app} />} />
          <Route path="/app/settings" element={<Settings app={app} auth={auth} />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
