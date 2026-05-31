import { Navigate, Outlet, useLocation } from "react-router-dom";

export default function RequireAuth({ auth }) {
  const location = useLocation();

  if (auth.loading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">RankBall</p>
          <h1>로그인 확인 중</h1>
        </section>
      </main>
    );
  }

  if (auth.configured && !auth.session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
