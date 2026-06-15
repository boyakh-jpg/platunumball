import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

function getPosition(anchor, width, estimatedHeight) {
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  const gap = 10;
  const safeWidth = Math.min(width, window.innerWidth - margin * 2);
  const maxLeft = Math.max(margin, window.innerWidth - safeWidth - margin);
  const left = Math.min(Math.max(margin, rect.left), maxLeft);
  const below = rect.bottom + gap;
  const above = rect.top - estimatedHeight - gap;
  const top = below + estimatedHeight > window.innerHeight && above >= margin
    ? above
    : Math.min(below, window.innerHeight - estimatedHeight - margin);

  const maxTop = Math.max(margin, window.innerHeight - estimatedHeight - margin);

  return {
    top: Math.min(Math.max(margin, top), maxTop),
    left,
    width: safeWidth,
  };
}

export default function HoverPortal({
  anchorRef,
  open,
  className,
  children,
  width = 360,
  estimatedHeight = 280,
}) {
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    if (!open || typeof document === "undefined") {
      setPosition(null);
      return undefined;
    }

    const update = () => {
      if (!anchorRef.current) {
        setPosition(null);
        return;
      }
      setPosition(getPosition(anchorRef.current, width, estimatedHeight));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, estimatedHeight, open, width]);

  if (!open || !position || typeof document === "undefined") return null;

  return createPortal(
    <span className={className} role="tooltip" style={position}>
      {children}
    </span>,
    document.body,
  );
}
