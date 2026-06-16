import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, LogOut, ShieldCheck } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";

const providers = [
  { id: "naver", label: "Naver", mark: "N" },
  { id: "kakao", label: "Kakao", mark: "K" },
  { id: "google", label: "Google", mark: "G" },
];

export default function Login({ auth, app }) {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname && location.state.from.pathname !== "/login" ? location.state.from.pathname : "/app";
  const activeProviders = auth.configured ? providers.filter((provider) => provider.id === "google") : providers;

  const enterApp = () => navigate(from, { replace: true });
  const signIn = async (providerId) => {
    const nextSession = await auth.signInWithProvider(providerId);
    if (nextSession) enterApp();
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

          <div className="social-login-grid">
            {activeProviders.map((provider) => (
              <button key={provider.id} type="button" className={`provider-button provider-${provider.id}`} onClick={() => signIn(provider.id)}>
                <span>{provider.mark}</span>
                {auth.configured ? `${provider.label} OAuth` : `${provider.label} demo`}
              </button>
            ))}
          </div>

          {auth.session ? (
            <Button type="button" onClick={enterApp}>
              앱으로 들어가기 <ArrowRight size={18} />
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
