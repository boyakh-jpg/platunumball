import { Link, useLocation } from "react-router-dom";
import Button from "../common/Button.jsx";
import EmptyState from "../common/EmptyState.jsx";
import { getLoginPath } from "../../lib/profileSetup.js";

export default function GuestAccessNotice({
  title,
  description,
  returnTo = "",
  showPublicMatches = true,
  className = "",
}) {
  const location = useLocation();
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  return (
    <EmptyState
      title={title}
      description={description}
      className={className}
      action={(
        <>
          <Button as={Link} to={getLoginPath(returnTo || currentPath)}>로그인</Button>
          {showPublicMatches ? <Button as={Link} to="/app/recruiting" variant="secondary">공개 매칭 보기</Button> : null}
        </>
      )}
    />
  );
}
