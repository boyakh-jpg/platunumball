import { RecruitingRoomView } from "./RecruitingRoomView.jsx";
import { useRecruitingRoomController } from "./useRecruitingRoomController.js";

export { RecruitingRoomLoadFailedView } from "./RecruitingRoomStatusViews.jsx";

export function RecruitingRoomModal(props) {
  if (!props.app?.currentUser?.id) {
    return null;
  }
  return <RecruitingRoomModalReady {...props} />;
}

function RecruitingRoomModalReady(props) {
  const context = useRecruitingRoomController(props);
  if (!context) return null;
  return <RecruitingRoomView context={context} />;
}

export {
  RECRUITING_FILTER_DEBOUNCE_MS,
  RECRUITING_FILTER_PAGE_LIMIT,
  QueueRoomBoard,
  RecruitingRoomLoadingView,
  getRecruitingRoomListStatus,
  getRecruitingRoomTypeLabel,
  useDebouncedValue,
} from "./RecruitingRoomCore.jsx";

export {
  canShowRecruitingQueuePost,
  isExpiredInstantRecruitingPost,
  isLocalRecruitingPost,
  isRegionRecruitingPost,
  stripRegionSuffix,
} from "./RecruitingSourceMatchPanels.jsx";
