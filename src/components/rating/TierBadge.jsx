import { getTier, getTierDivision } from "../../lib/tier.js";

export default function TierBadge({ mmr, compact = false }) {
  const tier = getTier(mmr);
  return (
    <span className={`tier-badge ${compact ? "tier-badge-compact" : ""}`} style={{ "--tier-color": tier.color }}>
      <span className="tier-dot" />
      <span>{getTierDivision(mmr)}</span>
    </span>
  );
}
