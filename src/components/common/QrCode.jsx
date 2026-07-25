import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createQrPath } from "../../lib/qrCode.js";
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

  useEffect(() => {
    if (!expanded) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
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
            className="ui-qr-expand-dialog ui-modal-shell"
            role="dialog"
            aria-modal="true"
            aria-label={`${label} 확대 보기`}
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
