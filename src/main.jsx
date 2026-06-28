import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ScrollToTop from "./components/common/ScrollToTop.jsx";
import { installRemoteAssetVariables } from "./lib/assets.js";
import "./styles/tokens.css";
import "./styles/globals.css";

installRemoteAssetVariables();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
