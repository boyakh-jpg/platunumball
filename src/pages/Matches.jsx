import GuestAccessNotice from "../components/auth/GuestAccessNotice.jsx";
import useMatchesPageController from "./useMatchesPageController.jsx";
import MatchesPageView from "./MatchesPageView.jsx";
import { useSearchParams } from "react-router-dom";
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
  const [searchParams] = useSearchParams();
  if (!props.app?.demoPreview || searchParams.has("match")) return <AuthenticatedMatches {...props} />;
  return (
    <div className="page-stack">
      <GuestAccessNotice
        title="일정은 로그인 후 확인할 수 있습니다"
        description="로그인하면 내 참가 경기와 팀 일정을 불러옵니다."
      />
    </div>
  );
}
