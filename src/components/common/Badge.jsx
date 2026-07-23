export default function Badge({ children, tone = "neutral", className = "" }) {
  return <span className={`badge ui-badge badge-${tone} ui-badge-${tone} ${className}`}>{children}</span>;
}
