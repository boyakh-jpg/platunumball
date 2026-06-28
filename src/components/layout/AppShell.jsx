import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";
import Sidebar from "./Sidebar.jsx";
import { assetUrl } from "../../lib/assets.js";

const remoteLoaderBallSrc = assetUrl("/assets/bounding_ball2.gif");

export default function AppShell({ app, auth }) {
  const [showRemoteLoader, setShowRemoteLoader] = useState(false);
  const [remoteLoaderImageFailed, setRemoteLoaderImageFailed] = useState(false);

  useEffect(() => {
    if (app.remoteReady !== false) {
      setShowRemoteLoader(false);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setShowRemoteLoader(true);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [app.remoteReady]);

  return (
    <div className="app-shell">
      <Sidebar user={app.currentUser} teams={app.state.teams} auth={auth} />
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
      {showRemoteLoader ? (
        <div className="basketball-loader-overlay" role="status" aria-live="polite" aria-label="서버 데이터를 불러오는 중">
          <div className="basketball-loader">
            <span className="basketball-loader-visual" aria-hidden="true">
              {remoteLoaderImageFailed ? null : (
                <img
                  className="basketball-loader-gif"
                  src={remoteLoaderBallSrc}
                  width="50"
                  height="50"
                  alt=""
                  decoding="async"
                  onError={() => setRemoteLoaderImageFailed(true)}
                />
              )}
              <span className={remoteLoaderImageFailed ? "basketball-loader-ball active" : "basketball-loader-ball"} />
            </span>
            <span className="basketball-loader-shadow" aria-hidden="true" />
            <span className="basketball-loader-text">불러오는 중</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
