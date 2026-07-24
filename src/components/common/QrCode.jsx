import { useMemo } from "react";
import { createQrPath } from "../../lib/qrCode.js";

export default function QrCode({ value, label = "QR 코드", className = "" }) {
  const qr = useMemo(() => (value ? createQrPath(value) : null), [value]);
  if (!qr) return null;
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
