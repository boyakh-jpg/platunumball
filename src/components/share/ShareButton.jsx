import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Image, Share2, X } from "lucide-react";
import Button from "../common/Button.jsx";
import { copyTextToClipboard, getAppShareUrl, getPromotionShareText, SHARE_FEEDBACK, shareLink } from "../../lib/sharing.js";

const ShareImagePanel = lazy(() => import("./ShareImagePanel.jsx"));

function ShareOptions({ title, url, shareText, promotion }) {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const imageId = useId();
  const pendingRef = useRef(false);
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);
  const canSend = typeof globalThis.navigator?.share === "function";
  const copyText = promotion ? [shareText, url].filter(Boolean).join("\n\n") : url;
  const feedback = promotion && status === "copied"
    ? "안내 문구와 링크를 복사했어요. 단체 채팅방에 붙여넣어 주세요."
    : promotion && status === "copyFailed"
      ? "복사하지 못했어요. 위 문구와 링크를 직접 선택해 복사해 주세요."
      : SHARE_FEEDBACK[status] || "";
  const runAction = async (action) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(action);
    setStatus("");
    try {
      const result = action === "copy"
        ? await copyTextToClipboard(copyText) ? "copied" : "copyFailed"
        : await shareLink({ title, text: shareText, url });
      if (activeRef.current) setStatus(result);
    } catch {
      if (activeRef.current) setStatus(action === "copy" ? "copyFailed" : "failed");
    } finally {
      pendingRef.current = false;
      if (activeRef.current) setPending("");
    }
  };

  return (
    <>
      {promotion
        ? <textarea aria-label="공유 문구와 링크" readOnly rows={6} value={copyText} onFocus={(event) => event.target.select()} />
        : <input aria-label="공유 링크" readOnly value={url} onFocus={(event) => event.target.select()} />}
      <div className="ui-action-row" data-align="start">
        {canSend ? (
          <Button touchFriendly disabled={Boolean(pending)} aria-busy={pending === "share"} onClick={() => runAction("share")}>
            <Share2 size={16} /> 앱으로 보내기
          </Button>
        ) : null}
        <Button touchFriendly variant={canSend ? "secondary" : "primary"} disabled={Boolean(pending)} aria-busy={pending === "copy"} onClick={() => runAction("copy")}>
          {status === "copied" ? <Check size={16} /> : <Copy size={16} />}
          {promotion ? "문구와 링크 복사" : "링크 복사"}
        </Button>
        {promotion ? (
          <Button touchFriendly variant="secondary" disabled={Boolean(pending)} aria-expanded={imageOpen} aria-controls={imageId} onClick={() => setImageOpen((open) => !open)}>
            <Image size={16} /> 이미지로 공유
          </Button>
        ) : null}
      </div>
      <span className="ui-share-feedback" role="status">{feedback}</span>
      {promotion && imageOpen ? (
        <div id={imageId}>
          <Suspense fallback={<p className="ui-share-feedback" role="status">공유 이미지를 준비하고 있어요.</p>}>
            <ShareImagePanel content={JSON.stringify({ ...promotion, title, url })} />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}

export default function ShareButton({ path, title, text, promotion, label = "공유", className = "", variant = "secondary", size = "sm" }) {
  const [open, setOpen] = useState(false);
  const controlRef = useRef(null);
  const panelId = useId();
  const url = getAppShareUrl(path);
  const shareText = promotion ? getPromotionShareText({ ...promotion, title }) : text;
  const close = () => {
    setOpen(false);
    controlRef.current?.querySelector("button")?.focus();
  };

  return (
    <div className="ui-share-control" ref={controlRef} onKeyDown={(event) => {
      if (open && event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    }}>
      <Button touchFriendly size={size} variant={variant} className={className} disabled={!path} aria-label={label} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        <Share2 size={16} /> {label}
      </Button>
      {open && path ? (
        <section id={panelId} className="ui-share-panel" aria-label={`${label} 방법`}>
          <div className="ui-share-panel-header">
            <strong className="ui-share-preview-title">보낼 내용</strong>
            <Button touchFriendly size="sm" variant="secondary" aria-label="공유 닫기" onClick={close}>
              <X size={16} /> 닫기
            </Button>
          </div>
          <ShareOptions key={JSON.stringify([title, url, shareText, promotion])} title={title} url={url} shareText={shareText} promotion={promotion} />
        </section>
      ) : null}
    </div>
  );
}
