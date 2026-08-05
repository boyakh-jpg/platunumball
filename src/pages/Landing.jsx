import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  House,
  LogIn,
  MapPin,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import { getTierEmblemSrc } from "../components/rating/TierEmblem.jsx";
import { assetUrl } from "../lib/assets.js";
import { BRAND_NAME } from "../lib/brand.js";
import { MATCH_SIDE_FALLBACK_NAMES } from "../lib/constants.js";
import { isPlacementComplete } from "../lib/rating.js";
import { getTierDivision } from "../lib/tier.js";
import { GUIDE_CHAPTERS } from "./gettingStartedGuideData.jsx";

const LANDING_SHOWCASE_CHAPTERS = GUIDE_CHAPTERS.filter(({ id }) => (
  ["matching", "attendance", "live", "records"].includes(id)
));

function getScheduleLabel(item = {}) {
  return item.scheduledAt || item.scheduledTime || item.scheduledDate || "일정 협의";
}

function getSideName(match = {}, sideName) {
  return match?.[sideName]?.name || match?.[`${sideName}Name`] || MATCH_SIDE_FALLBACK_NAMES[sideName];
}

function normalizeLandingStats(value = {}) {
  const stats = Object.fromEntries(
    ["openRecruiting", "completedMatches", "activeTeams", "players"]
      .map((key) => [key, Number(value?.[key])]),
  );
  return Object.values(stats).every((count) => Number.isSafeInteger(count) && count >= 0)
    ? stats
    : null;
}

function normalizeLandingFeed(value = {}) {
  if (!Array.isArray(value?.openRecruiting) || !Array.isArray(value?.recentMatches)) return null;
  return {
    openRecruiting: value.openRecruiting.filter((item) => typeof item?.id === "string").slice(0, 3),
    recentMatches: value.recentMatches.filter((item) => typeof item?.id === "string").slice(0, 3),
  };
}

export default function Landing({ state, authenticated = false }) {
  const [publicStats, setPublicStats] = useState(null);
  const [publicFeed, setPublicFeed] = useState(null);
  const users = state?.users ?? [];
  const matches = state?.matches ?? [];
  const teams = state?.teams ?? [];
  const openRecruitingPosts = (state?.recruitingPosts ?? [])
    .filter((post) => post.status === "open" && post.visibility !== "private");
  const confirmedMatches = matches.filter((match) => match.status === "confirmed" && match.visibility !== "private");
  const openRecruiting = publicFeed?.openRecruiting ?? openRecruitingPosts.slice(0, 3);
  const completedMatches = publicFeed?.recentMatches ?? confirmedMatches.slice(-3).reverse();
  const topUser = users
    .filter((user) => isPlacementComplete(user.ratings))
    .sort((a, b) => (b.ratings?.integrated ?? 0) - (a.ratings?.integrated ?? 0))[0];
  const featuredTeam = [...teams].sort((a, b) => (b.mmr ?? 0) - (a.mmr ?? 0))[0];
  const topMmr = Number(topUser?.ratings?.integrated ?? 0);
  const topTier = topUser ? getTierDivision(topMmr) : "시즌 랭킹 준비 중";

  const landingStats = publicStats ?? {
    openRecruiting: openRecruitingPosts.length,
    completedMatches: confirmedMatches.length,
    activeTeams: teams.length,
    players: users.length,
  };

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/landing/stats", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const nextStats = normalizeLandingStats(payload?.stats);
        const nextFeed = normalizeLandingFeed(payload?.feed);
        if (nextStats) setPublicStats(nextStats);
        if (nextFeed) setPublicFeed(nextFeed);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <main className="ui-design-host ui-design-public-main" data-design="editorial">
      <div className="ui-design-page ui-design-main-page">
        <div className="ui-design-flow ui-design-main-flow">
          <section
            className="ui-design-hero ui-design-main-hero ui-page-hero"
            style={{
              "--ui-design-media": "var(--bg-action)",
              "--ui-design-media-position": "center 36%",
              "--ui-design-media-position-mobile": "62% center",
            }}
          >
            <div className="ui-design-hero__copy ui-page-hero__copy">
              <Badge tone="green">Season Zero</Badge>
              <h1>오늘,<br />농구할 사람?</h1>
              <div className="ui-action-row ui-design-actions">
                {authenticated ? (
                  <>
                    <Button as={Link} to="/app/recruiting">
                      경기 찾기 <ArrowRight size={18} />
                    </Button>
                    <Button as={Link} to="/app" variant="secondary">
                      홈 <House size={18} />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button as={Link} to="/app">
                      홈 <House size={18} />
                    </Button>
                    <Button as={Link} to="/login" variant="secondary">
                      로그인 <LogIn size={18} />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="ui-design-stat-strip ui-design-hero__stats" aria-label={`${BRAND_NAME} 활동 요약`}>
              <span><b>{landingStats.openRecruiting}</b>열린 매칭</span>
              <span><b>{landingStats.completedMatches}</b>경기 기록</span>
              <span><b>{landingStats.activeTeams}</b>활동 팀</span>
            </div>
          </section>

          <section
            className="ui-design-section getting-started-section"
            id="how-it-works"
            aria-labelledby="landing-showcase-title"
          >
            <div className="section-title-row ui-design-section-heading">
              <div>
                <p className="eyebrow">How it works</p>
                <h2 id="landing-showcase-title">처음부터 기록까지, 화면 그대로</h2>
              </div>
              <span>4가지 핵심 흐름</span>
            </div>

            {LANDING_SHOWCASE_CHAPTERS.map((chapter, chapterIndex) => (
              <section
                className="getting-started-section"
                aria-labelledby={`landing-showcase-${chapter.id}`}
                key={chapter.id}
              >
                <Card as="article" className="getting-started-chapter">
                  <header className="getting-started-chapter__copy">
                    <Badge tone="orange">{chapterIndex + 1} / {LANDING_SHOWCASE_CHAPTERS.length}</Badge>
                    <p className="eyebrow">{chapter.eyebrow}</p>
                    <h2 id={`landing-showcase-${chapter.id}`}>{chapter.title}</h2>
                    <p>{chapter.lead}</p>
                    {chapter.id === "records" ? (
                      <p>경기 확정 뒤 나·팀 기록에서 함께 뛴 선수를 추천할 수 있습니다.</p>
                    ) : null}
                  </header>
                  <figure className="getting-started-shot ui-design-borderless-surface">
                    <img
                      src={assetUrl(chapter.image)}
                      alt={chapter.imageAlt}
                      loading="lazy"
                      decoding="async"
                    />
                    <figcaption>{chapter.caption}</figcaption>
                  </figure>
                </Card>

                <ol className="getting-started-steps ui-design-borderless-list">
                  {chapter.steps.map(({ title, body, Icon }, stepIndex) => (
                    <li className="getting-started-step ui-panel" key={title}>
                      <div>
                        <span>{String(stepIndex + 1).padStart(2, "0")}</span>
                        <Icon size={21} aria-hidden="true" />
                      </div>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </li>
                  ))}
                </ol>
              </section>
            ))}

            <div className="ui-action-row">
              <Button as={Link} to={authenticated ? "/app/guide/practice" : "/app"}>
                {authenticated ? "연습 경기 시작" : "게스트 홈 보기"} <ArrowRight size={18} />
              </Button>
              {!authenticated ? (
                <Button as={Link} to="/login" variant="secondary">
                  가입하고 시작 <LogIn size={18} />
                </Button>
              ) : null}
            </div>
          </section>

          <section className="ui-design-section">
            <div className="section-title-row ui-design-section-heading">
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
                  to={`/app/recruiting?post=${encodeURIComponent(post.id)}`}
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
              <Link to={featuredTeam ? `/app/teams/${encodeURIComponent(featuredTeam.id)}` : "/app/teams"} className="ui-design-text-action ui-design-text-action--inverse">
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
              <div><dt>경기</dt><dd>{landingStats.completedMatches}</dd></div>
              <div><dt>팀</dt><dd>{landingStats.activeTeams}</dd></div>
              <div><dt>선수</dt><dd>{landingStats.players}</dd></div>
            </dl>
          </section>

          <section className="ui-design-section">
            <div className="section-title-row ui-design-section-heading">
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
                <Link to={`/app/matches?match=${encodeURIComponent(match.id)}`} className="ui-design-result-row" key={match.id}>
                  <span className="is-win">완료</span>
                  <strong>{getSideName(match, "teamA")} vs {getSideName(match, "teamB")}</strong>
                  <b>{match.scoreA ?? match.result?.scoreA ?? match.teamA?.score ?? 0} : {match.scoreB ?? match.result?.scoreB ?? match.teamB?.score ?? 0}</b>
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
