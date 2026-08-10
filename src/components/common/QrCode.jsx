import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createQrPath } from "../../lib/qrCode.js";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import Button from "./Button.jsx";

function QrGraphic({ qr, label, className = "" }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

export default function QrCode({ value, label = "QR 코드", className = "", expandable = false }) {
  const qr = useMemo(() => (value ? createQrPath(value) : null), [value]);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);

  useBodyScrollLock(expanded);

  useEffect(() => {
    if (!expanded) return undefined;
    restoreFocusRef.current = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector("button:not([disabled])")?.focus();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
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
      const target = restoreFocusRef.current;
      if (target instanceof window.HTMLElement && target.isConnected) target.focus();
    };
  }, [expanded]);

  if (!qr) return null;
  if (!expandable) return <QrGraphic qr={qr} label={label} className={className} />;

  return (
    <>
      <button
        type="button"
        className="ui-qr-expand-trigger"
        aria-label={`${label} 확대`}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
      >
        <QrGraphic qr={qr} label={label} className={className} />
      </button>
      {expanded && typeof document !== "undefined" ? createPortal(
        <div className="ui-qr-expand-backdrop" role="presentation" onMouseDown={() => setExpanded(false)}>
          <div
            ref={dialogRef}
            className="ui-qr-expand-dialog ui-modal-shell"
            role="dialog"
            aria-modal="true"
            aria-label={`${label} 확대 보기`}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <QrGraphic qr={qr} label={label} className="ui-qr-expanded-code" />
            <small>참가자가 카메라로 스캔하세요.</small>
            <Button type="button" size="sm" variant="secondary" onClick={() => setExpanded(false)}>닫기</Button>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
