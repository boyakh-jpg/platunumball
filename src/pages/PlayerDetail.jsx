import { Link, Navigate, useParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import ProgressionChecklist from "../components/rating/ProgressionChecklist.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import TierEmblem from "../components/rating/TierEmblem.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import { getDiscordAvatarClassName, getDiscordAvatarStyle, getDiscordDisplayName, getDiscordProfileUrl } from "../lib/discord.js";
import { getUserHashtag } from "../lib/handles.js";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { formatStatLine } from "../lib/matchUtils.js";
import { getTierDivision, getTierQuote } from "../lib/tier.js";

function getPlayerSide(match, playerId) {
  if ((match.teamA?.players ?? []).includes(playerId)) return "teamA";
  if ((match.teamB?.players ?? []).includes(playerId)) return "teamB";
  return null;
}

function getSideScore(match, sideName) {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return Number(match.result?.[resultKey] ?? match[sideName]?.score ?? 0);
}

function getPlayerOutcome(match, playerId) {
  const sideName = getPlayerSide(match, playerId);
  if (!sideName || !match.result) return null;
  const otherSide = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getSideScore(match, sideName);
  const otherScore = getSideScore(match, otherSide);
  if (sideScore === otherScore) return "draw";
  return sideScore > otherScore ? "win" : "loss";
}

function addCount(map, userId) {
  map.set(userId, (map.get(userId) ?? 0) + 1);
}

const historyStatusLabel = {
  contract: "동의 대기",
  agreed: "예정",
  approval: "승인 대기",
  disputed: "보류",
  void: "무효",
  cancelled: "취소",
};

export default function PlayerDetail({ app }) {
  const { playerId } = useParams();
  const player = app.state.users.find((user) => user.id === playerId);

  if (!player) return <Navigate to="/app/rankings" replace />;

  const userMap = Object.fromEntries(app.state.users.map((user) => [user.id, user]));
  const teamMap = Object.fromEntries(app.state.teams.map((team) => [team.id, team]));
  const playerTeams = app.state.teams.filter((team) => team.members.some((member) => member.userId === player.id));
  const history = app.state.matches.filter((match) => getPlayerSide(match, player.id));
  const teammateCounts = new Map();
  const opponentCounts = new Map();
  const totals = Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field.id, 0]));

  for (const match of history) {
    const sideName = getPlayerSide(match, player.id);
    const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
    (match[sideName]?.players ?? []).filter((id) => id !== player.id).forEach((id) => addCount(teammateCounts, id));
    (match[oppositeSide]?.players ?? []).forEach((id) => addCount(opponentCounts, id));
    const stats = match.result?.playerStats?.[player.id];
    if (stats) PLAYER_STAT_FIELDS.forEach((field) => { totals[field.id] += Number(stats[field.id] ?? 0); });
  }
  const confirmedHistory = history.filter((match) => match.status === "confirmed" && match.result);
  const wins = confirmedHistory.filter((match) => getPlayerOutcome(match, player.id) === "win").length;
  const losses = confirmedHistory.filter((match) => getPlayerOutcome(match, player.id) === "loss").length;
  const winRate = confirmedHistory.length ? Math.round((wins / confirmedHistory.length) * 100) : 0;
  const recentOutcomes = confirmedHistory.slice(0, 10).map((match) => getPlayerOutcome(match, player.id));
  const averageFouls = confirmedHistory.length
    ? confirmedHistory.reduce((sum, match) => sum + Number(match.result?.playerStats?.[player.id]?.fouls ?? 0), 0) / confirmedHistory.length
    : 0;
  const discordProfileUrl = getDiscordProfileUrl(player);
  const discordDisplayName = getDiscordDisplayName(player);

  const renderRelationship = (title, counts) => (
    <Card className="section-card">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Match Links</p>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="connection-list">
        {[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, count]) => {
          const user = userMap[id];
          if (!user) return null;
          return (
            <PlayerHoverCard key={id} user={user} teams={app.state.teams}>
              <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
              <strong>{user.name}</strong>
              <em>{count}경기</em>
            </PlayerHoverCard>
          );
        })}
      </div>
    </Card>
  );

  return (
    <div className="page-stack profile-detail-page rank-profile-page">
      <section className="profile-hero rank-profile-hero">
        <div className="profile-identity rank-profile-identity">
          <div className={getDiscordAvatarClassName(player, "avatar hero-avatar")} style={getDiscordAvatarStyle(player)}>{player.name.slice(0, 1)}</div>
          <div>
            <p className="eyebrow">Player Profile</p>
            <h1>{player.name}</h1>
            <p>{getUserHashtag(player)} · 신뢰도 {player.trustScore}</p>
            <div className="badge-row">
              <TierBadge mmr={player.ratings.integrated} />
              <Badge tone="green">{player.region}</Badge>
              <Badge tone="blue">{player.position}</Badge>
              {discordProfileUrl ? (
                <a className="discord-link-badge" href={discordProfileUrl} target="_blank" rel="noreferrer">
                  <MessageCircle size={14} /> {discordDisplayName}
                </a>
              ) : null}
            </div>
          </div>
        </div>
        <div className="tier-statement rank-tier-statement">
          <TierEmblem mmr={player.ratings.integrated} size="hero" showLabel />
          <div>
            <span>{getTierDivision(player.ratings.integrated)}</span>
            <em className="tier-score-line">{Math.round(player.ratings.integrated)} MMR</em>
            <strong>{getTierQuote(player.ratings.integrated)}</strong>
          </div>
        </div>
      </section>

      <nav className="rank-profile-tabs">
        <a href="#summary">종합</a>
        <a href="#history">전적</a>
        <a href="#teams">팀</a>
        <a href="#links">상대</a>
      </nav>

      <section id="summary" className="rank-profile-summary">
        <Card className="section-card rank-record-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Ranked Solo</p>
              <h2>통합 랭크</h2>
            </div>
            <Badge tone="gold">{Math.round(player.ratings.integrated)} MMR</Badge>
          </div>
          <div className="rank-record-main">
            <TierEmblem mmr={player.ratings.integrated} size="md" showLabel />
            <div>
              <strong>{getTierDivision(player.ratings.integrated)}</strong>
              <span>{wins}승 {losses}패 · 승률 {winRate}%</span>
            </div>
          </div>
          <div className="form-pill-row">
            {recentOutcomes.map((outcome, index) => (
              <span key={`${outcome}-${index}`} className={`form-pill form-pill-${outcome === "win" ? "w" : outcome === "loss" ? "l" : "d"}`}>
                {outcome === "win" ? "W" : outcome === "loss" ? "L" : "D"}
              </span>
            ))}
          </div>
        </Card>
        <Card className="section-card rank-record-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Career Totals</p>
              <h2>누적 스탯</h2>
            </div>
          </div>
          <div className="rank-stat-grid">
            {PLAYER_STAT_FIELDS.map((field) => (
              <span key={field.id}>
                <strong>{totals[field.id]}</strong>
                {field.label}
              </span>
            ))}
            <span>
              <strong>{averageFouls.toFixed(1)}</strong>
              평균 파울
            </span>
          </div>
        </Card>
      </section>

      <div className="content-grid wide-left">
        <div className="page-stack">
          <section className="mode-grid">
            <RatingCard title="통합" mmr={player.ratings.integrated} subtitle="메인 티어" />
            {Object.entries(player.ratings.modes).map(([mode, mmr]) => (
              <RatingCard key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
            ))}
          </section>

          <Card id="history" className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Player History</p>
                <h2>누구와 뛰었는지</h2>
              </div>
              <Badge tone="green">{history.length}경기</Badge>
            </div>
            <div className="history-list">
              {history.map((match) => {
                const sideName = getPlayerSide(match, player.id);
                const oppositeSide = sideName === "teamA" ? "teamB" : "teamA";
                const side = match[sideName] ?? { name: sideName === "teamA" ? "A" : "B", teamId: "" };
                const opponent = match[oppositeSide] ?? { name: oppositeSide === "teamA" ? "A" : "B", teamId: "" };
                const stats = match.result?.playerStats?.[player.id];
                const outcome = getPlayerOutcome(match, player.id);
                return (
                  <article key={match.id} className={`history-item rank-match-item ${outcome ? `rank-match-${outcome}` : ""}`}>
                    <div>
                      <Link to={`/app/matches?match=${match.id}`}><strong>{match.title}</strong></Link>
                      <span>{match.court} · {match.scheduledAt}</span>
                    </div>
                    <div className="history-score">
                      <Badge tone={outcome === null ? "blue" : outcome === "win" ? "green" : outcome === "loss" ? "orange" : "gold"}>
                        {outcome === null ? historyStatusLabel[match.status] ?? match.status : outcome === "win" ? "승" : outcome === "loss" ? "패" : "무"}
                      </Badge>
                      <strong>{getSideScore(match, sideName)}:{getSideScore(match, oppositeSide)}</strong>
                    </div>
                    <div className="history-teams">
                      {side.teamId ? <Link to={`/app/teams/${side.teamId}`}>{teamMap[side.teamId]?.name ?? side.name}</Link> : <span>{side.name}</span>}
                      <span>vs</span>
                      {opponent.teamId ? <Link to={`/app/teams/${opponent.teamId}`}>{teamMap[opponent.teamId]?.name ?? opponent.name}</Link> : <span>{opponent.name}</span>}
                    </div>
                    <p>{formatStatLine(stats)}</p>
                  </article>
                );
              })}
            </div>
          </Card>
        </div>

        <aside className="page-stack">
          <ProgressionChecklist user={player} matches={app.state.matches} />
          <Card className="section-card" id="teams">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Career Totals</p>
                <h2>누적 경기 스탯</h2>
              </div>
            </div>
            <div className="contract-grid single">
              {PLAYER_STAT_FIELDS.map((field) => (
                <div key={field.id}>
                  <span>{field.label}</span>
                  <strong>{totals[field.id]}</strong>
                </div>
              ))}
            </div>
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Teams</p>
                <h2>소속 팀</h2>
              </div>
            </div>
            <div className="compact-list">
              {playerTeams.map((team) => (
                <Link key={team.id} to={`/app/teams/${team.id}`}>
                  <span>{team.name}</span>
                  <strong>{team.mmr}</strong>
                </Link>
              ))}
            </div>
          </Card>
          <div id="links" className="page-stack">
            {renderRelationship("같이 뛴 사람", teammateCounts)}
            {renderRelationship("상대한 사람", opponentCounts)}
          </div>
        </aside>
      </div>
    </div>
  );
}
