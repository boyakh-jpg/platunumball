import { useEffect } from "react";

export const IMAGE_CONTEXT_MENU_ALLOW_ATTRIBUTE = "data-allow-image-context-menu";

export function getProtectedImageTarget(target) {
  if (typeof target?.closest !== "function") return null;
  const image = target.closest("img");
  if (!image || image.getAttribute?.(IMAGE_CONTEXT_MENU_ALLOW_ATTRIBUTE) === "true") return null;
  return image;
}

export default function useImageInteractionGuard() {
  useEffect(() => {
    const preventImageNativeAction = (event) => {
      if (getProtectedImageTarget(event.target)) event.preventDefault();
    };

    document.addEventListener("contextmenu", preventImageNativeAction, true);
    document.addEventListener("dragstart", preventImageNativeAction, true);

    return () => {
      document.removeEventListener("contextmenu", preventImageNativeAction, true);
      document.removeEventListener("dragstart", preventImageNativeAction, true);
    };
  }, []);
}
