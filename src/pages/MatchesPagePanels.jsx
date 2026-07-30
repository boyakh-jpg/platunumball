import { Component, useEffect, useRef, useState } from "react";
import Badge from "../components/common/Badge.jsx";
import BasketballLoader from "../components/common/BasketballLoader.jsx";
import Button from "../components/common/Button.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { RecruitingRoomModal } from "./Recruiting.jsx";
import {
  requestMatchDetailOnce,
  useSelectedMatchRoom,
} from "./matchesPageModel.js";

export function RoomModalErrorView({ error, onClose, onRetry = null }) {
  return (
    <div className="arena-modal-backdrop arena-room-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="arena-room-modal ui-room-borderless-scope" role="dialog" aria-modal="true" aria-label="경기방 오류" onMouseDown={(event) => event.stopPropagation()}>
        <div className="arena-modal-status-row">
          <Badge tone="orange">경기방 오류</Badge>
        </div>
        <h2 className="arena-room-title">경기방을 열 수 없습니다</h2>
        <p className="arena-room-subtitle">경기방 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
        <div className="arena-modal-close-row">
          {onRetry ? (
            <Button type="button" size="lg" onClick={onRetry}>
              다시 시도
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>
            방 닫기
          </Button>
        </div>
      </aside>
    </div>
  );
}

export class RoomModalErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <RoomModalErrorView error={this.state.error} onClose={this.props.onClose} />;
  }
}

export function RoomModalLoadingView({ onClose }) {
  return (
    <div className="arena-modal-backdrop arena-room-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="arena-room-modal ui-room-borderless-scope" role="dialog" aria-modal="true" aria-label="경기방 불러오는 중" onMouseDown={(event) => event.stopPropagation()}>
        <BasketballLoader label="방 불러오는 중" />
        <div className="arena-modal-close-row">
          <Button type="button" variant="secondary" size="lg" onClick={onClose}>방 닫기</Button>
        </div>
      </aside>
    </div>
  );
}

export function AttendanceScanResultView({ state, onClose }) {
  const scanState = state ?? { pending: true, tone: "blue", message: "QR 출석 확인 중" };
  return (
    <div className="arena-modal-backdrop arena-room-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="arena-room-modal arena-attendance-scan-modal ui-room-borderless-scope" role="dialog" aria-modal="true" aria-label="QR 출석 결과" onMouseDown={(event) => event.stopPropagation()}>
        <div className="arena-modal-status-row">
          <Badge tone={scanState.tone ?? "blue"}>{scanState.pending ? "출석 확인 중" : "출석 결과"}</Badge>
        </div>
        <h2 className="arena-room-title">{scanState.pending ? "QR 출석 확인 중" : scanState.message}</h2>
        {!scanState.pending ? (
          <div className="arena-modal-close-row">
            <Button type="button" size="lg" onClick={onClose}>일정으로 돌아가기</Button>
          </div>
        ) : <BasketballLoader label="출석 대상 확인 중" />}
      </aside>
    </div>
  );
}

export function MatchRoomModal({
  app,
  matchId,
  onClose,
  entryPoint = "",
  contextPanel = null,
  clockClient = undefined,
  onRemake = null,
}) {
  const [selectedMatchDetailLoadingId, setSelectedMatchDetailLoadingId] = useState(null);
  const [openedMatchId, setOpenedMatchId] = useState("");
  const requestedMatchDetailsRef = useRef(new Set());
  const matchesById = app.matchEntities ?? Object.fromEntries(app.state.matches.map((match) => [match.id, match]));
  const selectedMatch = matchId ? matchesById[matchId] ?? null : null;
  const selectedMatchRoom = useSelectedMatchRoom(selectedMatch, app.state);
  const selectedMatchDetailLoading = Boolean(matchId && (app.remoteReady === false || selectedMatchDetailLoadingId === matchId || openedMatchId !== matchId));
  useBodyScrollLock(Boolean(matchId));

  useEffect(() => {
    if (!matchId) {
      requestedMatchDetailsRef.current.clear();
      setOpenedMatchId("");
      setSelectedMatchDetailLoadingId(null);
      return;
    }
    if (app.remoteReady === false || !app.currentUser.id) return;
    if (requestedMatchDetailsRef.current.has(matchId)) {
      setOpenedMatchId(matchId);
      return;
    }
    setOpenedMatchId(matchId);
    setSelectedMatchDetailLoadingId(matchId);
    requestMatchDetailOnce({
      matchId,
      requestedMatchDetails: requestedMatchDetailsRef.current,
      loadMatchDetail: app.actions.loadMatchDetail,
      onSettled: () => {
        setSelectedMatchDetailLoadingId((currentId) => currentId === matchId ? null : currentId);
      },
    });
  }, [app.actions, app.currentUser.id, app.remoteReady, matchId]);

  if (!matchId) return null;
  if (selectedMatchDetailLoading) return <RoomModalLoadingView onClose={onClose} />;
  if (selectedMatchRoom.error) return <RoomModalErrorView error={selectedMatchRoom.error} onClose={onClose} />;
  if (!selectedMatch || !selectedMatchRoom.post) {
    return <RoomModalErrorView error={new Error("경기 기록을 불러오지 못했습니다.")} onClose={onClose} />;
  }
  return (
    <RoomModalErrorBoundary key={selectedMatch.id} onClose={onClose}>
      <RecruitingRoomModal
        app={app}
        post={selectedMatchRoom.post}
        sourceMatch={selectedMatch}
        entryPoint={entryPoint}
        contextPanel={contextPanel}
        clockClient={clockClient}
        onRemake={onRemake}
        skipInitialDetailLoad
        onClose={onClose}
      />
    </RoomModalErrorBoundary>
  );
}
