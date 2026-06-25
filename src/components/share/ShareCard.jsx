import { useState } from "react";
import { Copy, Trophy } from "lucide-react";
import TierEmblem from "../rating/TierEmblem.jsx";
import { getTierDivision } from "../../lib/tier.js";

function getShareUrl(user) {
  const path = user?.id ? `/app/players/${user.id}` : "/app/profile";
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL;
  const fallbackBase = typeof window !== "undefined" ? window.location.origin : "";
  const base = String(configuredBase || fallbackBase).replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export default function ShareCard({ user, match }) {
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
        <div className="share-card-label">
          <Trophy size={22} />
          <span>공유 카드</span>
        </div>
        <h3>{match?.title ?? "오늘의 코트"}</h3>
        <strong>{user.name}</strong>
        <span className="share-card-tier-copy">{getTierDivision(mmr)} · {Math.round(mmr)} MMR</span>
        <p>
          {user.region} 코트 통합 {Math.round(mmr)} MMR · {user.streak > 0 ? `${user.streak}연승` : "다음 경기 대기"}
        </p>
        <button className="share-card-action" type="button" onClick={copyLink}>
          <Copy size={16} />
          {copied ? "복사됨" : "링크 복사"}
        </button>
        <small className="share-card-url">{shareUrl}</small>
      </div>
      <div className="share-card-emblem" aria-hidden="true">
        <TierEmblem mmr={mmr} size="hero" />
      </div>
    </div>
  );
}
