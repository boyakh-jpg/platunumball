import { useId } from "react";
import { isDirectNumericEntryPointer } from "../../lib/numericStepper.js";

export default function InlineValidatedInput({
  message = "",
  wrapperClassName = "",
  className = "",
  clearOnDirectEntry = false,
  ...inputProps
}) {
  const generatedId = useId();
  const messageId = `${inputProps.id || generatedId}-validation`;
  const describedBy = [inputProps["aria-describedby"], message ? messageId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <span className={`inline-validated-input${message ? " has-error" : ""}${wrapperClassName ? ` ${wrapperClassName}` : ""}`}>
      <input
        {...inputProps}
        className={className}
        aria-describedby={describedBy}
        aria-invalid={message ? "true" : undefined}
        onPointerDown={(event) => {
          inputProps.onPointerDown?.(event);
          if (!clearOnDirectEntry || inputProps.type !== "number" || inputProps.disabled) return;
          if (!isDirectNumericEntryPointer(event.clientX, event.currentTarget.getBoundingClientRect().right)) return;
          event.currentTarget.value = "";
          inputProps.onChange?.(event);
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
