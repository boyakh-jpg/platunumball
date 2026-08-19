import { getMatchPlayedDate } from "../../lib/matchUtils.js";
import { getCompactCourtDisplayName } from "../../lib/courts.js";

export function PersonalRecordMetaLabels({ visibility = "private" }) {
  const isPublic = visibility === "public";
  return (
    <span className="match-record-meta__labels">
      <span className="match-record-meta__label match-record-meta__label--personal">· 내 기록</span>
      <span className={`match-record-meta__label match-record-meta__label--${isPublic ? "public" : "private"}`}>
        · {isPublic ? "공개" : "비공개"}
      </span>
    </span>
  );
}

export default function MatchRecordMeta({ record = {}, afterCourt = null, className = "" }) {
  const date = getMatchPlayedDate(record);
  const mode = record.mode ?? "";
  const court = record.court ?? "";
  const courtLabel = getCompactCourtDisplayName(court);
  const prefix = [date, mode].filter(Boolean).join(" · ");
  const rootClassName = ["match-record-meta", className].filter(Boolean).join(" ");

  if (!prefix && !afterCourt && !court) return null;
  return (
    <span className={rootClassName}>
      {prefix ? <span className="match-record-meta__prefix">{prefix}</span> : null}
      {court ? <span className="match-record-meta__court" title={court}>· {courtLabel}</span> : null}
      {afterCourt}
    </span>
  );
}
