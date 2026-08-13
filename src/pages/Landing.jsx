import { ArrowRight, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import { MATCH_SIDE_FALLBACK_NAMES } from "../lib/constants.js";

function getSideName(match = {}, sideName) {
  return match?.[sideName]?.name || match?.[`${sideName}Name`] || MATCH_SIDE_FALLBACK_NAMES[sideName];
}

function normalizeRecentMatches(value = {}) {
  if (!Array.isArray(value?.recentMatches)) return null;
  return value.recentMatches.filter((item) => typeof item?.id === "string").slice(0, 1);
}

export default function Landing({ state, authenticated = false }) {
  const [publicMatches, setPublicMatches] = useState(null);
  const matches = state?.matches ?? [];
  const confirmedMatches = matches.filter((match) => match.status === "confirmed" && match.visibility !== "private");
  const completedMatches = publicMatches ?? confirmedMatches.slice(-1).reverse();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/landing/stats", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const nextMatches = normalizeRecentMatches(payload?.feed);
        if (nextMatches) setPublicMatches(nextMatches);
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
              <Badge tone="green">BOXTIER</Badge>
              <h1>경기 끝나면<br />기록도 끝나나요?</h1>
              <p>출석부터 점수·개인 기록·전적·티어까지 남기는 생활체육 농구 서비스</p>
              <div className="ui-action-row ui-design-actions">
                {authenticated ? (
                  <>
                    <Button as={Link} to="/app/recruiting">
                      열린 경기 보기 <ArrowRight size={18} />
                    </Button>
                    <Button as={Link} to="/app" variant="secondary">
                      홈
                    </Button>
                  </>
                ) : (
                  <>
                    <Button as={Link} to="/app/recruiting">
                      가입 없이 열린 경기 보기 <ArrowRight size={18} />
                    </Button>
                    <Button as={Link} to="/app/guide/practice" variant="secondary">
                      30초 연습경기 만들기
                    </Button>
                  </>
                )}
              </div>
            </div>
          </section>

          <section className="ui-design-section">
            <div className="section-title-row ui-design-section-heading">
              <div>
                <p className="eyebrow">Recent games</p>
                <h2>실제 경기 영수증 예시</h2>
              </div>
              <Link to="/app/receipt" className="ui-design-text-action">
                영수증 발급 <ChevronRight size={17} />
              </Link>
            </div>
            <div className="ui-design-list ui-design-result-list">
              {completedMatches.length ? completedMatches.map((match) => (
                <Link to={`/app/receipt?match=${encodeURIComponent(match.id)}`} className="ui-design-result-row" key={match.id}>
                  <span className="is-win">완료</span>
                  <strong>{getSideName(match, "teamA")} vs {getSideName(match, "teamB")}</strong>
                  <b>{match.scoreA ?? match.result?.scoreA ?? match.teamA?.score ?? 0} : {match.scoreB ?? match.result?.scoreB ?? match.teamB?.score ?? 0}</b>
                </Link>
              )) : (
                <div className="ui-empty-state-compact">아직 공개된 경기 기록이 없습니다.</div>
              )}
            </div>
          </section>

          {!authenticated ? (
            <section className="ui-design-section">
              <div className="section-title-row ui-design-section-heading">
                <div>
                  <p className="eyebrow">Keep your record</p>
                  <h2>경기 기록을 내 전적과 티어로 이어가세요.</h2>
                </div>
                <div className="ui-action-row ui-design-actions">
                  <Button as={Link} to="/login">
                    Google로 시작하기 <ArrowRight size={18} />
                  </Button>
                  <Button as={Link} to="/app" variant="secondary">
                    홈
                  </Button>
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
