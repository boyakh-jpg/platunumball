import { MMR_RANGE_POLICIES } from "../../lib/recruiting.js";

export default function MmrRangeSelector({
  value,
  onChange,
  ariaLabel = "정규전 허용구간",
}) {
  return (
    <div className="segmented-control compact-segments" role="radiogroup" aria-label={ariaLabel}>
      {Object.entries(MMR_RANGE_POLICIES).map(([mode, policy]) => (
        <button
          key={mode}
          type="button"
          className={value === mode ? "active" : ""}
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
        >
          {policy.label}
        </button>
      ))}
    </div>
  );
}
