import { ArrowRight, House } from "lucide-react";
import { Link } from "react-router-dom";
import BrandLockup from "../components/common/BrandLockup.jsx";
import Button from "../components/common/Button.jsx";
import { BRAND_NAME } from "../lib/brand.js";

export default function NotFound() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-card-head">
          <Link to="/" className="brand auth-brand" aria-label={BRAND_NAME}>
            <BrandLockup />
          </Link>
        </div>

        <div className="auth-form">
          <div>
            <p className="eyebrow">404</p>
            <h1 className="ui-content-title">페이지를 찾을 수 없습니다</h1>
          </div>
          <p className="auth-message">주소가 바뀌었거나 존재하지 않는 페이지입니다.</p>
          <div className="ui-action-row">
            <Button as={Link} to="/app">
              <House size={16} /> 홈으로
            </Button>
            <Button as={Link} to="/" variant="secondary">
              <ArrowRight size={16} /> 서비스 소개
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
