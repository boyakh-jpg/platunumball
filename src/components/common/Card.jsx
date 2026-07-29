export default function Card({ children, className = "", as: Tag = "section", ...props }) {
  const categoryClass = className.split(/\s+/).includes("section-card")
    ? "ui-design-category-surface"
    : "";

  return (
    <Tag
      {...props}
      className={["card", "ui-card", "ui-design-surface", "ui-design-info-surface", categoryClass, className].filter(Boolean).join(" ")}
    >
      {children}
    </Tag>
  );
}
