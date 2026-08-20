import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createQrPath } from "../../lib/qrCode.js";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import Button from "./Button.jsx";
import ModalShell from "./ModalShell.jsx";

const BRANDED_QR_ACCENT = "#d4582b";

function QrGraphic({ qr, label, className = "", branded = false }) {
  const badgeClearSize = 5;
  const badgeSize = 5;
  const badgeStart = Math.floor((qr.matrix.length - badgeClearSize) / 2);
  const finderCenterPositions = [
    [6, 6],
    [qr.size - 9, 6],
    [6, qr.size - 9],
  ];

  return (
    <svg
      className={className}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      shapeRendering={branded ? "geometricPrecision" : "crispEdges"}
    >
      {branded ? null : <rect width={qr.size} height={qr.size} fill="#fff" />}
      {branded ? (
        <g fill="#111" aria-hidden="true">
          {qr.matrix.flatMap((row, rowIndex) => row.map((dark, columnIndex) => {
            const isBadgeModule = rowIndex >= badgeStart && rowIndex < badgeStart + badgeClearSize
              && columnIndex >= badgeStart && columnIndex < badgeStart + badgeClearSize;
            return dark && !isBadgeModule ? (
            <rect
              key={`${rowIndex}-${columnIndex}`}
              x={columnIndex + qr.offset + 0.03}
              y={rowIndex + qr.offset + 0.03}
              width="0.94"
              height="0.94"
              rx="0.18"
            />
            ) : null;
          }))}
        </g>
      ) : <path d={qr.path} fill="#111" stroke="#111" strokeWidth="0.1" strokeLinejoin="round" />}
      {branded ? (
        <g aria-hidden="true">
          {finderCenterPositions.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" rx="0.45" fill={BRANDED_QR_ACCENT} />
          ))}
          <g transform={`translate(${badgeStart + qr.offset} ${badgeStart + qr.offset})`}>
            <rect width={badgeSize} height={badgeSize} rx="0.8" fill={BRANDED_QR_ACCENT} />
            <path
              d="M1.7 1.3V3.7M1.7 1.3H2.5C3.02 1.3 3.3 1.52 3.3 1.9C3.3 2.28 3.02 2.5 2.5 2.5H1.7M1.7 2.5H2.58C3.14 2.5 3.45 2.72 3.45 3.1C3.45 3.48 3.14 3.7 2.58 3.7H1.7"
              fill="none"
              stroke="#fff3df"
              strokeWidth="0.58"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      ) : null}
    </svg>
  );
}

export default function QrCode({ value, label = "QR 코드", className = "", expandable = false, branded = false }) {
  const qr = useMemo(() => (value ? createQrPath(value) : null), [value]);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);

  useBodyScrollLock(expanded);

  useLayoutEffect(() => {
    if (!expanded) return undefined;
    restoreFocusRef.current = document.activeElement;
    dialogRef.current?.querySelector("button:not([disabled])")?.focus();
    return () => {
      const target = restoreFocusRef.current;
      if (target instanceof window.HTMLElement && target.isConnected) target.focus();
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return undefined;
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
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  if (!qr) return null;
  if (!expandable) return <QrGraphic qr={qr} label={label} className={className} branded={branded} />;

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
        <QrGraphic qr={qr} label={label} className={className} branded={branded} />
      </button>
      {expanded && typeof document !== "undefined" ? createPortal(
        <div className="ui-qr-expand-backdrop" role="presentation" onMouseDown={() => setExpanded(false)}>
          <ModalShell
            as="div"
            ref={dialogRef}
            className="ui-qr-expand-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${label} 확대 보기`}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <QrGraphic qr={qr} label={label} className="ui-qr-expanded-code" branded={branded} />
            <small>참가자가 카메라로 스캔하세요.</small>
            <Button type="button" size="sm" variant="secondary" onClick={() => setExpanded(false)}>닫기</Button>
          </ModalShell>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
