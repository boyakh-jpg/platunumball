import { ChevronDown, ChevronUp } from "lucide-react";
import { clampNumericStepperValue } from "../../lib/numericStepper.js";

export default function NumericStepper({
  value,
  min = 0,
  max = 999,
  disabled = false,
  onChange,
  label,
  className = "",
  clearZeroOnFocus = false,
  clearOnFocus = false,
  integer = true,
}) {
  const numericValue = clampNumericStepperValue(value, min, max, integer);
  const setNextValue = (nextValue) => onChange?.(
    clampNumericStepperValue(nextValue, min, max, integer),
  );
  const inputValue = value === "" ? "" : numericValue;

  return (
    <div className={["ui-numeric-stepper", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setNextValue(numericValue + 1)}
        aria-label={`${label} 1 증가`}
        title="1 증가"
      >
        <ChevronUp size={18} strokeWidth={3} />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        inputMode="numeric"
        pattern="[0-9]*"
        disabled={disabled}
        value={inputValue}
        onFocus={() => {
          if (clearOnFocus || (clearZeroOnFocus && numericValue === 0)) onChange?.("");
        }}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange?.("");
            return;
          }
          setNextValue(event.target.value);
        }}
        aria-label={label}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setNextValue(numericValue - 1)}
        aria-label={`${label} 1 감소`}
        title="1 감소"
      >
        <ChevronDown size={18} strokeWidth={3} />
      </button>
    </div>
  );
}
