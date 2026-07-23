import { UsersRound } from "lucide-react";
import ProfileEmblem from "../profile/ProfileEmblem.jsx";
import Button from "../common/Button.jsx";
import { getPickupParticipantIds } from "../../lib/roomFlow.js";

export default function PickupParticipantPool({ lobby, userById, capacity = 0, assignmentMode = false, onInvite = null }) {
  const participantIds = getPickupParticipantIds(lobby);
  return (
    <section className="ui-panel ui-modal-section pickup-participant-pool">
      <header className="ui-status-strip">
        <span><UsersRound size={17} /> {assignmentMode ? "출석·팀 배정 대상" : "통합 참가자 풀"}</span>
        <strong>{participantIds.length}/{capacity || "-"}</strong>
      </header>
      <div className="pickup-participant-grid">
        {participantIds.map((playerId, index) => {
          const user = userById[playerId];
          return (
            <div key={playerId} className="pickup-participant-item">
              <ProfileEmblem user={user} />
              <span><strong>{user?.name ?? "참가자"}</strong><small>{assignmentMode ? "배정 대기" : `${index + 1}번째 참가`}</small></span>
            </div>
          );
        })}
        {!participantIds.length ? <p>아직 참가자가 없습니다.</p> : null}
      </div>
      <small>{assignmentMode ? "출석을 확인한 뒤 A/B사이드와 대기 선수를 배정합니다." : "모집 중에는 A/B사이드를 나누지 않습니다."}</small>
      {!assignmentMode && onInvite ? <Button type="button" size="sm" variant="secondary" onClick={onInvite}>선수 초대</Button> : null}
    </section>
  );
}
