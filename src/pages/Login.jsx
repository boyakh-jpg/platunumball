import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import BrandLockup from "../components/common/BrandLockup.jsx";
import Button from "../components/common/Button.jsx";
import { BRAND_NAME } from "../lib/brand.js";
import { getTestAccountDisplayLabel } from "../lib/constants.js";
import { getAppRedirectFromLocation } from "../lib/profileSetup.js";

function isEmbeddedOAuthBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /KAKAOTALK|KAKAOSTORY|NAVER|Instagram|FBAN|FBAV|Line\/|Twitter|; wv\)/i.test(ua);
}

export default function Login({ auth, app }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [copyMessage, setCopyMessage] = useState("");
  const [selectedTestLoginId, setSelectedTestLoginId] = useState(auth.testAccounts?.[0]?.id ?? "rankball-001");
  const from = getAppRedirectFromLocation(location);
  const activeProviders = auth.enabledProviders ?? [];
  const embeddedGoogleOAuthBrowser = auth.configured
    && activeProviders.some((provider) => provider.id === "google")
    && isEmbeddedOAuthBrowser();
  const browserOpenUrl = typeof window === "undefined" ? "" : `${window.location.origin}${from}`;

  if (auth.session) return <Navigate to={from} replace />;

  const goBack = () => location.key === "default" ? navigate("/app", { replace: true }) : navigate(-1);
  const enterApp = () => navigate(from, { replace: true });
  const signIn = async (providerId) => {
    if (providerId === "google" && embeddedGoogleOAuthBrowser) {
      setCopyMessage("카카오톡 내 브라우저에서는 Google 로그인을 사용할 수 없습니다. 링크를 복사해 Chrome 또는 Safari에서 열어 주세요.");
      return;
    }
    const nextSession = await auth.signInWithProvider(providerId, from);
    if (nextSession) enterApp();
  };
  const signInWithTestAccount = async (event) => {
    event.preventDefault();
    const nextSession = await auth.signInWithTestAccount(selectedTestLoginId);
    if (nextSession) enterApp();
  };
  const copyBrowserOpenUrl = async () => {
    if (!browserOpenUrl || !navigator.clipboard) {
      setCopyMessage("주소창의 URL을 복사해 Chrome 또는 Safari에서 열어 주세요.");
      return;
    }
    try {
      await navigator.clipboard.writeText(browserOpenUrl);
      setCopyMessage("링크를 복사했습니다. Chrome 또는 Safari 주소창에 붙여 넣어 주세요.");
    } catch {
      setCopyMessage("링크를 복사하지 못했습니다. 주소창의 URL을 직접 복사해 주세요.");
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-card-head">
          <Link to="/" className="brand auth-brand" aria-label={BRAND_NAME}>
            <BrandLockup />
          </Link>
          <Button type="button" variant="secondary" size="sm" className="auth-back-link" onClick={goBack} aria-label="이전 화면으로 돌아가기">
            <ArrowLeft size={18} />
            <span>뒤로</span>
          </Button>
        </div>

        <div className="auth-form">
          <div>
            <p className="eyebrow">Sign in</p>
            <h1 className="ui-content-title">소셜 계정으로 시작</h1>
          </div>

          {auth.session ? (
            <div className="auth-session-line">
              <ShieldCheck size={18} />
              <span>{getTestAccountDisplayLabel(auth.user.user_metadata?.providerName ?? auth.user.email)} 로그인됨</span>
              <button type="button" onClick={() => window.confirm("로그아웃하시겠습니까?") && void auth.signOut()} disabled={auth.authActionPending}><LogOut size={16} /> 로그아웃</button>
            </div>
          ) : null}

          {auth.error ? <p className="auth-message">{auth.error}</p> : null}
          {auth.message ? <p className="auth-message">{auth.message}</p> : null}
          {embeddedGoogleOAuthBrowser ? (
            <div className="auth-browser-warning">
              <strong>카카오톡 내 브라우저에서는 Google 로그인을 사용할 수 없습니다.</strong>
              <span>오른쪽 위 메뉴에서 다른 브라우저로 열거나, 아래 링크를 복사해 Chrome 또는 Safari에서 열어 주세요.</span>
              <div className="auth-browser-actions">
                <button type="button" onClick={copyBrowserOpenUrl}><Copy size={15} /> 링크 복사</button>
                {browserOpenUrl ? (
                  <a href={browserOpenUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> 새 창 열기</a>
                ) : null}
              </div>
              {copyMessage ? <small>{copyMessage}</small> : null}
            </div>
          ) : null}

          <div className="social-login-grid">
            {activeProviders.map((provider) => (
              <button key={provider.id} type="button" className={`provider-button provider-${provider.id}`} disabled={auth.authActionPending || auth.testLoginPending} onClick={() => signIn(provider.id)}>
                <span>{provider.mark}</span>
                {auth.configured ? `${provider.label}로 로그인` : `${provider.label} 체험 로그인`}
              </button>
            ))}
          </div>

          {!auth.session ? (
            <p className="auth-legal-note">
              로그인하면 <Link to="/terms">서비스 약관</Link>과 <Link to="/privacy">개인정보처리방침</Link>을 확인하고 동의한 것으로 봅니다.
            </p>
          ) : null}

          {auth.testLoginAllowed ? (
            <>
            <div className="auth-divider"><span>테스트 계정으로 둘러보기</span></div>
            <form className="auth-test-login" onSubmit={signInWithTestAccount}>
              <label>
                둘러볼 계정
                <select value={selectedTestLoginId} onChange={(event) => setSelectedTestLoginId(event.target.value)} disabled={auth.authActionPending || auth.testLoginPending}>
                  {auth.testAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.label}</option>
                  ))}
                </select>
              </label>
              <small>알파 테스트 기간에만 제공되며 베타 전환 시 종료됩니다.</small>
              <button type="submit" className="provider-button provider-test" disabled={auth.authActionPending || auth.testLoginPending}>
                <span>T</span>
                {auth.testLoginPending ? "로그인 중..." : "테스트 계정으로 입장"}
              </button>
            </form>
            </>
          ) : null}

          {auth.session ? (
            <>
              <Button type="button" onClick={enterApp}>
              앱으로 들어가기 <ArrowRight size={18} />
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate(`/app/signup?redirect=${encodeURIComponent(from)}`)}>
                가입 정보 설정
              </Button>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
