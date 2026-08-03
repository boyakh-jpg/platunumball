import { assetUrl } from "../../lib/assets.js";

const emblemByGrade = {
  candidate: "/assets/referee-tier-emblems/referee-candidate-v2.webp",
  silver: "/assets/referee-tier-emblems/referee-silver-v2.webp",
  gold: "/assets/referee-tier-emblems/referee-gold-v2.webp",
  platinum: "/assets/referee-tier-emblems/referee-platinum-v2.webp",
  official: "/assets/referee-tier-emblems/referee-official-v2.webp",
};

const colorByGrade = {
  candidate: "#d58a62",
  silver: "#b9c2cf",
  gold: "#e9bd4a",
  platinum: "#64d6c4",
  official: "#f2f0e8",
};

export default function RefereeTierEmblem({ grade = "candidate", meta, size = "md", showLabel = false }) {
  const normalizedGrade = colorByGrade[grade] ? grade : "candidate";
  return (
    <figure
      className={`tier-emblem tier-emblem-${size} referee-tier-emblem referee-tier-${normalizedGrade}`}
      style={{ "--tier-color": colorByGrade[normalizedGrade] }}
    >
      <img
        src={assetUrl(emblemByGrade[normalizedGrade])}
        alt={`${meta?.label ?? "심판"} 티어 문장`}
        loading="lazy"
      />
      {showLabel ? (
        <figcaption>
          <strong className="ui-tier-label">{meta?.label ?? "자격심판"}</strong>
          <span>{meta?.requirement ?? "심판 자격 유지"}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
