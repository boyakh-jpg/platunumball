import { useState } from "react";
import Card from "../components/common/Card.jsx";
import RankingTable from "../components/ranking/RankingTable.jsx";
import RankingTabs from "../components/ranking/RankingTabs.jsx";

const tabs = [
  { id: "integrated", label: "통합" },
  { id: "1v1", label: "1v1" },
  { id: "3v3", label: "3v3" },
  { id: "5v5", label: "5v5" },
  { id: "teams", label: "팀" },
  { id: "affiliations", label: "소속" },
];

export default function Rankings({ app }) {
  const [tab, setTab] = useState("integrated");
  const type = tab === "teams" ? "teams" : tab === "affiliations" ? "affiliations" : "players";
  const rows =
    tab === "teams"
      ? app.rankings.teams
      : tab === "affiliations"
        ? app.rankings.affiliations
        : tab === "integrated"
          ? app.rankings.players
          : app.rankings.mode(tab);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Rankings</p>
          <h1>랭킹</h1>
        </div>
      </header>
      <Card className="section-card">
        <RankingTabs value={tab} options={tabs} onChange={setTab} />
        <RankingTable rows={rows} type={type} mode={tab} />
      </Card>
    </div>
  );
}
