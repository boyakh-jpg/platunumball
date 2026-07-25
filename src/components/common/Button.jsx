export default function Button({
  children,
  className = "",
  variant = "primary",
  size = "md",
  type = "button",
  as: Tag = "button",
  ...props
}) {
  const buttonClassName = `button ui-button button-${variant} ui-button-${variant} button-${size} ui-button-${size} ${className}`;

  if (Tag !== "button") {
    return (
      <Tag className={buttonClassName} {...props}>
        {children}
      </Tag>
    );
  }

  return (
    <button
      type={type}
      className={buttonClassName}
      {...props}
    >
      {children}
    </button>
  );
}
