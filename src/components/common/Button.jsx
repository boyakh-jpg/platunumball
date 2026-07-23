export default function Button({ children, className = "", variant = "primary", size = "md", type = "button", ...props }) {
  return (
    <button
      type={type}
      className={`button ui-button button-${variant} ui-button-${variant} button-${size} ui-button-${size} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
