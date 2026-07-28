import { ArrowRight, BarChart3, ClipboardCheck, House, LogIn, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import { BOXTIER_LETTER_DARK_URL, BOXTIER_LETTER_LIGHT_URL, BOXTIER_LOGO_URL } from "../lib/assets.js";
import { BRAND_NAME } from "../lib/brand.js";
import { MATCH_SIDE_FALLBACK_NAMES } from "../lib/constants.js";
import { isPlacementComplete } from "../lib/rating.js";

export default function Landing({ state }) {
  const users = state?.users ?? [];
  const matches = state?.matches ?? [];
  const teams = state?.teams ?? [];
  const topUser = users
    .filter((user) => isPlacementComplete(user.ratings))
    .sort((a, b) => (b.ratings?.integrated ?? 0) - (a.ratings?.integrated ?? 0))[0];
  const featuredMatch =
    matches.find((match) => ["approval", "agreed", "contract"].includes(match.status)) ??
    matches.find((match) => match.status === "confirmed") ??
    matches[0];
  const approvalCount = matches.filter((match) => match.status === "approval").length;
  const recruitingCount = state?.recruitingPosts?.filter((post) => post.status !== "closed").length ?? 0;
  const statusLabel = {
    contract: "협의",
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
          <h1 className="landing-brand-lockup" aria-label={BRAND_NAME}>
            <span className="brand-logo-frame" aria-hidden="true">
              <img className="brand-logo-img" src={BOXTIER_LOGO_URL} alt="" />
            </span>
            <span className="brand-letter-wrap" aria-hidden="true">
              <img className="brand-letter-img brand-letter-dark" src={BOXTIER_LETTER_DARK_URL} alt="" />
              <img className="brand-letter-img brand-letter-light" src={BOXTIER_LETTER_LIGHT_URL} alt="" />
            </span>
          </h1>
          <p className="landing-compact-summary">농구 경기 모집 · 기록 · MMR 랭킹 · 팀 운영</p>
          <Badge tone="green">Season Zero</Badge>
          <div className="landing-actions">
            <div className="landing-primary-actions">
              <Button as={Link} to="/app/create" className="landing-create-action">
                매칭 만들기 <ArrowRight size={18} />
              </Button>
              <Button as={Link} to="/app/create?intent=record" className="landing-create-action">
                경기 기록하기 <ClipboardCheck size={18} />
              </Button>
            </div>
            <Button as={Link} to="/app" variant="secondary"><House size={18} /> 홈</Button>
            <Button as={Link} to="/app/rankings" variant="secondary"><Trophy size={18} /> 랭크보드</Button>
            <Button as={Link} to="/login" variant="secondary"><LogIn size={18} /> 로그인</Button>
          </div>
          <div className="landing-stat-grid">
            <span><strong>{matches.length}</strong> matches</span>
            <span><strong>{teams.length}</strong> teams</span>
            <span><strong>{topUser?.ratings?.integrated ?? "-"}</strong> top MMR</span>
          </div>
        </div>
        <div className="broadcast-panel" aria-label={`${BRAND_NAME} 실시간 현황`}>
          <Link to={featuredMatch ? `/app/matches?match=${featuredMatch.id}` : "/app"} className="broadcast-glass">
            <div className="live-dot">TODAY</div>
            <h2>{featuredMatch?.mode ?? "5v5"} Match</h2>
            <div className="broadcast-score">
              <span>{featuredMatch?.teamA.name ?? MATCH_SIDE_FALLBACK_NAMES.teamA}</span>
              <strong>{featuredMatch?.teamA.score ?? 0}</strong>
              <i>VS</i>
              <strong>{featuredMatch?.teamB.score ?? 0}</strong>
              <span>{featuredMatch?.teamB.name ?? MATCH_SIDE_FALLBACK_NAMES.teamB}</span>
            </div>
            <div className="broadcast-list">
              <span><Trophy size={17} /> {topUser?.name ?? BRAND_NAME} <b>{topUser?.ratings?.integrated ?? "-"}</b></span>
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
