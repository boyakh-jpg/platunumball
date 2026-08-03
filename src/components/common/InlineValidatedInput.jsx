import { useId, useRef } from "react";
import { getNumericInputBlurValue, isDirectNumericEntryPointer } from "../../lib/numericStepper.js";

export default function InlineValidatedInput({
  message = "",
  wrapperClassName = "",
  className = "",
  clearOnDirectEntry = false,
  ...inputProps
}) {
  const generatedId = useId();
  const blurFallbackRef = useRef(inputProps.value);
  const preservePointerFallbackRef = useRef(false);
  const messageId = `${inputProps.id || generatedId}-validation`;
  const describedBy = [inputProps["aria-describedby"], message ? messageId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <span className={`inline-validated-input${message ? " has-error" : ""}${wrapperClassName ? ` ${wrapperClassName}` : ""}`}>
      <input
        {...inputProps}
        className={className}
        aria-describedby={describedBy}
        aria-invalid={message ? "true" : undefined}
        onFocus={(event) => {
          if (!preservePointerFallbackRef.current) blurFallbackRef.current = inputProps.value;
          preservePointerFallbackRef.current = false;
          inputProps.onFocus?.(event);
        }}
        onPointerDown={(event) => {
          inputProps.onPointerDown?.(event);
          if (!clearOnDirectEntry || inputProps.type !== "number" || inputProps.disabled) return;
          if (!isDirectNumericEntryPointer(event.clientX, event.currentTarget.getBoundingClientRect().right)) return;
          blurFallbackRef.current = inputProps.value;
          preservePointerFallbackRef.current = true;
          event.currentTarget.value = "";
          inputProps.onChange?.(event);
        }}
        onBlur={(event) => {
          const blurValue = getNumericInputBlurValue(event.currentTarget.value, blurFallbackRef.current);
          if (blurValue !== event.currentTarget.value) {
            event.currentTarget.value = String(blurValue ?? "");
            inputProps.onChange?.(event);
          }
          inputProps.onBlur?.(event);
        }}
      />
      {message ? (
        <span id={messageId} className="inline-validated-input-message" aria-live="polite">
          {message}
        </span>
      ) : null}
    </span>
  );
}
