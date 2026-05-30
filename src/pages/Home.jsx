import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, PlusCircle, Search, Trophy } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MatchCard from "../components/match/MatchCard.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import TeamCard from "../components/team/TeamCard.jsx";
import { COURTS } from "../lib/constants.js";
import { getTierDivision, getTierQuote } from "../lib/tier.js";

export default function Home({ app }) {
  const user = app.currentUser;
  const [query, setQuery] = useState("");
  const activeMatch = app.state.matches.find((match) => match.status !== "confirmed") ?? app.state.matches[0];
  const myTeam = app.state.teams.find((team) => team.members.some((member) => member.userId === user.id));
  const searchText = query.trim().toLowerCase();
  const playerResults = useMemo(() => app.state.users
    .filter((item) => `${item.name} ${item.handle} ${item.region} ${item.position} ${item.club}`.toLowerCase().includes(searchText))
    .sort((a, b) => Number(b.region === user.region) - Number(a.region === user.region) || b.ratings.integrated - a.ratings.integrated)
    .slice(0, 5), [app.state.users, searchText, user.region]);
  const teamResults = useMemo(() => app.state.teams
    .filter((team) => `${team.name} ${team.region} ${team.homeCourt}`.toLowerCase().includes(searchText))
    .sort((a, b) => Number(b.region === user.region) - Number(a.region === user.region) || b.mmr - a.mmr)
    .slice(0, 5), [app.state.teams, searchText, user.region]);
  const courtResults = useMemo(() => COURTS
    .filter((court) => `${court.name} ${court.region} ${court.type}`.toLowerCase().includes(searchText))
    .sort((a, b) => Number(b.region === user.region) - Number(a.region === user.region) || a.name.localeCompare(b.name))
    .slice(0, 5), [searchText, user.region]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Court Command</p>
          <h1>{user.name}님의 오늘 랭크 보드</h1>
        </div>
        <Link to="/app/create">
          <Button><PlusCircle size={18} /> 오늘의 판 만들기</Button>
        </Link>
      </header>

      <Card className="home-search-panel">
        <div className="home-search-box">
          <Search size={24} />
          <input value={query} placeholder="선수, 팀, 코트를 검색하세요" onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="home-search-results">
          <div>
            <p className="eyebrow">Players</p>
            {playerResults.map((item) => (
              <Link key={item.id} to={`/app/players/${item.id}`}>
                <span className="avatar small" style={{ "--avatar": item.avatarColor }}>{item.name.slice(0, 1)}</span>
                <strong>{item.name}</strong>
                <em>{item.region} · {item.ratings.integrated}</em>
              </Link>
            ))}
          </div>
          <div>
            <p className="eyebrow">Teams</p>
            {teamResults.map((team) => (
              <Link key={team.id} to={`/app/teams/${team.id}`}>
                <span className="team-mini-dot" style={{ "--team-color": team.accent }} />
                <strong>{team.name}</strong>
                <em>{team.region} · {team.mmr}</em>
              </Link>
            ))}
          </div>
          <div>
            <p className="eyebrow">Courts</p>
            {courtResults.map((court) => (
              <Link key={court.id} to="/app/create">
                <span className="team-mini-dot" />
                <strong>{court.name}</strong>
                <em>{court.region} · {court.type}</em>
              </Link>
            ))}
          </div>
        </div>
      </Card>

      <section className="court-command">
        <div className="court-command-copy">
          <BadgeLine icon={Trophy} text="Rank profile" />
          <strong>{user.ratings.integrated}</strong>
          <h2>{user.name} · 통합 티어 레이스</h2>
          <Badge tone="gold">{getTierDivision(user.ratings.integrated)}</Badge>
          <p className="tier-line">{getTierQuote(user.ratings.integrated)}</p>
          <p>{user.streak > 0 ? `${user.streak}연승 중. 다음 공식전이 티어를 크게 흔듭니다.` : "다음 승리를 노리는 중입니다."}</p>
        </div>
        <div className="mode-grid">
          {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
            <RatingCard key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
          ))}
        </div>
      </section>

      <div className="content-grid">
        <div className="page-stack">
          <Card className="section-card match-focus-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Next Match</p>
                <h2>진행할 경기</h2>
              </div>
              <Badge tone="orange">{activeMatch.status}</Badge>
            </div>
            <MatchCard match={activeMatch} />
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Recent Form</p>
                <h2>전적 흐름</h2>
              </div>
            </div>
            <div className="compact-list">
              {app.state.matches.slice(0, 5).map((match) => (
                <Link key={match.id} to={`/app/matches/${match.id}`}>
                  <span>{match.title}</span>
                  <strong>{match.teamA.score ?? 0}:{match.teamB.score ?? 0}</strong>
                </Link>
              ))}
            </div>
          </Card>
        </div>
        <aside className="page-stack">
          {myTeam ? <TeamCard team={myTeam} users={app.state.users} compact /> : null}
          <ShareCard user={user} match={activeMatch} />
        </aside>
      </div>
    </div>
  );
}

function BadgeLine({ icon: Icon, text }) {
  return (
    <span className="badge-line">
      <Icon size={17} />
      {text}
      <Flame size={17} />
    </span>
  );
}
