import Card from "../common/Card.jsx";
import TierEmblem from "./TierEmblem.jsx";
import { getTierProgress, getTierQuote } from "../../lib/tier.js";

export default function RatingCard({ title, mmr, subtitle, trend }) {
  return (
    <Card className="rating-card">
      <div className="rating-card-top">
        <div>
          <p className="eyebrow">{title}</p>
          <strong>{Math.round(mmr)}</strong>
        </div>
        <TierEmblem mmr={mmr} size="sm" />
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${getTierProgress(mmr)}%` }} />
      </div>
      <div className="rating-card-bottom">
        <span>{subtitle}</span>
        {trend ? <span className={trend > 0 ? "text-positive" : "text-negative"}>{trend > 0 ? "+" : ""}{trend}</span> : null}
      </div>
      <p className="tier-quote">{getTierQuote(mmr)}</p>
    </Card>
  );
}
