import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Button from "../components/common/Button.jsx";
import Badge from "../components/common/Badge.jsx";
import ModalShell from "../components/common/ModalShell.jsx";
import { getSettingsActivityDetail } from "./settingsPageModel.js";

export default function SettingsActivityDialog({ detail, controller, onClose }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef(null);
  const open = Boolean(detail);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.querySelector("[data-dialog-initial-focus]")?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget instanceof window.HTMLElement && restoreTarget.isConnected) restoreTarget.focus();
    };
  }, [open]);

  if (!detail || typeof document === "undefined") return null;
  const model = getSettingsActivityDetail(detail, controller);

  return createPortal(
    <div className="app-confirm-backdrop" role="presentation" onMouseDown={onClose}>
      <ModalShell ref={dialogRef} tabIndex={-1} className="app-confirm-dialog settings-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-activity-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="section-title-row">
          <strong id="settings-activity-dialog-title">{model.title}</strong>
          <Badge tone={model.tone}>{model.status}</Badge>
        </div>
        <div className="settings-activity-detail-list">
          {model.rows.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
        <div className="ui-action-row app-confirm-actions">
          <Button data-dialog-initial-focus type="button" variant="secondary" onClick={onClose}>닫기</Button>
        </div>
      </ModalShell>
    </div>,
    document.body,
  );
}
