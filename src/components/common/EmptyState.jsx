import { CircleOff, LoaderCircle } from "lucide-react";

export default function EmptyState({
  title,
  description = "",
  action = null,
  icon: Icon,
  tone = "neutral",
  className = "",
}) {
  const normalizedTone = tone === "error" || tone === "loading" ? tone : "neutral";
  const StateIcon = Icon ?? (normalizedTone === "loading" ? LoaderCircle : CircleOff);

  return (
    <div
      className={`ui-empty-state ui-empty-state-${normalizedTone} ${className}`.trim()}
      role={normalizedTone === "error" ? "alert" : "status"}
      aria-live={normalizedTone === "error" ? "assertive" : "polite"}
      aria-busy={normalizedTone === "loading" || undefined}
    >
      <span className="ui-empty-state-icon" aria-hidden="true">
        <StateIcon size={24} strokeWidth={2.1} />
      </span>
      <div className="ui-empty-state-copy">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="ui-empty-state-actions">{action}</div> : null}
    </div>
  );
}
