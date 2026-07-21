import { Link } from "react-router-dom";

const DATA_PORTAL_URL = "https://www.data.go.kr/";
const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

export default function DataAttribution() {
  return (
    <footer className="site-data-footer" aria-label="농구장 데이터 출처">
      <Link to="/data-sources">농구장 데이터:</Link>
      <a href={DATA_PORTAL_URL} target="_blank" rel="noopener noreferrer">공공데이터포털</a>
      <span aria-hidden="true">·</span>
      <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
    </footer>
  );
}
