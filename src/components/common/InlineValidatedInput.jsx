import { useId } from "react";

export default function InlineValidatedInput({
  message = "",
  wrapperClassName = "",
  className = "",
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
      />
      {message ? (
        <span id={messageId} className="inline-validated-input-message" aria-live="polite">
          {message}
        </span>
      ) : null}
    </span>
  );
}
