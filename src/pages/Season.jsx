import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarClock, ClipboardCheck, MapPin, Swords, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Card from "../components/common/Card.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProfileEmblem from "../components/profile/ProfileEmblem.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import {
  getCurrentSeason,
  getLocalRivalries,
  getPlayerSeasonActivity,
  getPlayerSeasonRows,
  getSeasonProgress,
  getTeamSeasonRows,
} from "../lib/season.js";
import { DIRECTORY_PICKER_PAGE_LIMIT } from "../lib/queryPolicy.js";
import { isPlacementComplete } from "../lib/rating.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import useCanonicalSeasonRankings from "../hooks/useCanonicalSeasonRankings.js";

function formatDate(value) {
  return value ? value.replaceAll("-", ".") : "일정 미정";
}

export default function Season({ app }) {
  const directoryLoadKeyRef = useRef("");
  const recordLoadKeyRef = useRef("");
  const [directoryLoadFailed, setDirectoryLoadFailed] = useState(false);
  const [recordLoadFailed, setRecordLoadFailed] = useState(false);
  const [loadRetrySequence, setLoadRetrySequence] = useState(0);
  const season = getCurrentSeason(app.state);
  const canonicalEnabled = isSupabaseConfigured && app.remoteReady;
  const canonicalRankings = useCanonicalSeasonRankings(canonicalEnabled, season.id);
  const region = app.currentUser.region;
  const progress = getSeasonProgress(season);
  const blockedUserIds = new Set(app.state.settings?.blockedUserIds ?? []);
  const localPlayerRows = getPlayerSeasonRows(app.state.users, app.state.matches, season, "전체");
  const localTeamRows = getTeamSeasonRows(app.state.teams, app.state.matches, season, "전체");
  const seasonPlayerRows = canonicalEnabled && canonicalRankings.data
    ? (canonicalRankings.data.players ?? [])
    : localPlayerRows;
  const seasonTeamRows = canonicalEnabled && canonicalRankings.data
    ? (canonicalRankings.data.teams ?? [])
    : localTeamRows;
  const nationalPlayerRows = seasonPlayerRows
    .filter((user) => !blockedUserIds.has(user.id))
    .filter((user) => isPlacementComplete(user.ratings));
  const nationalTeamRows = seasonTeamRows;
  const regionalPlayerRows = seasonPlayerRows
    .filter((user) => user.region === region)
    .filter((user) => !blockedUserIds.has(user.id))
    .filter((user) => isPlacementComplete(user.ratings))
    .filter((user) => user.id === app.currentUser.id || user.privacy?.regionRanking !== false);
  const myTeamIds = app.state.teams
    .filter((team) => team.members?.some((member) => member.userId === app.currentUser.id))
    .map((team) => team.id);
  const myTeamIdSet = new Set(myTeamIds);
  const nationalRankByPlayerId = new Map(nationalPlayerRows.map((user, index) => [user.id, index + 1]));
  const nationalCandidates = regionalPlayerRows.slice(0, 5);
  const rivalries = myTeamIds.length
    ? getLocalRivalries(app.state.teams, app.state.matches, region, 4, myTeamIds)
    : [];
  const activity = getPlayerSeasonActivity(app.state.matches, app.currentUser.id, season);
  const myNationalRankIndex = nationalPlayerRows.findIndex((user) => user.id === app.currentUser.id);
  const myRegionalRankIndex = regionalPlayerRows.findIndex((user) => user.id === app.currentUser.id);
  const myNationalRank = myNationalRankIndex >= 0 ? myNationalRankIndex + 1 : null;
  const myRegionalRank = myRegionalRankIndex >= 0 ? myRegionalRankIndex + 1 : null;
  const mySeasonRow = seasonPlayerRows.find((user) => user.id === app.currentUser.id) ?? null;
  const loadDirectory = app.actions.loadDirectory;
  const loadProfileRecords = app.actions.loadProfileRecords;
  const profileRecordsLoaded = app.actions.profileRecordsLoaded;

  useEffect(() => {
    if (!canonicalEnabled || !loadDirectory || !app.currentUser.id) return;
    if (directoryLoadKeyRef.current === app.currentUser.id) return;
    directoryLoadKeyRef.current = app.currentUser.id;
    setDirectoryLoadFailed(false);
    const request = loadDirectory({ kind: "all", limit: DIRECTORY_PICKER_PAGE_LIMIT, offset: 0 });
    if (!request?.then) {
      if (!request) {
        directoryLoadKeyRef.current = "";
        setDirectoryLoadFailed(true);
      }
      return;
    }
    request.then((result) => {
      if (result === false) {
        directoryLoadKeyRef.current = "";
        setDirectoryLoadFailed(true);
      }
    }).catch(() => {
      directoryLoadKeyRef.current = "";
      setDirectoryLoadFailed(true);
    });
  }, [app.currentUser.id, canonicalEnabled, loadDirectory, loadRetrySequence]);

  useEffect(() => {
    if (!canonicalEnabled || !loadProfileRecords || profileRecordsLoaded || !app.currentUser.id) return;
    if (recordLoadKeyRef.current === app.currentUser.id) return;
    recordLoadKeyRef.current = app.currentUser.id;
    setRecordLoadFailed(false);
    const request = loadProfileRecords();
    if (!request?.then) {
      if (!request) {
        recordLoadKeyRef.current = "";
        setRecordLoadFailed(true);
      }
      return;
    }
    request.then((result) => {
      if (result === false) {
        recordLoadKeyRef.current = "";
        setRecordLoadFailed(true);
      }
    }).catch(() => {
      recordLoadKeyRef.current = "";
      setRecordLoadFailed(true);
    });
  }, [app.currentUser.id, canonicalEnabled, loadProfileRecords, loadRetrySequence, profileRecordsLoaded]);

  const retrySeasonLoads = () => {
    directoryLoadKeyRef.current = "";
    recordLoadKeyRef.current = "";
    setDirectoryLoadFailed(false);
    setRecordLoadFailed(false);
    canonicalRankings.retry();
    setLoadRetrySequence((current) => current + 1);
  };

  return (
    <div className="page-stack season-page">
      <header className="page-header ui-page-hero ui-design-app-hero">
        <div className="ui-page-hero__copy">
          <p className="eyebrow">Season</p>
          <h1>시즌</h1>
          <p>{season.name} · {season.subtitle}</p>
        </div>
        <Badge tone="gold">진행 중</Badge>
      </header>

      {canonicalRankings.loading && !canonicalRankings.data ? (
        <Card className="section-card"><BasketballLoader label="시즌 순위 불러오는 중" /></Card>
      ) : null}

      {directoryLoadFailed || recordLoadFailed || canonicalRankings.error ? (
        <Card className="section-card">
          <div className="section-title-row">
            <div>
              <h2>시즌 정보를 불러오지 못했습니다.</h2>
              <p>기존 정보는 유지됩니다. 다시 시도해 주세요.</p>
            </div>
            <Button type="button" variant="secondary" onClick={retrySeasonLoads}>다시 시도</Button>
          </div>
        </Card>
      ) : null}

      <Card className="section-card season-overview-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">My Season</p>
            <h2>{app.currentUser.name} 시즌 현황</h2>
          </div>
          <Badge tone="neutral">{progress}% 진행</Badge>
        </div>
        <div className="progress-track" aria-label={`시즌 ${progress}% 진행`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="season-meta-row">
          <span><CalendarClock size={16} /> {formatDate(season.startsAt)} - {formatDate(season.endsAt)}</span>
          <span><Trophy size={16} /> 전국 통합 시즌</span>
          <span><MapPin size={16} /> {region}</span>
        </div>
        <div className="rank-stat-grid season-summary-grid">
          <span><strong>{myNationalRank ?? "-"}</strong>전국 순위</span>
          <span><strong>{myRegionalRank ?? "-"}</strong>지역 순위</span>
          <span><strong>{mySeasonRow?.seasonPlayed ?? 0}</strong>경기</span>
          <span><strong>{mySeasonRow?.seasonWins ?? 0}승 {mySeasonRow?.seasonLosses ?? 0}패</strong>승패</span>
          <span><strong>{(mySeasonRow?.seasonDelta ?? 0) >= 0 ? "+" : ""}{mySeasonRow?.seasonDelta ?? 0}</strong>MMR 변화</span>
          <span><strong>{activity.primaryMode}</strong>주 플레이</span>
        </div>
        <div className="ui-action-row">
          <Button as={Link} to="/app/create"><Swords size={18} /> 방 만들기</Button>
          <Button as={Link} to="/app/create?intent=record" variant="secondary"><ClipboardCheck size={18} /> 기록하기</Button>
        </div>
      </Card>

      <div className="card-grid season-board-grid">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Promotion Race</p>
                <h2>전국 개인 승격권</h2>
              </div>
              <div className="ui-action-row season-section-actions">
                <Badge tone="gold">TOP {season.promotionLine ?? 4}</Badge>
                <Button as={Link} to="/app/rankings?view=promotion" variant="secondary">전체 순위</Button>
              </div>
            </div>
            <div className="season-race-list ranking-table ui-design-borderless-list">
              {nationalPlayerRows.slice(0, 5).map((user, index) => (
                <PlayerHoverCard
                  key={user.id}
                  user={user}
                  teams={app.state.teams}
                  className={`ranking-row ui-design-soft-surface${user.id === app.currentUser.id ? " active" : ""}`}
                >
                  <span className={`rank rank-${index + 1}`}>{index + 1}</span>
                  <span className="ranking-name">
                    <ProfileEmblem user={user} className="small" />
                    <span className="season-ranking-copy">
                      <b>{user.name}</b>
                      <em>
                        {user.seasonWins}승 {user.seasonLosses}패 · {user.seasonDelta >= 0 ? "+" : ""}{user.seasonDelta}
                        {" · "}
                        {user.seasonStats.points}P/{user.seasonStats.rebounds}R/{user.seasonStats.assists}A
                      </em>
                    </span>
                  </span>
                  <TierBadge mmr={user.ratings.integrated} ratings={user.ratings} compact />
                </PlayerHoverCard>
              ))}
            </div>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Squad Race</p>
                <h2>전국 팀 승격권</h2>
              </div>
              <div className="ui-action-row season-section-actions">
                <Badge tone="gold">TOP {season.promotionLine ?? 4}</Badge>
                <Button as={Link} to="/app/rankings?view=promotion&tab=teams" variant="secondary">전체 팀 순위</Button>
              </div>
            </div>
            <div className="season-race-list team-race-list ranking-table ui-design-borderless-list">
              {nationalTeamRows.slice(0, 5).map((team, index) => (
                <Link
                  aria-label={`${team.name} 팀 상세 보기`}
                  className="ranking-row ui-design-soft-surface"
                  key={team.id}
                  state={{ teamPreview: team }}
                  to={`/app/teams/${team.id}`}
                >
                  <span className={`rank rank-${index + 1}`}>{index + 1}</span>
                  <span className="ranking-name">
                    <TeamEmblem team={team} size="sm" />
                    <span className="season-ranking-copy">
                      <b>{team.name}</b>
                      <em>{team.seasonWins}승 {team.seasonLosses}패 · {team.seasonDelta >= 0 ? "+" : ""}{team.seasonDelta} · {team.mmr} MMR</em>
                    </span>
                  </span>
                  <Badge tone={index < (season.promotionLine ?? 4) ? "gold" : "neutral"}>{index < (season.promotionLine ?? 4) ? "승격권" : "추격"}</Badge>
                </Link>
              ))}
            </div>
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">National Signal</p>
                <h2>전국구 후보</h2>
              </div>
              <Badge tone="blue">{region}</Badge>
            </div>
            <div className={`season-race-list season-candidate-list ranking-table${nationalCandidates.length ? " ui-design-borderless-list" : ""}`}>
              {nationalCandidates.length ? nationalCandidates.map((user, index) => (
                <PlayerHoverCard
                  key={user.id}
                  user={user}
                  teams={app.state.teams}
                  className={`ranking-row ui-design-soft-surface${user.id === app.currentUser.id ? " active" : ""}`}
                >
                  <span className="rank">{nationalRankByPlayerId.get(user.id) ?? "-"}</span>
                  <span className="ranking-name">
                    <ProfileEmblem user={user} className="small" />
                    <span className="season-ranking-copy">
                      <b>{user.name}</b>
                      <em>지역 {index + 1}위 · 전국 {nationalRankByPlayerId.get(user.id) ?? "-"}위</em>
                    </span>
                  </span>
                  <TierBadge mmr={user.ratings.integrated} ratings={user.ratings} compact />
                </PlayerHoverCard>
              )) : <div className="ui-empty-state-compact">지역 시즌 기록이 없습니다.</div>}
            </div>
          </Card>

          <Card className="section-card season-play-report">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Play Report</p>
                <h2>이번 시즌 플레이</h2>
              </div>
              <Badge tone="gold">{activity.primaryMode}</Badge>
            </div>
            <div className="rank-stat-grid season-play-grid">
              {Object.entries(activity.modes).map(([mode, count]) => (
                <span key={mode}><strong>{count}</strong>{mode}</span>
              ))}
              <span><strong>{mySeasonRow?.seasonStats.points ?? 0}</strong>득점</span>
              <span><strong>{mySeasonRow?.seasonStats.rebounds ?? 0}</strong>리바운드</span>
              <span><strong>{mySeasonRow?.seasonStats.assists ?? 0}</strong>어시스트</span>
              <span><strong>{activity.official}</strong>공식전</span>
            </div>
            <Button as={Link} to="/app/profile/records" variant="secondary" className="ui-button-block">전체 기록 보기</Button>
          </Card>
      </div>

      <Card className="section-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Rivalry Heat</p>
            <h2>{myTeamIds.length ? "내 팀 지역" : region} 라이벌 매치업</h2>
          </div>
          <Swords size={20} />
        </div>
        <div className="rivalry-grid">
          {rivalries.length ? rivalries.map((pair) => {
            const myTeam = myTeamIdSet.has(pair.teamA.id) ? pair.teamA : pair.teamB;
            const opponentTeam = myTeam.id === pair.teamA.id ? pair.teamB : pair.teamA;
            return (
            <article key={pair.id} className="rivalry-matchup ui-design-info-surface">
              <div>
                <Link to={`/app/teams/${pair.teamA.id}`}>{pair.teamA.name}</Link>
                <strong>{pair.teamA.mmr}</strong>
              </div>
              <span>VS</span>
              <div>
                <Link to={`/app/teams/${pair.teamB.id}`}>{pair.teamB.name}</Link>
                <strong>{pair.teamB.mmr}</strong>
              </div>
              <p>{pair.headToHead.length}전 · MMR 차이 {pair.mmrGap}</p>
              <div className="rivalry-challenge-actions">
                <Button
                  as={Link}
                  to={`/app/create?challengeTeamAId=${encodeURIComponent(myTeam.id)}&challengeTeamBId=${encodeURIComponent(opponentTeam.id)}`}
                  state={{ challengeTeamAId: myTeam.id, challengeTeamBId: opponentTeam.id }}
                  size="sm"
                >
                  방 만들기 <ArrowRight size={16} />
                </Button>
                <Button as={Link} to="/app/create?intent=record" variant="secondary" size="sm">
                  기록하기 <ClipboardCheck size={16} />
                </Button>
              </div>
            </article>
            );
          }) : (
            <article className="rivalry-matchup rivalry-empty">
              <div>
                <strong>라이벌 후보 없음</strong>
                <p>같은 지역 팀이 더 등록되면 MMR 차이와 맞대결 기록으로 자동 추천됩니다.</p>
              </div>
              <Button as={Link} to="/app/teams" variant="secondary" size="sm">
                지역 팀 보기 <ArrowRight size={16} />
              </Button>
            </article>
          )}
        </div>
      </Card>
    </div>
  );
}
