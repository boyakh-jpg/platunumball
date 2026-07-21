import { useState } from "react";
import { NAME_REPORT_REASONS } from "../../lib/affiliations.js";
import Button from "./Button.jsx";

export default function NameReportForm({ label = "이름", onSubmit, onCancel }) {
  const [reason, setReason] = useState(NAME_REPORT_REASONS[0]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await onSubmit(reason);
    setPending(false);
    if (!result || result.ok === false) {
      setFeedback(result?.error === "active_report_duplicate" ? "이미 신고한 이름입니다." : "신고를 접수하지 못했습니다.");
      return;
    }
    setFeedback(result.duplicate ? `이미 신고한 ${label}입니다.` : `${label} 신고를 접수했습니다.`);
  };

  return (
    <form className="name-report-form" onSubmit={submit}>
      <select value={reason} disabled={pending} aria-label={`${label} 신고 사유`} onChange={(event) => setReason(event.target.value)}>
        {NAME_REPORT_REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <div className="name-report-actions">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "접수 중" : "신고 접수"}</Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={onCancel}>닫기</Button>
      </div>
      {feedback ? <small role="status">{feedback}</small> : null}
    </form>
  );
}
