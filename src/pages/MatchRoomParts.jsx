import { Star } from "lucide-react";


export function CourtReviewRating({ label, value, onChange, disabled = false }) {
  const numericValue = Number(value ?? 0);
  return (
    <div className="court-review-rating-row">
      <span>{label}</span>
      <div className="court-review-stars">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            className={numericValue >= rating ? "court-review-star-button selected" : "court-review-star-button"}
            disabled={disabled}
            onClick={() => onChange(rating)}
            aria-label={`${label} ${rating}점`}
          >
            <Star size={15} fill={numericValue >= rating ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
    </div>
  );
}
