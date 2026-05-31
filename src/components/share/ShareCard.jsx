import { useState } from "react";
import { Copy, Trophy } from "lucide-react";
import TierBadge from "../rating/TierBadge.jsx";

export default function ShareCard({ user, match }) {
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="share-card">
      <div>
        <Trophy size={22} />
        <span>공유 카드</span>
      </div>
      <h3>{match?.title ?? "오늘의 판"}</h3>
      <strong>{user.name}</strong>
      <TierBadge mmr={user.ratings.integrated} />
      <p>
        {user.region} 코트 통합 {Math.round(user.ratings.integrated)} MMR · {user.streak > 0 ? `${user.streak}연승` : "다음 판 대기"}
      </p>
      <button className="share-card-action" type="button" onClick={copyLink}>
        <Copy size={16} />
        {copied ? "복사됨" : "링크 복사"}
      </button>
    </div>
  );
}
