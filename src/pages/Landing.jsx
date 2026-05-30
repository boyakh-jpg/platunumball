import { ArrowRight, BarChart3, ClipboardCheck, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";

export default function Landing({ state }) {
  const topUser = [...state.users].sort((a, b) => b.ratings.integrated - a.ratings.integrated)[0];

  return (
    <main className="landing">
      <section className="landing-hero">
        <div className="landing-backdrop" aria-hidden="true" />
        <div className="landing-copy">
          <Badge tone="green">RankBall Season Zero</Badge>
          <h1>RankBall</h1>
          <p>친구끼리 뛰는 농구를 랭크전처럼 기록하고, 경기계약서와 승인으로 티어를 올리는 코트 래더.</p>
          <div className="landing-actions">
            <Link to="/app/create">
              <Button>
                오늘의 판 만들기 <ArrowRight size={18} />
              </Button>
            </Link>
            <Link to="/app/rankings">
              <Button variant="secondary">랭킹 보드 보기</Button>
            </Link>
          </div>
          <div className="landing-stat-grid">
            <span><strong>{state.matches.length}</strong> active matches</span>
            <span><strong>{state.teams.length}</strong> squads</span>
            <span><strong>{topUser.ratings.integrated}</strong> top MMR</span>
          </div>
        </div>
        <div className="broadcast-panel" aria-label="RankBall live board">
          <div className="broadcast-glass">
            <div className="live-dot">LIVE</div>
            <h2>Street Court Ladder</h2>
            <div className="broadcast-score">
              <span>Noeul Kings</span>
              <strong>21</strong>
              <i>VS</i>
              <strong>17</strong>
              <span>Bridge Ballers</span>
            </div>
            <div className="broadcast-list">
              <span><Trophy size={17} /> {topUser.name} · {topUser.ratings.integrated} MMR</span>
              <span><ClipboardCheck size={17} /> Contract locked before tip-off</span>
              <span><ShieldCheck size={17} /> Majority approval updates rank</span>
              <span><BarChart3 size={17} /> 5v5 official has the highest weight</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
