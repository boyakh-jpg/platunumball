import { getTier, getTierDivision } from "../../lib/tier.js";
import { getPlacementLabel, isPlacementComplete, normalizePlacement } from "../../lib/rating.js";
import { assetUrl } from "../../lib/assets.js";

const emblemByTier = {
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

function PlacementEmblemMark({ matchCount = 0, target = 5 }) {
  return (
    <svg
      className="tier-emblem-placement-mark"
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <path className="tier-emblem-placement-shadow" d="M24 13h72l13 15v63l-22 22H33L11 91V28z" />
      <path className="tier-emblem-placement-frame" d="M24 9h72l13 15v63l-22 22H33L11 87V24z" />
      <path className="tier-emblem-placement-inner" d="M29 19h62l8 10v53l-17 17H38L21 82V29z" />
      <path className="tier-emblem-placement-ridge" d="M31 27h58M29 89l8 8h46l8-8" />
      <path
        className="tier-emblem-placement-question"
        d="M43 47c0-11 7-18 18-18 10 0 17 6 17 15 0 8-5 12-12 16-6 4-8 7-8 13"
      />
      <circle className="tier-emblem-placement-question-dot" cx="58" cy="84" r="5" />
      <g className="tier-emblem-placement-progress">
        {Array.from({ length: target }, (_, index) => (
          <circle
            key={index}
            className={index < matchCount ? "is-complete" : ""}
            cx={44 + (index * 7)}
            cy="102"
            r="2"
          />
        ))}
      </g>
    </svg>
  );
}

export default function TierEmblem({ mmr, ratings = null, size = "md", showLabel = false }) {
  if (ratings && !isPlacementComplete(ratings)) {
    const placement = normalizePlacement(ratings.placement, ratings.integrated);
    const placementLabel = getPlacementLabel(ratings);
    return (
      <figure
        className={`tier-emblem tier-emblem-${size} tier-emblem-placement`}
        role="img"
        aria-label={`${placementLabel} 티어 엠블럼`}
      >
        <PlacementEmblemMark matchCount={placement.matchCount} target={placement.target} />
        {showLabel ? (
          <figcaption>
            <strong>배정 전</strong>
            <span>{placementLabel.replace("배정 전 · ", "")}</span>
          </figcaption>
        ) : null}
      </figure>
    );
  }
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
