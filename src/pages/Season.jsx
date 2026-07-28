import { useEffect, useRef } from "react";
import { ArrowRight, CalendarClock, ClipboardCheck, MapPin, Swords, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
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

function formatDate(value) {
  return value ? value.replaceAll("-", ".") : "일정 미정";
}

export default function Season({ app }) {
  const directoryLoadKeyRef = useRef("");
  const recordLoadKeyRef = useRef("");
  const season = getCurrentSeason(app.state);
  const region = app.currentUser.region;
  const progress = getSeasonProgress(season);
  const nationalPlayerRows = getPlayerSeasonRows(app.state.users, app.state.matches, season, "전체")
    .filter((user) => isPlacementComplete(user.ratings));
  const nationalTeamRows = getTeamSeasonRows(app.state.teams, app.state.matches, season, "전체");
  const regionalPlayerRows = getPlayerSeasonRows(app.state.users, app.state.matches, season, region)
    .filter((user) => isPlacementComplete(user.ratings))
    .filter((user) => user.id === app.currentUser.id || user.privacy?.regionRanking !== false);
  const nationalRankByPlayerId = new Map(nationalPlayerRows.map((user, index) => [user.id, index + 1]));
  const nationalCandidates = regionalPlayerRows.slice(0, 5);
  const rivalries = getLocalRivalries(app.state.teams, app.state.matches, region, 4);
  const activity = getPlayerSeasonActivity(app.state.matches, app.currentUser.id, season);
  const myNationalRankIndex = nationalPlayerRows.findIndex((user) => user.id === app.currentUser.id);
  const myRegionalRankIndex = regionalPlayerRows.findIndex((user) => user.id === app.currentUser.id);
  const myNationalRank = myNationalRankIndex >= 0 ? myNationalRankIndex + 1 : null;
  const myRegionalRank = myRegionalRankIndex >= 0 ? myRegionalRankIndex + 1 : null;
  const mySeasonRow = myNationalRankIndex >= 0 ? nationalPlayerRows[myNationalRankIndex] : null;
  const loadDirectory = app.actions.loadDirectory;
  const loadProfileRecords = app.actions.loadProfileRecords;
  const profileRecordsLoaded = app.actions.profileRecordsLoaded;

  useEffect(() => {
    if (!app.remoteReady || !loadDirectory || !app.currentUser.id) return;
    if (directoryLoadKeyRef.current === app.currentUser.id) return;
    directoryLoadKeyRef.current = app.currentUser.id;
    const request = loadDirectory({ kind: "all", limit: DIRECTORY_PICKER_PAGE_LIMIT, offset: 0 });
    if (!request?.then) {
      if (!request) directoryLoadKeyRef.current = "";
      return;
    }
    request.catch(() => {
      directoryLoadKeyRef.current = "";
    });
  }, [app.currentUser.id, app.remoteReady, loadDirectory]);

  useEffect(() => {
    if (!app.remoteReady || !loadProfileRecords || profileRecordsLoaded || !app.currentUser.id) return;
    if (recordLoadKeyRef.current === app.currentUser.id) return;
    recordLoadKeyRef.current = app.currentUser.id;
    const request = loadProfileRecords();
    if (!request?.then) {
      if (!request) recordLoadKeyRef.current = "";
      return;
    }
    request.then((result) => {
      if (result === false) recordLoadKeyRef.current = "";
    }).catch(() => {
      recordLoadKeyRef.current = "";
    });
  }, [app.currentUser.id, app.remoteReady, loadProfileRecords, profileRecordsLoaded]);

  return (
    <div className="page-stack season-page">
      <section className="season-hero">
        <div className="season-hero-copy">
          <Badge tone="gold">시즌 진행 중</Badge>
          <h1>{season.name}</h1>
          <p>{season.subtitle}</p>
          <div className="season-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="season-meta-row">
            <span><CalendarClock size={16} /> {formatDate(season.startsAt)} - {formatDate(season.endsAt)}</span>
            <span><Trophy size={16} /> 전국 통합 시즌</span>
            <span><MapPin size={16} /> 지역 랭킹 {region}</span>
          </div>
        </div>
        <div className="season-rule-board ui-liquid-glass">
          <strong>{app.currentUser.name} 시즌 요약</strong>
          <span><Trophy size={16} /> 전국 {myNationalRank ? `${myNationalRank}위` : "순위 준비 중"}</span>
          <span><MapPin size={16} /> {region} {myRegionalRank ? `${myRegionalRank}위` : "순위 준비 중"}</span>
          <div className="season-rule-actions">
            <Button as={Link} to="/app/create"><Swords size={18} /> 매칭 만들기</Button>
            <Button as={Link} to="/app/create?intent=record"><ClipboardCheck size={18} /> 경기 기록하기</Button>
          </div>
        </div>
      </section>

      <section className="season-summary ui-liquid-glass ui-liquid-glass-segments" aria-label="내 시즌 요약">
        <div className="season-summary-item">
          <span>이번 시즌 경기</span>
          <strong>{mySeasonRow?.seasonPlayed ?? 0}</strong>
          <em>확정 기록 기준</em>
        </div>
        <div className="season-summary-item">
          <span>이번 시즌 승패</span>
          <strong>{mySeasonRow?.seasonWins ?? 0}승 {mySeasonRow?.seasonLosses ?? 0}패</strong>
          <em>무승부 제외</em>
        </div>
        <div className="season-summary-item">
          <span>시즌 MMR 변화</span>
          <strong>{(mySeasonRow?.seasonDelta ?? 0) >= 0 ? "+" : ""}{mySeasonRow?.seasonDelta ?? 0}</strong>
          <em>확정 경기 누적</em>
        </div>
        <div className="season-summary-item">
          <span>주 플레이</span>
          <strong>{activity.primaryMode}</strong>
          <em>{activity.ranked} 정규 · {activity.friendly} 친선</em>
        </div>
      </section>

      <div className="season-content-grid">
        <main className="page-stack season-race-column">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Promotion Race</p>
                <h2>전국 개인 승격권</h2>
              </div>
              <div className="season-section-actions">
                <Badge tone="gold">TOP {season.promotionLine ?? 4}</Badge>
                <Button as={Link} to="/app/rankings" variant="secondary">전체 순위</Button>
              </div>
            </div>
            <div className="season-race-list">
              {nationalPlayerRows.slice(0, 8).map((user, index) => (
                <PlayerHoverCard key={user.id} user={user} teams={app.state.teams} className={user.id === app.currentUser.id ? "mine" : ""}>
                  <strong>{index + 1}</strong>
                  <ProfileEmblem user={user} className="small" />
                  <div>
                    <b>{user.name}</b>
                    <em>
                      {user.seasonWins}승 {user.seasonLosses}패 · {user.seasonDelta >= 0 ? "+" : ""}{user.seasonDelta}
                      {" · "}
                      {user.seasonStats.points}P/{user.seasonStats.rebounds}R/{user.seasonStats.assists}A
                    </em>
                  </div>
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
            </div>
            <div className="season-race-list team-race-list">
              {nationalTeamRows.slice(0, 8).map((team, index) => (
                <Link key={team.id} to={`/app/teams/${team.id}`}>
                  <strong>{index + 1}</strong>
                  <TeamEmblem team={team} size="xs" />
                  <div>
                    <b>{team.name}</b>
                    <em>{team.seasonWins}승 {team.seasonLosses}패 · {team.seasonDelta >= 0 ? "+" : ""}{team.seasonDelta} · {team.mmr} MMR</em>
                  </div>
                  <Badge tone={index < (season.promotionLine ?? 4) ? "gold" : "neutral"}>{index < (season.promotionLine ?? 4) ? "승격권" : "추격"}</Badge>
                </Link>
              ))}
            </div>
          </Card>
        </main>

        <aside className="page-stack season-side-rail">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">National Signal</p>
                <h2>전국구 후보</h2>
              </div>
              <Badge tone="blue">{region}</Badge>
            </div>
            <div className="season-race-list season-candidate-list">
              {nationalCandidates.length ? nationalCandidates.map((user, index) => (
                <PlayerHoverCard key={user.id} user={user} teams={app.state.teams} className={user.id === app.currentUser.id ? "mine" : ""}>
                  <strong>{nationalRankByPlayerId.get(user.id) ?? "-"}</strong>
                  <ProfileEmblem user={user} className="small" />
                  <div>
                    <b>{user.name}</b>
                    <em>지역 {index + 1}위 · 전국 {nationalRankByPlayerId.get(user.id) ?? "-"}위</em>
                  </div>
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
        </aside>
      </div>

      <Card className="section-card">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Rivalry Heat</p>
            <h2>{region} 라이벌 매치업</h2>
          </div>
          <Swords size={20} />
        </div>
        <div className="rivalry-grid">
          {rivalries.length ? rivalries.map((pair) => (
            <article key={pair.id} className="rivalry-matchup">
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
                <Link to="/app/create" className="rivalry-challenge-link">
                  매칭 만들기 <ArrowRight size={16} />
                </Link>
                <Link to="/app/create?intent=record" className="rivalry-challenge-link">
                  경기 기록하기 <ClipboardCheck size={16} />
                </Link>
              </div>
            </article>
          )) : (
            <article className="rivalry-matchup rivalry-empty">
              <div>
                <strong>라이벌 후보 없음</strong>
                <p>같은 지역 팀이 더 등록되면 MMR 차이와 맞대결 기록으로 자동 추천됩니다.</p>
              </div>
              <Link to="/app/teams" className="rivalry-challenge-link">
                지역 팀 보기 <ArrowRight size={16} />
              </Link>
            </article>
          )}
        </div>
      </Card>
    </div>
  );
}
