import { Component } from "react";
import { RecruitingRoomView } from "./RecruitingRoomView.jsx";
import { useRecruitingRoomController } from "./useRecruitingRoomController.js";
import { RecruitingRoomLoadFailedView } from "./RecruitingRoomStatusViews.jsx";

export { RecruitingRoomLoadFailedView } from "./RecruitingRoomStatusViews.jsx";

export function RecruitingRoomModal(props) {
  if (!props.app?.currentUser?.id) {
    return null;
  }
  return (
    <RecruitingRoomRenderBoundary
      key={props.sourceMatch?.id ?? props.post?.id ?? "room"}
      onClose={props.onClose}
      onRetry={() => props.app.actions.loadRecruitingPost?.(props.post?.id, { force: true })}
    >
      <RecruitingRoomModalReady {...props} />
    </RecruitingRoomRenderBoundary>
  );
}

class RecruitingRoomRenderBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("boxtier recruiting room render failed.", error, info);
  }

  retry = () => {
    this.setState({ failed: false });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.failed) {
      return <RecruitingRoomLoadFailedView onClose={this.props.onClose} onRetry={this.retry} />;
    }
    return this.props.children;
  }
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
