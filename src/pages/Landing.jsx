import { ArrowRight, Check } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import BrandLockup from "../components/common/BrandLockup.jsx";
import Button from "../components/common/Button.jsx";
import LandingLoading from "../components/common/LandingLoading.jsx";
import MatchReceiptPreview from "../components/match/MatchReceiptPreview.jsx";
import { BRAND_NAME } from "../lib/brand.js";
import { normalizeMatchReceiptDraft } from "../lib/matchReceipt.js";
import { getLoginPath } from "../lib/profileSetup.js";
import "../styles/features/match-clock-shell-controls.css";

const LANDING_RECEIPT_DRAFT = normalizeMatchReceiptDraft({
  serialSeed: "landing-receipt",
  homeTeam: "NEW COURT CREW",
  awayTeam: "마포 러너스",
  homeScore: 60,
  awayScore: 46,
  playedOn: "2026-08-11",
  venue: "마포구 와우근린공원 농구장",
  format: "5v5",
  matchNature: "competitive",
  comment: "오늘도 농구",
  homeMmr: 1540,
  awayMmr: 1490,
  hasCanonicalTeamMatch: true,
  verified: true,
});

function LoginButton({ children = "로그인", className = "", variant = "secondary" }) {
  return (
    <Button
      as={Link}
      to={getLoginPath("/app", "/")}
      variant={variant}
      className={className}
      aria-label="로그인"
    >
      {children}
    </Button>
  );
}

export default function Landing({ auth }) {
  if (auth?.loading) return <LandingLoading />;
  if (auth?.user) return <Navigate to="/app" replace />;

  const receiptUrl = new URL("/app/receipt", window.location.origin).toString();

  return (
    <main className="guest-landing">
      <header className="guest-landing-header">
        <div className="guest-landing-header-inner">
          <Link to="/" className="brand guest-landing-brand" aria-label={BRAND_NAME}>
            <BrandLockup />
          </Link>
          <LoginButton className="guest-landing-header-login" />
        </div>
      </header>

      <section className="guest-landing-hero">
        <div className="guest-landing-hero-copy">
          <p className="guest-landing-eyebrow">PLAY REAL. RANK REAL.</p>
          <h1>농구 기록을<br />쌓고 연결하세요.</h1>
          <p className="guest-landing-lead">
            경기방, 출석, 점수와 개인 기록까지 한곳에 쌓고<br />
            끝난 경기는 영수증으로 저장·공유하세요.
          </p>
          <div className="guest-landing-primary-actions">
            <Button as={Link} to="/app/receipt" className="guest-landing-primary-cta">
              가입 없이 영수증 만들기 <ArrowRight aria-hidden="true" size={18} />
            </Button>
            <LoginButton className="guest-landing-hero-login">
              별도 가입 없이 로그인
            </LoginButton>
            <Button as={Link} to="/app" variant="secondary" className="guest-landing-explore-link">
              로그인 없이 둘러보기 <ArrowRight aria-hidden="true" size={16} />
            </Button>
          </div>
          {auth?.error ? <p className="guest-landing-auth-error">로그인을 완료하지 못했습니다. 다시 시도해주세요.</p> : null}
        </div>

        <div className="guest-landing-hero-receipt" aria-label="박스티어 경기 영수증 예시">
          <MatchReceiptPreview draft={LANDING_RECEIPT_DRAFT} matchUrl={receiptUrl} />
        </div>
      </section>

      <section className="guest-landing-section guest-landing-record-section">
        <div className="guest-landing-section-heading">
          <p className="guest-landing-eyebrow">HOW BOXTIER WORKS</p>
          <h2>경기 전부터 종료 후까지<br />하나의 기록으로 이어집니다.</h2>
          <p>BOXTIER는 영수증 제작만 하는 서비스가 아닙니다.<br />경기 운영과 결과, 팀·개인 기록을 연결합니다.</p>
        </div>

        <ol className="guest-landing-record-flow">
          <li><b>01</b><strong>경기 준비</strong><span>경기방·일정·참가자</span></li>
          <li><b>02</b><strong>경기 기록</strong><span>점수·개인 기록·승패</span></li>
          <li><b>03</b><strong>기록 연결</strong><span>전적·티어·팀 기록</span></li>
        </ol>

        <div className="guest-landing-experience">
          <div className="guest-landing-mobile-scoreboard" aria-label="모바일 전광판 예시">
            <div className="ui-match-clock-scoreboard">
              <span className="ui-match-clock-scoreboard-label">MOBILE SCOREBOARD</span>
              <div className="ui-match-clock-team ui-match-clock-team-a">
                <span className="ui-match-clock-team-label">{LANDING_RECEIPT_DRAFT.homeTeam}</span>
                <strong className="ui-match-clock-team-score">{LANDING_RECEIPT_DRAFT.homeScore}</strong>
              </div>
              <div className="ui-match-clock-main-time">
                <span className="ui-match-clock-main-time-label">GAME CLOCK</span>
                <strong className="ui-match-clock-period">2Q</strong>
                <time dateTime="PT7M32S">07:32</time>
              </div>
              <div className="ui-match-clock-team ui-match-clock-team-b">
                <span className="ui-match-clock-team-label">{LANDING_RECEIPT_DRAFT.awayTeam}</span>
                <strong className="ui-match-clock-team-score">{LANDING_RECEIPT_DRAFT.awayScore}</strong>
              </div>
            </div>
          </div>

          <div className="guest-landing-experience-copy">
            <p className="guest-landing-eyebrow">TRY THE FLOW</p>
            <h3>휴대폰 하나로 경기 운영</h3>
            <p>연습경기에서 모바일 전광판을 체험하고, 쌓인 기록은 랭크보드에서 확인하세요.</p>
            <div className="guest-landing-experience-actions">
              <Button as={Link} to="/app/guide/practice" variant="secondary">
                연습경기 체험하기 <ArrowRight aria-hidden="true" size={17} />
              </Button>
              <Button as={Link} to="/app/rankings" variant="secondary">
                랭크보드 보기 <ArrowRight aria-hidden="true" size={17} />
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="guest-landing-section guest-landing-account-section">
        <div className="guest-landing-section-heading">
          <p className="guest-landing-eyebrow">KEEP YOUR RECORD</p>
          <h2>한 경기로 끝내지 않으려면<br />기록을 이어가세요.</h2>
        </div>
        <ul className="guest-landing-benefits">
          <li><Check aria-hidden="true" /> 경기 영수증 자동 보관</li>
          <li><Check aria-hidden="true" /> 승패와 개인 기록 누적</li>
          <li><Check aria-hidden="true" /> 전적·티어·팀 기록 연결</li>
        </ul>
      </section>

    </main>
  );
}
