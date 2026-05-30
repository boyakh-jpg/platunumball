import { Link, Navigate, useParams } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Card from "../components/common/Card.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import { PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { formatStatLine } from "../lib/matchUtils.js";
import { getTierDivision, getTierQuote } from "../lib/tier.js";

function getPlayerSide(match, playerId) {
  if (match.teamA.players.includes(playerId)) return "teamA";
  if (match.teamB.players.includes(playerId)) return "teamB";
  return null;
}

function addCount(map, userId) {
  map.set(userId, (map.get(userId) ?? 0) + 1);
}

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
    match[sideName].players.filter((id) => id !== player.id).forEach((id) => addCount(teammateCounts, id));
    match[oppositeSide].players.forEach((id) => addCount(opponentCounts, id));
    const stats = match.result?.playerStats?.[player.id];
    if (stats) PLAYER_STAT_FIELDS.forEach((field) => { totals[field.id] += Number(stats[field.id] ?? 0); });
  }

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
            <Link key={id} to={`/app/players/${id}`}>
              <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
              <strong>{user.name}</strong>
              <em>{count}경기</em>
            </Link>
          );
        })}
      </div>
    </Card>
  );

  return (
    <div className="page-stack profile-detail-page">
      <section className="profile-hero">
        <div className="profile-identity">
          <div className="avatar hero-avatar" style={{ "--avatar": player.avatarColor }}>{player.name.slice(0, 1)}</div>
          <div>
            <p className="eyebrow">Player Profile</p>
            <h1>{player.name}</h1>
            <div className="badge-row">
              <TierBadge mmr={player.ratings.integrated} />
              <Badge tone="green">{player.region}</Badge>
              <Badge tone="blue">{player.position}</Badge>
            </div>
          </div>
        </div>
        <div className="tier-statement">
          <span>{getTierDivision(player.ratings.integrated)}</span>
          <strong>{getTierQuote(player.ratings.integrated)}</strong>
        </div>
      </section>

      <div className="content-grid wide-left">
        <div className="page-stack">
          <section className="mode-grid">
            <RatingCard title="통합" mmr={player.ratings.integrated} subtitle="메인 티어" />
            {Object.entries(player.ratings.modes).map(([mode, mmr]) => (
              <RatingCard key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
            ))}
          </section>

          <Card className="section-card">
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
                const side = match[sideName];
                const opponent = match[oppositeSide];
                const stats = match.result?.playerStats?.[player.id];
                const didWin = match.result ? Number(side.score) > Number(opponent.score) : null;
                return (
                  <article key={match.id} className="history-item">
                    <div>
                      <Link to={`/app/matches/${match.id}`}><strong>{match.title}</strong></Link>
                      <span>{match.court} · {match.scheduledAt}</span>
                    </div>
                    <div className="history-score">
                      <Badge tone={didWin === null ? "blue" : didWin ? "green" : "orange"}>{didWin === null ? match.status : didWin ? "승" : "패"}</Badge>
                      <strong>{side.score ?? 0}:{opponent.score ?? 0}</strong>
                    </div>
                    <div className="history-teams">
                      <Link to={`/app/teams/${side.teamId}`}>{teamMap[side.teamId]?.name ?? side.name}</Link>
                      <span>vs</span>
                      <Link to={`/app/teams/${opponent.teamId}`}>{teamMap[opponent.teamId]?.name ?? opponent.name}</Link>
                    </div>
                    <p>{formatStatLine(stats)}</p>
                  </article>
                );
              })}
            </div>
          </Card>
        </div>

        <aside className="page-stack">
          <Card className="section-card">
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
          {renderRelationship("같이 뛴 사람", teammateCounts)}
          {renderRelationship("상대한 사람", opponentCounts)}
        </aside>
      </div>
    </div>
  );
}
