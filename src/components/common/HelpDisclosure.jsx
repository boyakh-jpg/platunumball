export default function HelpDisclosure({ children, label = "설명 보기", className = "" }) {
  return (
    <details className={["ui-help-disclosure", className].filter(Boolean).join(" ")}>
      <summary aria-label={label} title={label}>?</summary>
      <span className="ui-help-disclosure-copy">{children}</span>
    </details>
  );
}
