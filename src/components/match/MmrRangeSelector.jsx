import { MMR_RANGE_POLICIES } from "../../lib/recruiting.js";

export default function MmrRangeSelector({
  value,
  onChange,
  ariaLabel = "정규전 허용구간",
  disabled = false,
}) {
  return (
    <div className="ui-segmented-control segmented-control compact-segments" role="radiogroup" aria-label={ariaLabel}>
      {Object.entries(MMR_RANGE_POLICIES).map(([mode, policy]) => (
        <button
          key={mode}
          type="button"
          className={value === mode ? "active" : ""}
          role="radio"
          aria-checked={value === mode}
          disabled={disabled}
          onClick={() => onChange(mode)}
        >
          {policy.label}
        </button>
      ))}
    </div>
  );
}
