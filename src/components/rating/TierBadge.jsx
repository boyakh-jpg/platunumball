import { getTier, getTierDivision } from "../../lib/tier.js";
import { getPlacementLabel, isPlacementComplete } from "../../lib/rating.js";
import { getTierEmblemSrc } from "./TierEmblem.jsx";

export default function TierBadge({ mmr, ratings = null, compact = false }) {
  if (ratings && !isPlacementComplete(ratings)) {
    return (
      <span className={`tier-badge tier-badge-placement ${compact ? "tier-badge-compact" : ""}`}>
        <span>{getPlacementLabel(ratings)}</span>
      </span>
    );
  }
  const tier = getTier(mmr);
  const division = getTierDivision(mmr);
  return (
    <span className={`tier-badge ${compact ? "tier-badge-compact" : ""}`} style={{ "--tier-color": tier.color }}>
      <img src={getTierEmblemSrc(mmr)} alt={`${division} emblem`} loading="lazy" />
      <span>{division}</span>
    </span>
  );
}
