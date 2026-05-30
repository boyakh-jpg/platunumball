import { getTier, getTierDivision } from "../../lib/tier.js";

const emblemByTier = {
  Rookie: "/assets/tier-emblems/tier-rookie-v1.png",
  Bronze: "/assets/tier-emblems/tier-bronze-v1.png",
  Silver: "/assets/tier-emblems/tier-silver-v1.png",
  Gold: "/assets/tier-emblems/tier-gold-v1.png",
  Platinum: "/assets/tier-emblems/tier-platinum-v1.png",
  Diamond: "/assets/tier-emblems/tier-diamond-v1.png",
  Master: "/assets/tier-emblems/tier-master-v1.png",
  Legend: "/assets/tier-emblems/tier-legend-v1.png",
};

export default function TierEmblem({ mmr, size = "md", showLabel = false }) {
  const tier = getTier(mmr);
  const division = getTierDivision(mmr);
  const src = emblemByTier[tier.name] ?? emblemByTier.Rookie;

  return (
    <figure className={`tier-emblem tier-emblem-${size}`} style={{ "--tier-color": tier.color }}>
      <img src={src} alt={`${division} 티어 문장`} loading="lazy" />
      {showLabel ? (
        <figcaption>
          <strong>{division}</strong>
          <span>{tier.name} crest</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
