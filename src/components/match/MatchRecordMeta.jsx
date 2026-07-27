function getRecordDate(value = {}) {
  return value.recordDate
    ?? value.scheduledDate
    ?? value.scheduledAt
    ?? value.confirmedAt
    ?? value.createdAt
    ?? "";
}

export default function MatchRecordMeta({ record = {}, afterMode = null, className = "" }) {
  const date = getRecordDate(record);
  const mode = record.mode ?? "";
  const court = record.court ?? "";
  const prefix = [date, mode].filter(Boolean).join(" · ");
  const rootClassName = ["match-record-meta", className].filter(Boolean).join(" ");

  if (!prefix && !afterMode && !court) return null;
  return (
    <span className={rootClassName}>
      {prefix ? <span className="match-record-meta__prefix">{prefix}</span> : null}
      {afterMode}
      {court ? <span className="match-record-meta__court">· {court}</span> : null}
    </span>
  );
}
