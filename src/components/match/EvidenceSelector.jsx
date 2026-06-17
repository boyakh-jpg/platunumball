import { EVIDENCE_OPTIONS } from "../../lib/constants.js";

export default function EvidenceSelector({ selected, onChange }) {
  const toggle = (option) => {
    const exists = selected.some((item) => item.id === option.id);
    onChange(exists ? selected.filter((item) => item.id !== option.id) : [...selected, option]);
  };

  return (
    <div className="evidence-grid">
      {EVIDENCE_OPTIONS.length ? EVIDENCE_OPTIONS.map((option) => (
        <label key={option.id} className={selected.some((item) => item.id === option.id) ? "selected" : ""}>
          <input type="checkbox" checked={selected.some((item) => item.id === option.id)} onChange={() => toggle(option)} />
          <span>{option.label}</span>
        </label>
      )) : <span className="muted">증빙 첨부 없이 약속과 경기 메모만 기록합니다.</span>}
    </div>
  );
}
