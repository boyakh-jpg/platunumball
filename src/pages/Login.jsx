import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, LogIn, LogOut, ShieldCheck, UserRound } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";

export default function Login({ auth, app }) {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname && location.state.from.pathname !== "/login" ? location.state.from.pathname : "/app";
  const [email, setEmail] = useState(auth.user?.email ?? "");
  const [selectedUserId, setSelectedUserId] = useState(app.currentUserId ?? app.state.users[0]?.id ?? "");

  const selectedUser = useMemo(
    () => app.state.users.find((user) => user.id === selectedUserId) ?? app.state.users[0],
    [app.state.users, selectedUserId],
  );
  const sortedUsers = useMemo(
    () => [...app.state.users].sort((a, b) => Number(b.region === app.currentUser.region) - Number(a.region === app.currentUser.region) || b.ratings.integrated - a.ratings.integrated),
    [app.currentUser.region, app.state.users],
  );

  const submitEmail = (event) => {
    event.preventDefault();
    if (email.trim()) auth.signInWithEmail(email.trim());
  };

  const enterWithProfile = () => {
    app.actions.switchUser(selectedUserId);
    navigate(from, { replace: true });
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
          <Badge tone={auth.session ? "green" : "blue"}>{auth.session ? "세션 연결됨" : "로그인 필요"}</Badge>
        </div>

        {!auth.session ? (
          <form className="auth-form" onSubmit={submitEmail}>
            <div>
              <p className="eyebrow">Sign in</p>
              <h1>이메일로 로그인</h1>
            </div>
            <label>
              이메일
              <input type="email" autoComplete="email" value={email} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} />
            </label>
            {auth.error ? <p className="form-warning">{auth.error}</p> : null}
            {auth.message ? <p className="form-help auth-message">{auth.message}</p> : null}
            <Button type="submit" disabled={!auth.configured || !email.trim()}>
              <LogIn size={18} /> 로그인 링크 받기
            </Button>
            {!auth.configured ? <p className="form-warning">Supabase Auth 환경변수가 없어 로그인 링크를 보낼 수 없습니다.</p> : null}
          </form>
        ) : (
          <div className="auth-form">
            <div>
              <p className="eyebrow">Profile</p>
              <h1>플레이어 선택</h1>
            </div>
            <div className="auth-session-line">
              <ShieldCheck size={18} />
              <span>{auth.user.email}</span>
              <button type="button" onClick={auth.signOut}><LogOut size={16} /> 로그아웃</button>
            </div>
            <label>
              RankBall 프로필
              <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                {sortedUsers.map((user) => (
                  <option key={user.id} value={user.id}>{user.name} · {user.region} · {user.position} · {user.ratings.integrated}</option>
                ))}
              </select>
            </label>
            {selectedUser ? (
              <div className="auth-profile-preview">
                <span className="avatar" style={{ "--avatar": selectedUser.avatarColor }}>{selectedUser.name.slice(0, 1)}</span>
                <div>
                  <strong>{selectedUser.name}</strong>
                  <span>{selectedUser.region} · {selectedUser.position}</span>
                </div>
                <TierBadge mmr={selectedUser.ratings.integrated} compact />
              </div>
            ) : null}
            <Button type="button" onClick={enterWithProfile}>
              <UserRound size={18} /> 이 프로필로 시작 <ArrowRight size={18} />
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
