import { getTier, getTierDivision } from "../../lib/tier.js";

const emblemByTier = {
  Rookie: "/assets/tier-emblems/tier-rookie-v2.png",
  Bronze: "/assets/tier-emblems/tier-bronze-v2.png",
  Silver: "/assets/tier-emblems/tier-silver-v2.png",
  Gold: "/assets/tier-emblems/tier-gold-v2.png",
  Platinum: "/assets/tier-emblems/tier-platinum-v2.png",
  Diamond: "/assets/tier-emblems/tier-diamond-v2.png",
  Master: "/assets/tier-emblems/tier-master-v2.png",
  Legend: "/assets/tier-emblems/tier-legend-v2.png",
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
