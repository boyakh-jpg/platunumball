import { forwardRef } from "react";

const ModalShell = forwardRef(function ModalShell(
  { as: Tag = "section", className = "", children, ...props },
  ref,
) {
  return (
    <Tag
      ref={ref}
      {...props}
      className={["ui-modal-shell", className].filter(Boolean).join(" ")}
    >
      {children}
    </Tag>
  );
});

export default ModalShell;
