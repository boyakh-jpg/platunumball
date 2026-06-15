import { getTier, getTierDivision } from "../../lib/tier.js";
import { getTierEmblemSrc } from "./TierEmblem.jsx";

export default function TierBadge({ mmr, compact = false }) {
  const tier = getTier(mmr);
  const division = getTierDivision(mmr);
  return (
    <span className={`tier-badge ${compact ? "tier-badge-compact" : ""}`} style={{ "--tier-color": tier.color }}>
      <img src={getTierEmblemSrc(mmr)} alt={`${division} emblem`} loading="lazy" />
      <span>{division}</span>
    </span>
  );
}
