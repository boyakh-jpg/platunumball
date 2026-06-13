import { ArrowRight, CalendarClock, ClipboardCheck, MapPin, ShieldCheck, Swords, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import {
  getCurrentSeason,
  getLocalRivalries,
  getOperationsSummary,
  getPlayerSeasonRows,
  getSeasonProgress,
  getTeamSeasonRows,
} from "../lib/season.js";

const statusLabels = {
  contract: "경기 전 동의",
  agreed: "결과 입력 가능",
  approval: "결과 승인",
  disputed: "이의 확인",
  confirmed: "확정",
};

function formatDate(value) {
  return value ? value.replaceAll("-", ".") : "일정 미정";
}

function getTaskMatches(matches = []) {
  return matches
    .filter((match) => ["contract", "approval", "disputed"].includes(match.status))
    .slice(0, 5);
}

export default function Season({ app }) {
  const season = getCurrentSeason(app.state);
  const region = app.currentUser.region;
  const progress = getSeasonProgress(season);
  const playerRows = getPlayerSeasonRows(app.state.users, app.state.matches, season, region);
  const teamRows = getTeamSeasonRows(app.state.teams, app.state.matches, season, region);
  const nationalPlayers = getPlayerSeasonRows(app.state.users, app.state.matches, season, "전체").slice(0, 5);
  const rivalries = getLocalRivalries(app.state.teams, app.state.matches, region, 4);
  const operations = getOperationsSummary(app.state.matches, app.state.reports ?? []);
  const taskMatches = getTaskMatches(app.state.matches);
  const myRankIndex = playerRows.findIndex((user) => user.id === app.currentUser.id);
  const myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;
  const topPlayer = playerRows[0];
  const topTeam = teamRows[0];

  return (
    <div className="page-stack season-page">
      <section className="season-hero">
        <div className="season-hero-copy">
          <Badge tone="green">Active Season</Badge>
          <h1>{season.name}</h1>
          <div className="season-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="season-meta-row">
            <span><CalendarClock size={16} /> {formatDate(season.startsAt)} - {formatDate(season.endsAt)}</span>
            <span><MapPin size={16} /> {region} 디비전</span>
            <span><Trophy size={16} /> {myRank ? `내 지역 ${myRank}위` : "지역 기록 준비 중"}</span>
          </div>
        </div>
        <div className="season-rule-board">
          <strong>지역 현황</strong>
          <span><Trophy size={16} /> 개인 1위 {topPlayer?.name ?? "-"}</span>
          <span><ShieldCheck size={16} /> 팀 1위 {topTeam?.name ?? "-"}</span>
          <span><ClipboardCheck size={16} /> 처리 대기 {operations.contract + operations.approval + operations.disputed}</span>
          <Link to="/app/create">
            <Button><Swords size={18} /> 정규전 만들기</Button>
          </Link>
        </div>
      </section>

      <section className="season-metric-grid">
        <Card className="season-metric-card">
          <span>지역 플레이어</span>
          <strong>{playerRows.length}</strong>
          <em>{region} 기준</em>
        </Card>
        <Card className="season-metric-card">
          <span>지역 팀</span>
          <strong>{teamRows.length}</strong>
          <em>승격권 {season.promotionLine ?? 4}팀</em>
        </Card>
        <Card className="season-metric-card">
          <span>승인 대기</span>
          <strong>{operations.approval}</strong>
          <em>결과 확정 필요</em>
        </Card>
        <Card className="season-metric-card">
          <span>보류/신고</span>
          <strong>{operations.disputed + operations.reports}</strong>
          <em>운영 확인 필요</em>
        </Card>
      </section>

      <div className="content-grid wide-left">
        <div className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Promotion Race</p>
                <h2>{region} 개인 승격권</h2>
              </div>
              <Badge tone="gold">TOP {season.promotionLine ?? 4}</Badge>
            </div>
            <div className="season-race-list">
              {playerRows.slice(0, 8).map((user, index) => (
                <Link key={user.id} to={`/app/players/${user.id}`} className={user.id === app.currentUser.id ? "mine" : ""}>
                  <strong>{index + 1}</strong>
                  <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
                  <div>
                    <b>{user.name}</b>
                    <em>
                      {user.seasonWins}승 {user.seasonLosses}패 · {user.seasonDelta >= 0 ? "+" : ""}{user.seasonDelta}
                      {" · "}
                      {user.seasonStats.points}P/{user.seasonStats.rebounds}R/{user.seasonStats.assists}A
                    </em>
                  </div>
                  <TierBadge mmr={user.ratings.integrated} compact />
                </Link>
              ))}
            </div>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Squad Race</p>
                <h2>{region} 팀 승격권</h2>
              </div>
            </div>
            <div className="season-race-list team-race-list">
              {teamRows.slice(0, 8).map((team, index) => (
                <Link key={team.id} to={`/app/teams/${team.id}`}>
                  <strong>{index + 1}</strong>
                  <span className="team-mini-dot" style={{ "--team-color": team.accent }} />
                  <div>
                    <b>{team.name}</b>
                    <em>{team.seasonWins}승 {team.seasonLosses}패 · {team.seasonDelta >= 0 ? "+" : ""}{team.seasonDelta} · {team.mmr} MMR</em>
                  </div>
                  <Badge tone={index < (season.promotionLine ?? 4) ? "gold" : "neutral"}>{index < (season.promotionLine ?? 4) ? "승격권" : "추격"}</Badge>
                </Link>
              ))}
            </div>
          </Card>
        </div>

        <aside className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">National Signal</p>
                <h2>전국구 후보</h2>
              </div>
              <Trophy size={20} />
            </div>
            <div className="compact-list">
              {nationalPlayers.map((user, index) => (
                <Link key={user.id} to={`/app/players/${user.id}`}>
                  <span>{index + 1}. {user.name}</span>
                  <strong>{user.ratings.integrated}</strong>
                </Link>
              ))}
            </div>
          </Card>

          <Card className="section-card season-ops-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">League Ops</p>
                <h2>운영 체크</h2>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="operations-list">
              <Link to="/app/matches"><ClipboardCheck size={17} /> 경기 전 동의 <strong>{operations.contract}</strong></Link>
              <Link to="/app/matches"><ClipboardCheck size={17} /> 결과 승인 <strong>{operations.approval}</strong></Link>
              <Link to="/app/matches"><ShieldCheck size={17} /> 이의제기 <strong>{operations.disputed}</strong></Link>
              <Link to="/app/settings"><ShieldCheck size={17} /> 신고 <strong>{operations.reports}</strong></Link>
            </div>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Next Actions</p>
                <h2>처리할 경기</h2>
              </div>
              <Badge tone={taskMatches.length ? "orange" : "neutral"}>{taskMatches.length}건</Badge>
            </div>
            <div className="compact-list">
              {taskMatches.length ? taskMatches.map((match) => (
                <Link key={match.id} to={`/app/matches/${match.id}`}>
                  <span>{match.title}</span>
                  <strong>{statusLabels[match.status] ?? match.status}</strong>
                </Link>
              )) : <div><span>대기 중인 운영 항목이 없습니다.</span><strong>OK</strong></div>}
            </div>
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
              <Link to="/app/create" className="rivalry-challenge-link">
                도전 경기 만들기 <ArrowRight size={16} />
              </Link>
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
