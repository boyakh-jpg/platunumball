import { getSafeInitial } from "../../lib/handles.js";

const EMBLEM_SIZES = new Set(["xs", "sm", "md", "lg"]);

export default function TeamEmblem({ team, name, accent, size = "md", className = "" }) {
  const resolvedName = name ?? team?.name ?? "";
  const resolvedAccent = accent ?? team?.accent ?? "var(--rb-orange)";
  const resolvedSize = EMBLEM_SIZES.has(size) ? size : "md";

  return (
    <span
      aria-hidden="true"
      className={`team-emblem team-emblem-${resolvedSize} ${className}`.trim()}
      style={{ "--team-color": resolvedAccent }}
    >
      {getSafeInitial(resolvedName)}
    </span>
  );
}
