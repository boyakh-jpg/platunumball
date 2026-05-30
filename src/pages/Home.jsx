import { Link } from "react-router-dom";
import { PlusCircle } from "lucide-react";
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
          <p className="eyebrow">오늘의 코트</p>
          <h1>{user.name}님, 다음 판이 기다리고 있어요.</h1>
        </div>
        <Link to="/app/create">
          <Button><PlusCircle size={18} /> 오늘의 판 만들기</Button>
        </Link>
      </header>

      <section className="hero-dashboard">
        <div className="hero-score">
          <span>통합 MMR</span>
          <strong>{user.ratings.integrated}</strong>
          <p>{user.streak > 0 ? `${user.streak}연승 중` : "다음 승리를 노리는 중"}</p>
        </div>
        <div className="mode-grid">
          {Object.entries(user.ratings.modes).map(([mode, mmr]) => (
            <RatingCard key={mode} title={mode} mmr={mmr} subtitle="모드 티어" />
          ))}
        </div>
      </section>

      <div className="content-grid">
        <div className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">대기 중</p>
                <h2>진행할 경기</h2>
              </div>
            </div>
            <MatchCard match={activeMatch} />
          </Card>
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">최근 5경기</p>
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
