import { ArrowRight, BarChart3, ClipboardCheck, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import Badge from "../components/common/Badge.jsx";

export default function Landing({ state }) {
  const topUser = [...state.users].sort((a, b) => b.ratings.integrated - a.ratings.integrated)[0];

  return (
    <main className="landing">
      <section className="landing-hero">
        <div className="landing-copy">
          <Badge tone="green">RankBall MVP</Badge>
          <h1>현실 농구도 이제 랭크전처럼.</h1>
          <p>친구들과 경기하고, 기록하고, 티어를 올리세요.</p>
          <div className="landing-actions">
            <Link to="/app/create">
              <Button>
                오늘의 판 만들기 <ArrowRight size={18} />
              </Button>
            </Link>
            <Link to="/app/rankings">
              <Button variant="secondary">내 티어 보기</Button>
            </Link>
          </div>
        </div>
        <div className="court-visual" aria-label="RankBall 코트 현황">
          <div className="court-lines">
            <span />
            <span />
            <span />
          </div>
          <div className="court-scoreboard">
            <strong>{topUser.name}</strong>
            <span>{topUser.ratings.integrated} MMR</span>
          </div>
          <div className="court-chip chip-a"><Trophy size={18} /> Platinum chase</div>
          <div className="court-chip chip-b"><ClipboardCheck size={18} /> contract ready</div>
          <div className="court-chip chip-c"><BarChart3 size={18} /> 5v5 official</div>
        </div>
      </section>
    </main>
  );
}
