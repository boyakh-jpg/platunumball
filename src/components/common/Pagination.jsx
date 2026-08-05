import { ChevronLeft, ChevronRight } from "lucide-react";
import Button from "./Button.jsx";

export function getPaginationPages(page = 0, totalPages = 1) {
  const count = Math.min(3, Math.max(1, totalPages));
  const start = Math.min(Math.max(0, page - 1), Math.max(0, totalPages - count));
  return Array.from({ length: count }, (_, index) => start + index);
}

export default function Pagination({ page = 0, totalPages = 1, disabled = false, onChange, className = "" }) {
  return (
    <nav className={`ui-pagination ${className}`} aria-label="페이지 이동">
      <Button size="sm" variant="secondary" aria-label="이전 페이지" disabled={disabled || page <= 0} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={17} />
      </Button>
      {getPaginationPages(page, totalPages).map((pageNumber) => (
        <Button
          key={pageNumber}
          size="sm"
          variant={pageNumber === page ? "primary" : "secondary"}
          aria-current={pageNumber === page ? "page" : undefined}
          disabled={disabled}
          onClick={() => onChange(pageNumber)}
        >
          {pageNumber + 1}
        </Button>
      ))}
      <Button size="sm" variant="secondary" aria-label="다음 페이지" disabled={disabled || page >= totalPages - 1} onClick={() => onChange(page + 1)}>
        <ChevronRight size={17} />
      </Button>
    </nav>
  );
}
