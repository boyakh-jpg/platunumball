import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ScrollToTop from "./components/common/ScrollToTop.jsx";
import { installRemoteAssetVariables } from "./lib/assets.js";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/ui-primitives.css";

const PRELOAD_RECOVERY_KEY = "boxtier.preload-recovery-at";
const PRELOAD_RECOVERY_WINDOW_MS = 30_000;

window.addEventListener("vite:preloadError", (event) => {
  let lastRecoveryAt = 0;
  try {
    lastRecoveryAt = Number(window.sessionStorage.getItem(PRELOAD_RECOVERY_KEY) ?? 0);
  } catch {
    lastRecoveryAt = 0;
  }
  if (Date.now() - lastRecoveryAt < PRELOAD_RECOVERY_WINDOW_MS) return;
  event.preventDefault();
  try {
    window.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, String(Date.now()));
  } catch {}
  window.location.reload();
});

window.setTimeout(() => {
  try {
    window.sessionStorage.removeItem(PRELOAD_RECOVERY_KEY);
  } catch {}
}, PRELOAD_RECOVERY_WINDOW_MS);

installRemoteAssetVariables();

const rootElement = document.getElementById("root");
rootElement.replaceChildren();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
