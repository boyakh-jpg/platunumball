import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const SHOW_SCROLL_TOP_AFTER = 700;

export default function ScrollToTop() {
  const { hash, pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [hash, pathname]);

  useEffect(() => {
    let frameId = 0;
    const updateVisibility = () => {
      frameId = 0;
      setVisible(window.scrollY >= SHOW_SCROLL_TOP_AFTER);
    };
    const handleScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateVisibility);
    };

    updateVisibility();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <button
      type="button"
      className={`scroll-to-top-button${visible ? " is-visible" : ""}`}
      aria-label="페이지 맨 위로"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={() => window.scrollTo({
        top: 0,
        left: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      })}
    >
      <ArrowUp aria-hidden="true" size={20} strokeWidth={2.5} />
    </button>
  );
}
