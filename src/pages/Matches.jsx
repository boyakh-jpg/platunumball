import { Link } from "react-router-dom";
import Button from "../components/common/Button.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import useMatchesPageController from "./useMatchesPageController.jsx";
import MatchesPageView from "./MatchesPageView.jsx";
import "../styles/recruiting-arena.css";
import "../styles/matches-arena.css";
import "../styles/match-list-card.css";
export { matchesRecruitingScheduleDate, matchesScheduleRelation, getMatchRoomPost } from "./matchesPageSelectors.js";
export { MatchRoomModal } from "./MatchesPagePanels.jsx";

function AuthenticatedMatches(props) {
  const controller = useMatchesPageController(props);
  return <MatchesPageView controller={controller} />;
}

export default function Matches(props) {
  if (!props.app?.demoPreview) return <AuthenticatedMatches {...props} />;
  return (
    <div className="page-stack">
      <EmptyState
        title="일정은 로그인 후 확인할 수 있습니다"
        description="로그인하면 내 참가 경기와 팀 일정을 불러옵니다."
        action={(
          <div className="ui-action-row">
            <Button as={Link} to="/login">로그인</Button>
            <Button as={Link} to="/app/recruiting" variant="secondary">공개 매칭 보기</Button>
          </div>
        )}
      />
    </div>
  );
}
