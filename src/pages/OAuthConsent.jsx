import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import BrandLockup from "../components/common/BrandLockup.jsx";
import Button from "../components/common/Button.jsx";
import { BRAND_NAME } from "../lib/brand.js";
import { getLoginPath } from "../lib/profileSetup.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";

function getRedirectUrl(result) {
  const redirectUrl = String(result?.data?.redirect_url ?? "").trim();
  if (!redirectUrl) throw new Error("OAuth 복귀 주소가 없다.");
  return redirectUrl;
}

export default function OAuthConsent({ auth }) {
  const location = useLocation();
  const authorizationId = useMemo(
    () => new URLSearchParams(location.search).get("authorization_id")?.trim() ?? "",
    [location.search],
  );
  const consentPath = authorizationId
    ? `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`
    : "/oauth/consent";
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState("");

  useEffect(() => {
    if (auth.loading || !auth.session || !isSupabaseConfigured || !authorizationId) return undefined;
    let active = true;
    void supabase.auth.oauth.getAuthorizationDetails(authorizationId).then((result) => {
      if (!active) return;
      if (result.error) throw result.error;
      const redirectUrl = String(result.data?.redirect_url ?? "").trim();
      if (redirectUrl) {
        window.location.replace(redirectUrl);
        return;
      }
      setDetails(result.data);
    }).catch((loadError) => {
      if (active) setError(loadError?.message || "연결 요청을 불러오지 못했다.");
    });
    return () => {
      active = false;
    };
  }, [auth.loading, auth.session, authorizationId]);

  if (!auth.loading && !auth.session && authorizationId) {
    return <Navigate to={getLoginPath(consentPath, consentPath)} replace />;
  }

  const decide = async (decision) => {
    if (!supabase || !authorizationId || pendingAction) return;
    setPendingAction(decision);
    setError("");
    try {
      const result = decision === "approve"
        ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (result.error) throw result.error;
      window.location.replace(getRedirectUrl(result));
    } catch (decisionError) {
      setError(decisionError?.message || "연결 요청을 처리하지 못했다.");
      setPendingAction("");
    }
  };

  const clientName = details?.client?.name || details?.client?.client_name || details?.client?.client_id || "ChatGPT";
  const scopes = String(details?.scope ?? "profile").split(/\s+/u).filter(Boolean);

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-card-head">
          <Link to="/" className="brand auth-brand" aria-label={BRAND_NAME}><BrandLockup /></Link>
        </div>
        <div className="auth-form">
          <div>
            <p className="eyebrow">Connect</p>
            <h1 className="ui-content-title">BoxTier 계정 연결</h1>
          </div>
          {!authorizationId ? <p className="auth-message">올바르지 않은 연결 요청이다.</p> : null}
          {!isSupabaseConfigured ? <p className="auth-message">계정 연결 기능이 설정되지 않았다.</p> : null}
          {authorizationId && auth.loading ? <p className="auth-message">로그인 상태 확인 중...</p> : null}
          {authorizationId && auth.session && !details && !error ? <p className="auth-message">연결 요청 확인 중...</p> : null}
          {details ? (
            <>
              <p><strong>{clientName}</strong>에서 BoxTier 계정 연결을 요청했다.</p>
              <div className="auth-recovery-notice">
                <strong>허용할 권한</strong>
                <p>{scopes.includes("profile") ? "내 BoxTier 경기 기록 읽기" : scopes.join(", ")}</p>
              </div>
              <Button type="button" disabled={Boolean(pendingAction)} onClick={() => void decide("approve")}>
                {pendingAction === "approve" ? "연결 중..." : "연결 허용"}
              </Button>
              <Button type="button" variant="secondary" disabled={Boolean(pendingAction)} onClick={() => void decide("deny")}>
                {pendingAction === "deny" ? "거부 중..." : "거부"}
              </Button>
            </>
          ) : null}
          {error ? <p className="auth-message" role="alert">{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
