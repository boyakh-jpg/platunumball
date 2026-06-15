import { X } from "lucide-react";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import Button from "./Button.jsx";

export default function Modal({ open, title, children, onClose }) {
  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}
