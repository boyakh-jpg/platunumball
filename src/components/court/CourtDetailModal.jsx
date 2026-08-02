import { lazy, Suspense, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";

const CourtDetail = lazy(() => import("../../pages/CourtDetail.jsx"));

export default function CourtDetailModal({ app, courtId = "", open = false, onClose }) {
  const closeButtonRef = useRef(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return undefined;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open || !courtId || typeof document === "undefined") return null;

  return createPortal(
    <div className="court-detail-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="court-detail-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label="구장 상세 정보"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="button ui-button button-secondary ui-button-secondary button-sm ui-button-sm button-icon court-detail-modal-close"
          title="닫기"
          aria-label="구장 정보 닫기"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <div className="court-detail-modal-scroll">
          <Suspense fallback={<div className="court-detail-state">구장 정보를 불러오는 중입니다.</div>}>
            <CourtDetail app={app} courtId={courtId} embedded onClose={onClose} />
          </Suspense>
        </div>
      </section>
    </div>,
    document.body,
  );
}
