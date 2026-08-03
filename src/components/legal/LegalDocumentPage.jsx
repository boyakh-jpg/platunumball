import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { BRAND_NAME } from "../../lib/brand.js";

const LEGAL_LINKS = [
  { to: "/privacy", label: "개인정보처리방침" },
  { to: "/terms", label: "서비스 약관" },
];

export default function LegalDocumentPage({ eyebrow, title, lead, effectiveDate, children }) {
  const location = useLocation();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} · ${BRAND_NAME}`;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <main className="legal-page">
      <article className="section-card ui-card legal-document">
        <header className="legal-document-header">
          <div className="legal-brand-row">
            <Link className="legal-brand-link" to="/">{BRAND_NAME}</Link>
            <nav className="legal-document-nav" aria-label="법적 고지">
              {LEGAL_LINKS.map((item) => (
                <Link
                  key={item.to}
                  className={location.pathname === item.to ? "active" : ""}
                  to={item.to}
                  aria-current={location.pathname === item.to ? "page" : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="legal-document-lead">{lead}</p>
          <dl className="legal-document-meta">
            <div>
              <dt>시행일</dt>
              <dd>{effectiveDate}</dd>
            </div>
            <div>
              <dt>운영 주체</dt>
              <dd>{BRAND_NAME} 운영팀</dd>
            </div>
          </dl>
        </header>

        <div className="legal-document-body">{children}</div>

        <footer className="legal-document-footer">
          <Link to="/">홈으로 돌아가기</Link>
          <Link to="/data-sources">농구장 데이터 출처</Link>
        </footer>
      </article>
    </main>
  );
}
