import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import BrandLockup from "../components/common/BrandLockup.jsx";
import Button from "../components/common/Button.jsx";
import { BRAND_NAME } from "../lib/brand.js";
import { getLoginPath } from "../lib/profileSetup.js";
import { postServerAction } from "../lib/serverActions.js";

const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function formatHistoryItem(row = {}) {
  const summary = row.receipt_summary ?? {};
  return `${summary.playedOn ?? "-"} · ${summary.homeTeam ?? "-"} ${summary.homeScore ?? "-"}-${summary.awayScore ?? "-"} ${summary.awayTeam ?? "-"}`;
}

export default function InstagramConnect({ auth }) {
  const location = useLocation();
  const code = useMemo(
    () => new URLSearchParams(location.search).get("code")?.trim() ?? "",
    [location.search],
  );
  const connectPath = code ? `/instagram/connect?code=${encodeURIComponent(code)}` : "/instagram/connect";
  const validCode = LINK_CODE_PATTERN.test(code);
  const started = useRef(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (auth.loading || !auth.session || !validCode || started.current) return;
    started.current = true;
    void postServerAction("/api/instagram/account", { action: "link", code })
      .then((nextResult) => setResult(nextResult))
      .catch((linkError) => {
        setError(linkError?.code === "instagram_link_expired"
          ? "연결 링크가 만료되었거나 이미 사용됐다. Instagram DM으로 '연결'을 다시 보내라."
          : "Instagram 계정을 연결하지 못했다.");
      });
  }, [auth.loading, auth.session, code, validCode]);

  if (!auth.loading && !auth.session && validCode) {
    return <Navigate to={getLoginPath(connectPath, connectPath)} replace />;
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-card-head">
          <Link to="/" className="brand auth-brand" aria-label={BRAND_NAME}><BrandLockup /></Link>
        </div>
        <div className="auth-form">
          <div>
            <p className="eyebrow">Instagram</p>
            <h1 className="ui-content-title">영수증 봇 계정 연결</h1>
          </div>
          {!validCode ? <p className="auth-message" role="alert">올바르지 않은 연결 요청이다.</p> : null}
          {validCode && auth.loading ? <p className="auth-message">로그인 상태 확인 중...</p> : null}
          {validCode && auth.session && !result && !error ? <p className="auth-message">Instagram 계정 연결 중...</p> : null}
          {result ? (
            <>
              <p className="auth-message" role="status">연결 완료. 이제 Instagram DM에서 영수증 기록을 불러올 수 있다.</p>
              <div className="auth-recovery-notice">
                <strong>최근 영수증 기록</strong>
                {result.history?.length ? result.history.map((row) => <p key={row.id}>{formatHistoryItem(row)}</p>) : <p>저장된 기록이 없다.</p>}
              </div>
              <Button as={Link} to="/app">BoxTier로 이동</Button>
            </>
          ) : null}
          {error ? <p className="auth-message" role="alert">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
