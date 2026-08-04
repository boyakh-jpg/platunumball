import { useEffect } from "react";
import { createPortal } from "react-dom";
import Button from "../components/common/Button.jsx";
import Badge from "../components/common/Badge.jsx";
import { getSettingsActivityDetail } from "./settingsPageModel.js";

export default function SettingsActivityDialog({ detail, controller, onClose }) {
  useEffect(() => {
    if (!detail) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detail, onClose]);

  if (!detail || typeof document === "undefined") return null;
  const model = getSettingsActivityDetail(detail, controller);

  return createPortal(
    <div className="app-confirm-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="app-confirm-dialog settings-activity-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-activity-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
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
          <Button type="button" variant="secondary" autoFocus onClick={onClose}>닫기</Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
