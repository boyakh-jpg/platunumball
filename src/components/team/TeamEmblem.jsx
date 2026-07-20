import { useEffect, useState } from "react";
import { assetUrl } from "../../lib/assets.js";
import { getTeamEmblemTextLines, normalizeTeamEmblemFont } from "../../lib/teamEmblem.js";

const EMBLEM_SIZES = new Set(["xs", "sm", "md", "lg"]);

export default function TeamEmblem({ team, name, accent, size = "md", className = "" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedName = name ?? team?.name ?? "";
  const resolvedAccent = accent ?? team?.accent ?? "var(--rb-orange)";
  const resolvedBackground = team?.emblemColor ?? resolvedAccent;
  const resolvedBorder = team?.emblemBorderColor ?? resolvedAccent;
  const borderEnabled = team?.emblemBorderEnabled !== false;
  const resolvedSize = EMBLEM_SIZES.has(size) ? size : "md";
  const emblemSource = team?.emblemSource ?? (team?.emblemKey ? "upload" : "initial");
  const keyedUrl = emblemSource === "upload" && team?.emblemKey ? assetUrl(`/${String(team.emblemKey).replace(/^\/+/, "")}`) : "";
  const resolvedImageUrl = emblemSource === "upload"
    ? (keyedUrl && !keyedUrl.startsWith("/") ? keyedUrl : team?.emblemUrl ?? keyedUrl)
    : "";
  const textLines = getTeamEmblemTextLines(team, resolvedName);
  const textDensity = Math.max(...textLines.map((line) => Array.from(line).length), 1);
  const textScale = Math.max(0.24, Math.min(1.9, 2 / textDensity));
  const textClass = textDensity > 8 ? "dense" : textDensity > 5 ? "compact" : "regular";
  const lineClass = textLines.length >= 3 ? "three-lines" : textLines.length === 2 ? "two-lines" : "one-line";
  const emblemFont = normalizeTeamEmblemFont(team?.emblemFont);

  useEffect(() => setImageFailed(false), [resolvedImageUrl, team?.emblemUpdatedAt]);

  return (
    <span
      aria-hidden="true"
      className={`team-emblem team-emblem-${resolvedSize} ${resolvedImageUrl && !imageFailed ? "has-image" : ""} ${borderEnabled ? "" : "no-emblem-border"} ${className}`.trim()}
      style={{
        "--team-color": resolvedAccent,
        "--team-emblem-bg": resolvedBackground,
        "--team-emblem-border": resolvedBorder,
        "--team-emblem-text-scale": `${textScale.toFixed(3)}em`,
      }}
    >
      {resolvedImageUrl && !imageFailed ? (
        <img src={resolvedImageUrl} alt="" loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
      ) : (
        <span className={`team-emblem-text team-emblem-font-${emblemFont} ${textClass} ${lineClass}`}>
          {textLines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
        </span>
      )}
    </span>
  );
}
