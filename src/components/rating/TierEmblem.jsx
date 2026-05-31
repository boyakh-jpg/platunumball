import { getTier, getTierDivision } from "../../lib/tier.js";

const emblemByTier = {
  Rookie: "/assets/tier-emblems/tier-rookie-v3.png",
  Bronze: "/assets/tier-emblems/tier-bronze-v3.png",
  Silver: "/assets/tier-emblems/tier-silver-v3.png",
  Gold: "/assets/tier-emblems/tier-gold-v3.png",
  Platinum: "/assets/tier-emblems/tier-platinum-v3.png",
  Diamond: "/assets/tier-emblems/tier-diamond-v3.png",
  Master: "/assets/tier-emblems/tier-master-v3.png",
  Legend: "/assets/tier-emblems/tier-legend-v3.png",
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
