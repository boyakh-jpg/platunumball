import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ScrollToTop from "./components/common/ScrollToTop.jsx";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/recruiting-overwatch.css";
import "./styles/matches-overwatch.css";
import "./styles/matchroom-overwatch.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
