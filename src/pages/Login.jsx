import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, LogOut, ShieldCheck } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";

const providers = [
  { id: "naver", label: "네이버", mark: "N" },
  { id: "kakao", label: "카카오", mark: "K" },
  { id: "google", label: "구글", mark: "G" },
];

export default function Login({ auth, app }) {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname && location.state.from.pathname !== "/login" ? location.state.from.pathname : "/app";

  const enterApp = () => navigate(from, { replace: true });
  const signIn = async (providerId) => {
    await auth.signInWithTestProvider(providerId);
    enterApp();
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
          <Badge tone={auth.session ? "green" : "blue"}>{auth.session ? "테스트 세션" : "소셜 로그인"}</Badge>
        </div>

        <div className="auth-form">
          <div>
            <p className="eyebrow">Sign in</p>
            <h1>소셜 계정으로 시작</h1>
          </div>
          <p className="muted">테스트 단계라 실제 OAuth 연결 없이 버튼을 누르면 바로 앱으로 들어갑니다.</p>

          {auth.session ? (
            <div className="auth-session-line">
              <ShieldCheck size={18} />
              <span>{auth.user.user_metadata?.providerName ?? auth.user.email} 테스트 로그인됨</span>
              <button type="button" onClick={auth.signOut}><LogOut size={16} /> 로그아웃</button>
            </div>
          ) : null}

          <div className="social-login-grid">
            {providers.map((provider) => (
              <button key={provider.id} type="button" className={`provider-button provider-${provider.id}`} onClick={() => signIn(provider.id)}>
                <span>{provider.mark}</span>
                {provider.label}로 로그인하기
              </button>
            ))}
          </div>

          {auth.session ? (
            <Button type="button" onClick={enterApp}>
              앱으로 들어가기 <ArrowRight size={18} />
            </Button>
          ) : null}
          <p className="form-help">현재 플레이어는 {app.currentUser.name}으로 시작합니다. 다른 플레이어 테스트는 설정에서 전환할 수 있습니다.</p>
        </div>
      </section>
    </main>
  );
}
