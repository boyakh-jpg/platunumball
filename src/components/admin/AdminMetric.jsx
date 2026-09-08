import { ArrowRight } from "lucide-react";

export default function AdminMetric({ label, value, detail, tone = "neutral", onClick, disabled = false, selected }) {
  return (
    <button type="button" className={`admin-operation-metric ${tone}`} disabled={disabled} onClick={onClick} aria-pressed={selected}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <ArrowRight size={17} aria-hidden="true" />
    </button>
  );
}
