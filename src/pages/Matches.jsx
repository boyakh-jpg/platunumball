import useMatchesPageController from "./useMatchesPageController.jsx";
import MatchesPageView from "./MatchesPageView.jsx";
import "../styles/recruiting-arena.css";
import "../styles/matches-arena.css";
import "../styles/match-list-card.css";
export { matchesRecruitingScheduleDate, matchesScheduleRelation, getMatchRoomPost } from "./matchesPageSelectors.js";
export { MatchRoomModal } from "./MatchesPagePanels.jsx";

export default function Matches(props) {
  const controller = useMatchesPageController(props);
  return <MatchesPageView controller={controller} />;
}
