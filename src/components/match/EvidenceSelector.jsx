import { EVIDENCE_OPTIONS } from "../../lib/constants.js";

export default function EvidenceSelector({ selected, onChange }) {
  const toggle = (option) => {
    const exists = selected.some((item) => item.id === option.id);
    onChange(exists ? selected.filter((item) => item.id !== option.id) : [...selected, option]);
  };

  return (
    <div className="evidence-grid">
      {EVIDENCE_OPTIONS.map((option) => (
        <label key={option.id} className={selected.some((item) => item.id === option.id) ? "selected" : ""}>
          <input type="checkbox" checked={selected.some((item) => item.id === option.id)} onChange={() => toggle(option)} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
