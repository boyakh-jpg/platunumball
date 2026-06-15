export default function Card({ children, className = "", as: Tag = "section", ...props }) {
  return <Tag {...props} className={`card ${className}`}>{children}</Tag>;
}
