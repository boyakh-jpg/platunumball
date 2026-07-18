import { Component, Suspense, lazy, useEffect, useLayoutEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import RequireAuth from "./components/auth/RequireAuth.jsx";
import BasketballLoader from "./components/common/BasketballLoader.jsx";
import AppShell from "./components/layout/AppShell.jsx";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { useAppData } from "./hooks/useAppData.js";
import { getSafeAppRedirect, shouldRecheckAgeGroup, shouldSetupProfile } from "./lib/profileSetup.js";

const Admin = lazy(() => import("./pages/Admin.jsx"));
const Affiliations = lazy(() => import("./pages/Affiliations.jsx"));
const CreateMatch = lazy(() => import("./pages/CreateMatch.jsx"));
const CourtDetail = lazy(() => import("./pages/CourtDetail.jsx"));
const Home = lazy(() => import("./pages/Home.jsx"));
const Landing = lazy(() => import("./pages/Landing.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Matches = lazy(() => import("./pages/Matches.jsx"));
const MatchRoom = lazy(() => import("./pages/MatchRoom.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const PlayerDetail = lazy(() => import("./pages/PlayerDetail.jsx"));
const Profile = lazy(() => import("./pages/Profile.jsx"));
const ProfileRecords = lazy(() => import("./pages/ProfileRecords.jsx"));
const Rankings = lazy(() => import("./pages/Rankings.jsx"));
const Recorder = lazy(() => import("./pages/Recorder.jsx"));
const RefereeRulebook = lazy(() => import("./pages/RefereeRulebook.jsx"));
const Recruiting = lazy(() => import("./pages/Recruiting.jsx"));
const Season = lazy(() => import("./pages/Season.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Signup = lazy(() => import("./pages/Signup.jsx"));
const TeamDetail = lazy(() => import("./pages/TeamDetail.jsx"));
const Teams = lazy(() => import("./pages/Teams.jsx"));
const TournamentDetail = lazy(() => import("./pages/TournamentDetail.jsx"));

function preloadCoreAppRoutes() {
  return Promise.allSettled([
    import("./pages/Home.jsx"),
    import("./pages/Matches.jsx"),
    import("./pages/Recruiting.jsx"),
    import("./pages/Recorder.jsx"),
    import("./pages/Teams.jsx"),
    import("./pages/Profile.jsx"),
    import("./pages/Settings.jsx"),
    import("./pages/CreateMatch.jsx"),
  ]);
}

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error, info) {
    console.error("boxtier render failed.", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">boxtier</p>
          <h1>화면을 불러오지 못했습니다</h1>
          <p>{String(this.state.error?.message ?? "render_failed")}</p>
          <button type="button" className="button button-primary button-md" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </section>
      </main>
    );
  }
}

export default function App() {
  const auth = useAuthSession();
  const location = useLocation();
  const app = useAppData(auth.user ?? null, location);
  const theme = app.state.settings?.theme === "light" ? "light" : "dark";
  const profileGateReady = Boolean(!auth.user || app.remoteReady);
  const ageRecheckRequired = Boolean(
    auth.user &&
      profileGateReady &&
      location.pathname.startsWith("/app") &&
      location.pathname !== "/app/signup" &&
      shouldRecheckAgeGroup(app.currentUser),
  );
  const profileSetupRequired = Boolean(
    auth.user &&
      profileGateReady &&
      location.pathname.startsWith("/app") &&
      location.pathname !== "/app/signup" &&
      shouldSetupProfile(app.currentUser),
  );

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!auth.user || !app.remoteReady || !location.pathname.startsWith("/app")) return undefined;
    const schedule = window.requestIdleCallback ?? ((callback) => window.setTimeout(callback, 800));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const id = schedule(() => {
      preloadCoreAppRoutes();
    });
    return () => cancel(id);
  }, [app.remoteReady, auth.user, location.pathname]);

  if (profileSetupRequired || ageRecheckRequired) {
    const redirectTo = getSafeAppRedirect(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`/app/signup?redirect=${encodeURIComponent(redirectTo)}`} replace />;
  }

  return (
    <AppErrorBoundary resetKey={location.pathname}>
      <Suspense fallback={<BasketballLoader overlay label="페이지 불러오는 중" />}>
        <Routes>
        <Route path="/" element={<Landing state={app.state} />} />
        <Route path="/login" element={<Login auth={auth} app={app} />} />
        <Route element={<RequireAuth auth={auth} />}>
          <Route element={<AppShell app={app} auth={auth} />}>
            <Route path="/app" element={<Home app={app} />} />
            <Route path="/app/create" element={<CreateMatch app={app} />} />
            <Route path="/app/courts/:courtId" element={<CourtDetail app={app} />} />
            <Route path="/app/matches/:matchId" element={<MatchRoom app={app} />} />
            <Route path="/app/matches" element={<Matches app={app} />} />
            <Route path="/app/recorder" element={<Recorder app={app} />} />
            <Route path="/app/referee-rulebook" element={<RefereeRulebook theme={theme} />} />
            <Route path="/app/season" element={<Season app={app} />} />
            <Route path="/app/rankings" element={<Rankings app={app} />} />
            <Route path="/app/recruiting" element={<Recruiting app={app} />} />
            <Route path="/app/teams" element={<Teams app={app} />} />
            <Route path="/app/teams/:teamId" element={<TeamDetail app={app} />} />
            <Route path="/app/tournaments/:tournamentId" element={<TournamentDetail app={app} />} />
            <Route path="/app/players/:playerId" element={<PlayerDetail app={app} />} />
            <Route path="/app/profile" element={<Profile app={app} />} />
            <Route path="/app/profile/records" element={<ProfileRecords app={app} />} />
            <Route path="/app/affiliations" element={<Affiliations app={app} />} />
            <Route path="/app/notifications" element={<Notifications app={app} />} />
            <Route path="/app/admin" element={<Admin app={app} />} />
            <Route path="/app/settings" element={<Settings app={app} auth={auth} />} />
            <Route path="/app/settings/favorites" element={<Settings app={app} auth={auth} section="favorites" />} />
            <Route path="/app/settings/profile" element={<Settings app={app} auth={auth} section="profile" />} />
            <Route path="/app/settings/discord" element={<Settings app={app} auth={auth} section="discord" />} />
            <Route path="/app/settings/courts" element={<Settings app={app} auth={auth} section="courts" />} />
            <Route path="/app/settings/referee" element={<Settings app={app} auth={auth} section="referee" />} />
            <Route path="/app/signup" element={<Signup app={app} auth={auth} />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
