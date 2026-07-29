import { useCallback, useEffect, useRef, useState } from "react";
import {
  canUseHoverPreview,
  clearPinnedHoverPreview,
  getPinnedHoverPreviewKey,
  isTouchPreviewEvent,
  pinHoverPreview,
  subscribePinnedHoverPreview,
} from "../lib/hoverPreviewPin.js";
import useBodyScrollLock from "./useBodyScrollLock.js";

const LONG_PRESS_DELAY_MS = 420;

export default function useHoverCardInteraction({ cardKey, longPress = false }) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [pinnedHoverKey, setPinnedHoverKey] = useState(getPinnedHoverPreviewKey);
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressOpenedRef = useRef(false);

  useBodyScrollLock(pinnedOpen);

  const clearLongPress = useCallback(() => {
    if (!longPressTimerRef.current) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  const closePinned = useCallback(() => {
    setPinnedOpen(false);
    clearPinnedHoverPreview(cardKey);
  }, [cardKey]);

  const openPinned = useCallback(() => {
    setHoverOpen(false);
    pinHoverPreview(cardKey);
    setPinnedOpen(true);
  }, [cardKey]);

  const togglePinned = useCallback(() => {
    if (pinnedOpen) closePinned();
    else openPinned();
  }, [closePinned, openPinned, pinnedOpen]);

  const showHover = useCallback(() => {
    if (canUseHoverPreview() && !pinnedHoverKey) setHoverOpen(true);
  }, [pinnedHoverKey]);

  const hideHover = useCallback(() => setHoverOpen(false), []);

  const handlePointerDown = useCallback((event) => {
    if (!longPress || !isTouchPreviewEvent(event)) return;
    clearLongPress();
    setHoverOpen(false);
    longPressOpenedRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressOpenedRef.current = true;
      openPinned();
    }, LONG_PRESS_DELAY_MS);
  }, [clearLongPress, longPress, openPinned]);

  const consumeLongPressOpen = useCallback(() => {
    if (!longPressOpenedRef.current) return false;
    longPressOpenedRef.current = false;
    return true;
  }, []);

  const handleContextMenu = useCallback((event) => {
    if (longPress && isTouchPreviewEvent(event)) event.preventDefault();
  }, [longPress]);

  const handleDragStart = useCallback((event) => {
    if (longPress && isTouchPreviewEvent(event)) event.preventDefault();
  }, [longPress]);

  useEffect(() => subscribePinnedHoverPreview(setPinnedHoverKey), []);

  useEffect(() => {
    if (pinnedOpen && pinnedHoverKey && pinnedHoverKey !== cardKey) setPinnedOpen(false);
  }, [cardKey, pinnedHoverKey, pinnedOpen]);

  useEffect(() => () => {
    clearLongPress();
    clearPinnedHoverPreview(cardKey);
  }, [cardKey, clearLongPress]);

  useEffect(() => {
    if (!pinnedOpen) return undefined;

    const closeOutside = (event) => {
      const target = event.target;
      if (anchorRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      closePinned();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closePinned();
    };

    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closePinned, pinnedOpen]);

  return {
    anchorRef,
    cardRef,
    closePinned,
    consumeLongPressOpen,
    hideHover,
    open: pinnedOpen || (!pinnedHoverKey && canUseHoverPreview() && hoverOpen),
    openPinned,
    pinnedOpen,
    showHover,
    togglePinned,
    triggerProps: {
      onBlur: hideHover,
      onContextMenu: handleContextMenu,
      onDragStart: handleDragStart,
      onFocus: showHover,
      onMouseEnter: showHover,
      onMouseLeave: hideHover,
      onPointerCancel: clearLongPress,
      onPointerDown: handlePointerDown,
      onPointerLeave: clearLongPress,
      onPointerUp: clearLongPress,
    },
  };
}
