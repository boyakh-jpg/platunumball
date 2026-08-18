import Button from "../common/Button.jsx";
import Card from "../common/Card.jsx";

const MATCH_LIST_TONE_MAP = Object.freeze({
  orange: "orange",
  gold: "orange",
  danger: "orange",
  blue: "blue",
  green: "blue",
  violet: "blue",
  neutral: "neutral",
});

function normalizeBadge(value, kind) {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    return { kind, label: value };
  }
  return {
    kind: value.kind ?? kind,
    label: value.label ?? value.children,
    tone: value.tone,
  };
}

function normalizeMatchListTone(tone, fallback) {
  return MATCH_LIST_TONE_MAP[tone] ?? fallback;
}

function getBadgeTone(kind, tone = "") {
  if (kind === "status") return normalizeMatchListTone(tone, "orange");
  if (tone) return normalizeMatchListTone(tone, "neutral");
  if (kind === "mode") return "blue";
  if (kind === "target") return "orange";
  return "neutral";
}

export function MatchListBadge({ children, kind = "extra", tone = "" }) {
  if (!children) return null;
  const resolvedTone = getBadgeTone(kind, tone);
  return (
    <span className="match-list-badge" data-kind={kind} data-tone={resolvedTone}>
      {children}
    </span>
  );
}

export function MatchListSummary({ left, center = "vs", right, meta, detail, variant = "matchup" }) {
  return (
    <div className="match-list-summary ui-panel ui-match-list-summary" data-variant={variant}>
      <div className="match-list-summary__line">
        <span className="match-list-summary__side">{left}</span>
        <strong>{center}</strong>
        <span className="match-list-summary__side">{right}</span>
      </div>
      {meta || detail ? (
        <span className="match-list-summary__support">
          {meta ? <span className="match-list-summary__meta">{meta}</span> : null}
          {detail ? <span className="match-list-summary__detail">{detail}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

export default function MatchListCard({
  id,
  className = "",
  status,
  mode,
  visibility,
  roomType,
  competition,
  referee,
  extraBadges = [],
  title,
  meta,
  summary,
  actionLabel,
  onAction,
  onOpen,
}) {
  const badges = [
    normalizeBadge(status, "status"),
    normalizeBadge(mode, "mode"),
    normalizeBadge(visibility, "visibility"),
    normalizeBadge(roomType, "roomType"),
    normalizeBadge(competition, "competition"),
    normalizeBadge(referee, "referee"),
    ...extraBadges.map((badge) => normalizeBadge(badge, badge?.kind ?? "extra")),
  ].filter((badge) => badge?.label);
  const statusTone = getBadgeTone("status", status?.tone ?? "orange");
  const cardClassName = ["match-list-card", "ui-match-list-surface", className].filter(Boolean).join(" ");

  return (
    <Card
      as="article"
      id={id}
      className={cardClassName}
      data-clickable={onOpen ? "true" : undefined}
      data-status-tone={statusTone}
      onClick={onOpen}
    >
      <div className="match-list-card__main">
        <div className="match-list-card__badges">
          {badges.map((badge, index) => (
            <MatchListBadge key={`${badge.kind}-${index}`} kind={badge.kind} tone={badge.tone}>
              {badge.label}
            </MatchListBadge>
          ))}
        </div>
        {title ? <h3 className="match-list-card__title">{title}</h3> : null}
        {meta ? <p className="match-list-card__meta">{meta}</p> : null}
      </div>

      {summary}

      <Button
        className="match-list-card__action ui-button-card-action"
        variant="secondary"
        onClick={(event) => {
          event.stopPropagation();
          onAction?.(event);
        }}
      >
        {actionLabel}
      </Button>
    </Card>
  );
}
