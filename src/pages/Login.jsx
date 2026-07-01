import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Copy, ExternalLink, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";

const providers = [
  { id: "naver", label: "Naver", mark: "N" },
  { id: "kakao", label: "Kakao", mark: "K" },
  { id: "google", label: "Google", mark: "G" },
];

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
  const from = location.state?.from?.pathname && location.state.from.pathname !== "/login" ? location.state.from.pathname : "/app";
  const activeProviders = auth.configured ? providers.filter((provider) => provider.id === "google") : providers;
  const embeddedOAuthBrowser = auth.configured && isEmbeddedOAuthBrowser();
  const browserOpenUrl = typeof window === "undefined" ? "" : `${window.location.origin}/app`;

  const enterApp = () => navigate(from, { replace: true });
  const signIn = async (providerId) => {
    if (providerId === "google" && embeddedOAuthBrowser) {
      setCopyMessage("카톡 안에서는 Google 로그인이 막힙니다. 링크를 복사해서 Chrome/Safari에서 열어주세요.");
      return;
    }
    const nextSession = await auth.signInWithProvider(providerId);
    if (nextSession) enterApp();
  };
  const signInWithTestAccount = async () => {
    const nextSession = await auth.signInWithTestAccount(selectedTestLoginId);
    if (nextSession) enterApp();
  };
  const copyBrowserOpenUrl = async () => {
    if (!browserOpenUrl || !navigator.clipboard) {
      setCopyMessage("주소창의 URL을 복사해서 Chrome/Safari에서 열어주세요.");
      return;
    }
    await navigator.clipboard.writeText(browserOpenUrl);
    setCopyMessage("링크 복사됨. Chrome/Safari 주소창에 붙여넣어 주세요.");
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-card-head">
          <Link to="/" className="brand auth-brand">
            <span className="brand-mark">R</span>
            <span>
              <strong>RankBall</strong>
              <small>street court ladder</small>
            </span>
          </Link>
          <Badge tone={auth.session ? "green" : "blue"}>{auth.session ? "로그인됨" : auth.configured ? "Supabase Auth" : "Demo login"}</Badge>
        </div>

        <div className="auth-form">
          <div>
            <p className="eyebrow">Sign in</p>
            <h1>소셜 계정으로 시작</h1>
          </div>

          {auth.session ? (
            <div className="auth-session-line">
              <ShieldCheck size={18} />
              <span>{auth.user.user_metadata?.providerName ?? auth.user.email} 로그인됨</span>
              <button type="button" onClick={auth.signOut}><LogOut size={16} /> 로그아웃</button>
            </div>
          ) : null}

          {auth.error ? <p className="auth-message">{auth.error}</p> : null}
          {auth.message ? <p className="auth-message">{auth.message}</p> : null}
          {embeddedOAuthBrowser ? (
            <div className="auth-browser-warning">
              <strong>카톡 브라우저에서는 Google 로그인이 막힙니다.</strong>
              <span>오른쪽 위 메뉴에서 다른 브라우저로 열거나, 아래 링크를 복사해서 Chrome/Safari에서 열어주세요.</span>
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
              <button key={provider.id} type="button" className={`provider-button provider-${provider.id}`} onClick={() => signIn(provider.id)}>
                <span>{provider.mark}</span>
                {auth.configured ? `${provider.label} OAuth` : `${provider.label} demo`}
              </button>
            ))}
          </div>

          {auth.testLoginAllowed ? (
            <>
            <div className="auth-divider"><span>테스트 계정으로 둘러보기</span></div>
            <div className="auth-test-login">
              <label>
                둘러볼 계정
                <select value={selectedTestLoginId} onChange={(event) => setSelectedTestLoginId(event.target.value)}>
                  {auth.testAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.label}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="provider-button provider-test" onClick={signInWithTestAccount}>
                <span>T</span>
                테스트 계정으로 입장
              </button>
            </div>
            </>
          ) : null}

          {auth.session ? (
            <>
              <Button type="button" onClick={enterApp}>
              앱으로 들어가기 <ArrowRight size={18} />
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate("/app/signup")}>
                가입 정보 설정
              </Button>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
