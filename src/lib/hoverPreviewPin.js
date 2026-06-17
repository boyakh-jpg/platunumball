const HOVER_PREVIEW_PIN_EVENT = "rankball:hover-preview-pin";

let pinnedHoverPreviewKey = null;

function emitPinnedHoverPreview() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HOVER_PREVIEW_PIN_EVENT, { detail: pinnedHoverPreviewKey }));
}

export function getPinnedHoverPreviewKey() {
  return pinnedHoverPreviewKey;
}

export function pinHoverPreview(key) {
  if (!key) return;
  pinnedHoverPreviewKey = key;
  emitPinnedHoverPreview();
}

export function clearPinnedHoverPreview(key) {
  if (!key) return;
  if (key && pinnedHoverPreviewKey !== key) return;
  pinnedHoverPreviewKey = null;
  emitPinnedHoverPreview();
}

export function subscribePinnedHoverPreview(listener) {
  if (typeof window === "undefined") return () => {};

  const handleChange = (event) => listener(event.detail ?? null);
  window.addEventListener(HOVER_PREVIEW_PIN_EVENT, handleChange);

  return () => window.removeEventListener(HOVER_PREVIEW_PIN_EVENT, handleChange);
}
