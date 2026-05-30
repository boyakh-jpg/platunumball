export default function Button({ children, className = "", variant = "primary", size = "md", ...props }) {
  return (
    <button className={`button button-${variant} button-${size} ${className}`} {...props}>
      {children}
    </button>
  );
}
