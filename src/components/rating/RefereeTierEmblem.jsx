import { assetUrl } from "../../lib/assets.js";

const emblemByGrade = {
  candidate: "/assets/referee-tier-emblems/referee-candidate-v1.webp",
  silver: "/assets/referee-tier-emblems/referee-silver-v1.webp",
  gold: "/assets/referee-tier-emblems/referee-gold-v1.webp",
  platinum: "/assets/referee-tier-emblems/referee-platinum-v1.webp",
  official: "/assets/referee-tier-emblems/referee-official-v1.webp",
};

const colorByGrade = {
  candidate: "#c98563",
  silver: "#78aaff",
  gold: "#ffd36c",
  platinum: "#b9a8ff",
  official: "#ffe09a",
};

export default function RefereeTierEmblem({ grade = "candidate", meta, size = "md", showLabel = false }) {
  const normalizedGrade = emblemByGrade[grade] ? grade : "candidate";
  return (
    <figure className={`tier-emblem tier-emblem-${size} referee-tier-emblem`} style={{ "--tier-color": colorByGrade[normalizedGrade] }}>
      <img src={assetUrl(emblemByGrade[normalizedGrade])} alt={`${meta?.label ?? "심판"} 티어 문장`} loading="lazy" />
      {showLabel ? (
        <figcaption>
          <strong className="ui-tier-label">{meta?.label ?? "자격심판"}</strong>
          <span>{meta?.requirement ?? "심판 자격 유지"}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
