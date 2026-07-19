import { useEffect } from "react";

let lockCount = 0;
let previousOverflow = "";
let previousPaddingRight = "";
let hadLockClass = false;

export default function useBodyScrollLock(locked) {
  useEffect(() => {
    if (!locked || typeof document === "undefined") return undefined;

    const body = document.body;

    if (lockCount === 0) {
      previousOverflow = body.style.overflow;
      previousPaddingRight = body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      const stableScrollbarGutter = window.getComputedStyle(document.documentElement).scrollbarGutter.includes("stable");
      hadLockClass = body.classList.contains("rankball-scroll-locked");
      body.classList.add("rankball-scroll-locked");
      body.style.overflow = "hidden";
      if (scrollbarWidth > 0 && !stableScrollbarGutter) body.style.paddingRight = `${scrollbarWidth}px`;
    }

    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        body.style.overflow = previousOverflow;
        body.style.paddingRight = previousPaddingRight;
        if (!hadLockClass) body.classList.remove("rankball-scroll-locked");
      }
    };
  }, [locked]);
}
