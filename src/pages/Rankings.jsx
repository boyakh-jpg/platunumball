import { useEffect, useState } from "react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import RankingTable from "../components/ranking/RankingTable.jsx";
import RankingTabs from "../components/ranking/RankingTabs.jsx";
import { isSupabaseConfigured } from "../lib/supabase.js";

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
  const loadDirectory = app.actions.loadDirectory;
  const directoryKind = tab === "teams" ? "teams" : tab === "affiliations" ? "affiliations" : tab === "local" ? "all" : "players";
  const directoryRegion = tab === "local" ? myRegion : "";
  useEffect(() => {
    loadDirectory?.({ kind: directoryKind, region: directoryRegion, limit: 50, offset: 0 });
  }, [directoryKind, directoryRegion, loadDirectory]);
  const hiddenUserIds = new Set(app.state.settings?.blockedUserIds ?? []);
  const visiblePlayers = app.rankings.players.filter((user) => !hiddenUserIds.has(user.id));
  const visibleModePlayers = tab === "teams" || tab === "affiliations" || tab === "integrated" || tab === "local"
    ? visiblePlayers
    : app.rankings.mode(tab).filter((user) => !hiddenUserIds.has(user.id));
  const localPlayers = visiblePlayers.filter((user) => (
    user.region === myRegion && (
      user.id === app.currentUser.id ||
      user.privacy?.regionRanking === true ||
      (!isSupabaseConfigured && user.privacy?.regionRanking !== false)
    )
  ));
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
      <Card className="section-card ranking-filter-card">
        <RankingTabs value={tab} options={tabs} onChange={setTab} />
      </Card>
      {tab === "local" ? (
        <div className="content-grid">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Local Players</p>
                <h2>{myRegion} 개인 랭킹</h2>
              </div>
            </div>
            <RankingTable rows={localPlayers} type="players" mode="integrated" teams={app.state.teams} />
          </Card>
          <div className="page-stack">
            <Card className="section-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Local Teams</p>
                  <h2>{myRegion} 팀</h2>
                </div>
              </div>
              <RankingTable rows={localTeams} type="teams" teams={app.state.teams} />
            </Card>
            <Card className="section-card">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Affiliations</p>
                  <h2>주변 소속</h2>
                </div>
              </div>
              <RankingTable rows={localAffiliations} type="affiliations" teams={app.state.teams} />
            </Card>
          </div>
        </div>
      ) : null}
      {tab !== "local" ? (
        <Card className="section-card">
          <RankingTable rows={rows} type={type} mode={tab} teams={app.state.teams} />
        </Card>
      ) : null}
      {app.directoryStatus?.page?.kind === directoryKind && app.directoryStatus?.page?.region === directoryRegion && app.directoryStatus?.page?.hasMore ? (
        <Button type="button" variant="secondary" disabled={app.directoryStatus.loading} onClick={() => app.actions.loadMoreDirectory?.()}>
          {app.directoryStatus.loading ? "불러오는 중" : "랭킹 더 보기"}
        </Button>
      ) : null}
    </div>
  );
}
