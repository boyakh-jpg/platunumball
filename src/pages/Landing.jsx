import { ArrowRight, BarChart3, ClipboardCheck, House, LogIn, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";

export default function Landing({ state }) {
  const topUser = [...state.users].sort((a, b) => b.ratings.integrated - a.ratings.integrated)[0];
  const featuredMatch =
    state.matches.find((match) => ["approval", "agreed", "contract"].includes(match.status)) ??
    state.matches.find((match) => match.status === "confirmed") ??
    state.matches[0];
  const approvalCount = state.matches.filter((match) => match.status === "approval").length;
  const recruitingCount = state.recruitingPosts?.filter((post) => post.status !== "closed").length ?? 0;
  const statusLabel = {
    contract: "동의",
    agreed: "예정",
    approval: "승인",
    disputed: "보류",
    confirmed: "완료",
  }[featuredMatch?.status] ?? "경기";

  return (
    <main className="landing">
      <section className="landing-hero">
        <div className="landing-backdrop" aria-hidden="true" />
        <div className="landing-copy">
          <Badge tone="green">RankBall Season Zero</Badge>
          <h1>RankBall</h1>
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
            <span><strong>{state.matches.length}</strong> matches</span>
            <span><strong>{state.teams.length}</strong> teams</span>
            <span><strong>{topUser.ratings.integrated}</strong> top MMR</span>
          </div>
        </div>
        <div className="broadcast-panel" aria-label="RankBall live board">
          <Link to={featuredMatch ? `/app/matches?match=${featuredMatch.id}` : "/app"} className="broadcast-glass">
            <div className="live-dot">TODAY</div>
            <h2>{featuredMatch?.mode ?? "5v5"} Match</h2>
            <div className="broadcast-score">
              <span>{featuredMatch?.teamA.name ?? "Team A"}</span>
              <strong>{featuredMatch?.teamA.score ?? 0}</strong>
              <i>VS</i>
              <strong>{featuredMatch?.teamB.score ?? 0}</strong>
              <span>{featuredMatch?.teamB.name ?? "Team B"}</span>
            </div>
            <div className="broadcast-list">
              <span><Trophy size={17} /> {topUser.name} <b>{topUser.ratings.integrated}</b></span>
              <span><ClipboardCheck size={17} /> 승인 대기 <b>{approvalCount}</b></span>
              <span><ShieldCheck size={17} /> 대기 매칭 <b>{recruitingCount}</b></span>
              <span><BarChart3 size={17} /> 상태 <b>{statusLabel}</b></span>
            </div>
          </Link>
        </div>
      </section>
    </main>
  );
}
