import { Component, Suspense, lazy, useEffect, useLayoutEffect } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import RequireAdmin from "./components/auth/RequireAdmin.jsx";
import RequireAuth from "./components/auth/RequireAuth.jsx";
import GuestAccessNotice from "./components/auth/GuestAccessNotice.jsx";
import BasketballLoader from "./components/common/BasketballLoader.jsx";
import LandingLoading from "./components/common/LandingLoading.jsx";
import AppShell from "./components/layout/AppShell.jsx";
import PublicShell from "./components/layout/PublicShell.jsx";
import { useAuthSession } from "./hooks/useAuthSession.js";
import { useAppData } from "./hooks/useAppData.js";
import useImageInteractionGuard from "./hooks/useImageInteractionGuard.js";
import { BRAND_NAME } from "./lib/brand.js";
import { getSafeAppRedirect, isProfileGateReady, shouldRecheckAgeGroup, shouldSetupProfile } from "./lib/profileSetup.js";

const Admin = lazy(() => import("./pages/Admin.jsx"));
const AdminCourtMapPopup = lazy(() => import("./pages/AdminCourtMapPopup.jsx"));
const Affiliations = lazy(() => import("./pages/Affiliations.jsx"));
const Community = lazy(() => import("./pages/Community.jsx"));
const CreateMatch = lazy(() => import("./pages/CreateMatch.jsx"));
const MatchReceipt = lazy(() => import("./pages/MatchReceipt.jsx"));
const CourtDetail = lazy(() => import("./pages/CourtDetail.jsx"));
const DataSources = lazy(() => import("./pages/DataSources.jsx"));
const GettingStarted = lazy(() => import("./pages/GettingStarted.jsx"));
const Home = lazy(() => import("./pages/Home.jsx"));
const Landing = lazy(() => import("./pages/Landing.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Matches = lazy(() => import("./pages/Matches.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const NotFound = lazy(() => import("./pages/NotFound.jsx"));
const PlayerDetail = lazy(() => import("./pages/PlayerDetail.jsx"));
const RefereeDetail = lazy(() => import("./pages/RefereeDetail.jsx"));
const Privacy = lazy(() => import("./pages/Privacy.jsx"));
const Profile = lazy(() => import("./pages/Profile.jsx"));
const ProfileAchievements = lazy(() => import("./pages/ProfileAchievements.jsx"));
const ProfileRecords = lazy(() => import("./pages/ProfileRecords.jsx"));
const PracticeMatch = lazy(() => import("./pages/PracticeMatch.jsx"));
const Rankings = lazy(() => import("./pages/Rankings.jsx"));
const Recorder = lazy(() => import("./pages/Recorder.jsx"));
const RefereeRulebook = lazy(() => import("./pages/RefereeRulebook.jsx"));
const VisualDirectionDemo = lazy(() => import("./pages/VisualDirectionDemo.jsx"));
const Recruiting = lazy(() => import("./pages/Recruiting.jsx"));
const Season = lazy(() => import("./pages/Season.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
const Signup = lazy(() => import("./pages/Signup.jsx"));
const TeamDetail = lazy(() => import("./pages/TeamDetail.jsx"));
const Teams = lazy(() => import("./pages/Teams.jsx"));
const Terms = lazy(() => import("./pages/Terms.jsx"));
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

const GUEST_PUBLIC_APP_PATHS = new Set([
  "/app",
  "/app/guide",
  "/app/guide/practice",
  "/app/create",
  "/app/receipt",
  "/app/community",
  "/app/matches",
  "/app/profile",
  "/app/recorder",
  "/app/recruiting",
  "/app/referee-rulebook",
  "/app/rankings",
  "/app/settings",
  "/app/teams",
]);
const GUEST_PUBLIC_APP_PREFIXES = [
  "/app/matches/",
  "/app/players/",
  "/app/teams/",
];

export function isGuestPublicAppPath(pathname = "") {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return GUEST_PUBLIC_APP_PATHS.has(normalizedPathname)
    || GUEST_PUBLIC_APP_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix));
}

function LegacyMatchRoomRedirect() {
  const { matchId = "" } = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  searchParams.set("match", matchId);
  return (
    <Navigate
      to={{
        pathname: "/app/matches",
        search: `?${searchParams.toString()}`,
        hash: location.hash,
      }}
      replace
    />
  );
}

export class AppErrorBoundary extends Component {
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
          <p className="eyebrow">{BRAND_NAME}</p>
          <h1>화면을 불러오지 못했습니다</h1>
          <p>일시적인 오류가 발생했습니다. 새로고침한 뒤 다시 시도해 주세요.</p>
          <button type="button" className="button ui-button button-primary ui-button-primary button-md ui-button-md" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </section>
      </main>
    );
  }
}

export function getAppErrorBoundaryResetKey(location = {}) {
  return `${location.pathname ?? ""}${location.search ?? ""}${location.hash ?? ""}`;
}

export default function App() {
  const auth = useAuthSession();
  const location = useLocation();
  const guestPreview = Boolean(
    auth.configured
      && !auth.loading
      && !auth.session
      && isGuestPublicAppPath(location.pathname),
  );
  const app = useAppData(auth.user ?? null, location, { demoPreview: guestPreview });
  useImageInteractionGuard();
  const theme = app.state.settings?.theme === "light" ? "light" : "dark";
  const profileGateReady = isProfileGateReady({
    authUserId: auth.user?.id,
    profileAuthUserId: app.currentUser?.authUserId,
    remoteReady: app.remoteReady,
    serverProfileBound: app.serverProfileBound,
  });
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
    document.getElementById("app-theme-color")?.setAttribute(
      "content",
      theme === "light" ? "#f5f1e8" : "#303132",
    );
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

  useEffect(() => {
    if (!auth.user || !app.serverProfileBound || !("serviceWorker" in navigator)) return undefined;
    const handlePush = (event) => {
      if (event.data?.type === "boxtier:push") void app.actions.loadNotifications();
    };
    navigator.serviceWorker.addEventListener("message", handlePush);
    return () => navigator.serviceWorker.removeEventListener("message", handlePush);
  }, [app.actions.loadNotifications, app.serverProfileBound, auth.user]);

  if (profileSetupRequired || ageRecheckRequired) {
    const redirectTo = getSafeAppRedirect(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`/app/signup?redirect=${encodeURIComponent(redirectTo)}`} replace />;
  }

  return (
    <AppErrorBoundary resetKey={getAppErrorBoundaryResetKey(location)}>
      <svg aria-hidden="true" width="0" height="0" focusable="false">
        <defs>
          <filter
            id="ui-liquid-glass-refraction"
            x="-8%"
            y="-12%"
            width="116%"
            height="124%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.018" numOctaves="1" seed="8" stitchTiles="stitch" result="liquidNoise" />
            <feDisplacementMap in="SourceGraphic" in2="liquidNoise" scale="1.25" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <Suspense fallback={location.pathname === "/" || location.pathname === "/start"
        ? <LandingLoading />
        : <BasketballLoader overlay label="페이지 불러오는 중" />}>
        <Routes>
        <Route element={<PublicShell />}>
          <Route path="/" element={<Landing auth={auth} />} />
          <Route path="/start" element={<Landing auth={auth} />} />
          <Route path="/login" element={<Login auth={auth} app={app} />} />
          <Route path="/data-sources" element={<DataSources />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/demo/visual-direction" element={<VisualDirectionDemo />} />
        </Route>
        <Route element={<RequireAuth auth={auth} allowGuestHome={guestPreview} />}>
          <Route path="/app/admin/court-map" element={<RequireAdmin app={app}><AdminCourtMapPopup /></RequireAdmin>} />
          <Route element={<AppShell app={app} auth={auth} guestPreview={guestPreview} />}>
            <Route path="/app" element={<Home app={app} />} />
            <Route path="/app/guide" element={<GettingStarted app={app} />} />
            <Route path="/app/guide/practice" element={<PracticeMatch app={app} />} />
            <Route path="/app/create" element={<CreateMatch app={app} />} />
            <Route path="/app/receipt" element={<MatchReceipt auth={auth} app={app} />} />
            <Route path="/app/courts/:courtId" element={<CourtDetail app={app} />} />
            <Route path="/app/matches/:matchId" element={<LegacyMatchRoomRedirect />} />
            <Route path="/app/matches" element={<Matches app={app} />} />
            <Route path="/app/recorder" element={guestPreview ? (
              <GuestAccessNotice title="플레이는 로그인 후 확인할 수 있습니다" description="로그인하면 진행 중인 경기와 기록 입력 대상을 불러옵니다." />
            ) : <Recorder app={app} />} />
            <Route path="/app/referee-rulebook" element={<RefereeRulebook theme={theme} />} />
            <Route path="/app/season" element={<Season app={app} />} />
            <Route path="/app/rankings" element={<Rankings app={app} />} />
            <Route path="/app/recruiting" element={<Recruiting app={app} readOnly={guestPreview} />} />
            <Route path="/app/community" element={<Community app={app} />} />
            <Route path="/app/teams" element={<Teams app={app} />} />
            <Route path="/app/teams/:teamId" element={<TeamDetail app={app} />} />
            <Route path="/app/tournaments/:tournamentId" element={<TournamentDetail app={app} />} />
            <Route path="/app/players/:playerId" element={<PlayerDetail app={app} />} />
            <Route path="/app/referees/:refereeId" element={<RefereeDetail app={app} />} />
            <Route path="/app/profile" element={guestPreview ? (
              <GuestAccessNotice title="내 정보는 로그인 후 확인할 수 있습니다" description="로그인하면 프로필, 랭크, 업적과 경기 기록을 불러옵니다." />
            ) : <Profile app={app} />} />
            <Route path="/app/profile/achievements" element={<ProfileAchievements app={app} />} />
            <Route path="/app/profile/records" element={<ProfileRecords app={app} />} />
            <Route path="/app/affiliations" element={<Affiliations app={app} />} />
            <Route path="/app/notifications" element={<Notifications app={app} />} />
            <Route path="/app/admin" element={<RequireAdmin app={app}><Admin app={app} /></RequireAdmin>} />
            <Route path="/app/settings" element={guestPreview ? (
              <GuestAccessNotice title="설정은 로그인 후 확인할 수 있습니다" description="로그인하면 계정, 화면, 구장과 연동 설정을 불러옵니다." />
            ) : <Settings app={app} auth={auth} />} />
            <Route path="/app/settings/favorites" element={<Settings app={app} auth={auth} section="favorites" />} />
            <Route path="/app/settings/profile" element={<Settings app={app} auth={auth} section="profile" />} />
            <Route path="/app/settings/discord" element={<Settings app={app} auth={auth} section="discord" />} />
            <Route path="/app/settings/courts" element={<Settings app={app} auth={auth} section="courts" />} />
            <Route path="/app/settings/referee" element={<Settings app={app} auth={auth} section="referee" />} />
            <Route path="/app/signup" element={<Signup app={app} auth={auth} />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
