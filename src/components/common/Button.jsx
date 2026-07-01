export default function Button({ children, className = "", variant = "primary", size = "md", type = "button", ...props }) {
  return (
    <button type={type} className={`button button-${variant} button-${size} ${className}`} {...props}>
      {children}
    </button>
  );
}
