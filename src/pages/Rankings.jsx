import { useState } from "react";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import RankingTable from "../components/ranking/RankingTable.jsx";
import RankingTabs from "../components/ranking/RankingTabs.jsx";

const tabs = [
  { id: "local", label: "내 주변" },
  { id: "integrated", label: "통합" },
  { id: "1v1", label: "1v1" },
  { id: "3v3", label: "3v3" },
  { id: "5v5", label: "5v5" },
  { id: "teams", label: "팀" },
  { id: "affiliations", label: "소속" },
];

export default function Rankings({ app }) {
  const [tab, setTab] = useState("local");
  const myRegion = app.currentUser.region;
  const hiddenUserIds = new Set(app.state.settings?.blockedUserIds ?? []);
  if (app.state.settings?.privacy?.regionRanking === false) hiddenUserIds.add(app.currentUser.id);
  const visiblePlayers = app.rankings.players.filter((user) => !hiddenUserIds.has(user.id));
  const visibleModePlayers = tab === "teams" || tab === "affiliations" || tab === "integrated" || tab === "local"
    ? visiblePlayers
    : app.rankings.mode(tab).filter((user) => !hiddenUserIds.has(user.id));
  const localPlayers = visiblePlayers.filter((user) => user.region === myRegion);
  const localTeams = app.rankings.teams.filter((team) => team.region === myRegion);
  const localAffiliations = app.rankings.affiliations.filter((affiliation) => affiliation.name === myRegion || affiliation.type !== "region").slice(0, 6);
  const type = tab === "teams" ? "teams" : tab === "affiliations" ? "affiliations" : "players";
  const rows =
    tab === "teams"
      ? app.rankings.teams
      : tab === "affiliations"
        ? app.rankings.affiliations
        : tab === "integrated"
          ? visiblePlayers
          : tab === "local"
            ? localPlayers
            : visibleModePlayers;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Rankings</p>
          <h1>지역과 주변 소속부터 보는 랭킹</h1>
        </div>
        <Badge tone="green">{myRegion} 우선</Badge>
      </header>
      {tab === "local" ? (
        <div className="content-grid">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Local Players</p>
                <h2>{myRegion} 개인 랭킹</h2>
              </div>
            </div>
            <RankingTable rows={localPlayers} type="players" mode="integrated" />
          </Card>
          <div className="page-stack">
            <Card className="section-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Local Teams</p>
                  <h2>{myRegion} 팀</h2>
                </div>
              </div>
              <RankingTable rows={localTeams} type="teams" />
            </Card>
            <Card className="section-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Affiliations</p>
                  <h2>주변 소속</h2>
                </div>
              </div>
              <RankingTable rows={localAffiliations} type="affiliations" />
            </Card>
          </div>
        </div>
      ) : null}
      <Card className="section-card">
        <RankingTabs value={tab} options={tabs} onChange={setTab} />
        {tab === "local" ? null : <RankingTable rows={rows} type={type} mode={tab} />}
      </Card>
    </div>
  );
}
