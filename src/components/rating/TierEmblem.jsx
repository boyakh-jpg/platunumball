import { useId } from "react";
import { getTier, getTierDivision } from "../../lib/tier.js";

function TierMark({ name }) {
  if (name === "Rookie") {
    return (
      <>
        <circle cx="80" cy="88" r="24" />
        <path d="M58 116h44" />
      </>
    );
  }

  if (name === "Bronze") {
    return (
      <>
        <path d="M50 104l30-44 30 44" />
        <path d="M61 106h38" />
      </>
    );
  }

  if (name === "Silver") {
    return (
      <>
        <path d="M45 94c18-32 52-32 70 0" />
        <path d="M52 114h56" />
        <path d="M62 76h36" />
      </>
    );
  }

  if (name === "Gold") {
    return <path d="M80 52l9 27 28 1-22 17 8 28-23-16-23 16 8-28-22-17 28-1z" />;
  }

  if (name === "Platinum") {
    return (
      <>
        <path d="M80 48l42 25v48l-42 25-42-25V73z" />
        <path d="M58 96h44" />
        <path d="M80 62v68" />
      </>
    );
  }

  if (name === "Diamond") {
    return (
      <>
        <path d="M80 42l45 48-45 60-45-60z" />
        <path d="M52 89h56" />
        <path d="M80 42l-16 47 16 61 16-61z" />
      </>
    );
  }

  if (name === "Master") {
    return (
      <>
        <path d="M46 118l10-52 21 22 24-32 22 62z" />
        <path d="M53 124h58" />
        <circle cx="57" cy="63" r="5" />
        <circle cx="101" cy="53" r="5" />
        <circle cx="121" cy="111" r="5" />
      </>
    );
  }

  return (
    <>
      <path d="M82 42c31 30 44 57 30 82-10 18-29 27-52 20 18-11 22-25 14-42-10 11-19 15-32 11 17-14 25-29 24-51 7 5 12 12 16 22 7-14 8-27 0-42z" />
      <path d="M72 126c20-7 28-20 22-38 15 16 19 33 8 47-9 12-26 16-44 8 6-3 11-9 14-17z" />
    </>
  );
}

export default function TierEmblem({ mmr, size = "md", showLabel = false }) {
  const id = useId().replace(/:/g, "");
  const tier = getTier(mmr);
  const division = getTierDivision(mmr);
  const gradientId = `tier-emblem-gradient-${id}`;

  return (
    <figure className={`tier-emblem tier-emblem-${size}`} style={{ "--tier-color": tier.color }}>
      <svg viewBox="0 0 160 190" role="img" aria-labelledby={`${gradientId}-title`}>
        <title id={`${gradientId}-title`}>{division} 티어 문장</title>
        <defs>
          <linearGradient id={gradientId} x1="30" y1="14" x2="132" y2="168" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.38" />
            <stop offset="0.34" stopColor={tier.color} stopOpacity="0.98" />
            <stop offset="1" stopColor="#05070a" stopOpacity="0.92" />
          </linearGradient>
        </defs>
        <path className="tier-emblem-shadow" d="M80 9l59 22v60c0 41-23 72-59 91-36-19-59-50-59-91V31z" />
        <path className="tier-emblem-shield" d="M80 9l59 22v60c0 41-23 72-59 91-36-19-59-50-59-91V31z" fill={`url(#${gradientId})`} />
        <path className="tier-emblem-inner" d="M80 23l45 17v49c0 32-16 56-45 73-29-17-45-41-45-73V40z" />
        <g className="tier-emblem-court">
          <path d="M43 86h74" />
          <path d="M80 48v91" />
          <circle cx="80" cy="95" r="25" />
        </g>
        <g className={`tier-emblem-mark tier-emblem-mark-${tier.name.toLowerCase()}`}>
          <TierMark name={tier.name} />
        </g>
        <path className="tier-emblem-glint" d="M43 34l70 28" />
      </svg>
      {showLabel ? (
        <figcaption>
          <strong>{division}</strong>
          <span>{tier.name} crest</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
