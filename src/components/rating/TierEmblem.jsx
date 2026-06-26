import { getTier, getTierDivision } from "../../lib/tier.js";
import { assetUrl } from "../../lib/assets.js";

export const emblemByTier = {
  Rookie: "/assets/tier-emblems/tier-rookie-v5.webp",
  Bronze: "/assets/tier-emblems/tier-bronze-v5.webp",
  Silver: "/assets/tier-emblems/tier-silver-v5.webp",
  Gold: "/assets/tier-emblems/tier-gold-v5.webp",
  Platinum: "/assets/tier-emblems/tier-platinum-v5.webp",
  Diamond: "/assets/tier-emblems/tier-diamond-v5.webp",
  Master: "/assets/tier-emblems/tier-master-v5.webp",
  Legend: "/assets/tier-emblems/tier-legend-v5.webp",
};

export function getTierEmblemSrc(mmr) {
  const tier = getTier(mmr);
  return assetUrl(emblemByTier[tier.name] ?? emblemByTier.Rookie);
}

export default function TierEmblem({ mmr, size = "md", showLabel = false }) {
  const tier = getTier(mmr);
  const division = getTierDivision(mmr);
  const src = getTierEmblemSrc(mmr);

  return (
    <figure className={`tier-emblem tier-emblem-${size}`} style={{ "--tier-color": tier.color }}>
      <img src={src} alt={`${division} 티어 문장`} loading="lazy" />
      {showLabel ? (
        <figcaption>
          <strong>{division}</strong>
          <span>{Math.round(mmr)} MMR</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
