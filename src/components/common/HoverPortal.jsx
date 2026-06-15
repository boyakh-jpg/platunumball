import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function getPosition(anchor, width, cardHeight) {
  const rect = anchor.getBoundingClientRect();
  const margin = 12;
  const gap = 10;
  const safeWidth = Math.min(width, window.innerWidth - margin * 2);
  const maxLeft = Math.max(margin, window.innerWidth - safeWidth - margin);
  const left = Math.min(Math.max(margin, rect.left), maxLeft);
  const safeHeight = Math.min(cardHeight, window.innerHeight - margin * 2);
  const belowSpace = window.innerHeight - rect.bottom - gap - margin;
  const aboveSpace = rect.top - gap - margin;
  const placeAbove = belowSpace < safeHeight && aboveSpace > belowSpace;
  const availableSpace = Math.max(0, placeAbove ? aboveSpace : belowSpace);
  const maxHeight = Math.min(window.innerHeight - margin * 2, availableSpace);
  const visibleHeight = Math.min(safeHeight, maxHeight);
  const top = placeAbove
    ? rect.top - gap - visibleHeight
    : Math.min(rect.bottom + gap, window.innerHeight - visibleHeight - margin);

  return {
    top: Math.max(margin, top),
    left,
    maxHeight,
    width: safeWidth,
  };
}

function isSamePosition(a, b) {
  return a &&
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.maxHeight) === Math.round(b.maxHeight);
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
  const cardRef = useRef(null);

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
      const measuredHeight = cardRef.current?.getBoundingClientRect().height || estimatedHeight;
      const nextPosition = getPosition(anchorRef.current, width, measuredHeight);
      setPosition((current) => (isSamePosition(current, nextPosition) ? current : nextPosition));
    };

    update();
    const frameId = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, estimatedHeight, open, width]);

  if (!open || !position || typeof document === "undefined") return null;

  return createPortal(
    <span ref={cardRef} className={className} role="tooltip" style={position}>
      {children}
    </span>,
    document.body,
  );
}
