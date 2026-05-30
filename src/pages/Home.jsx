import { Link } from "react-router-dom";
import { Flame, PlusCircle, Trophy } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import MatchCard from "../components/match/MatchCard.jsx";
import RatingCard from "../components/rating/RatingCard.jsx";
import ShareCard from "../components/share/ShareCard.jsx";
import TeamCard from "../components/team/TeamCard.jsx";

export default function Home({ app }) {
  const user = app.currentUser;
  const activeMatch = app.state.matches.find((match) => match.status !== "confirmed") ?? app.state.matches[0];
  const myTeam = app.state.teams.find((team) => team.members.some((member) => member.userId === user.id));

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

      <section className="court-command">
        <div className="court-command-copy">
          <BadgeLine icon={Trophy} text="Rank profile" />
          <strong>{user.ratings.integrated}</strong>
          <h2>{user.name} · 통합 티어 레이스</h2>
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
