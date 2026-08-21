import { Instagram } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { getReceiptLocale, RECEIPT_SHELL_COPY } from "../../lib/receiptLocale.js";

const DATA_PORTAL_URL = "https://www.data.go.kr/";
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
const INSTAGRAM_URL = "https://www.instagram.com/box_tier/";

export default function DataAttribution({ compact = false }) {
  const location = useLocation();
  const shellCopy = RECEIPT_SHELL_COPY[getReceiptLocale(location)];

  return (
    <footer className={`site-data-footer${compact ? " is-compact" : ""}`} aria-label={shellCopy.serviceInformation}>
      <Link to="/privacy">{shellCopy.privacyPolicy}</Link>
      <span aria-hidden="true">·</span>
      <Link to="/terms">{shellCopy.termsOfService}</Link>
      <span aria-hidden="true">·</span>
      <a className="site-footer-social-link" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
        <Instagram aria-hidden="true" />
        Instagram @box_tier
      </a>
      {!compact ? (
        <>
          <span className="site-footer-divider" aria-hidden="true">|</span>
          <Link to="/data-sources">{shellCopy.courtData}</Link>
          <a href={DATA_PORTAL_URL} target="_blank" rel="noopener noreferrer">{shellCopy.publicDataPortal}</a>
          <span aria-hidden="true">·</span>
          <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
        </>
      ) : null}
    </footer>
  );
}
