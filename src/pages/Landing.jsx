import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  LogIn,
  MapPin,
  Trophy,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import { getTierEmblemSrc } from "../components/rating/TierEmblem.jsx";
import { BOXTIER_LOGO_URL } from "../lib/assets.js";
import { BRAND_NAME } from "../lib/brand.js";
import { MATCH_SIDE_FALLBACK_NAMES } from "../lib/constants.js";
import { isPlacementComplete } from "../lib/rating.js";
import { getTierDivision } from "../lib/tier.js";

function getScheduleLabel(item = {}) {
  return item.scheduledAt || item.scheduledTime || item.scheduledDate || "일정 협의";
}

function getSideName(match = {}, sideName) {
  return match?.[sideName]?.name || MATCH_SIDE_FALLBACK_NAMES[sideName];
}

export default function Landing({ state }) {
  const users = state?.users ?? [];
  const matches = state?.matches ?? [];
  const teams = state?.teams ?? [];
  const openRecruiting = (state?.recruitingPosts ?? [])
    .filter((post) => post.status !== "closed")
    .slice(0, 3);
  const completedMatches = matches
    .filter((match) => match.status === "confirmed")
    .slice(-3)
    .reverse();
  const topUser = users
    .filter((user) => isPlacementComplete(user.ratings))
    .sort((a, b) => (b.ratings?.integrated ?? 0) - (a.ratings?.integrated ?? 0))[0];
  const featuredTeam = [...teams].sort((a, b) => (b.mmr ?? 0) - (a.mmr ?? 0))[0];
  const topMmr = Number(topUser?.ratings?.integrated ?? 0);
  const topTier = topUser ? getTierDivision(topMmr) : "시즌 랭킹 준비 중";

  return (
    <main className="ui-design-host ui-design-public-main" data-design="editorial">
      <div className="ui-design-page ui-design-main-page">
        <div className="ui-design-flow ui-design-main-flow">
          <section
            className="ui-design-hero ui-design-main-hero"
            style={{
              "--ui-design-media": "var(--bg-action)",
              "--ui-design-media-position": "center 36%",
              "--ui-design-media-position-mobile": "62% center",
            }}
          >
            <div className="ui-design-hero__copy">
              <div className="ui-design-main-brand" aria-label={BRAND_NAME}>
                <span className="brand-logo-frame" aria-hidden="true">
                  <img className="brand-logo-img" src={BOXTIER_LOGO_URL} alt="" />
                </span>
                <span className="brand-letter-wrap" aria-hidden="true">
                  <span className="brand-letter-text">{BRAND_NAME}</span>
                </span>
              </div>
              <Badge tone="green">Season Zero</Badge>
              <h1>오늘,<br />농구할 사람?</h1>
              <p>가까운 경기를 찾고, 팀과 기록을 한곳에서 관리하세요.</p>
              <div className="ui-design-actions">
                <Button as={Link} to="/app/recruiting">
                  경기 찾기 <ArrowRight size={18} />
                </Button>
                <Button as={Link} to="/login" variant="secondary">
                  로그인 <LogIn size={18} />
                </Button>
              </div>
            </div>
            <div className="ui-design-stat-strip ui-design-hero__stats" aria-label={`${BRAND_NAME} 활동 요약`}>
              <span><b>{openRecruiting.length}</b>열린 매칭</span>
              <span><b>{matches.length}</b>경기 기록</span>
              <span><b>{teams.length}</b>활동 팀</span>
            </div>
          </section>

          <section className="ui-design-section">
            <div className="ui-design-section-heading">
              <div>
                <p className="eyebrow">Play next</p>
                <h2>지금 열려 있는 경기</h2>
              </div>
              <Link to="/app/recruiting" className="ui-design-text-action">
                전체 매칭 <ChevronRight size={17} />
              </Link>
            </div>
            <div className="ui-design-list ui-design-schedule">
              {openRecruiting.length ? openRecruiting.map((post) => (
                <Link
                  to="/app/recruiting"
                  key={post.id}
                  className="ui-design-row ui-design-schedule-row"
                >
                  <time>
                    <b>{post.mode ?? "농구 경기"}</b>
                    <span>{getScheduleLabel(post)}</span>
                  </time>
                  <span className="ui-design-schedule-copy">
                    <strong>{post.title || "새 매칭 참가자 모집"}</strong>
                    <small><MapPin size={14} /> {post.court || "구장 협의"}</small>
                  </span>
                  <span className="ui-design-availability">참가자 모집 중</span>
                  <ChevronRight size={18} />
                </Link>
              )) : (
                <Link to="/app/create" className="ui-design-row ui-design-schedule-row">
                  <time><b>COURT OPEN</b><span>새 경기</span></time>
                  <span className="ui-design-schedule-copy">
                    <strong>첫 매칭을 직접 열어보세요.</strong>
                    <small><MapPin size={14} /> 구장과 시간을 선택할 수 있습니다.</small>
                  </span>
                  <span className="ui-design-availability">매칭 만들기</span>
                  <ChevronRight size={18} />
                </Link>
              )}
            </div>
          </section>

          <section
            className="ui-design-image-feature"
            style={{
              "--ui-design-media": "var(--bg-teams)",
              "--ui-design-media-position": "center",
              "--ui-design-media-position-mobile": "64% center",
            }}
          >
            <div className="ui-design-image-feature__copy">
              <p className="eyebrow">Team basketball</p>
              <h2>{featuredTeam?.name ?? "함께할 팀 찾기"}</h2>
              <p>
                {featuredTeam
                  ? `${featuredTeam.region ?? "지역 미정"} · ${featuredTeam.homeCourt ?? "홈 구장 미정"}`
                  : "팀을 만들거나 나와 맞는 팀을 찾아보세요."}
              </p>
              <div className="ui-design-inline-meta">
                <span><Users size={17} /> 팀원 {featuredTeam?.members?.length ?? 0}명</span>
                <span><Trophy size={17} /> {featuredTeam?.wins ?? 0}승 {featuredTeam?.losses ?? 0}패</span>
                <span>{featuredTeam?.mmr ?? 1200} MMR</span>
              </div>
              <Link to="/app/teams" className="ui-design-text-action ui-design-text-action--inverse">
                팀 둘러보기 <ArrowRight size={18} />
              </Link>
            </div>
          </section>

          <section className="ui-design-spotlight">
            <div className="ui-design-spotlight__intro">
              <img
                src={getTierEmblemSrc(topMmr || 1200, topUser?.ratings)}
                alt={`${topTier} 티어 엠블럼`}
              />
              <div>
                <p className="eyebrow">Season ranking</p>
                <h2 className="ui-tier-label">{topUser?.name ?? "새로운 시즌"}</h2>
                <p>{topUser ? `${topTier} · ${Math.round(topMmr)} MMR` : "경기를 기록하면 시즌 경쟁이 시작됩니다."}</p>
              </div>
            </div>
            <dl className="ui-design-stat-strip ui-design-spotlight__stats">
              <div><dt>경기</dt><dd>{matches.length}</dd></div>
              <div><dt>팀</dt><dd>{teams.length}</dd></div>
              <div><dt>선수</dt><dd>{users.length}</dd></div>
            </dl>
          </section>

          <section className="ui-design-section">
            <div className="ui-design-section-heading">
              <div>
                <p className="eyebrow">Recent games</p>
                <h2>최근 경기</h2>
              </div>
              <Link to="/app/matches" className="ui-design-text-action">
                경기 일정 <CalendarDays size={17} />
              </Link>
            </div>
            <div className="ui-design-list ui-design-result-list">
              {completedMatches.length ? completedMatches.map((match) => (
                <Link to="/app/matches" className="ui-design-result-row" key={match.id}>
                  <span className="is-win">완료</span>
                  <strong>{getSideName(match, "teamA")} vs {getSideName(match, "teamB")}</strong>
                  <b>{match.teamA?.score ?? 0} : {match.teamB?.score ?? 0}</b>
                </Link>
              )) : (
                <div className="ui-empty-state-compact">아직 공개된 경기 기록이 없습니다.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
