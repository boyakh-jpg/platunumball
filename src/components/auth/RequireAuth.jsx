import { Navigate, Outlet, useLocation } from "react-router-dom";
import BasketballLoader from "../common/BasketballLoader.jsx";
import { getLoginPath } from "../../lib/profileSetup.js";

export default function RequireAuth({ auth, allowGuestHome = false }) {
  const location = useLocation();

  if (auth.loading) {
    return <BasketballLoader overlay label="로그인 확인 중" />;
  }

  if (auth.configured && !auth.session && !allowGuestHome) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={getLoginPath(returnTo, returnTo)}
        replace
        state={{ from: location, authGate: true }}
      />
    );
  }

  return <Outlet />;
}
