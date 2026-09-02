import { ArrowRight, Check } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import BrandLockup from "../components/common/BrandLockup.jsx";
import Button from "../components/common/Button.jsx";
import LandingLoading from "../components/common/LandingLoading.jsx";
import LandingDemoFrame from "../components/landing/LandingDemoFrame.jsx";
import { BRAND_NAME } from "../lib/brand.js";
import { getLoginPath } from "../lib/profileSetup.js";

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
          <h1>농구 끝나면, 기록이 남는다.</h1>
          <p className="guest-landing-lead">
            출석부터 점수·개인 기록까지 경기 현장에서 남기고, 확정된 결과는 전적과 티어,
            공유용 영수증으로 이어집니다.
          </p>
          <div className="guest-landing-primary-actions">
            <Button as={Link} to="/app/guide/practice" className="guest-landing-primary-cta">
              샘플 경기 체험 <ArrowRight aria-hidden="true" size={18} />
            </Button>
            <Button as={Link} to="/app/create?intent=record" variant="secondary">
              경기 기록 시작하기
            </Button>
          </div>
          <Link to="/app" className="guest-landing-explore-link">
            로그인 없이 둘러보기 <ArrowRight aria-hidden="true" size={16} />
          </Link>
          {auth?.error ? <p className="guest-landing-auth-error">로그인을 완료하지 못했습니다. 다시 시도해주세요.</p> : null}
        </div>

        <LandingDemoFrame />
      </section>

      <section className="guest-landing-section guest-landing-record-section">
        <div className="guest-landing-section-heading">
          <h2>모이고, 경기하고, 기록으로 남깁니다.</h2>
        </div>

        <ol className="guest-landing-record-flow">
          <li><span>경기 전</span><strong>모인다</strong><p>출석을 확인하고 오늘 뛸 선수와 팀 구성을 정합니다.</p></li>
          <li><span>경기 중</span><strong>경기한다</strong><p>점수와 개인 기록을 경기 흐름 안에서 바로 남깁니다.</p></li>
          <li><span>경기 후</span><strong>기록된다</strong><p>확정 결과가 전적과 티어, 공유용 영수증으로 이어집니다.</p></li>
        </ol>
      </section>

      <section className="guest-landing-section guest-landing-account-section">
        <div className="guest-landing-section-heading">
          <h2>경기 뒤에도 내 농구가 이어집니다.</h2>
        </div>
        <ul className="guest-landing-benefits">
          <li><Check aria-hidden="true" /> 확정 경기 전적과 승률 누적</li>
          <li><Check aria-hidden="true" /> 개인 기록 기반 티어와 랭킹 반영</li>
          <li><Check aria-hidden="true" /> 공유용 경기 영수증 보관</li>
        </ul>
        <p className="guest-landing-matching-note">
          상대나 인원이 필요하면 <Link to="/app/recruiting">공개 매칭</Link>도 둘러볼 수 있습니다.
        </p>
      </section>

    </main>
  );
}
