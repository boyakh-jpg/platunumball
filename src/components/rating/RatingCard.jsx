import Card from "../common/Card.jsx";
import TierEmblem from "./TierEmblem.jsx";
import { getTierDivision, getTierProgress } from "../../lib/tier.js";
import { getPlacementLabel, hasModeRating, isPlacementComplete } from "../../lib/rating.js";

export default function RatingCard({ title, mmr, ratings = null, mode = "", className = "" }) {
  const placementPending = ratings && !isPlacementComplete(ratings);
  const modeMissing = ratings && mode && !hasModeRating(ratings, mode);
  const label = placementPending ? "배정 전" : modeMissing ? "기록 없음" : getTierDivision(mmr);
  const detail = placementPending
    ? getPlacementLabel(ratings).replace("배정 전 · ", "")
    : modeMissing ? "경쟁전 0경기" : `${Math.round(mmr)} MMR`;
  return (
    <Card className={`rating-card ${placementPending || modeMissing ? "rating-card-pending" : ""} ${className}`}>
      <div className="rating-card-top">
        <div>
          <p className="eyebrow">{title}</p>
          <strong className="ui-tier-label">{label}</strong>
          <span className="rating-mmr">{detail}</span>
        </div>
        {modeMissing ? <span className="rating-card-empty-mark" aria-hidden="true">—</span> : <TierEmblem mmr={mmr} ratings={ratings} size="sm" />}
      </div>
      {!placementPending && !modeMissing ? (
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${getTierProgress(mmr)}%` }} />
        </div>
      ) : null}
    </Card>
  );
}
