import { Fragment } from "react";
import { UsersRound } from "lucide-react";
import { getPickupParticipants } from "../../lib/roomFlow.js";

export default function PickupParticipantPool({
  lobby,
  capacity = 0,
  assignmentMode = false,
  renderParticipant,
  renderEmptySlot,
}) {
  const participants = getPickupParticipants(lobby);
  const safeCapacity = Math.max(participants.length, Number(capacity) || 0);
  const openSlotCount = Math.max(0, safeCapacity - participants.length);
  return (
    <section className="arena-side-roster pickup-participant-pool" aria-label={assignmentMode ? "출석 및 팀 배정 대상" : "픽업 참가자"}>
      <header>
        <div>
          <span><UsersRound size={17} /> {assignmentMode ? "배정 대상" : "참가자"}</span>
          <strong>{participants.length}/{safeCapacity || "-"}</strong>
        </div>
      </header>
      <div className="arena-room-slot-row pickup-room-slot-grid">
        {participants.map((participant, index) => (
          <Fragment key={participant.playerId}>
            {renderParticipant?.({ ...participant, index })}
          </Fragment>
        ))}
        {Array.from({ length: openSlotCount }).map((_item, index) => (
          <Fragment key={`pickup-empty-${index}`}>
            {renderEmptySlot?.({ index })}
          </Fragment>
        ))}
      </div>
      <small className="pickup-participant-helper">
        {assignmentMode ? "출석 확인 후 팀과 교대 순서를 정합니다." : "팀은 경기 시작 전 출석 확인 후 정합니다."}
      </small>
    </section>
  );
}
