import { useEffect, useState } from "react";
import Button from "../common/Button.jsx";
import ModalShell from "../common/ModalShell.jsx";
import useBodyScrollLock from "../../hooks/useBodyScrollLock.js";
import { BASKETBALL_POSITIONS } from "../../lib/constants.js";
import {
  TEAM_JOIN_AGE_OPTIONS,
  TEAM_JOIN_APPLICATION_LIMITS,
  TEAM_JOIN_GENDER_OPTIONS,
  getTeamJoinApplicationError,
  normalizeTeamJoinApplication,
} from "../../lib/teamJoinApplication.js";

const EMPTY_APPLICATION = normalizeTeamJoinApplication();

const REVIEW_FIELDS = [
  ["SNS", "sns"],
  ["연락처", "contact"],
  ["키", "heightCm"],
  ["포지션", "position"],
  ["경기 가능 시간", "availability"],
  ["연령대", "ageGroup"],
  ["성별", "gender"],
];

function getReviewValue(key, value) {
  if (value === "" || value == null) return "미입력";
  if (key === "heightCm") return `${value}cm`;
  if (key === "ageGroup") return TEAM_JOIN_AGE_OPTIONS.find((option) => option.value === value)?.label ?? value;
  if (key === "gender") return TEAM_JOIN_GENDER_OPTIONS.find((option) => option.value === value)?.label ?? value;
  return value;
}

export default function TeamJoinApplicationDialog({
  open,
  application,
  applicantName = "지원자",
  mode = "apply",
  pending = false,
  onClose,
  onSubmit,
}) {
  const [draft, setDraft] = useState(EMPTY_APPLICATION);
  const [error, setError] = useState("");
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    setDraft(normalizeTeamJoinApplication(application));
    setError("");
  }, [application, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !pending) onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, pending]);

  if (!open) return null;
  const review = mode === "review";
  const update = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    const validationError = getTeamJoinApplicationError(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    await onSubmit?.(normalizeTeamJoinApplication(draft));
  };

  return (
    <div className="app-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose?.(); }}>
      <ModalShell className="app-confirm-dialog team-join-application-dialog" role="dialog" aria-modal="true" aria-labelledby="team-join-application-title">
        <div>
          <p className="eyebrow">Team Application</p>
          <strong id="team-join-application-title">{review ? `${applicantName} 가입 신청서` : "팀 가입 신청서"}</strong>
          {!review ? <p>모든 항목은 선택입니다. 정보가 부족하면 팀장이 승인을 보류하거나 거절할 수 있습니다.</p> : null}
        </div>
        {review ? (
          <dl className="team-join-application-review">
            {REVIEW_FIELDS.map(([label, key]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{getReviewValue(key, draft[key])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <form className="team-join-application-form" onSubmit={submit}>
            <div className="team-join-application-grid">
              <label>SNS<input value={draft.sns} maxLength={TEAM_JOIN_APPLICATION_LIMITS.sns} placeholder="인스타그램 등" onChange={update("sns")} /></label>
              <label>연락처<input value={draft.contact} maxLength={TEAM_JOIN_APPLICATION_LIMITS.contact} placeholder="전화번호, 카카오톡 등" onChange={update("contact")} /></label>
              <label>키(cm)<input type="number" inputMode="numeric" min={TEAM_JOIN_APPLICATION_LIMITS.heightMin} max={TEAM_JOIN_APPLICATION_LIMITS.heightMax} value={draft.heightCm ?? ""} onChange={update("heightCm")} /></label>
              <label>포지션<select value={draft.position} onChange={update("position")}><option value="">선택 안 함</option>{BASKETBALL_POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}</select></label>
              <label>연령대<select value={draft.ageGroup} onChange={update("ageGroup")}><option value="">선택 안 함</option>{TEAM_JOIN_AGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label>성별<select value={draft.gender} onChange={update("gender")}><option value="">선택 안 함</option>{TEAM_JOIN_GENDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="team-join-application-wide">경기 가능 시간<textarea rows="3" maxLength={TEAM_JOIN_APPLICATION_LIMITS.availability} value={draft.availability} placeholder="예: 평일 저녁, 토요일 오후" onChange={update("availability")} /></label>
            </div>
            {error ? <span className="form-warning" role="alert">{error}</span> : null}
            <div className="app-confirm-actions ui-action-row">
              <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>취소</Button>
              <Button type="submit" disabled={pending}>{pending ? "신청 중" : "가입 신청 보내기"}</Button>
            </div>
          </form>
        )}
        {review ? <div className="app-confirm-actions ui-action-row"><Button type="button" onClick={onClose}>확인</Button></div> : null}
      </ModalShell>
    </div>
  );
}
