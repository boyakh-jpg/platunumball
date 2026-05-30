export default function MmrChange({ value = 0, label = "MMR" }) {
  const positive = value > 0;
  const neutral = value === 0;
  return (
    <span className={`mmr-change ${positive ? "positive" : neutral ? "neutral" : "negative"}`}>
      {label} {positive ? "+" : ""}
      {Math.round(value)}
    </span>
  );
}
