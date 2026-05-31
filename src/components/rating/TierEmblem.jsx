import { getTier, getTierDivision } from "../../lib/tier.js";

const emblemByTier = {
  Rookie: "/assets/tier-emblems/tier-rookie-v4.png",
  Bronze: "/assets/tier-emblems/tier-bronze-v4.png",
  Silver: "/assets/tier-emblems/tier-silver-v4.png",
  Gold: "/assets/tier-emblems/tier-gold-v4.png",
  Platinum: "/assets/tier-emblems/tier-platinum-v4.png",
  Diamond: "/assets/tier-emblems/tier-diamond-v4.png",
  Master: "/assets/tier-emblems/tier-master-v4.png",
  Legend: "/assets/tier-emblems/tier-legend-v4.png",
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
