import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import RankingTable from "../components/ranking/RankingTable.jsx";
import RankingTabs from "../components/ranking/RankingTabs.jsx";
import SeasonPromotionTable from "../components/ranking/SeasonPromotionTable.jsx";
import { DIRECTORY_PICKER_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { hasModeRating, isPlacementComplete } from "../lib/rating.js";
import { getCurrentSeason, getPlayerSeasonRows, getTeamSeasonRows } from "../lib/season.js";
import { isSupabaseConfigured } from "../lib/supabase.js";

const tabs = [
  { id: "integrated", label: "통합" },
  { id: "region", label: "지역" },
  { id: "1v1", label: "1v1" },
  { id: "3v3", label: "3v3" },
  { id: "5v5", label: "5v5" },
  { id: "teams", label: "팀" },
  { id: "affiliations", label: "소속" },
];
const tabIds = new Set(tabs.map((item) => item.id));

const rankingTitles = {
  integrated: "전국 통합 MMR",
  "1v1": "전국 1v1 MMR",
  "3v3": "전국 3v3 MMR",
  "5v5": "전국 5v5 MMR",
  teams: "전국 팀 MMR",
  affiliations: "전국 소속 랭킹",
};

export default function Rankings({ app }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [promotionLoadFailed, setPromotionLoadFailed] = useState(false);
  const [promotionRetrySequence, setPromotionRetrySequence] = useState(0);
  const promotionView = searchParams.get("view") === "promotion";
  const requestedTab = searchParams.get("tab");
  const tab = promotionView
    ? requestedTab === "teams" ? "teams" : "integrated"
    : tabIds.has(requestedTab) ? requestedTab : "integrated";
  const setTab = (nextTab) => {
    if (!tabIds.has(nextTab)) return;
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextTab === "integrated") nextSearchParams.delete("tab");
    else nextSearchParams.set("tab", nextTab);
    setSearchParams(nextSearchParams, { replace: true });
  };
  const myRegion = app.currentUser.region;
  const season = getCurrentSeason(app.state);
  const loadDirectory = app.actions.loadDirectory;
  const loadProfileRecords = app.actions.loadProfileRecords;
  const profileRecordsLoaded = app.actions.profileRecordsLoaded;
  const directoryKind = tab === "teams" ? "teams" : tab === "affiliations" ? "affiliations" : tab === "region" ? "all" : "players";
  const directoryRegion = tab === "region" ? myRegion : "";
  const placementCompleteOnly = !["teams", "affiliations"].includes(tab);
  const rankingSort = ["integrated", "region", "1v1", "3v3", "5v5"].includes(tab)
    ? tab === "region" ? "integrated" : tab
    : "";
  useEffect(() => {
    loadDirectory?.({ kind: directoryKind, region: directoryRegion, placementCompleteOnly, rankingSort, limit: DIRECTORY_PICKER_PAGE_LIMIT, offset: 0 });
  }, [directoryKind, directoryRegion, loadDirectory, placementCompleteOnly, rankingSort]);
  useEffect(() => {
    if (!promotionView || !app.remoteReady || profileRecordsLoaded || !loadProfileRecords) return;
    setPromotionLoadFailed(false);
    Promise.resolve(loadProfileRecords())
      .then((result) => { if (result === false) setPromotionLoadFailed(true); })
      .catch(() => setPromotionLoadFailed(true));
  }, [app.remoteReady, loadProfileRecords, profileRecordsLoaded, promotionRetrySequence, promotionView]);
  const hiddenUserIds = new Set(app.state.settings?.blockedUserIds ?? []);
  const visiblePlayers = app.rankings.players.filter((user) => isPlacementComplete(user.ratings) && !hiddenUserIds.has(user.id));
  const visibleModePlayers = tab === "teams" || tab === "affiliations" || tab === "integrated" || tab === "region"
    ? visiblePlayers
    : app.rankings.mode(tab).filter((user) => isPlacementComplete(user.ratings) && hasModeRating(user.ratings, tab) && !hiddenUserIds.has(user.id));
  const regionalPlayers = visiblePlayers.filter((user) => (
    user.region === myRegion && (
      user.id === app.currentUser.id ||
      user.privacy?.regionRanking === true ||
      (!isSupabaseConfigured && user.privacy?.regionRanking !== false)
    )
  ));
  const regionalTeams = app.rankings.teams.filter((team) => team.region === myRegion);
  const type = tab === "teams" ? "teams" : tab === "affiliations" ? "affiliations" : "players";
  const rows =
    tab === "teams"
      ? app.rankings.teams
      : tab === "affiliations"
        ? app.rankings.affiliations
        : tab === "integrated"
          ? visiblePlayers
          : tab === "region"
            ? regionalPlayers
            : visibleModePlayers;
  const promotionRows = tab === "teams"
    ? getTeamSeasonRows(app.rankings.teams, app.state.matches, season, "전체")
    : getPlayerSeasonRows(visiblePlayers, app.state.matches, season, "전체");
  const promotionTabs = [
    { id: "integrated", label: "개인" },
    { id: "teams", label: "팀" },
  ];

  return (
    <div className="page-stack rankings-page">
      <header className="page-header ui-design-app-hero">
        <div>
          <p className="eyebrow">{promotionView ? "Promotion Race" : "Rankings"}</p>
          <h1>{promotionView ? "시즌 승격권" : "랭크보드"}</h1>
        </div>
        <Badge tone={tab === "region" ? "blue" : "gold"}>
          {promotionView ? season.name : tab === "region" ? myRegion : "전국 기준"}
        </Badge>
      </header>
      <Card className="section-card ranking-filter-card">
        <RankingTabs value={tab} options={promotionView ? promotionTabs : tabs} onChange={setTab} />
      </Card>
      {promotionLoadFailed ? (
        <Card className="section-card">
          <div className="section-title-row">
            <span className="form-warning">승격권 기록을 불러오지 못했습니다.</span>
            <Button type="button" variant="secondary" onClick={() => setPromotionRetrySequence((current) => current + 1)}>다시 시도</Button>
          </div>
        </Card>
      ) : null}
      {promotionView ? (
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">National Season Ranking</p>
              <h2>전국 {tab === "teams" ? "팀" : "개인"} 승격 경쟁</h2>
            </div>
            <Badge tone="gold">TOP {season.promotionLine ?? 4}</Badge>
          </div>
          <SeasonPromotionTable
            rows={promotionRows}
            type={tab === "teams" ? "teams" : "players"}
            teams={app.state.teams}
            promotionLine={season.promotionLine ?? 4}
          />
        </Card>
      ) : tab === "region" ? (
        <div className="content-grid">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Local Players</p>
                <h2>{myRegion} 개인 MMR</h2>
              </div>
            </div>
            <RankingTable rows={regionalPlayers} type="players" mode="integrated" teams={app.state.teams} />
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Local Teams</p>
                <h2>{myRegion} 팀</h2>
              </div>
            </div>
            <RankingTable rows={regionalTeams} type="teams" teams={app.state.teams} />
          </Card>
        </div>
      ) : null}
      {!promotionView && tab !== "region" ? (
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">National Ranking</p>
              <h2>{rankingTitles[tab]}</h2>
            </div>
            <Badge tone="gold">전국</Badge>
          </div>
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
