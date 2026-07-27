import { useState } from "react";
import { Copy } from "lucide-react";
import TierEmblem from "../rating/TierEmblem.jsx";
import { getTierDivision } from "../../lib/tier.js";

function getShareUrl(user) {
  const path = user?.id ? `/app/players/${user.id}` : "/app/profile";
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL;
  const fallbackBase = typeof window !== "undefined" ? window.location.origin : "";
  const base = String(configuredBase || fallbackBase).replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export default function ShareCard({ user }) {
  const [copied, setCopied] = useState(false);
  const mmr = Number(user.ratings.integrated);
  const shareUrl = getShareUrl(user);

  const copyLink = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="share-card">
      <div className="share-card-copy">
        <strong>{user.name}</strong>
        <span className="share-card-tier-copy">{getTierDivision(mmr)} · {Math.round(mmr)} MMR</span>
        <button className="share-card-action" type="button" onClick={copyLink}>
          <Copy size={16} />
          {copied ? "복사됨" : "프로필 링크 복사"}
        </button>
      </div>
      <div className="share-card-emblem" aria-hidden="true">
        <TierEmblem mmr={mmr} size="hero" />
      </div>
    </div>
  );
}
