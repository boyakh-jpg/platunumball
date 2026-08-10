import { X } from "lucide-react";
import Badge from "../common/Badge.jsx";
import Button from "../common/Button.jsx";

export function RecruitingRoomLoadFailedView({
  onClose,
  onRetry = null,
  retrying = false,
  title = "방을 불러올 수 없음",
  description = "방이 닫혔거나 권한이 없거나 잠시 응답이 비었습니다.",
}) {
  return (
    <div className="arena-modal-backdrop arena-room-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="arena-room-modal ui-room-borderless-scope" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="arena-modal-status-row">
          <Badge tone="orange">ROOM LOAD</Badge>
          <button type="button" className="arena-icon-button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        </div>
        <h2 className="arena-room-title">{title}</h2>
        <p className="arena-room-subtitle">{description}</p>
        <div className="arena-modal-close-row">
          <Button type="button" variant="secondary" size="lg" disabled={retrying} onClick={onClose}>방 닫기</Button>
          {onRetry ? <Button type="button" size="lg" disabled={retrying} onClick={onRetry}>{retrying ? "다시 불러오는 중" : "다시 시도"}</Button> : null}
        </div>
      </aside>
    </div>
  );
}
