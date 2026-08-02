import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Button from "../common/Button.jsx";

export const MATCH_VOID_REASON_MIN_LENGTH = 10;
export const MATCH_VOID_REASON_MAX_LENGTH = 500;

export function MatchFinalizeDialog({
  open,
  pending = false,
  error = "",
  openDisputeCount = 0,
  authorityLabel = "방장",
  onClose,
  onConfirm,
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const blocked = openDisputeCount > 0 || !acknowledged;

  return createPortal(
    <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !pending && onClose?.()}>
      <form
        className="app-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-finalize-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked && !pending) onConfirm?.({ disputesAcknowledged: true });
        }}
      >
        <strong id="match-finalize-dialog-title">더 이상 이의가 없음을 확인하셨나요?</strong>
        <p>
          {blocked
            ? `열린 이의신청 ${openDisputeCount}건을 먼저 처리해 주세요.`
            : `${authorityLabel}이 현장 참가자들과 최종 점수를 확인한 뒤 승인합니다.`}
        </p>
        <label className="match-void-acknowledgement">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>열린 이의가 없고 현장 최종 점수를 확인했습니다.</span>
        </label>
        {error ? <small role="status" className="form-warning">{error}</small> : null}
        <div className="ui-action-row app-confirm-actions">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>취소</Button>
          <Button type="submit" disabled={blocked || pending}>
            {pending ? "승인 중" : "최종 승인"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export default function MatchVoidDialog({ open, pending = false, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setAcknowledged(false);
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const safeReason = reason.trim();
  const canSubmit = safeReason.length >= MATCH_VOID_REASON_MIN_LENGTH && acknowledged && !pending;

  return createPortal(
    <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !pending && onClose?.()}>
      <form
        className="app-confirm-dialog match-void-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-void-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onConfirm?.(safeReason);
        }}
      >
        <strong id="match-void-dialog-title">경기 무효 처리</strong>
        <p>경기 기록과 MMR 반영이 중단되며, 방장 신뢰도가 차감됩니다. 참가자는 관리자에게 복구 심사를 요청할 수 있습니다.</p>
        <label className="memo-label">
          무효 사유
          <textarea
            autoFocus
            value={reason}
            minLength={MATCH_VOID_REASON_MIN_LENGTH}
            maxLength={MATCH_VOID_REASON_MAX_LENGTH}
            placeholder="참가자가 이해할 수 있도록 10자 이상 작성"
            onChange={(event) => setReason(event.target.value)}
          />
          <small>{safeReason.length}/{MATCH_VOID_REASON_MAX_LENGTH}</small>
        </label>
        <label className="match-void-acknowledgement">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>경기 전체를 무효 처리하는 강한 조치임을 확인했습니다.</span>
        </label>
        <div className="ui-action-row app-confirm-actions">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>취소</Button>
          <Button type="submit" className="danger-button" disabled={!canSubmit}>{pending ? "처리 중" : "경기 무효 처리"}</Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
