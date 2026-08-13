import { ArrowRight, Check } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import BrandLockup from "../components/common/BrandLockup.jsx";
import Button from "../components/common/Button.jsx";
import LandingLoading from "../components/common/LandingLoading.jsx";
import MatchReceiptPreview from "../components/match/MatchReceiptPreview.jsx";
import { BRAND_NAME } from "../lib/brand.js";
import { normalizeMatchReceiptDraft } from "../lib/matchReceipt.js";

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

function GoogleLoginButton({ auth, compact = false, className = "", variant = "secondary" }) {
  const signIn = () => auth?.signInWithProvider?.("google", "/app");

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={signIn}
      disabled={auth?.authActionPending}
      aria-label="Google로 로그인"
    >
      <span aria-hidden="true" className="guest-landing-login-long">Google로 로그인</span>
      {compact ? <span aria-hidden="true" className="guest-landing-login-short">로그인</span> : null}
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
          <GoogleLoginButton auth={auth} compact className="guest-landing-header-login" />
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
            <button
              type="button"
              className="guest-landing-text-login"
              onClick={() => auth?.signInWithProvider?.("google", "/app")}
              disabled={auth?.authActionPending}
            >
              이미 회원이신가요? Google로 로그인 <ArrowRight aria-hidden="true" size={16} />
            </button>
          </div>
          <small>로그인 없이 제작·저장·공유할 수 있어요.</small>
          {auth?.error ? <p className="guest-landing-auth-error">Google 로그인을 완료하지 못했습니다. 다시 시도해주세요.</p> : null}
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
        <GoogleLoginButton auth={auth} variant="primary" className="guest-landing-account-login" />
        <small>처음 이용해도 별도의 가입 양식 없이<br />Google 계정으로 바로 시작할 수 있습니다.</small>
      </section>

    </main>
  );
}
