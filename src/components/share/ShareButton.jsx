import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";
import Button from "../common/Button.jsx";
import { getAppShareUrl, SHARE_FEEDBACK, shareLink } from "../../lib/sharing.js";

export default function ShareButton({ path, title, text, label = "공유", className = "", variant = "secondary", size = "sm" }) {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const timerRef = useRef(null);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const url = getAppShareUrl(path);
  const share = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setStatus("");
    window.clearTimeout(timerRef.current);
    try {
      const result = await shareLink({ title, text, url });
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
      <span className="ui-share-feedback" role="status">{SHARE_FEEDBACK[status] || ""}</span>
      {status === "failed" ? <input aria-label="공유 링크" readOnly value={url} onFocus={(event) => event.target.select()} /> : null}
    </div>
  );
}
