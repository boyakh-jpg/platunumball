import { Shield } from "lucide-react";

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
      role="img"
      aria-label={`${meta?.label ?? "심판"} 티어 문장`}
    >
      <div className="referee-tier-mark" aria-hidden="true">
        <Shield />
        <strong>{meta?.code ?? "C"}</strong>
      </div>
      {showLabel ? (
        <figcaption>
          <strong className="ui-tier-label">{meta?.label ?? "자격심판"}</strong>
          <span>{meta?.requirement ?? "심판 자격 유지"}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
