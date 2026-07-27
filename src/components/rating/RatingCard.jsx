import Card from "../common/Card.jsx";
import TierEmblem from "./TierEmblem.jsx";
import { getTierDivision, getTierProgress } from "../../lib/tier.js";

export default function RatingCard({ title, mmr, className = "" }) {
  return (
    <Card className={`rating-card ${className}`}>
      <div className="rating-card-top">
        <div>
          <p className="eyebrow">{title}</p>
          <strong>{getTierDivision(mmr)}</strong>
          <span className="rating-mmr">{Math.round(mmr)} MMR</span>
        </div>
        <TierEmblem mmr={mmr} size="sm" />
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${getTierProgress(mmr)}%` }} />
      </div>
    </Card>
  );
}
