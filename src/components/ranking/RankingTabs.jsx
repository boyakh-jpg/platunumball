export default function RankingTabs({ value, options, onChange }) {
  return (
    <div className="segmented-control">
      {options.map((option) => (
        <button
          className={value === option.id ? "active" : ""}
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
