import { useEffect, useState } from "react";
import { assetUrl } from "../../lib/assets.js";
import { getSafeInitial } from "../../lib/handles.js";

const EMBLEM_SIZES = new Set(["xs", "sm", "md", "lg"]);

export default function TeamEmblem({ team, name, accent, size = "md", className = "" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedName = name ?? team?.name ?? "";
  const resolvedAccent = accent ?? team?.accent ?? "var(--rb-orange)";
  const resolvedSize = EMBLEM_SIZES.has(size) ? size : "md";
  const keyedUrl = team?.emblemKey ? assetUrl(`/${String(team.emblemKey).replace(/^\/+/, "")}`) : "";
  const resolvedImageUrl = keyedUrl && !keyedUrl.startsWith("/") ? keyedUrl : team?.emblemUrl ?? keyedUrl;

  useEffect(() => setImageFailed(false), [resolvedImageUrl, team?.emblemUpdatedAt]);

  return (
    <span
      aria-hidden="true"
      className={`team-emblem team-emblem-${resolvedSize} ${resolvedImageUrl && !imageFailed ? "has-image" : ""} ${className}`.trim()}
      style={{ "--team-color": resolvedAccent }}
    >
      {resolvedImageUrl && !imageFailed ? (
        <img src={resolvedImageUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
      ) : getSafeInitial(resolvedName)}
    </span>
  );
}
