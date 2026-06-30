import { Navigate, Outlet, useLocation } from "react-router-dom";
import BasketballLoader from "../common/BasketballLoader.jsx";

export default function RequireAuth({ auth }) {
  const location = useLocation();

  if (auth.loading) {
    return <BasketballLoader overlay label="로그인 확인 중" />;
  }

  if (auth.configured && !auth.session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
