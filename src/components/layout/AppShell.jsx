import { useState } from "react";
import { Outlet } from "react-router-dom";
import BottomNav from "./BottomNav.jsx";
import Sidebar from "./Sidebar.jsx";
import { assetUrl } from "../../lib/assets.js";

const remoteLoaderBallSources = [
  "https://pub-ace5b2a3eb5a41dfba7488c3de616118.r2.dev/assets/bounding_ball2.gif",
  assetUrl("/assets/bounding_ball2.gif"),
];

export default function AppShell({ app, auth }) {
  const [remoteLoaderImageFailed, setRemoteLoaderImageFailed] = useState(false);
  const [remoteLoaderImageIndex, setRemoteLoaderImageIndex] = useState(0);

  return (
    <div className="app-shell">
      <Sidebar user={app.currentUser} teams={app.state.teams} auth={auth} />
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
      {app.remoteReady === false ? (
        <div className="basketball-loader-overlay" role="status" aria-live="polite" aria-label="서버 데이터를 불러오는 중">
          <div className="basketball-loader">
            <span className="basketball-loader-visual" aria-hidden="true">
              {remoteLoaderImageFailed ? null : (
                <img
                  className="basketball-loader-gif"
                  src={remoteLoaderBallSources[remoteLoaderImageIndex]}
                  width="50"
                  height="50"
                  alt=""
                  decoding="async"
                  onError={() => {
                    setRemoteLoaderImageIndex((currentIndex) => {
                      const nextIndex = currentIndex + 1;
                      if (nextIndex < remoteLoaderBallSources.length) return nextIndex;
                      setRemoteLoaderImageFailed(true);
                      return currentIndex;
                    });
                  }}
                />
              )}
            </span>
            <span className="basketball-loader-text">불러오는 중</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
