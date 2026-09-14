import { Children, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import Button from "../common/Button.jsx";

export default function AdminWorkbench({ children, className = "", pending = false }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const detailRef = useRef(null);
  const backRef = useRef(null);
  const originRef = useRef(null);
  const [list, detail] = Children.toArray(children);

  useEffect(() => {
    // CSS owns the breakpoint; desktop keeps both panes and its current focus.
    if (detailOpen && backRef.current?.offsetParent !== null) {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: "start" });
    } else if (!detailOpen && originRef.current) {
      originRef.current.button.focus({ preventScroll: true });
      window.scrollTo({ top: originRef.current.scrollY, behavior: "instant" });
      originRef.current = null;
    }
  }, [detailOpen]);

  function openDetail(event) {
    const button = event.target.closest("button[data-admin-item]");
    if (!button || button.disabled || pending) return;
    originRef.current = { button, scrollY: window.scrollY };
    setDetailOpen(true);
  }

  return (
    <div className={`ui-admin-workbench ${detailOpen ? "is-detail-open" : ""} ${className}`.trim()}>
      <div className="ui-admin-workbench__list" onClickCapture={openDetail}>{list}</div>
      <div className="ui-admin-workbench__detail" ref={detailRef} tabIndex={-1} role="region" aria-label="선택한 항목 상세">
        <div className="ui-admin-workbench__back" ref={backRef}>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setDetailOpen(false)}><ArrowLeft size={16} />목록으로</Button>
        </div>
        {detail}
      </div>
    </div>
  );
}
