import { Instagram } from "lucide-react";
import { Link } from "react-router-dom";

const DATA_PORTAL_URL = "https://www.data.go.kr/";
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
const INSTAGRAM_URL = "https://www.instagram.com/box_tier/";

export default function DataAttribution() {
  return (
    <footer className="site-data-footer" aria-label="서비스 정보">
      <Link to="/privacy">개인정보처리방침</Link>
      <span aria-hidden="true">·</span>
      <Link to="/terms">서비스 약관</Link>
      <span aria-hidden="true">·</span>
      <a className="site-footer-social-link" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">
        <Instagram aria-hidden="true" />
        Instagram @box_tier
      </a>
      <span className="site-footer-divider" aria-hidden="true">|</span>
      <Link to="/data-sources">농구장 데이터:</Link>
      <a href={DATA_PORTAL_URL} target="_blank" rel="noopener noreferrer">공공데이터포털</a>
      <span aria-hidden="true">·</span>
      <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
    </footer>
  );
}
