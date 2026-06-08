import { ArrowRight, BarChart3, ClipboardCheck, House, LogIn, ShieldCheck, Trophy } from "lucide-react";
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
          <p>동네 코트의 경기 기록, 팀 히스토리, 랭크 경쟁을 한 곳에서 관리하는 농구 래더.</p>
          <div className="landing-actions">
            <Link to="/app/create">
              <Button>
                오늘 판 만들기 <ArrowRight size={18} />
              </Button>
            </Link>
            <Link to="/app">
              <Button variant="secondary"><House size={18} /> 홈 화면</Button>
            </Link>
            <Link to="/app/rankings">
              <Button variant="secondary">랭크보드</Button>
            </Link>
            <Link to="/login">
              <Button variant="secondary"><LogIn size={18} /> 로그인</Button>
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
              <span><ClipboardCheck size={17} /> 경기 조건은 시작 전에 고정</span>
              <span><ShieldCheck size={17} /> 과반 승인 후 랭크 반영</span>
              <span><BarChart3 size={17} /> 공식 5v5는 가장 높은 가중치</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
