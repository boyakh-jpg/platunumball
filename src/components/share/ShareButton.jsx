import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Check, Image, Share2 } from "lucide-react";
import Button from "../common/Button.jsx";
import { getAppShareUrl, getPromotionShareText, SHARE_FEEDBACK, shareLink } from "../../lib/sharing.js";

const ShareImagePanel = lazy(() => import("./ShareImagePanel.jsx"));

export default function ShareButton({ path, title, text, promotion, label = "공유", className = "", variant = "secondary", size = "sm" }) {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const panelId = useId();
  const pendingRef = useRef(false);
  const timerRef = useRef(null);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const url = getAppShareUrl(path);
  const shareText = promotion ? getPromotionShareText({ ...promotion, title }) : text;
  const fallbackText = promotion ? [shareText, url].filter(Boolean).join("\n\n") : url;
  const feedback = promotion && status === "copied"
    ? "안내 문구와 링크를 복사했어요. 단체 채팅방에 붙여넣어 주세요."
    : promotion && status === "failed"
      ? "복사하지 못했어요. 아래 문구와 링크를 직접 복사해 주세요."
      : SHARE_FEEDBACK[status] || "";
  const share = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setStatus("");
    window.clearTimeout(timerRef.current);
    try {
      const result = await shareLink({ title, text: shareText, url }, { fallbackText });
      setStatus(result);
      if (result !== "failed") timerRef.current = window.setTimeout(() => setStatus(""), 4000);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="ui-share-control">
      <Button touchFriendly size={size} variant={variant} className={className} disabled={pending || !path} aria-label={label} aria-busy={pending} onClick={share}>
        {status === "copied" ? <Check size={16} /> : <Share2 size={16} />}
        {label}
      </Button>
      {promotion ? (
        <Button touchFriendly size={size} variant="secondary" disabled={!path} aria-expanded={imageOpen} aria-controls={panelId} onClick={() => setImageOpen((open) => !open)}>
          <Image size={16} /> 공유 이미지
        </Button>
      ) : null}
      <span className="ui-share-feedback" role="status">{feedback}</span>
      {status === "failed" ? (
        promotion
          ? <textarea aria-label="공유 문구와 링크" readOnly rows={6} value={fallbackText} onFocus={(event) => event.target.select()} />
          : <input aria-label="공유 링크" readOnly value={url} onFocus={(event) => event.target.select()} />
      ) : null}
      {promotion && imageOpen ? (
        <div id={panelId} className="ui-share-panel">
          <Suspense fallback={<p className="ui-share-feedback" role="status">공유 이미지를 준비하고 있어요.</p>}>
            <ShareImagePanel content={JSON.stringify({ ...promotion, title, url })} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
